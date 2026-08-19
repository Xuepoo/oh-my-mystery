import type { ArmName, ArmPlan } from './arms';
import type { BrowserName } from './browser';
import type { FixtureManifest } from './fixture';
import type { InteractionResultRecord } from './interactions';
import type { PhysicsBrowserResult } from './physics-browser';
import type { PreviewProcess } from './process';
import type { OmmBaselineReportV1 } from './report';

export type BaselineMode =
  | { mode: 'validate-fixtures' }
  | { mode: 'generate-graphs'; check: boolean }
  | { mode: 'capture'; repetitions: 1 | 3 | 5 };

export interface ValidatedFixture {
  schemaVersion: number;
  sha256: string;
  value: FixtureManifest | unknown;
}

export interface PreflightContext {
  candidateRoot: string;
  candidateRevision: string;
  runnerRevision: string;
  runId: string;
  baselineRevision?: string;
  quotable?: boolean;
}

export interface PreparedArm {
  plan?: ArmPlan;
  artifact?: unknown;
  physicsBundle?: unknown;
}

export interface PreparedBaseline {
  context?: PreflightContext;
  arms?: Partial<Record<ArmName, PreparedArm>>;
  [key: string]: unknown;
}

export interface RunningPreviews {
  previews?: readonly PreviewProcess[];
  urls?: Partial<Record<ArmName, string>>;
  [key: string]: unknown;
}

export interface CaptureRequest {
  arm: ArmName;
  browser: BrowserName;
  repetition: number;
}

export interface CaptureResult {
  request?: CaptureRequest;
  interaction?: readonly InteractionResultRecord[];
  physics?: readonly PhysicsBrowserResult[];
  [key: string]: unknown;
}

export interface BaselineBrowserSession {
  capture(request: CaptureRequest): Promise<CaptureResult>;
  close(): Promise<void>;
}

export interface ReportAssemblyInput {
  mode: Extract<BaselineMode, { mode: 'capture' }>;
  fixture: ValidatedFixture;
  preflight: PreflightContext;
  prepared: PreparedBaseline;
  captures: readonly CaptureResult[];
}

export interface BaselineRunnerDependencies {
  validateFixtures(): Promise<ValidatedFixture>;
  generateGraphs(check: boolean): Promise<void>;
  checkGraphs(): Promise<void>;
  preflight(mode: Extract<BaselineMode, { mode: 'capture' }>): Promise<PreflightContext>;
  prepare(context: PreflightContext): Promise<PreparedBaseline>;
  startPreviews(prepared: PreparedBaseline): Promise<RunningPreviews>;
  startBrowser(input: {
    fixture: ValidatedFixture;
    prepared: PreparedBaseline;
    previews: RunningPreviews;
  }): Promise<BaselineBrowserSession>;
  assembleReport(input: ReportAssemblyInput): Promise<unknown>;
  validateReport(report: unknown): OmmBaselineReportV1 | unknown;
  compareReport(report: unknown): Promise<unknown>;
  writeReport(report: unknown, input: ReportAssemblyInput): Promise<void>;
  stopPreviews(previews: RunningPreviews): Promise<void>;
  cleanup(prepared: PreparedBaseline): Promise<void>;
}

export function parseBaselineArguments(arguments_: readonly string[]): BaselineMode {
  const known = new Set([
    '--validate-fixtures',
    '--generate-graphs',
    '--check',
    '--diagnostic',
    '--soak',
  ]);
  const unknown = arguments_.find((argument) => !known.has(argument));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  if (new Set(arguments_).size !== arguments_.length)
    throw new Error('Duplicate baseline argument');

  const validateFixtures = arguments_.includes('--validate-fixtures');
  const generateGraphs = arguments_.includes('--generate-graphs');
  const diagnostic = arguments_.includes('--diagnostic');
  const soak = arguments_.includes('--soak');
  const selectedModes =
    Number(validateFixtures) + Number(generateGraphs) + Number(diagnostic) + Number(soak);
  if (selectedModes > 1) throw new Error('Choose exactly one baseline mode');
  if (arguments_.includes('--check') && !generateGraphs) {
    throw new Error('--check requires --generate-graphs');
  }
  if (validateFixtures) return { mode: 'validate-fixtures' };
  if (generateGraphs) return { mode: 'generate-graphs', check: arguments_.includes('--check') };
  return { mode: 'capture', repetitions: diagnostic ? 1 : soak ? 3 : 5 };
}

export async function runBaseline(
  mode: BaselineMode,
  dependencies: BaselineRunnerDependencies,
): Promise<void> {
  if (mode.mode === 'validate-fixtures') {
    await dependencies.validateFixtures();
    return;
  }
  if (mode.mode === 'generate-graphs') {
    await dependencies.generateGraphs(mode.check);
    return;
  }

  const fixture = await dependencies.validateFixtures();
  await dependencies.checkGraphs();
  const preflight = await dependencies.preflight(mode);
  let prepared: PreparedBaseline | undefined;
  let previews: RunningPreviews | undefined;
  let browser: BaselineBrowserSession | undefined;
  let failure: Error | undefined;
  const cleanupFailures: Error[] = [];

  try {
    prepared = await dependencies.prepare(preflight);
    previews = await dependencies.startPreviews(prepared);
    browser = await dependencies.startBrowser({ fixture, prepared, previews });
    const captures: CaptureResult[] = [];
    for (const request of captureOrder(mode.repetitions)) {
      try {
        captures.push(await browser.capture(request));
      } catch (error) {
        throw new Error(
          `Capture ${request.arm}/${request.browser}/repetition-${request.repetition} failed: ${asError(error).message}`,
          { cause: error },
        );
      }
    }

    const input: ReportAssemblyInput = { mode, fixture, preflight, prepared, captures };
    let report = dependencies.validateReport(await dependencies.assembleReport(input));
    if (mode.repetitions === 5) {
      report = dependencies.validateReport(await dependencies.compareReport(report));
      const failures = comparisonFailures(report);
      await dependencies.writeReport(report, input);
      if (failures.length > 0) {
        throw new Error(`Baseline comparison failed: ${failures.join(', ')}`);
      }
    } else {
      await dependencies.writeReport(report, input);
    }
  } catch (error) {
    failure = asError(error);
  } finally {
    for (const cleanup of [
      browser && (() => browser.close()),
      previews && (() => dependencies.stopPreviews(previews)),
      prepared && (() => dependencies.cleanup(prepared)),
    ]) {
      if (!cleanup) continue;
      try {
        await cleanup();
      } catch (error) {
        cleanupFailures.push(asError(error));
      }
    }
  }
  if (failure !== undefined) {
    if (cleanupFailures.length > 0) {
      throw new AggregateError([failure, ...cleanupFailures], 'Baseline run and cleanup failed');
    }
    throw failure;
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, 'Baseline cleanup failed');
  }
}

function comparisonFailures(report: unknown): string[] {
  if (!report || typeof report !== 'object' || !('comparison' in report)) return [];
  const comparison = (report as { comparison?: unknown }).comparison;
  if (!Array.isArray(comparison)) return [];
  return comparison
    .filter(
      (outcome): outcome is { status: string; findingKey?: string; metricId?: string } =>
        Boolean(outcome) &&
        typeof outcome === 'object' &&
        (outcome as { status?: unknown }).status === 'fail',
    )
    .map((outcome) => outcome.findingKey || outcome.metricId || 'unknown');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function captureOrder(repetitions: 1 | 3 | 5): CaptureRequest[] {
  if (repetitions === 1) {
    return [
      { arm: 'candidate', browser: 'chrome', repetition: 1 },
      { arm: 'candidate', browser: 'firefox', repetition: 1 },
    ];
  }

  if (repetitions === 3) {
    return Array.from({ length: repetitions }, (_, index) => index + 1).flatMap((repetition) => [
      { arm: 'candidate' as const, browser: 'chrome' as const, repetition },
      { arm: 'candidate' as const, browser: 'firefox' as const, repetition },
    ]);
  }

  const requests: CaptureRequest[] = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const odd = repetition % 2 === 1;
    const browsers: BrowserName[] = odd ? ['chrome', 'firefox'] : ['firefox', 'chrome'];
    const arms: ArmName[] = odd ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const browser of browsers) {
      for (const arm of arms) requests.push({ arm, browser, repetition });
    }
  }
  return requests;
}

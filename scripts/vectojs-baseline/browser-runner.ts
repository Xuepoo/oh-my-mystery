import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform as osPlatform, release as osRelease, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import {
  buildArmPlan,
  assertRepeatedInstallEqual,
  createInstalledPackageManifest,
  dependencyVersionRecord,
  hashPreparedManifest,
  parseVectoLockVersions,
  type ArmPlan,
  type InstallSnapshot,
  validateVectoResolutions,
} from './arms';
import {
  startPreview,
  stopPreviews,
  type PreviewDependencies,
  type PreviewProcess,
} from './process';
import {
  compareFiveRuns,
  compareZeroRequired,
  medianOfFive,
  nearestRank,
  type CorrectnessFailure,
} from './metrics';
import {
  classifyEscapeFinding,
  classifyOverlapFinding,
  classifyTargetFinding,
  type EdgeDepths,
  type FindingClassification,
  type OverlapFinding,
  type TargetState,
} from './geometry';
import {
  hashReport,
  type BaselineArtifact,
  type BaselineEnvironment,
  type BaselineRun,
  type BaselineViewport,
  type JsonObject,
  type OmmBaselineReportV1,
} from './report';
import type {
  BaselineMode,
  BaselineRunnerDependencies,
  CaptureResult,
  PreflightContext,
  PreparedBaseline,
  ReportAssemblyInput,
} from './runner';
import type { ArmName, CommandSpec, PhysicsBundlePlan } from './arms';
import { hashBytes } from './manifest';
import type { RunningPreviews } from './runner';
import {
  assertViewportAndBacking,
  browserContextOptions,
  browserExecutableMetadata,
  headedLaunchArgs,
  mergeLaunchEnvironment,
  readObservedViewport,
  resolveBrowserExecutable,
  runInNewContext,
  waitForApplicationReady,
  waitForStablePredicate,
  type BrowserExecutableMetadata,
  type BrowserName,
  type ViewportSpec,
} from './browser';
import {
  collectGeometryFromPage,
  collectIdleAudit,
  type EscapeAuditFinding,
  type TargetAuditFinding,
} from './audits';
import { runScenario, scenarioIds, type ScenarioId } from './interactions';
import { createFixtureRouter, installFixtureRoutes } from './routes';
import type { FixtureManifest } from './fixture';
import { graphFixtureDirectory, graphSpecs } from './generate-graphs';
import type { PhysicsBrowserRequest, PhysicsBrowserResult } from './physics-browser';

export const BASELINE_REVISION = 'ba80218944e424419c065ab0b0bbe4c3ed05580c';
const IDLE_WAIT_TIMEOUT_MS = 45_000;

export interface SnapshotHash {
  sha256: string;
}
export interface PhysicsBundleArtifact extends SnapshotHash {
  path: string;
  graphLayoutPackagePath: string;
}

export interface BrowserRunnerPlatform {
  cwd(): string;
  environment: Record<string, string | undefined>;
  now(): Date;
  command(command: CommandSpec): Promise<string>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
  sourceSnapshot(root: string): SnapshotHash;
  installSnapshot(root: string): InstallSnapshot;
  buildSnapshot(root: string): SnapshotHash;
  bundlePhysics(plan: PhysicsBundlePlan): Promise<PhysicsBundleArtifact>;
  startPreview(options: {
    root: string;
    arm: ArmName;
    port: number;
    environment: Record<string, string | undefined>;
  }): Promise<PreviewProcess>;
  stopPreviews(previews: readonly PreviewProcess[]): Promise<void>;
  launchBrowsers(input: {
    fixture: unknown;
    prepared: PreparedBaseline;
    previews: RunningPreviews;
  }): Promise<{
    capture(request: {
      arm: ArmName;
      browser: 'chrome' | 'firefox';
      repetition: number;
    }): Promise<CaptureResult>;
    close(): Promise<void>;
  }>;
}

interface PreparedReportData {
  artifacts: BaselineArtifact[];
  environments: BaselineEnvironment[];
  viewports: BaselineViewport[];
  workloads: Record<string, unknown>[];
}

const defaultPlatform: BrowserRunnerPlatform = {
  cwd: () => process.cwd(),
  environment: process.env,
  now: () => new Date(),
  async command(command) {
    const child = Bun.spawn(command.argv, {
      cwd: command.cwd,
      env: command.env,
      stdout: command.captureOutput ? 'pipe' : 'inherit',
      stderr: 'inherit',
    });
    const output = command.captureOutput ? await new Response(child.stdout).text() : '';
    const status = await child.exited;
    if (status !== 0) throw new Error(`Command failed (${status}): ${command.argv.join(' ')}`);
    return output;
  },
  remove: (path) => rm(path, { recursive: true, force: true }),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeFile: (path, content) => writeFile(path, content),
  readFile: (path) => readFile(path, 'utf8'),
  sourceSnapshot: (root) => ({ sha256: hashDirectoryFallback(root) }),
  installSnapshot: (root) => installSnapshot(root),
  buildSnapshot: (root) => ({ sha256: hashDirectoryFallback(join(root, 'apps/web/dist')) }),
  async bundlePhysics(plan) {
    await mkdir(plan.outputDir, { recursive: true });
    const result = await Bun.build({
      entrypoints: [plan.entryPoint],
      outdir: plan.outputDir,
      target: 'browser',
      minify: false,
    });
    if (!result.success) {
      throw new Error(result.logs.map(formatBuildDiagnostic).join('\n'));
    }
    const outputFiles = (await readdir(plan.outputDir)).filter((file) => file.endsWith('.js'));
    if (outputFiles.length !== 1) {
      throw new Error(`Expected one physics bundle, found ${outputFiles.join(', ')}`);
    }
    const output = join(plan.outputDir, outputFiles[0]!);
    return {
      path: output,
      sha256: hashDirectoryFallback(plan.outputDir),
      graphLayoutPackagePath: join(plan.root, 'apps/web/node_modules/@vectojs/graph-layout'),
    };
  },
  startPreview: (options) => startPreview(options, defaultPreviewDependencies),
  stopPreviews: (previews) => stopPreviews(previews),
  launchBrowsers: (input) => launchBrowsers(input),
};

const defaultPreviewDependencies: PreviewDependencies = {
  spawn(command) {
    const child = Bun.spawn(command.argv, {
      cwd: command.cwd,
      env: command.env,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'inherit',
    });
    return { exited: child.exited, kill: (signal) => child.kill(signal) };
  },
  async probe(url) {
    try {
      return (await fetch(url, { redirect: 'manual' })).status < 500;
    } catch {
      return false;
    }
  },
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  now: () => Date.now(),
};

const interactionViewports: readonly ViewportSpec[] = [
  { width: 1280, height: 800, dpr: 1, mobile: false },
  { width: 1440, height: 900, dpr: 1, mobile: false },
  { width: 390, height: 844, dpr: 2, mobile: true },
  { width: 412, height: 915, dpr: 2, mobile: true },
];
const physicsViewport: ViewportSpec = { width: 1280, height: 800, dpr: 1, mobile: false };

interface BrowserTypeAdapter {
  executablePath(): string;
  launch(options: {
    executablePath: string;
    headless: boolean;
    timeout?: number;
    args?: string[];
    env?: Record<string, string>;
  }): Promise<Browser>;
}

export interface LaunchBrowserDependencies {
  chromium: BrowserTypeAdapter;
  firefox: BrowserTypeAdapter;
  readExecutable(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
}

const defaultLaunchBrowserDependencies: LaunchBrowserDependencies = {
  chromium,
  firefox,
  readExecutable: async (path) => readFile(path),
  readText: async (path) => readFile(path, 'utf8'),
};

const require = createRequire(import.meta.url);

interface BrowserRuntimeInfo {
  userAgent: string;
  hardwareConcurrency: number;
}

function collectNodeEnvironment(): { os: string; cpu: string; memoryBytes: number } {
  return {
    os: `${osPlatform()} ${osRelease()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    memoryBytes: totalmem(),
  };
}

function installedPlaywrightVersion(): string {
  return require('playwright/package.json').version as string;
}

function buildEnvironment(
  browser: BrowserName,
  metadata: BrowserExecutableMetadata,
  runtime: BrowserRuntimeInfo,
): BaselineEnvironment {
  return {
    id: browser,
    browser,
    executableSha256: metadata.executableSha256,
    userAgent: runtime.userAgent,
    hardwareConcurrency: runtime.hardwareConcurrency,
    ...collectNodeEnvironment(),
    browserExecutable: metadata.executablePath,
    browserVersion: metadata.version,
    playwrightVersion: installedPlaywrightVersion(),
    bunVersion: Bun.version,
  };
}

export async function launchBrowsers(
  input: Parameters<BrowserRunnerPlatform['launchBrowsers']>[0],
  dependencies: LaunchBrowserDependencies = defaultLaunchBrowserDependencies,
): Promise<Awaited<ReturnType<BrowserRunnerPlatform['launchBrowsers']>>> {
  const fixture = readFixture(input.fixture);
  const launched = new Map<BrowserName, Browser>();

  return {
    async capture(request) {
      console.log(
        `[baseline] capture start: ${request.arm}/${request.browser}/repetition-${request.repetition}`,
      );
      for (const browser of launched.values())
        await withTimeout(browser.close(), 15_000, 'browser rotation cleanup');
      launched.clear();
      const previewUrl = input.previews.urls?.[request.arm];
      if (!previewUrl) throw new Error(`Missing ${request.arm} preview URL`);
      const preparedArm = input.prepared.arms?.[request.arm] as
        | { physicsBundle?: PhysicsBundleArtifact }
        | undefined;
      if (!preparedArm?.physicsBundle?.path) {
        throw new Error(`Missing ${request.arm} physics browser bundle`);
      }
      const browserType =
        request.browser === 'chrome' ? dependencies.chromium : dependencies.firefox;
      let browser = launched.get(request.browser);
      if (!browser) {
        const executablePath = resolveBrowserExecutable(request.browser, browserType);
        const browserTempRoot = join(
          (input.prepared.context as PreflightContext).candidateRoot,
          'tmp',
          'vectojs-baseline',
          'browser-tmp',
        );
        await mkdir(browserTempRoot, { recursive: true });
        const previousTmpdir = process.env.TMPDIR;
        process.env.TMPDIR = '/proc/self/cwd/tmp/vectojs-baseline/browser-tmp';
        try {
          console.log(`[baseline] ${request.arm}/${request.browser} browser launch start`);
          browser = await withTimeout(
            browserType.launch({
              executablePath,
              headless: false,
              args: headedLaunchArgs(request.browser),
              timeout: 30_000,
              env: {
                ...Object.fromEntries(
                  Object.entries(process.env).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                  ),
                ),
                TMPDIR: '/proc/self/cwd/tmp/vectojs-baseline/browser-tmp',
                ...(mergeLaunchEnvironment(process.env, request.browser) ?? {}),
              },
            }),
            45_000,
            `${request.arm}/${request.browser} browser launch`,
          );
          console.log(`[baseline] ${request.arm}/${request.browser} browser launch complete`);
        } finally {
          if (previousTmpdir === undefined) delete process.env.TMPDIR;
          else process.env.TMPDIR = previousTmpdir;
        }
        launched.set(request.browser, browser);
        const metadata = await browserExecutableMetadata(request.browser, executablePath, {
          readFile: dependencies.readExecutable,
          version: async () => browser!.version(),
        });
        const runtime = await runInNewContext(
          browser,
          browserContextOptions(physicsViewport),
          async (page) =>
            page.evaluate(() => ({
              userAgent: navigator.userAgent,
              hardwareConcurrency: navigator.hardwareConcurrency,
            })),
        );
        const prepared = input.prepared as PreparedBaseline & PreparedReportData;
        prepared.environments ??= [];
        if (!prepared.environments.some((environment) => environment.id === request.browser)) {
          prepared.environments.push(buildEnvironment(request.browser, metadata, runtime));
        }
      }
      if (!browser) throw new Error(`Unable to launch ${request.browser}`);

      const interaction: Record<string, unknown>[] = [];
      const layout: Record<string, unknown>[] = [];
      const audits: Record<string, unknown>[] = [];
      const viewports = request.viewport
        ? interactionViewports.filter(
            (viewport) =>
              viewport.width === request.viewport?.width &&
              viewport.height === request.viewport?.height,
          )
        : request.scenarioId
          ? interactionViewports.filter(
              (viewport) => !viewport.mobile && viewport.width === 1280 && viewport.height === 800,
            )
          : interactionViewports;
      for (const viewport of viewports) {
        const mode = viewport.mobile ? 'mobile' : 'desktop';
        const scenarios = request.scenarioId ? [request.scenarioId] : scenarioIds(mode);
        for (const scenarioId of scenarios) {
          const runId = captureRunId(request, viewport, scenarioId);
          console.log(`[baseline] scenario start: ${runId}`);
          await withTimeout(
            runInNewContext(
              browser,
              browserContextOptions(viewport, request.browser),
              async (page) => {
                const router = createFixtureRouter(fixture.manifest, fixture.responses, {
                  expectedRouteIds: expectedRouteIds(scenarioId),
                });
                await installFixtureRoutes(page.context(), router);
                await page.addInitScript(() => {
                  const diagnostics = window as unknown as {
                    __OMM_CAPTURE_DIAGNOSTICS__?: { pageErrors: string[]; consoleErrors: string[] };
                  };
                  diagnostics.__OMM_CAPTURE_DIAGNOSTICS__ = { pageErrors: [], consoleErrors: [] };
                  window.addEventListener('error', (event) => {
                    diagnostics.__OMM_CAPTURE_DIAGNOSTICS__?.pageErrors.push(
                      event.error instanceof Error
                        ? (event.error.stack ?? event.error.message)
                        : event.message,
                    );
                  });
                  window.addEventListener('unhandledrejection', (event) => {
                    diagnostics.__OMM_CAPTURE_DIAGNOSTICS__?.pageErrors.push(String(event.reason));
                  });
                  const writeText = (value: string) => {
                    (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__ =
                      value;
                    return Promise.resolve();
                  };
                  try {
                    Object.defineProperty(navigator, 'clipboard', {
                      configurable: true,
                      value: { writeText },
                    });
                  } catch {
                    Object.defineProperty(navigator.clipboard, 'writeText', {
                      configurable: true,
                      value: writeText,
                    });
                  }
                });
                const pageErrors: string[] = [];
                const consoleErrors: string[] = [];
                const requestFailures: string[] = [];
                const onPageError = (error: Error) => pageErrors.push(error.stack ?? error.message);
                const onConsole = (message: { type(): string; text(): string }) => {
                  if (message.type() === 'error') consoleErrors.push(message.text());
                };
                const onRequestFailed = (request: {
                  url(): string;
                  failure(): { errorText?: string } | null;
                }) => {
                  requestFailures.push(
                    `${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`,
                  );
                };
                page.on('pageerror', onPageError);
                page.on('console', onConsole);
                page.on('requestfailed', onRequestFailed);
                let idleAudit: ReturnType<typeof collectIdleAudit> | undefined;
                try {
                  interaction.push(
                    ...((await runScenario(scenarioId, page, {
                      runId,
                      execute: async (stepId, scenarioPage) => {
                        console.log(`[baseline] step start: ${runId}/${stepId}`);
                        const result = await withTimeout(
                          executeScenarioStep(stepId, scenarioPage as Page, {
                            previewUrl,
                            fixture: fixture.manifest,
                            viewport,
                            runId,
                            scenarioId,
                            browser: request.browser,
                          }),
                          stepId === 'navigate' ? 45_000 : 15_000,
                          `step ${runId}/${stepId}`,
                        );
                        if (result) idleAudit = result;
                        console.log(`[baseline] step complete: ${runId}/${stepId}`);
                      },
                    })) as unknown as Record<string, unknown>[]),
                  );
                  router.assertComplete();
                  if (idleAudit) audits.push(idleAudit as unknown as Record<string, unknown>);
                  const geometry = await collectVisibleGeometry(
                    page,
                    runId,
                    scenarioId,
                    viewport,
                    fixture.manifest,
                  );
                  layout.push(...(geometry.targets as unknown as Record<string, unknown>[]));
                  audits.push(
                    ...(geometry.overlaps as unknown as Record<string, unknown>[]),
                    ...(geometry.escapes as unknown as Record<string, unknown>[]),
                  );
                } catch (error) {
                  const state = await page.evaluate(
                    () =>
                      (window as unknown as { __OMM_CAPTURE_DIAGNOSTICS__?: unknown })
                        .__OMM_CAPTURE_DIAGNOSTICS__,
                  );
                  throw new Error(
                    `${error instanceof Error ? error.message : String(error)}; browserDiagnostics=${JSON.stringify({ state, pageErrors, consoleErrors, requestFailures })}`,
                    { cause: error },
                  );
                } finally {
                  page.off('pageerror', onPageError);
                  page.off('console', onConsole);
                  page.off('requestfailed', onRequestFailed);
                }
              },
            ),
            90_000,
            `scenario ${runId}`,
          );
          console.log(`[baseline] scenario complete: ${runId}`);
        }
      }

      if (request.scenarioId) {
        console.log(
          `[baseline] capture complete: ${request.arm}/${request.browser}/repetition-${request.repetition}`,
        );
        return {
          request,
          runs: [],
          interaction,
          layout,
          audits,
          physics: [],
        } as unknown as CaptureResult;
      }

      console.log(
        `[baseline] physics start: ${request.arm}/${request.browser}/repetition-${request.repetition}`,
      );
      const physics = await capturePhysics(
        browser,
        preparedArm.physicsBundle.path,
        dependencies.readText,
      );
      const runs = physics.map((result, index) => ({
        id: `${request.arm}-${request.browser}-${request.repetition}-physics-${index}`,
        artifactId: request.arm,
        environmentId: request.browser,
        viewportId: viewportId(physicsViewport),
        workloadId: physicsWorkloads[index].id,
        timerResolutionMilliseconds: result.timerResolutionMilliseconds,
        metrics: result.metrics,
      }));
      console.log(
        `[baseline] capture complete: ${request.arm}/${request.browser}/repetition-${request.repetition}`,
      );
      return { request, runs, interaction, layout, audits, physics } as unknown as CaptureResult;
    },
    async close() {
      const failures: unknown[] = [];
      for (const browser of launched.values()) {
        try {
          await withTimeout(browser.close(), 15_000, 'browser cleanup');
        } catch (error) {
          failures.push(error);
        }
      }
      launched.clear();
      if (failures.length > 0) throw new AggregateError(failures, 'Browser cleanup failed');
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMilliseconds: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMilliseconds}ms`)),
          timeoutMilliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function readFixture(value: unknown): {
  manifest: FixtureManifest;
  responses: Map<string, Uint8Array>;
} {
  const fixture = (value as { value?: unknown }).value ?? value;
  if (!isRecord(fixture) || !isRecord(fixture.manifest) || !(fixture.responses instanceof Map)) {
    throw new Error('Validated fixture does not contain a manifest and response map');
  }
  return fixture as { manifest: FixtureManifest; responses: Map<string, Uint8Array> };
}

function viewportId(viewport: ViewportSpec): string {
  return `${viewport.mobile ? 'mobile' : 'desktop'}-${viewport.width}x${viewport.height}-dpr${viewport.dpr}`;
}

function captureRunId(
  request: { arm: ArmName; browser: BrowserName; repetition: number },
  viewport: ViewportSpec,
  scenarioId: ScenarioId,
): string {
  return `${request.arm}-${request.browser}-${request.repetition}-${viewportId(viewport)}-${scenarioId}`;
}

const scenarioRoutes: Partial<Record<ScenarioId, readonly string[]>> = {
  'desktop-bootstrap': ['seeds', 'stats'],
  'mobile-bootstrap': ['seeds', 'stats'],
  'desktop-search': ['seeds', 'stats', 'search-root'],
  'mobile-header': ['seeds', 'stats', 'search-root'],
  'desktop-graph-input': ['seeds', 'stats', 'neighbors-root'],
  'mobile-graph-input': ['seeds', 'stats', 'neighbors-root'],
  'desktop-casefile': [
    'seeds',
    'stats',
    'profile-root',
    'relations-root-page-1',
    'relations-root-page-2',
    'recommendations-root',
    'profile-related-author',
  ],
  'mobile-casefile': [
    'seeds',
    'stats',
    'profile-root',
    'relations-root-page-1',
    'profile-related-author',
  ],
  'desktop-tools': ['seeds', 'stats'],
  'mobile-tools': ['seeds', 'stats'],
  'desktop-idle': ['seeds', 'stats'],
  'mobile-idle': ['seeds', 'stats'],
};

export function expectedRouteIds(scenarioId: ScenarioId): readonly string[] {
  return [...(scenarioRoutes[scenarioId] ?? [])];
}

async function collectVisibleGeometry(
  page: Page,
  runId: string,
  scenarioId: ScenarioId,
  viewport: ViewportSpec,
  fixture: FixtureManifest,
) {
  const renderedControls = await page.evaluate((controls) => {
    const targets = (
      window as unknown as {
        __OMM_APP__?: { instrumentation?: { targets: readonly { id: string }[] } };
      }
    ).__OMM_APP__?.instrumentation?.targets;
    if (!targets) throw new Error('OMM instrumentation is unavailable');
    const rendered = new Set(targets.map(({ id }) => id));
    return controls.filter((id) => rendered.has(id));
  }, fixture.controls);
  return collectGeometryFromPage(page, {
    runId,
    scenarioId,
    viewport: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    controls: renderedControls,
    allowedContainmentPairs: fixture.allowedContainmentPairs,
  });
}

const physicsWorkloads: readonly {
  id: string;
  file: keyof typeof graphSpecs;
  request: Omit<Extract<PhysicsBrowserRequest, { kind: 'graph' }>, 'graph'>;
}[] = [
  {
    id: 'sparse-500',
    file: 'sparse-500',
    request: { kind: 'graph', appendRootId: 'n0250', warmupTicks: 8, measuredTicks: 40 },
  },
  {
    id: 'hub-1000',
    file: 'hub-1000',
    request: { kind: 'graph', appendRootId: 'n0000', warmupTicks: 8, measuredTicks: 40 },
  },
  {
    id: 'mixed-3000',
    file: 'mixed-3000',
    request: { kind: 'graph', appendRootId: 'n1000', warmupTicks: 12, measuredTicks: 50 },
  },
  {
    id: 'drag-1000',
    file: 'hub-1000',
    request: { kind: 'graph', appendRootId: 'n0000', warmupTicks: 8, measuredTicks: 40 },
  },
];

async function capturePhysics(
  browser: Browser,
  bundlePath: string,
  readText: (path: string) => Promise<string>,
): Promise<PhysicsBrowserResult[]> {
  let bundle: string;
  try {
    bundle = await readText(bundlePath);
  } catch (error) {
    throw new Error(`Unable to load physics browser entry ${bundlePath}`, { cause: error });
  }
  return runInNewContext(browser, browserContextOptions(physicsViewport), async (page) => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: bundle });
    const available = await page.evaluate(
      () =>
        typeof (
          window as unknown as {
            __VECTOJS_PHYSICS_BASELINE__?: { run?: unknown };
          }
        ).__VECTOJS_PHYSICS_BASELINE__?.run === 'function',
    );
    if (!available) throw new Error(`Physics browser entry did not initialize from ${bundlePath}`);

    const results: PhysicsBrowserResult[] = [];
    for (const workload of physicsWorkloads) {
      const graph = JSON.parse(
        await readText(join(graphFixtureDirectory, `${workload.file}.json`)),
      ) as Extract<PhysicsBrowserRequest, { kind: 'graph' }>['graph'];
      const request: PhysicsBrowserRequest =
        workload.id === 'drag-1000'
          ? { kind: 'drag', graph, draggedNodeId: 'n0000' }
          : { ...workload.request, graph };
      results.push(
        await page.evaluate(async (physicsRequest) => {
          const api = (
            window as unknown as {
              __VECTOJS_PHYSICS_BASELINE__?: {
                run(request: PhysicsBrowserRequest): Promise<PhysicsBrowserResult>;
              };
            }
          ).__VECTOJS_PHYSICS_BASELINE__;
          if (!api) throw new Error('Physics browser entry is unavailable');
          return api.run(physicsRequest);
        }, request),
      );
    }
    return results;
  });
}

interface ScenarioExecutionContext {
  previewUrl: string;
  fixture: FixtureManifest;
  viewport: ViewportSpec;
  runId: string;
  scenarioId: ScenarioId;
  browser?: BrowserName;
}

export async function executeScenarioStep(
  stepId: string,
  page: Page,
  context: ScenarioExecutionContext,
): Promise<ReturnType<typeof collectIdleAudit> | undefined> {
  const root = context.fixture.entities.rootAuthor;
  const relatedWork = context.fixture.entities.relatedWork;
  switch (stepId) {
    case 'navigate': {
      await page.bringToFront();
      const errors: string[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          if (attempt === 0) await page.goto(context.previewUrl, { waitUntil: 'domcontentloaded' });
          else await page.reload({ waitUntil: 'domcontentloaded' });
          await waitForApplicationReady(
            page,
            root,
            10000,
            !context.scenarioId.endsWith('-idle'),
            2,
          );
          return;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
          if (attempt < 2)
            console.log(
              `[baseline] readiness retry ${attempt + 1}/2: ${context.runId}/${context.scenarioId}`,
            );
        }
      }
      throw new Error(`Readiness failed after 3 attempts: ${errors.join(' | ')}`);
    }
    case 'assert-root':
      await assertPageState(
        page,
        (id) =>
          Boolean(
            (
              window as unknown as {
                __OMM_APP__?: { instrumentation?: { nodeCenters: readonly { id: string }[] } };
              }
            ).__OMM_APP__?.instrumentation?.nodeCenters.some((node) => node.id === id),
          ),
        root,
      );
      return;
    case 'assert-dpr-backing':
      assertViewportAndBacking(
        context.browser ?? 'chrome',
        await readObservedViewport(page),
        context.viewport,
      );
      return;
    case 'assert-finite-camera-geometry':
      await assertFiniteGeometry(page);
      return;
    case 'press-search-shortcut':
      await page.keyboard.press('/');
      await assertPageState(page, () => document.activeElement?.tagName === 'INPUT');
      return;
    case 'type-search':
      await page.keyboard.type(context.fixture.expected.firstProfileCopy);
      try {
        await page.waitForFunction(
          () =>
            Boolean(
              (
                window as unknown as {
                  __OMM_APP__?: { headerBar?: { searchResults?: readonly unknown[] } };
                }
              ).__OMM_APP__?.headerBar?.searchResults?.length,
            ),
          undefined,
          { timeout: 5000 },
        );
      } catch (error) {
        const state = await page.evaluate(() => {
          const headerBar = (
            window as unknown as {
              __OMM_APP__?: {
                headerBar?: { searchQuery?: string; searchResults?: readonly unknown[] };
              };
            }
          ).__OMM_APP__?.headerBar;
          const active = document.activeElement;
          return {
            activeTag: active?.tagName ?? null,
            inputValue: active instanceof HTMLInputElement ? active.value : null,
            query: headerBar?.searchQuery ?? null,
            resultCount: headerBar?.searchResults?.length ?? null,
          };
        });
        throw new Error(`Search results timed out: ${JSON.stringify(state)}`, { cause: error });
      }
      return;
    case 'activate-first-result':
      await page.keyboard.press('Enter');
      await waitForStablePredicate(page, 'animationFree');
      return;
    case 'assert-one-selection':
      await assertPageState(
        page,
        () =>
          ((
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { graph: { nodeCount: number } } };
            }
          ).__OMM_APP__?.instrumentation?.graph.nodeCount ?? 0) > 0,
      );
      return;
    case 'record-camera':
    case 'record-header-geometry':
    case 'record-target-overlap-escape-transitions':
      await assertFiniteGeometry(page);
      return;
    case 'escape-search':
      await page.keyboard.press('Escape');
      return;
    case 'click-root':
    case 'tap-root':
      await activatePoint(page, await nodeCenter(page, root), context.viewport.mobile);
      return;
    case 'double-click-root':
    case 'double-tap-root':
      await activatePoint(page, await nodeCenter(page, root), context.viewport.mobile, 2);
      await waitForStablePredicate(page, 'animationFree');
      return;
    case 'long-press-root': {
      const point = await nodeCenter(page, root);
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(600);
      return;
    }
    case 'drag-related-work':
      await drag(
        page,
        await nodeCenter(page, relatedWork),
        context.viewport.mobile ? 50 : 80,
        context.viewport.mobile ? 30 : 40,
      );
      return;
    case 'wheel-zoom':
      await page.mouse.wheel(0, -120);
      await assertFiniteGeometry(page);
      return;
    case 'pan-blank':
      await drag(
        page,
        await blankPoint(page),
        context.viewport.mobile ? 50 : 60,
        context.viewport.mobile ? 20 : 30,
      );
      return;
    case 'pinch-80-to-120':
      await dispatchPinch(page);
      await assertFiniteGeometry(page);
      return;
    case 'cancel-pending-pointer':
      await page.keyboard.press('Escape');
      return;
    case 'assert-no-pointer-owner':
      await page.waitForFunction(
        () => {
          const ownership = (
            window as unknown as {
              __OMM_APP__?: {
                instrumentation?: {
                  pointerOwnership: {
                    activePointerIds: readonly number[];
                    canvasCapturedPointerIds: readonly number[];
                    drawerPointerId: number | null;
                    nodePointerId: number | null;
                    panning: boolean;
                    pinching: boolean;
                    pendingClick: boolean;
                    longPressPending: boolean;
                  };
                };
              };
            }
          ).__OMM_APP__?.instrumentation?.pointerOwnership;
          if (!ownership) return false;
          return (
            ownership.activePointerIds.length === 0 &&
            ownership.canvasCapturedPointerIds.length === 0 &&
            ownership.drawerPointerId === null &&
            ownership.nodePointerId === null &&
            !ownership.panning &&
            !ownership.pinching &&
            !ownership.pendingClick &&
            !ownership.longPressPending
          );
        },
        undefined,
        { timeout: 5000 },
      );
      return;
    case 'open-root': {
      const point = await nodeCenter(page, root);
      await page.evaluate(
        ({ nodeId, anchor }) => {
          const app = (
            window as unknown as {
              __OMM_APP__?: {
                handleSelectNode(id: string, anchor?: { x: number; y: number }): Promise<void>;
              };
            }
          ).__OMM_APP__;
          if (!app?.handleSelectNode) throw new Error('App handleSelectNode is unavailable');
          return app.handleSelectNode(nodeId, anchor);
        },
        { nodeId: root, anchor: point },
      );
      await assertDrawer(page, 'open', true);
      return;
    }
    case 'await-profile':
      await assertDrawer(page, 'profileStatus', 'ready');
      return;
    case 'activate-relations':
    case 'activate-relations-before-navigation':
      await activateDrawerTarget(page, 'casefile.tab.relations');
      await assertDrawer(page, 'relationsStatus', 'ready');
      return;
    case 'activate-recommendations':
      await activateDrawerTarget(page, 'casefile.tab.recommendations');
      await assertDrawer(page, 'recommendationsStatus', 'ready');
      return;
    case 'load-relation-page':
      await activateDrawerTarget(page, 'casefile.tab.relations');
      await assertDrawer(page, 'relationsStatus', 'ready');
      await activateDrawerTarget(page, 'casefile.relations.load-more');
      await waitForStablePredicate(page, 'animationFree');
      return;
    case 'copy-first-field':
      await activateDrawerTarget(page, 'casefile.tab.profile');
      await waitForProfileCopyTargets(page);
      await activateDrawerTarget(page, 'casefile.copy.first');
      await page
        .waitForFunction(
          (expected) =>
            (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__ ===
            expected,
          context.fixture.expected.firstProfileCopy,
          { timeout: 5000 },
        )
        .catch(async (error) => {
          const state = await page.evaluate(() => ({
            copied: (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__,
            clipboard: typeof navigator.clipboard?.writeText,
            targets: (
              window as unknown as { __OMM_APP__?: { instrumentation?: { targets: unknown } } }
            ).__OMM_APP__?.instrumentation?.targets,
          }));
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)}`,
          );
        });
      return;
    case 'scroll-casefile':
    case 'scroll-from-copy-field-without-copy': {
      const before = await page.evaluate(
        () => (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__,
      );
      const point = await targetCenter(page, 'casefile.copy.first');
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, 120);
      if (stepId.includes('without-copy')) {
        const after = await page.evaluate(
          () => (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__,
        );
        if (after !== before) throw new Error('Casefile scroll copied a field');
      }
      return;
    }
    case 'follow-related-author':
      await activateDrawerTarget(page, 'casefile.row.relation:101.navigate');
      await assertPageState(
        page,
        (id) =>
          (
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { drawer: { entityId: string } } };
            }
          ).__OMM_APP__?.instrumentation?.drawer.entityId === id,
        context.fixture.entities.relatedAuthor,
      );
      return;
    case 'close-casefile':
      await activateDrawerTarget(page, 'casefile.close');
      await assertDrawer(page, 'open', false);
      return;
    case 'assert-fixture-requests-and-copy':
      await assertPageState(
        page,
        (expected) =>
          (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__ === expected,
        context.fixture.expected.firstProfileCopy,
      );
      return;
    case 'toggle-relationship-filters':
    case 'toggle-rendered-relationship-filters':
      await activateTarget(page, 'tool.relationship', context.viewport.mobile);
      for (const id of [
        'tool.relationship.author_of',
        'tool.relationship.influenced_by',
        'tool.relationship.related',
      ]) {
        if (await hasTarget(page, id)) await activateTarget(page, id, context.viewport.mobile);
      }
      return;
    case 'open-close-stats':
    case 'open-close-rendered-stats':
      await toggleTwice(page, 'tool.stats', context.viewport.mobile);
      return;
    case 'open-close-minimap':
    case 'open-close-rendered-minimap':
      await toggleTwice(page, 'tool.minimap', context.viewport.mobile);
      return;
    case 'clear-graph':
    case 'clear-rendered-graph':
      await activateClearControl(page);
      await assertClearArmed(page);
      await activateClearControl(page);
      await assertPageState(
        page,
        () =>
          (
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { graph: { nodeCount: number } } };
            }
          ).__OMM_APP__?.instrumentation?.graph.nodeCount === 0,
      );
      return;
    case 'undo-clear':
    case 'undo-rendered-clear':
      if (!(await hasTarget(page, 'tool.history.undo'))) return;
      await activateTarget(page, 'tool.history.undo', context.viewport.mobile);
      await assertPageState(
        page,
        () =>
          ((
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { graph: { nodeCount: number } } };
            }
          ).__OMM_APP__?.instrumentation?.graph.nodeCount ?? 0) > 0,
      );
      return;
    case 'open-close-visibility':
    case 'open-close-rendered-visibility':
      await toggleTwice(page, 'tool.visibility', context.viewport.mobile);
      return;
    case 'activate-fit':
    case 'activate-rendered-fit':
      await activateTarget(page, 'viewport.fit', context.viewport.mobile);
      await waitForStablePredicate(page, 'animationFree');
      await assertFiniteGeometry(page);
      return;
    case 'freeze-then-resume':
    case 'freeze-then-resume-rendered':
      await toggleTwice(page, 'viewport.freeze', context.viewport.mobile);
      return;
    case 'reset-camera':
    case 'reset-rendered-camera':
      await activateTarget(page, 'viewport.reset', context.viewport.mobile);
      await assertFiniteGeometry(page);
      return;
    case 'await-idle':
      try {
        await page.waitForFunction(
          () => {
            const instrumentation = (
              window as unknown as {
                __OMM_APP__?: {
                  instrumentation?: { animationFree: boolean; sceneAlive: boolean };
                };
              }
            ).__OMM_APP__?.instrumentation;
            return instrumentation?.animationFree === true && instrumentation.sceneAlive === false;
          },
          undefined,
          { timeout: IDLE_WAIT_TIMEOUT_MS },
        );
      } catch (error) {
        const state = await page.evaluate(() => {
          const instrumentation = (
            window as unknown as {
              __OMM_APP__?: {
                instrumentation?: {
                  animationFree: boolean;
                  sceneAlive: boolean;
                  animationDiagnostics?: {
                    physicsActive: boolean;
                    cameraAnimating: boolean;
                    drawerAnimating: boolean;
                  };
                  graph?: { nodeCount: number };
                };
              };
            }
          ).__OMM_APP__?.instrumentation;
          return {
            animationFree: instrumentation?.animationFree,
            sceneAlive: instrumentation?.sceneAlive,
            animationDiagnostics: instrumentation?.animationDiagnostics,
            graphNodeCount: instrumentation?.graph?.nodeCount,
          };
        });
        if (state.animationFree === true && state.sceneAlive === false) return;
        throw new Error(`await-idle state: ${JSON.stringify(state)}`, { cause: error });
      }
      return;
    case 'observe-120-frames': {
      const frames = await page.evaluate(async () => {
        const output: string[][] = [];
        for (let index = 0; index < 120; index += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const instrumentation = (
            window as unknown as {
              __OMM_APP__?: {
                instrumentation?: { animationFree: boolean; sceneAlive: boolean };
              };
            }
          ).__OMM_APP__?.instrumentation;
          const free =
            instrumentation?.animationFree === true && instrumentation.sceneAlive === false;
          output.push(free ? [] : ['animation-active']);
        }
        return output;
      });
      return collectIdleAudit(context.runId, context.scenarioId, frames);
    }
    default:
      throw new Error(`Unsupported interaction step ${stepId}`);
  }
}

type Point = { x: number; y: number };

async function targetCenter(page: Page, id: string): Promise<Point> {
  return page.evaluate((targetId) => {
    const target = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            targets: readonly {
              id: string;
              rect: { x: number; y: number; w: number; h: number };
            }[];
          };
        };
      }
    ).__OMM_APP__?.instrumentation?.targets.find(({ id }) => id === targetId);
    if (!target) throw new Error(`Missing rendered target ${targetId}`);
    return { x: target.rect.x + target.rect.w / 2, y: target.rect.y + target.rect.h / 2 };
  }, id);
}

async function waitForProfileCopyTargets(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const target = (
        window as unknown as {
          __OMM_APP__?: {
            instrumentation?: {
              targets: readonly { id: string; rect: { feedbackKey?: string } }[];
            };
          };
        }
      ).__OMM_APP__?.instrumentation?.targets.find(({ id }) => id === 'casefile.copy.first');
      return target?.rect.feedbackKey?.startsWith('profile:') === true;
    },
    { timeout: 5000 },
  );
}

async function nodeCenter(page: Page, id: string): Promise<Point> {
  return page.evaluate((nodeId) => {
    const node = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: { nodeCenters: readonly { id: string; screen: Point }[] };
        };
      }
    ).__OMM_APP__?.instrumentation?.nodeCenters.find(({ id }) => id === nodeId);
    if (!node) throw new Error(`Missing instrumented node ${nodeId}`);
    return node.screen;
  }, id);
}

async function blankPoint(page: Page): Promise<Point> {
  return page.evaluate(() => {
    const instrumentation = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            targets: readonly {
              id: string;
              rect: { x: number; y: number; w: number; h: number };
            }[];
            hitTest(x: number, y: number): { overUI: boolean; nodeId: string | null };
          };
        };
      }
    ).__OMM_APP__?.instrumentation;
    if (!instrumentation) throw new Error('OMM instrumentation is unavailable');
    const headerBottom = Math.max(
      0,
      ...instrumentation.targets
        .filter(({ id }) => id.startsWith('header.'))
        .map(({ rect }) => rect.y + rect.h),
    );
    for (let y = headerBottom + 16; y < innerHeight - 16; y += 16) {
      for (let x = 16; x < innerWidth - 16; x += 16) {
        const hit = instrumentation.hitTest(x, y);
        if (!hit.overUI && hit.nodeId === null) return { x, y };
      }
    }
    throw new Error('No blank graph point is available');
  });
}

async function activatePoint(page: Page, point: Point, mobile: boolean, count = 1): Promise<void> {
  if (mobile) {
    for (let index = 0; index < count; index += 1) {
      await page.touchscreen.tap(point.x, point.y);
      if (count > 1) await page.waitForTimeout(100);
    }
  } else {
    await page.mouse.click(point.x, point.y, { clickCount: count });
  }
}

async function activateTarget(page: Page, id: string, mobile: boolean): Promise<void> {
  await activatePoint(page, await targetCenter(page, id), mobile);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function activateClearControl(page: Page): Promise<void> {
  const point = await targetCenter(page, 'tool.clear');
  await page.evaluate(({ x, y }) => {
    const app = (
      window as unknown as {
        __OMM_APP__?: { graphClearControl?: { handleClick(x: number, y: number): boolean } };
      }
    ).__OMM_APP__;
    if (!app?.graphClearControl?.handleClick(x, y)) {
      throw new Error('Clear control rejected its instrumented target point');
    }
  }, point);
}

async function activateDrawerTarget(page: Page, id: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForTarget(page, id);
    const point = await targetCenter(page, id);
    const activated = await page.evaluate(({ x, y }) => {
      const drawer = (
        window as unknown as {
          __OMM_APP__?: {
            drawer?: {
              handlePointerDown(x: number, y: number, pointerType: 'mouse'): boolean;
              handlePointerUp(x: number, y: number): boolean;
            };
          };
        }
      ).__OMM_APP__?.drawer;
      return Boolean(drawer?.handlePointerDown(x, y, 'mouse') && drawer.handlePointerUp(x, y));
    }, point);
    if (activated) break;
    if (attempt === 2) throw new Error('Drawer rejected its instrumented target point');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function drag(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + (dx * step) / 10, from.y + (dy * step) / 10);
  }
  await page.mouse.up();
}

async function dispatchPinch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Canvas is unavailable for pinch input');
    const center = { x: innerWidth / 2, y: innerHeight / 2 };
    const dispatch = (type: string, id: number, x: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 1,
          clientX: x,
          clientY: center.y,
          bubbles: true,
        }),
      );
    dispatch('pointerdown', 1, center.x - 40);
    dispatch('pointerdown', 2, center.x + 40);
    dispatch('pointermove', 1, center.x - 60);
    dispatch('pointermove', 2, center.x + 60);
    dispatch('pointerup', 1, center.x - 60);
    dispatch('pointerup', 2, center.x + 60);
  });
}

async function assertPageState<T>(
  page: Page,
  predicate: (argument: T) => boolean,
  argument?: T,
): Promise<void> {
  await page.waitForFunction(predicate as never, argument, { timeout: 5000 });
}

async function assertFiniteGeometry(page: Page): Promise<void> {
  await page.evaluate(() => {
    const instrumentation = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            camera: { panX: number; panY: number; zoom: number };
            nodeCenters: readonly { world: Point; screen: Point }[];
          };
        };
      }
    ).__OMM_APP__?.instrumentation;
    if (!instrumentation) throw new Error('OMM instrumentation is unavailable');
    const values = [
      instrumentation.camera.panX,
      instrumentation.camera.panY,
      instrumentation.camera.zoom,
      ...instrumentation.nodeCenters.flatMap(({ world, screen }) => [
        world.x,
        world.y,
        screen.x,
        screen.y,
      ]),
    ];
    if (!values.every(Number.isFinite))
      throw new Error('Camera or projected node geometry is non-finite');
  });
}

async function assertDrawer(page: Page, key: string, expected: unknown): Promise<void> {
  await page.waitForFunction(
    ({ property, value }) => {
      const drawer = (
        window as unknown as {
          __OMM_APP__?: { instrumentation?: { drawer: Record<string, unknown> } };
        }
      ).__OMM_APP__?.instrumentation?.drawer;
      return drawer?.[property] === value;
    },
    { property: key, value: expected },
    { timeout: 5000 },
  );
}

async function hasTarget(page: Page, id: string): Promise<boolean> {
  return page.evaluate(
    (targetId) =>
      Boolean(
        (
          window as unknown as {
            __OMM_APP__?: { instrumentation?: { targets: readonly { id: string }[] } };
          }
        ).__OMM_APP__?.instrumentation?.targets.some(({ id }) => id === targetId),
      ),
    id,
  );
}

async function waitForTarget(page: Page, id: string): Promise<void> {
  await page.waitForFunction(
    (targetId) =>
      Boolean(
        (
          window as unknown as {
            __OMM_APP__?: { instrumentation?: { targets: readonly { id: string }[] } };
          }
        ).__OMM_APP__?.instrumentation?.targets.some(({ id }) => id === targetId),
      ),
    id,
    { timeout: 5000 },
  );
}

async function toggleTwice(page: Page, id: string, mobile: boolean): Promise<void> {
  if (!(await hasTarget(page, id))) return;
  await activateTarget(page, id, mobile);
  await activateTarget(page, id, mobile);
}

async function assertClearArmed(page: Page): Promise<void> {
  try {
    await assertPageState(page, () =>
      Boolean(
        (
          window as unknown as {
            __OMM_APP__?: { instrumentation?: { tools: { clearArmed: boolean } } };
          }
        ).__OMM_APP__?.instrumentation?.tools.clearArmed,
      ),
    );
  } catch (error) {
    const state = await page.evaluate(() => {
      const app = (
        window as unknown as {
          __OMM_APP__?: {
            instrumentation?: {
              graph: { nodeCount: number };
              tools: { clearArmed: boolean; relationship: unknown };
              targets: readonly { id: string; rect: unknown }[];
            };
          };
        }
      ).__OMM_APP__?.instrumentation;
      return {
        graph: app?.graph,
        tools: app?.tools,
        clearTarget: app?.targets.find(({ id }) => id === 'tool.clear'),
      };
    });
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
}

export function createBaselineCaptureDependencies(
  platform: BrowserRunnerPlatform = defaultPlatform,
): BaselineRunnerDependencies {
  return {
    validateFixtures: async () => {
      throw new Error('Fixture validation is supplied by the entrypoint');
    },
    generateGraphs: async () => {
      throw new Error('Graph generation is supplied by the entrypoint');
    },
    checkGraphs: async () => {
      throw new Error('Graph checks are supplied by the entrypoint');
    },
    preflight: (mode) => preflight(platform, mode),
    prepare: (context) => prepare(platform, context),
    startPreviews: (prepared) => startPreviews(platform, prepared),
    startBrowser: ({ fixture, prepared, previews }) =>
      platform.launchBrowsers({ fixture, prepared, previews }),
    assembleReport: async (input) =>
      assembleBaselineReport(input as Parameters<typeof assembleBaselineReport>[0]),
    validateReport: (report) => report,
    compareReport: async (report) => compareBaselineReport(report as OmmBaselineReportV1),
    writeReport: async () => {},
    stopPreviews: async (previews) => platform.stopPreviews(previews.previews ?? []),
    cleanup: async (prepared) => cleanup(platform, prepared),
  };
}

async function preflight(
  platform: BrowserRunnerPlatform,
  mode: Extract<BaselineMode, { mode: 'capture' }>,
): Promise<PreflightContext> {
  const candidateRoot = platform.cwd();
  const candidateRevision = (
    await platform.command(
      command(['git', 'rev-parse', 'HEAD'], candidateRoot, platform.environment, true),
    )
  ).trim();
  const runnerRevision = candidateRevision;
  const status = await platform.command(
    command(['git', 'status', '--porcelain'], candidateRoot, platform.environment, true),
  );
  const quotable = status.trim().length === 0;
  if (mode.repetitions === 5 && !quotable)
    throw new Error('quotable full capture requires a clean candidate');
  const runId = `capture-${platform
    .now()
    .toISOString()
    .replace(/[^0-9A-Za-z._-]/g, '-')}`;
  return {
    candidateRoot,
    candidateRevision,
    runnerRevision,
    runId,
    baselineRevision: BASELINE_REVISION,
    quotable,
  };
}

async function prepare(
  platform: BrowserRunnerPlatform,
  context: PreflightContext,
): Promise<PreparedBaseline> {
  const arms: Partial<
    Record<
      ArmName,
      { plan: ArmPlan; artifact: BaselineArtifact; physicsBundle: PhysicsBundleArtifact }
    >
  > = {};
  const artifacts: BaselineArtifact[] = [];
  const createdPlans: ArmPlan[] = [];
  try {
    for (const arm of ['baseline', 'candidate'] as const) {
      const plan = buildArmPlan({
        arm,
        revision: arm === 'baseline' ? BASELINE_REVISION : context.candidateRevision,
        candidateRoot: context.candidateRoot,
        baselineSourceRoot: context.candidateRoot,
        runId: context.runId,
        environment: platform.environment,
      });
      if (plan.createWorktree) {
        createdPlans.push(plan);
        await platform.mkdir(dirname(plan.root));
        await platform.command(plan.createWorktree);
      }
      const first = await installAndBuild(platform, plan);
      console.log(`[baseline] ${arm} first install/build complete`);
      await platform.remove(join(plan.root, 'node_modules'));
      console.log(`[baseline] ${arm} node_modules removed for repeat install`);
      const second = await installAndBuild(platform, plan);
      console.log(`[baseline] ${arm} second install/build complete`);
      assertRepeatedInstallEqual(first.install, second.install);
      console.log(`[baseline] ${arm} repeated install validated`);
      await writePhysicsEntry(platform, plan);
      console.log(`[baseline] ${arm} physics entry written`);
      const physicsBundle = await platform.bundlePhysics(plan.physicsBundle);
      console.log(`[baseline] ${arm} physics bundle complete`);
      const artifact: BaselineArtifact = {
        id: arm,
        arm,
        appRevision: plan.revision,
        sourceTreeSha256: platform.sourceSnapshot(plan.root).sha256,
        lockfileSha256: second.install.lockfileSha256,
        dependencyVersions: second.install.dependencyVersions,
        installedPackageManifestSha256: second.install.installedPackageManifestSha256,
        repeatedInstallManifestSha256: second.install.installedPackageManifestSha256,
        buildSha256: second.build.sha256,
        buildMode: 'production-preview',
      };
      arms[arm] = { plan, artifact, physicsBundle };
      artifacts.push(artifact);
    }
  } catch (error) {
    try {
      await cleanupPlans(platform, context, createdPlans);
    } catch (cleanupError) {
      if (isRecord(error)) error.cleanupError = cleanupError;
    }
    throw error;
  }
  return { context, arms, artifacts, environments: [], viewports: [], workloads: [] };
}

async function writePhysicsEntry(platform: BrowserRunnerPlatform, plan: ArmPlan): Promise<void> {
  const runnerPhysics = join(platform.cwd(), 'scripts', 'vectojs-baseline', 'physics-browser.ts');
  const source = await platform.readFile(runnerPhysics);
  if (source.length > 0 && !source.includes('runPhysicsBrowserWorkload')) {
    throw new Error(`Invalid physics runner source: ${runnerPhysics}`);
  }
  const packageEntry = join(
    plan.root,
    'apps',
    'web',
    'node_modules',
    '@vectojs',
    'graph-layout',
    'dist',
    'index.mjs',
  );
  const entry = `import { ForceLayout2D } from ${JSON.stringify(packageEntry)};\nimport { runPhysicsBrowserWorkload } from ${JSON.stringify(runnerPhysics)};\n\nwindow.__VECTOJS_PHYSICS_BASELINE__ = {\n  run: (request) => runPhysicsBrowserWorkload(ForceLayout2D, request),\n};\n`;
  await platform.mkdir(dirname(plan.physicsBundle.entryPoint));
  await platform.writeFile(plan.physicsBundle.entryPoint, entry);
}

async function installAndBuild(
  platform: BrowserRunnerPlatform,
  plan: ArmPlan,
): Promise<{ install: InstallSnapshot; build: SnapshotHash }> {
  await platform.command(plan.install);
  const install = platform.installSnapshot(plan.root);
  await platform.command(plan.build);
  return { install, build: platform.buildSnapshot(plan.root) };
}

export function installSnapshot(root: string): InstallSnapshot {
  const lockfile = readFileSync(join(root, 'bun.lock'), 'utf8');
  const webRoot = join(root, 'apps', 'web');
  const packageJson = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  const packageNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ].filter((name, index, names) => name.startsWith('@vectojs/') && names.indexOf(name) === index);
  const resolutions = validateVectoResolutions(
    root,
    packageNames.map((name) => join(webRoot, 'node_modules', name)),
    parseVectoLockVersions(lockfile),
  );
  return {
    lockfileSha256: hashBytes(lockfile),
    dependencyVersions: dependencyVersionRecord(resolutions),
    installedPackageManifestSha256: hashPreparedManifest(
      createInstalledPackageManifest(root, resolutions),
    ),
  };
}

export function formatBuildDiagnostic(log: unknown): string {
  if (!isRecord(log)) return String(log);
  const position = isRecord(log.position) ? log.position : undefined;
  const path =
    typeof log.path === 'string'
      ? log.path
      : typeof position?.file === 'string'
        ? position.file
        : undefined;
  const line = typeof position?.line === 'number' ? position.line : undefined;
  const column = typeof position?.column === 'number' ? position.column : undefined;
  const location = path
    ? `${path}${line === undefined ? '' : `:${line}${column === undefined ? '' : `:${column}`}`}`
    : undefined;
  const message = typeof log.message === 'string' ? log.message : JSON.stringify(log);
  const renderedPosition = position === undefined ? undefined : JSON.stringify(position);
  return [message, location, renderedPosition].filter(Boolean).join(' ');
}

async function cleanupPlans(
  platform: BrowserRunnerPlatform,
  context: PreflightContext,
  plans: readonly ArmPlan[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const plan of [...plans].reverse()) {
    try {
      await platform.command(
        command(
          ['git', 'worktree', 'remove', '--force', plan.root],
          context.candidateRoot,
          platform.environment,
        ),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  const temporaryRoots = new Set(plans.map((plan) => plan.temporaryRoot));
  for (const temporaryRoot of temporaryRoots) {
    try {
      await platform.remove(temporaryRoot);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Baseline cleanup failed');
}

async function startPreviews(
  platform: BrowserRunnerPlatform,
  prepared: PreparedBaseline,
): Promise<RunningPreviews> {
  const arms = prepared.arms ?? {};
  const previews: PreviewProcess[] = [];
  const urls: Partial<Record<ArmName, string>> = {};
  let port = 4173;
  for (const arm of ['baseline', 'candidate'] as const) {
    const plan = arms[arm]?.plan;
    if (!plan) throw new Error(`Missing ${arm} arm plan`);
    const preview = await platform.startPreview({
      root: plan.root,
      arm,
      port,
      environment: plan.install.env,
    });
    previews.push(preview);
    urls[arm] = preview.url;
    port += 1;
  }
  return { previews, urls };
}

async function cleanup(platform: BrowserRunnerPlatform, prepared: PreparedBaseline): Promise<void> {
  const plans = (['baseline', 'candidate'] as const)
    .map((arm) => prepared.arms?.[arm]?.plan)
    .filter((plan): plan is ArmPlan => plan !== undefined);
  await cleanupPlans(
    platform,
    prepared.context ?? {
      candidateRoot: platform.cwd(),
      candidateRevision: '',
      runnerRevision: '',
      baselineRevision: BASELINE_REVISION,
      runId: '',
      quotable: false,
    },
    plans,
  );
}

export function assembleBaselineReport(
  input: ReportAssemblyInput & { prepared: PreparedBaseline },
): OmmBaselineReportV1 {
  const prepared = input.prepared as PreparedBaseline & PreparedReportData;
  const captures = input.captures as Array<
    CaptureResult & {
      runs?: Record<string, unknown>[];
      interaction?: Record<string, unknown>[];
      layout?: Record<string, unknown>[];
      audits?: Record<string, unknown>[];
    }
  >;
  const runs = captures.flatMap((capture) => capture.runs ?? []);
  const interaction = captures.flatMap((capture) => capture.interaction ?? []);
  const layout = captures.flatMap((capture) => capture.layout ?? []);
  const audits = captures.flatMap((capture) => capture.audits ?? []);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runnerRevision: input.preflight.runnerRevision,
    artifacts: (prepared.artifacts ?? []) as BaselineArtifact[],
    environments: (prepared.environments ?? []) as BaselineEnvironment[],
    viewports: (prepared.viewports ?? []) as BaselineViewport[],
    fixture: { schemaVersion: input.fixture.schemaVersion, sha256: input.fixture.sha256 },
    workloads: (prepared.workloads ?? []) as Record<string, unknown>[],
    runs: runs as OmmBaselineReportV1['runs'],
    interaction,
    layout,
    audits,
  };
}

export function compareBaselineReport(report: OmmBaselineReportV1): OmmBaselineReportV1 {
  const comparison: ComparisonOutcome[] = [
    ...compareWorkloadMetrics(report),
    ...compareGeometryFindings(report),
  ];
  return {
    ...report,
    comparison: comparison as unknown as JsonObject[],
    comparisonInputs: {
      baselineReportSha256: hashReport(reportForArm(report, 'baseline')),
      candidateReportSha256: hashReport(reportForArm(report, 'candidate')),
    },
  };
}

type ComparisonMode = 'percentage' | 'bounded' | 'zero-required' | null;

type ComparisonOutcome = {
  kind: 'metric' | 'finding';
  workloadId?: string;
  metricId?: string;
  phase?: string;
  environmentId: string;
  viewportId: string;
  baselineArtifactId: string;
  candidateArtifactId: string;
  baselineRunIds: string[];
  candidateRunIds: string[];
  baselineValues: number[];
  candidateValues: number[];
  baselineMedian: number | null;
  candidateMedian: number | null;
  absoluteDelta: number | null;
  mode: ComparisonMode;
  percentage: number | null;
  tolerance: number | null;
  regressionLimit: number | null;
  passed: boolean;
  status: 'pass' | 'fail' | 'informational';
  correctnessFailures?: CorrectnessFailure[];
  unavailableReason?: string;
  findingKey?: string;
  findingType?: 'target' | 'overlap' | 'escape';
  classification?: FindingClassification;
};

interface MetricInstance {
  metricId: string;
  phase: string;
  path: readonly string[];
  tolerance: number | 'timer';
  regressionLimit: number | null;
  isCorrect: (value: number) => boolean;
  zeroRequired: boolean;
  informational: boolean;
}

const finiteMetric = (value: number): boolean => Number.isFinite(value);
const under50 = (value: number): boolean => value < 50;
const under2000 = (value: number): boolean => value < 2000;
const atMost1 = (value: number): boolean => value <= 1;
const atMost20 = (value: number): boolean => Number.isFinite(value) && value <= 20;
const exactly0 = (value: number): boolean => value === 0;

const METRIC_INSTANCES: readonly MetricInstance[] = [
  {
    metricId: 'tick-p50',
    phase: 'measured',
    path: ['measured', 'tickP50Milliseconds'],
    tolerance: 'timer',
    regressionLimit: null,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: true,
  },
  {
    metricId: 'tick-p95',
    phase: 'measured',
    path: ['measured', 'tickP95Milliseconds'],
    tolerance: 'timer',
    regressionLimit: 10,
    isCorrect: under50,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'tick-max',
    phase: 'measured',
    path: ['measured', 'tickMaximumMilliseconds'],
    tolerance: 'timer',
    regressionLimit: 10,
    isCorrect: under50,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'synchronous-steps-above-50',
    phase: 'measured',
    path: ['measured', 'synchronousStepsAbove50Milliseconds'],
    tolerance: 0,
    regressionLimit: null,
    isCorrect: exactly0,
    zeroRequired: true,
    informational: false,
  },
  {
    metricId: 'append-mutation',
    phase: 'append',
    path: ['appendMutationMilliseconds'],
    tolerance: 'timer',
    regressionLimit: 15,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'first-post-append',
    phase: 'post-append',
    path: ['firstPostAppendMilliseconds'],
    tolerance: 'timer',
    regressionLimit: 10,
    isCorrect: under50,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'settling-ticks',
    phase: 'initial',
    path: ['initial', 'settlingTicks'],
    tolerance: 1,
    regressionLimit: 10,
    isCorrect: under2000,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'settling-ticks',
    phase: 'post-append',
    path: ['postAppend', 'settlingTicks'],
    tolerance: 1,
    regressionLimit: 10,
    isCorrect: under2000,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'settling-ticks',
    phase: 'post-drag',
    path: ['postDrag', 'settlingTicks'],
    tolerance: 1,
    regressionLimit: 10,
    isCorrect: under2000,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'settling-wall',
    phase: 'initial',
    path: ['initial', 'settlingWallMilliseconds'],
    tolerance: 'timer',
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'settling-wall',
    phase: 'post-append',
    path: ['postAppend', 'settlingWallMilliseconds'],
    tolerance: 'timer',
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'settling-wall',
    phase: 'post-drag',
    path: ['postDrag', 'settlingWallMilliseconds'],
    tolerance: 'timer',
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'old-node-rms-displacement',
    phase: 'post-append',
    path: ['postAppend', 'oldNodeRmsDisplacement'],
    tolerance: 0.01,
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'old-node-rms-displacement',
    phase: 'post-drag',
    path: ['postDrag', 'oldNodeRmsDisplacement'],
    tolerance: 0.01,
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'far-node-maximum-displacement',
    phase: 'post-append',
    path: ['postAppend', 'farNodeMaximumDisplacement'],
    tolerance: 0.01,
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'far-node-maximum-displacement',
    phase: 'post-drag',
    path: ['postDrag', 'farNodeMaximumDisplacement'],
    tolerance: 0.01,
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'peak-link-ratio',
    phase: 'post-append',
    path: ['postAppend', 'peakLinkRatio'],
    tolerance: 0.001,
    regressionLimit: 10,
    isCorrect: atMost20,
    zeroRequired: false,
    informational: true,
  },
  {
    metricId: 'peak-link-ratio',
    phase: 'post-drag',
    path: ['postDrag', 'peakLinkRatio'],
    tolerance: 0.001,
    regressionLimit: 10,
    isCorrect: atMost20,
    zeroRequired: false,
    informational: true,
  },
  {
    metricId: 'late-velocity-direction-changes',
    phase: 'post-drag',
    path: ['postDrag', 'lateVelocityDirectionChanges'],
    tolerance: 1,
    regressionLimit: 10,
    isCorrect: finiteMetric,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'drag-pointer-error',
    phase: 'drag',
    path: ['dragPointerError'],
    tolerance: 0.01,
    regressionLimit: 10,
    isCorrect: atMost1,
    zeroRequired: false,
    informational: false,
  },
  {
    metricId: 'non-finite-position-count',
    phase: 'initial',
    path: ['initial', 'nonFinitePositionCount'],
    tolerance: 0,
    regressionLimit: null,
    isCorrect: exactly0,
    zeroRequired: true,
    informational: false,
  },
  {
    metricId: 'non-finite-position-count',
    phase: 'post-append',
    path: ['postAppend', 'nonFinitePositionCount'],
    tolerance: 0,
    regressionLimit: null,
    isCorrect: exactly0,
    zeroRequired: true,
    informational: false,
  },
  {
    metricId: 'non-finite-position-count',
    phase: 'post-drag',
    path: ['postDrag', 'nonFinitePositionCount'],
    tolerance: 0,
    regressionLimit: null,
    isCorrect: exactly0,
    zeroRequired: true,
    informational: false,
  },
  {
    metricId: 'collision-overlap-count',
    phase: 'initial',
    path: ['initial', 'collisionOverlapCount'],
    tolerance: 0,
    regressionLimit: null,
    isCorrect: exactly0,
    zeroRequired: false,
    informational: true,
  },
  {
    metricId: 'collision-overlap-count',
    phase: 'post-append',
    path: ['postAppend', 'collisionOverlapCount'],
    tolerance: 0,
    regressionLimit: null,
    isCorrect: exactly0,
    zeroRequired: false,
    informational: true,
  },
  {
    metricId: 'collision-overlap-count',
    phase: 'post-drag',
    path: ['postDrag', 'collisionOverlapCount'],
    tolerance: 0,
    regressionLimit: null,
    isCorrect: exactly0,
    zeroRequired: false,
    informational: true,
  },
];

interface WorkloadRunGroup {
  workloadId: string;
  environmentId: string;
  viewportId: string;
  baseline: BaselineRun[];
  candidate: BaselineRun[];
}

interface FindingGroup<T> {
  browser: BrowserName;
  viewport: string;
  key: string;
  baseline: T[];
  candidate: T[];
}

const knownViewportIds = interactionViewports.map(viewportId);

function compareWorkloadMetrics(report: OmmBaselineReportV1): ComparisonOutcome[] {
  const outcomes: ComparisonOutcome[] = [];
  const artifactIds = artifactIdsByArm(report);
  for (const group of groupWorkloadRuns(report).values()) {
    if (group.baseline.length !== 5 || group.candidate.length !== 5) continue;
    const baselineRuns = group.baseline.sort(byRunId);
    const candidateRuns = group.candidate.sort(byRunId);
    const timerResolution = Math.max(
      ...baselineRuns.map(timerResolutionOf),
      ...candidateRuns.map(timerResolutionOf),
    );
    for (const instance of METRIC_INSTANCES) {
      const baselineValues = baselineRuns.map((run) => extractRunMetric(run, instance.path));
      const candidateValues = candidateRuns.map((run) => extractRunMetric(run, instance.path));
      if (baselineValues.every(isUndefined) && candidateValues.every(isUndefined)) continue;
      if (baselineValues.some(isUndefined) || candidateValues.some(isUndefined)) {
        outcomes.push(
          unavailableMetricOutcome(group, instance, baselineRuns, candidateRuns, artifactIds),
        );
        continue;
      }
      const tolerance = instance.tolerance === 'timer' ? timerResolution : instance.tolerance;
      outcomes.push(
        metricOutcome(
          group,
          instance,
          baselineRuns,
          candidateRuns,
          baselineValues as number[],
          candidateValues as number[],
          tolerance,
          artifactIds,
        ),
      );
    }
  }
  return outcomes;
}

function metricOutcome(
  group: WorkloadRunGroup,
  instance: MetricInstance,
  baselineRuns: BaselineRun[],
  candidateRuns: BaselineRun[],
  baselineValues: number[],
  candidateValues: number[],
  tolerance: number,
  artifactIds: { baseline: string; candidate: string },
): ComparisonOutcome {
  const base = {
    kind: 'metric' as const,
    workloadId: group.workloadId,
    metricId: instance.metricId,
    phase: instance.phase,
    environmentId: group.environmentId,
    viewportId: group.viewportId,
    baselineArtifactId: artifactIds.baseline,
    candidateArtifactId: artifactIds.candidate,
    baselineRunIds: baselineRuns.map((run) => run.id),
    candidateRunIds: candidateRuns.map((run) => run.id),
    baselineValues,
    candidateValues,
    tolerance,
    regressionLimit: instance.regressionLimit,
  };

  if (instance.informational) {
    const baselineMedian = medianOfFive(baselineValues);
    const candidateMedian = medianOfFive(candidateValues);
    return {
      ...base,
      baselineMedian,
      candidateMedian,
      absoluteDelta: candidateMedian - baselineMedian,
      mode: null,
      percentage: null,
      passed: true,
      status: 'informational' as const,
    };
  }

  if (instance.zeroRequired) {
    const result = compareZeroRequired(baselineValues, candidateValues);
    return {
      ...base,
      baselineMedian: null,
      candidateMedian: null,
      absoluteDelta: null,
      mode: result.mode,
      percentage: null,
      passed: result.passed,
      status: result.passed ? 'pass' : 'fail',
      correctnessFailures: collectFailures(baselineValues, candidateValues, instance.isCorrect),
    };
  }

  const result = compareFiveRuns({
    baseline: baselineValues,
    candidate: candidateValues,
    tolerance,
    regressionLimit: instance.regressionLimit ?? 0,
    isCorrect: instance.isCorrect,
  });
  return {
    ...base,
    baselineMedian: result.baselineMedian,
    candidateMedian: result.candidateMedian,
    absoluteDelta: result.absoluteDelta,
    mode: result.mode,
    percentage: result.percentage,
    passed: result.passed,
    status: result.passed ? 'pass' : 'fail',
    correctnessFailures: result.correctnessFailures,
  };
}

function unavailableMetricOutcome(
  group: WorkloadRunGroup,
  instance: MetricInstance,
  baselineRuns: BaselineRun[],
  candidateRuns: BaselineRun[],
  artifactIds: { baseline: string; candidate: string },
): ComparisonOutcome {
  return {
    kind: 'metric',
    workloadId: group.workloadId,
    metricId: instance.metricId,
    phase: instance.phase,
    environmentId: group.environmentId,
    viewportId: group.viewportId,
    baselineArtifactId: artifactIds.baseline,
    candidateArtifactId: artifactIds.candidate,
    baselineRunIds: baselineRuns.map((run) => run.id),
    candidateRunIds: candidateRuns.map((run) => run.id),
    baselineValues: [],
    candidateValues: [],
    baselineMedian: null,
    candidateMedian: null,
    absoluteDelta: null,
    mode: null,
    percentage: null,
    tolerance: null,
    regressionLimit: null,
    passed: false,
    status: 'fail',
    unavailableReason: 'metric value missing across baseline or candidate runs',
  };
}

function collectFailures(
  baseline: readonly number[],
  candidate: readonly number[],
  isCorrect: (value: number) => boolean,
): CorrectnessFailure[] {
  const failures: CorrectnessFailure[] = [];
  for (const arm of ['baseline', 'candidate'] as const) {
    (arm === 'baseline' ? baseline : candidate).forEach((value, index) => {
      if (!isCorrect(value)) failures.push({ arm, repetition: index + 1, value });
    });
  }
  return failures;
}

function groupWorkloadRuns(report: OmmBaselineReportV1): Map<string, WorkloadRunGroup> {
  const groups = new Map<string, WorkloadRunGroup>();
  for (const run of report.runs) {
    const workloadId = typeof run.workloadId === 'string' ? run.workloadId : undefined;
    const environmentId = typeof run.environmentId === 'string' ? run.environmentId : undefined;
    const viewportId = typeof run.viewportId === 'string' ? run.viewportId : undefined;
    if (!workloadId || !environmentId || !viewportId) continue;
    const arm =
      typeof run.artifactId === 'string' && run.artifactId.includes('baseline')
        ? 'baseline'
        : 'candidate';
    const key = `${workloadId}\0${environmentId}`;
    const group = groups.get(key) ?? {
      workloadId,
      environmentId,
      viewportId,
      baseline: [],
      candidate: [],
    };
    (arm === 'baseline' ? group.baseline : group.candidate).push(run);
    groups.set(key, group);
  }
  return groups;
}

function extractRunMetric(run: BaselineRun, path: readonly string[]): number | undefined {
  if (!isRecord(run.metrics)) return undefined;
  let current: unknown = run.metrics;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined;
}

function timerResolutionOf(run: BaselineRun): number {
  const value = run.timerResolutionMilliseconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function byRunId(left: BaselineRun, right: BaselineRun): number {
  return left.id.localeCompare(right.id);
}

function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

function artifactIdsByArm(report: OmmBaselineReportV1): { baseline: string; candidate: string } {
  const byArm = { baseline: 'baseline', candidate: 'candidate' };
  for (const artifact of report.artifacts) {
    if (artifact.arm === 'baseline' || artifact.arm === 'candidate')
      byArm[artifact.arm] = artifact.id;
  }
  return byArm;
}

function compareGeometryFindings(report: OmmBaselineReportV1): ComparisonOutcome[] {
  const outcomes: ComparisonOutcome[] = [];
  const artifactIds = artifactIdsByArm(report);
  const targets = report.layout.filter(isTargetFinding) as unknown as TargetAuditFinding[];
  for (const group of groupFindings(targets).values()) {
    const classification = classifyTargetFinding(
      aggregateTargetState(group.baseline),
      aggregateTargetState(group.candidate),
    );
    outcomes.push(findingOutcome(group, 'target', classification, artifactIds));
  }
  const overlaps = report.audits.filter(isOverlapFinding) as unknown as Array<
    OverlapFinding & { runId: string }
  >;
  for (const group of groupFindings(overlaps).values()) {
    const classification = classifyOverlapFinding(
      aggregateEdgeDepths(group.baseline),
      aggregateEdgeDepths(group.candidate),
    );
    outcomes.push(findingOutcome(group, 'overlap', classification, artifactIds));
  }
  const escapes = report.audits.filter(isEscapeFinding) as unknown as EscapeAuditFinding[];
  for (const group of groupFindings(escapes).values()) {
    const classification = classifyEscapeFinding(
      aggregateEdgeDepths(group.baseline),
      aggregateEdgeDepths(group.candidate),
    );
    outcomes.push(findingOutcome(group, 'escape', classification, artifactIds));
  }
  return outcomes;
}

function findingOutcome(
  group: FindingGroup<{ runId: string; key: string }>,
  findingType: 'target' | 'overlap' | 'escape',
  classification: FindingClassification,
  artifactIds: { baseline: string; candidate: string },
): ComparisonOutcome {
  const passed =
    classification === 'grandfathered' ||
    classification === 'improved' ||
    classification === 'unchanged';
  return {
    kind: 'finding',
    environmentId: group.browser,
    viewportId: group.viewport,
    baselineArtifactId: artifactIds.baseline,
    candidateArtifactId: artifactIds.candidate,
    baselineRunIds: group.baseline.map((finding) => finding.runId).sort(),
    candidateRunIds: group.candidate.map((finding) => finding.runId).sort(),
    baselineValues: [],
    candidateValues: [],
    baselineMedian: null,
    candidateMedian: null,
    absoluteDelta: null,
    mode: null,
    percentage: null,
    tolerance: null,
    regressionLimit: null,
    passed,
    status: passed ? 'pass' : 'fail',
    findingKey: group.key,
    findingType,
    classification,
  };
}

function aggregateTargetState(findings: readonly TargetAuditFinding[]): TargetState | undefined {
  if (findings.length === 0) return undefined;
  return {
    width: nearestRank(
      findings.map((finding) => finding.width),
      0.5,
    ),
    height: nearestRank(
      findings.map((finding) => finding.height),
      0.5,
    ),
    activatable: findings.every((finding) => finding.activatable),
  };
}

function aggregateEdgeDepths(
  findings: readonly { edgeDepths: EdgeDepths }[],
): EdgeDepths | undefined {
  if (findings.length === 0) return undefined;
  return {
    left: Math.max(...findings.map((finding) => finding.edgeDepths.left)),
    right: Math.max(...findings.map((finding) => finding.edgeDepths.right)),
    top: Math.max(...findings.map((finding) => finding.edgeDepths.top)),
    bottom: Math.max(...findings.map((finding) => finding.edgeDepths.bottom)),
  };
}

function groupFindings<T extends { runId: string; key: string }>(
  findings: readonly T[],
): Map<string, FindingGroup<T>> {
  const groups = new Map<string, FindingGroup<T>>();
  for (const finding of findings) {
    const context = findingRunContext(finding.runId);
    if (!context) continue;
    const key = `${context.browser}\0${context.viewport}\0${finding.key}`;
    const group = groups.get(key) ?? {
      browser: context.browser,
      viewport: context.viewport,
      key: finding.key,
      baseline: [],
      candidate: [],
    };
    (context.arm === 'baseline' ? group.baseline : group.candidate).push(finding);
    groups.set(key, group);
  }
  return groups;
}

function findingRunContext(
  runId: string,
): { arm: ArmName; browser: BrowserName; viewport: string } | undefined {
  const arm = runId.startsWith('baseline-')
    ? 'baseline'
    : runId.startsWith('candidate-')
      ? 'candidate'
      : undefined;
  if (!arm) return undefined;
  const browser = runId.includes('-chrome-')
    ? 'chrome'
    : runId.includes('-firefox-')
      ? 'firefox'
      : undefined;
  if (!browser) return undefined;
  const viewport = knownViewportIds.find((id) => runId.includes(id));
  if (!viewport) return undefined;
  return { arm, browser, viewport };
}

function isTargetFinding(value: unknown): value is TargetAuditFinding {
  return (
    isRecord(value) &&
    typeof value.runId === 'string' &&
    typeof value.key === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.activatable === 'boolean'
  );
}

function isOverlapFinding(value: unknown): value is OverlapFinding & { runId: string } {
  return (
    isRecord(value) &&
    typeof value.runId === 'string' &&
    typeof value.key === 'string' &&
    Array.isArray(value.controlIds) &&
    isRecord(value.edgeDepths)
  );
}

function isEscapeFinding(value: unknown): value is EscapeAuditFinding {
  return (
    isRecord(value) &&
    typeof value.runId === 'string' &&
    typeof value.key === 'string' &&
    typeof value.controlId === 'string' &&
    isRecord(value.edgeDepths) &&
    !('width' in value)
  );
}

function reportForArm(report: OmmBaselineReportV1, arm: ArmName): OmmBaselineReportV1 {
  return {
    ...report,
    artifacts: report.artifacts.filter((artifact) => artifact.arm === arm),
    runs: report.runs.filter(
      (run) => typeof run.artifactId === 'string' && run.artifactId.includes(arm),
    ),
    interaction: report.interaction.filter((record) => armOfRunId(runIdOf(record)) === arm),
    layout: report.layout.filter((record) => armOfRunId(runIdOf(record)) === arm),
    audits: report.audits.filter((record) => armOfRunId(runIdOf(record)) === arm),
  };
}

function runIdOf(record: Record<string, unknown>): string {
  return typeof record.runId === 'string' ? record.runId : '';
}

function armOfRunId(runId: string): ArmName | undefined {
  if (runId.startsWith('baseline-')) return 'baseline';
  if (runId.startsWith('candidate-')) return 'candidate';
  return undefined;
}

function command(
  argv: string[],
  cwd: string,
  environment: Record<string, string | undefined>,
  captureOutput = false,
): CommandSpec {
  return {
    argv,
    cwd,
    captureOutput,
    env: Object.fromEntries(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hashDirectoryFallback(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

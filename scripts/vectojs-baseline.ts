import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixtureDirectory, loadAndValidateFixture } from './vectojs-baseline/fixture';
import { generateGraphFixtures } from './vectojs-baseline/generate-graphs';
import { hashDirectory } from './vectojs-baseline/manifest';
import { canonicalize, validateReport } from './vectojs-baseline/report';
import {
  parseBaselineArguments,
  runBaseline,
  type BaselineRunnerDependencies,
} from './vectojs-baseline/runner';

type CaptureAdapter = Omit<
  BaselineRunnerDependencies,
  'validateFixtures' | 'generateGraphs' | 'checkGraphs' | 'validateReport' | 'writeReport'
>;

const root = resolve(import.meta.dir, '..');

async function main(arguments_: readonly string[]): Promise<void> {
  const mode = parseBaselineArguments(arguments_);
  const dependencies = await repositoryDependencies(mode.mode === 'capture');
  await runBaseline(mode, dependencies);
}

async function repositoryDependencies(
  requireCapture: boolean,
): Promise<BaselineRunnerDependencies> {
  const adapter = requireCapture ? await loadCaptureAdapter() : unavailableCaptureAdapter;
  return {
    ...adapter,
    async validateFixtures() {
      const fixture = await loadAndValidateFixture();
      return {
        schemaVersion: fixture.manifest.schemaVersion,
        sha256: hashDirectory(fixtureDirectory),
        value: fixture,
      };
    },
    generateGraphs: generateGraphFixtures,
    async checkGraphs() {
      await generateGraphFixtures(true);
    },
    validateReport,
    async writeReport(report, input) {
      const directory = join(root, 'tmp', 'vectojs-baseline');
      await mkdir(directory, { recursive: true });
      const suffix =
        input.mode.repetitions === 1
          ? 'diagnostic'
          : input.mode.repetitions === 3
            ? 'soak'
            : 'paired';
      await writeFile(
        join(directory, `${input.preflight.runId}-${suffix}.json`),
        `${canonicalize(report)}\n`,
      );
    },
  };
}

async function loadCaptureAdapter(): Promise<CaptureAdapter> {
  const moduleUrl = new URL('./vectojs-baseline/browser-runner.ts', import.meta.url).href;
  let module: { createBaselineCaptureDependencies?: () => CaptureAdapter };
  try {
    module = await import(moduleUrl);
  } catch (error) {
    if (error instanceof Error && /Cannot find module|ModuleNotFound/.test(error.message)) {
      throw new Error(
        'Baseline capture adapter is unavailable: expected scripts/vectojs-baseline/browser-runner.ts',
        { cause: error },
      );
    }
    throw error;
  }
  if (typeof module.createBaselineCaptureDependencies !== 'function') {
    throw new Error('browser-runner.ts must export createBaselineCaptureDependencies()');
  }
  return module.createBaselineCaptureDependencies();
}

const unavailable = async (): Promise<never> => {
  throw new Error('Baseline capture dependencies are unavailable');
};

const unavailableCaptureAdapter: CaptureAdapter = {
  preflight: unavailable,
  prepare: unavailable,
  startPreviews: unavailable,
  startBrowser: unavailable,
  assembleReport: unavailable,
  compareReport: unavailable,
  stopPreviews: unavailable,
  cleanup: unavailable,
};

if (import.meta.main) {
  await main(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

import { describe, expect, test } from 'bun:test';
import {
  BASELINE_REVISION,
  assembleBaselineReport,
  compareBaselineReport,
  createBaselineCaptureDependencies,
  type BrowserRunnerPlatform,
} from './browser-runner';

const candidateRevision = '1'.repeat(40);

describe('browser capture adapter', () => {
  test('allows a dirty diagnostic as non-quotable but rejects a dirty full capture', async () => {
    const platform = fakePlatform({ status: ' M scripts/vectojs-baseline/browser-runner.ts' });
    const adapter = createBaselineCaptureDependencies(platform);

    await expect(adapter.preflight({ mode: 'capture', repetitions: 5 })).rejects.toThrow(
      'quotable full capture requires a clean candidate',
    );
    expect(await adapter.preflight({ mode: 'capture', repetitions: 1 })).toMatchObject({
      candidateRevision,
      runnerRevision: candidateRevision,
      quotable: false,
      baselineRevision: BASELINE_REVISION,
    });
  });

  test('prepares detached baseline and both arms with two isolated installs and builds', async () => {
    const platform = fakePlatform();
    const adapter = createBaselineCaptureDependencies(platform);
    const preflight = await adapter.preflight({ mode: 'capture', repetitions: 5 });
    const prepared = await adapter.prepare(preflight);

    expect(platform.commands.filter((command) => command.argv[0] === 'git')).toContainEqual(
      expect.objectContaining({
        argv: ['git', 'worktree', 'add', '--detach', expect.any(String), BASELINE_REVISION],
      }),
    );
    expect(
      platform.commands.filter((command) => command.argv.slice(0, 2).join(' ') === 'bun install'),
    ).toHaveLength(4);
    expect(
      platform.commands.filter((command) => command.argv.join(' ') === 'bun run build'),
    ).toHaveLength(4);
    expect(prepared.arms?.baseline?.plan?.root).toContain('/tmp/opencode/');
    expect(prepared.arms?.candidate?.plan?.root).toContain('/tmp/opencode/');
  });

  test('assembles all report sections and compares five matching physics values', () => {
    const report = assembleBaselineReport(reportInput());
    expect(report).toMatchObject({
      schemaVersion: 1,
      runnerRevision: candidateRevision,
      fixture: { schemaVersion: 1, sha256: 'f'.repeat(64) },
    });
    expect(report.artifacts).toHaveLength(2);
    expect(report.environments).toHaveLength(1);
    expect(report.viewports).toHaveLength(1);
    expect(report.runs).toHaveLength(10);
    expect(report.interaction).toHaveLength(10);
    expect(report.layout).toHaveLength(10);
    expect(report.audits).toHaveLength(10);

    const compared = compareBaselineReport(report);
    expect(compared.comparison).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workloadId: 'sparse-500',
          metricId: 'tick-p95',
          baselineValues: [10, 10, 10, 10, 10],
          candidateValues: [11, 11, 11, 11, 11],
          passed: true,
        }),
      ]),
    );
    expect(compared.comparisonInputs?.baselineReportSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

function fakePlatform(options: { status?: string } = {}) {
  const commands: Array<{ argv: string[]; cwd: string; env: Record<string, string> }> = [];
  const platform: BrowserRunnerPlatform & { commands: typeof commands } = {
    commands,
    cwd: () => '/repo',
    environment: {},
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    async command(command) {
      commands.push(command);
      if (command.argv.join(' ') === 'git rev-parse HEAD') return candidateRevision + '\n';
      if (command.argv.join(' ') === 'git status --porcelain') return options.status ?? '';
      return '';
    },
    async remove() {},
    async mkdir() {},
    async writeFile() {},
    async readFile(path) {
      if (path.endsWith('bun.lock')) return 'lock';
      if (path.endsWith('.json')) return '{"nodes":[],"links":[]}\n';
      return '';
    },
    sourceSnapshot: () => ({ sha256: 'a'.repeat(64) }),
    installSnapshot: () => ({
      lockfileSha256: 'b'.repeat(64),
      dependencyVersions: { '@vectojs/core': '1.0.0' },
      installedPackageManifestSha256: 'c'.repeat(64),
    }),
    buildSnapshot: () => ({ sha256: 'd'.repeat(64) }),
    bundlePhysics: async (plan) => ({
      path: `${plan.outputDir}/physics.js`,
      sha256: 'e'.repeat(64),
      graphLayoutPackagePath: `${plan.root}/node_modules/@vectojs/graph-layout`,
    }),
    startPreview: async (options) => ({
      arm: options.arm,
      url: `http://127.0.0.1:${options.port}`,
      child: { exited: Promise.resolve(0), kill() {} },
      async stop() {},
    }),
    stopPreviews: async () => {},
    launchBrowsers: async () => {
      throw new Error('not used');
    },
  };
  return platform;
}

function reportInput(): Parameters<typeof assembleBaselineReport>[0] {
  const captures = [];
  for (let repetition = 1; repetition <= 5; repetition += 1) {
    for (const arm of ['baseline', 'candidate'] as const) {
      const runId = `${arm}-${repetition}`;
      captures.push({
        request: { arm, browser: 'chrome' as const, repetition },
        runs: [
          {
            id: runId,
            startedAt: '2026-08-17T00:00:00.000Z',
            artifactId: arm,
            environmentId: 'chrome',
            viewportId: 'physics-desktop',
            workloadId: 'sparse-500',
            timerResolutionMilliseconds: 0.01,
            metrics: {
              kind: 'graph',
              measured: {
                tickP95Milliseconds: arm === 'baseline' ? 10 : 11,
                tickMaximumMilliseconds: 12,
                synchronousStepsAbove50Milliseconds: 0,
              },
              initial: {
                settlingTicks: 100,
                settlingWallMilliseconds: 20,
                nonFinitePositionCount: 0,
                collisionOverlapCount: 0,
              },
            },
          },
        ],
        interaction: [{ runId, scenarioId: 'desktop-bootstrap' }],
        layout: [{ runId, workloadId: 'sparse-500' }],
        audits: [{ runId, type: 'idle', passed: true }],
      });
    }
  }
  return {
    mode: { mode: 'capture', repetitions: 5 },
    fixture: { schemaVersion: 1, sha256: 'f'.repeat(64), value: {} },
    preflight: {
      candidateRoot: '/repo',
      candidateRevision,
      runnerRevision: candidateRevision,
      baselineRevision: BASELINE_REVISION,
      runId: 'run-1',
      quotable: true,
    },
    prepared: {
      artifacts: [artifact('baseline'), artifact('candidate')],
      environments: [
        {
          id: 'chrome',
          browser: 'chrome',
          executableSha256: 'a'.repeat(64),
          userAgent: 'Chrome',
          hardwareConcurrency: 8,
          os: 'linux',
          cpu: 'cpu',
          memoryBytes: 1,
          browserExecutable: '/chrome',
          browserVersion: '1',
          playwrightVersion: '1',
          bunVersion: '1',
        },
      ],
      viewports: [
        { id: 'physics-desktop', width: 1280, height: 800, requestedDeviceScaleFactor: 1 },
      ],
      workloads: [{ id: 'sparse-500' }],
    },
    captures,
  } as Parameters<typeof assembleBaselineReport>[0];
}

function artifact(arm: 'baseline' | 'candidate') {
  return {
    id: arm,
    arm,
    appRevision: arm === 'baseline' ? BASELINE_REVISION : candidateRevision,
    sourceTreeSha256: '1'.repeat(64),
    lockfileSha256: '2'.repeat(64),
    dependencyVersions: {},
    installedPackageManifestSha256: '3'.repeat(64),
    repeatedInstallManifestSha256: '3'.repeat(64),
    buildSha256: '4'.repeat(64),
    buildMode: 'production-preview' as const,
  };
}

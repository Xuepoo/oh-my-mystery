import { describe, expect, test } from 'bun:test';
import {
  parseBaselineArguments,
  runBaseline,
  type BaselineRunnerDependencies,
  type CaptureRequest,
} from './runner';

describe('parseBaselineArguments', () => {
  test('selects validation, graph generation, diagnostic, soak, and full modes', () => {
    expect(parseBaselineArguments(['--validate-fixtures'])).toEqual({ mode: 'validate-fixtures' });
    expect(parseBaselineArguments(['--generate-graphs'])).toEqual({
      mode: 'generate-graphs',
      check: false,
    });
    expect(parseBaselineArguments(['--generate-graphs', '--check'])).toEqual({
      mode: 'generate-graphs',
      check: true,
    });
    expect(parseBaselineArguments(['--diagnostic'])).toEqual({ mode: 'capture', repetitions: 1 });
    expect(parseBaselineArguments(['--soak'])).toEqual({ mode: 'capture', repetitions: 3 });
    expect(parseBaselineArguments([])).toEqual({ mode: 'capture', repetitions: 5 });
  });

  test('rejects unknown and conflicting arguments', () => {
    expect(() => parseBaselineArguments(['--check'])).toThrow('--check requires --generate-graphs');
    expect(() => parseBaselineArguments(['--diagnostic', '--validate-fixtures'])).toThrow(
      'Choose exactly one baseline mode',
    );
    expect(() => parseBaselineArguments(['--diagnostic', '--soak'])).toThrow(
      'Choose exactly one baseline mode',
    );
    expect(() => parseBaselineArguments(['--unknown'])).toThrow('Unknown argument');
  });
});

test('soak reuses each browser across three candidate captures', async () => {
  const fake = fakeDependencies();
  await runBaseline({ mode: 'capture', repetitions: 3 }, fake.dependencies);

  expect(fake.captures).toEqual([
    { arm: 'candidate', browser: 'chrome', repetition: 1 },
    { arm: 'candidate', browser: 'firefox', repetition: 1 },
    { arm: 'candidate', browser: 'chrome', repetition: 2 },
    { arm: 'candidate', browser: 'firefox', repetition: 2 },
    { arm: 'candidate', browser: 'chrome', repetition: 3 },
    { arm: 'candidate', browser: 'firefox', repetition: 3 },
  ]);
  expect(fake.calls).not.toContain('compare-report');
});

test('fixture validation and graph generation do not run capture preflight', async () => {
  const validation = fakeDependencies();
  await runBaseline({ mode: 'validate-fixtures' }, validation.dependencies);
  expect(validation.calls).toEqual(['validate-fixtures']);

  const generation = fakeDependencies();
  await runBaseline({ mode: 'generate-graphs', check: true }, generation.dependencies);
  expect(generation.calls).toEqual(['generate-graphs:true']);
});

test('diagnostic captures only the candidate once in Chrome then Firefox', async () => {
  const fake = fakeDependencies();
  await runBaseline({ mode: 'capture', repetitions: 1 }, fake.dependencies);

  expect(fake.captures).toEqual([
    { arm: 'candidate', browser: 'chrome', repetition: 1 },
    { arm: 'candidate', browser: 'firefox', repetition: 1 },
  ]);
  expect(fake.calls).toEqual([
    'validate-fixtures',
    'check-graphs',
    'preflight',
    'prepare',
    'start-previews',
    'start-browser',
    'capture:candidate:chrome:1',
    'capture:candidate:firefox:1',
    'assemble:2',
    'validate-report',
    'write-report',
    'close-browser',
    'stop-previews',
    'cleanup',
  ]);
});

test('fails a full capture when comparison outcomes fail', async () => {
  const fake = fakeDependencies({ comparison: [{ status: 'fail', metricId: 'tick-p95' }] });

  await expect(runBaseline({ mode: 'capture', repetitions: 5 }, fake.dependencies)).rejects.toThrow(
    'Baseline comparison failed: tick-p95',
  );
  expect(fake.calls).toContain('write-report');
});

test('full capture alternates paired browser and arm order across five repetitions', async () => {
  const fake = fakeDependencies();
  await runBaseline({ mode: 'capture', repetitions: 5 }, fake.dependencies);

  expect(fake.captures).toEqual([
    { arm: 'baseline', browser: 'chrome', repetition: 1 },
    { arm: 'candidate', browser: 'chrome', repetition: 1 },
    { arm: 'baseline', browser: 'firefox', repetition: 1 },
    { arm: 'candidate', browser: 'firefox', repetition: 1 },
    { arm: 'candidate', browser: 'firefox', repetition: 2 },
    { arm: 'baseline', browser: 'firefox', repetition: 2 },
    { arm: 'candidate', browser: 'chrome', repetition: 2 },
    { arm: 'baseline', browser: 'chrome', repetition: 2 },
    { arm: 'baseline', browser: 'chrome', repetition: 3 },
    { arm: 'candidate', browser: 'chrome', repetition: 3 },
    { arm: 'baseline', browser: 'firefox', repetition: 3 },
    { arm: 'candidate', browser: 'firefox', repetition: 3 },
    { arm: 'candidate', browser: 'firefox', repetition: 4 },
    { arm: 'baseline', browser: 'firefox', repetition: 4 },
    { arm: 'candidate', browser: 'chrome', repetition: 4 },
    { arm: 'baseline', browser: 'chrome', repetition: 4 },
    { arm: 'baseline', browser: 'chrome', repetition: 5 },
    { arm: 'candidate', browser: 'chrome', repetition: 5 },
    { arm: 'baseline', browser: 'firefox', repetition: 5 },
    { arm: 'candidate', browser: 'firefox', repetition: 5 },
  ]);
  expect(fake.calls.slice(-6)).toEqual([
    'compare-report',
    'validate-report',
    'write-report',
    'close-browser',
    'stop-previews',
    'cleanup',
  ]);
});

test('cleans up browser, previews, and prepared arms after capture failure', async () => {
  const fake = fakeDependencies({ failCapture: true });
  await expect(runBaseline({ mode: 'capture', repetitions: 1 }, fake.dependencies)).rejects.toThrow(
    'capture failed',
  );
  expect(fake.calls.slice(-3)).toEqual(['close-browser', 'stop-previews', 'cleanup']);
  expect(fake.calls).not.toContain('assemble:2');
});

function fakeDependencies(options: { failCapture?: boolean; comparison?: unknown[] } = {}): {
  calls: string[];
  captures: CaptureRequest[];
  dependencies: BaselineRunnerDependencies;
} {
  const calls: string[] = [];
  const captures: CaptureRequest[] = [];
  return {
    calls,
    captures,
    dependencies: {
      async validateFixtures() {
        calls.push('validate-fixtures');
        return { schemaVersion: 1, sha256: 'a'.repeat(64), value: {} };
      },
      async generateGraphs(check) {
        calls.push(`generate-graphs:${check}`);
      },
      async checkGraphs() {
        calls.push('check-graphs');
      },
      async preflight() {
        calls.push('preflight');
        return {
          candidateRoot: '/repo',
          candidateRevision: '1'.repeat(40),
          runnerRevision: '1'.repeat(40),
          runId: 'run-1',
        };
      },
      async prepare(context) {
        calls.push('prepare');
        return { context };
      },
      async startPreviews(prepared) {
        calls.push('start-previews');
        return { prepared, urls: { baseline: 'http://baseline', candidate: 'http://candidate' } };
      },
      async startBrowser() {
        calls.push('start-browser');
        return {
          async capture(request) {
            captures.push(request);
            calls.push(`capture:${request.arm}:${request.browser}:${request.repetition}`);
            if (options.failCapture) throw new Error('capture failed');
            return { request };
          },
          async close() {
            calls.push('close-browser');
          },
        };
      },
      async assembleReport(input) {
        calls.push(`assemble:${input.captures.length}`);
        return { report: true };
      },
      validateReport(report) {
        calls.push('validate-report');
        return report;
      },
      async compareReport(report) {
        calls.push('compare-report');
        return options.comparison ? { ...report, comparison: options.comparison } : report;
      },
      async writeReport() {
        calls.push('write-report');
      },
      async stopPreviews() {
        calls.push('stop-previews');
      },
      async cleanup() {
        calls.push('cleanup');
      },
    },
  };
}

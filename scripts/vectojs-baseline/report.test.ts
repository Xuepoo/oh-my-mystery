import { expect, test } from 'bun:test';
import { canonicalize, hashReport, validateReport } from './report';

test('canonicalizes the RFC 8785 serialization sample', () => {
  const value = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/","literals":[null,true,false]}',
  );

  expect(canonicalize(value)).toBe(
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/"}',
  );
});

test('sorts object keys by UTF-16 code units at every depth', () => {
  expect(
    canonicalize({ '\u20ac': 1, '\r': 2, '\ufb33': 3, '1': { z: 1, a: 2 }, '\ud83d\ude00': 4 }),
  ).toBe('{"\\r":2,"1":{"a":2,"z":1},"€":1,"😀":4,"דּ":3}');
});

test('rejects values outside the I-JSON domain', () => {
  expect(() => canonicalize(Number.NaN)).toThrow('finite');
  expect(() => canonicalize({ value: undefined })).toThrow('JSON value');
  expect(() => canonicalize('\ud800')).toThrow('lone surrogate');
});

test('report hashes exclude only comparison metadata and timestamps', () => {
  const base = validReport();
  const decorated = {
    ...base,
    generatedAt: '2099-12-31T23:59:59.000Z',
    comparison: [{ status: 'failed' }],
    comparisonInputs: {
      baselineReportSha256: 'a'.repeat(64),
      candidateReportSha256: 'b'.repeat(64),
    },
    runs: [{ ...base.runs[0], startedAt: '2099-01-01T00:00:00.000Z' }],
  };

  expect(hashReport(decorated)).toBe(hashReport(base));
  expect(hashReport({ ...base, runnerRevision: '2'.repeat(40) })).not.toBe(hashReport(base));
});

test('validates the report envelope and rejects malformed revisions and hashes', () => {
  expect(validateReport(validReport())).toEqual(validReport());
  expect(() => validateReport({ ...validReport(), runnerRevision: 'short' })).toThrow(
    'runnerRevision',
  );
  expect(() =>
    validateReport({ ...validReport(), fixture: { schemaVersion: 1, sha256: 'bad' } }),
  ).toThrow('fixture.sha256');
});

function validReport() {
  return {
    schemaVersion: 1 as const,
    generatedAt: '2026-08-17T00:00:00.000Z',
    runnerRevision: '1'.repeat(40),
    artifacts: [],
    environments: [],
    viewports: [],
    fixture: { schemaVersion: 1, sha256: 'a'.repeat(64) },
    workloads: [],
    runs: [{ id: 'run-1', startedAt: '2026-08-17T00:00:01.000Z' }],
    interaction: [],
    layout: [],
    audits: [],
  };
}

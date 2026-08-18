import { createHash } from 'node:crypto';

export interface BaselineArtifact {
  id: string;
  arm: 'baseline' | 'candidate';
  appRevision: string;
  sourceTreeSha256: string;
  lockfileSha256: string;
  dependencyVersions: Record<string, string>;
  installedPackageManifestSha256: string;
  repeatedInstallManifestSha256: string;
  buildSha256: string;
  buildMode: 'production-preview';
}

export interface BaselineEnvironment {
  id: string;
  browser: string;
  executableSha256: string;
  userAgent: string;
  hardwareConcurrency: number;
  os: string;
  cpu: string;
  memoryBytes: number;
  browserExecutable: string;
  browserVersion: string;
  playwrightVersion: string;
  bunVersion: string;
}

export interface BaselineViewport {
  id: string;
  width: number;
  height: number;
  requestedDeviceScaleFactor: number;
}

export interface BaselineRun {
  id: string;
  startedAt: string;
  [key: string]: JsonValue;
}

export interface OmmBaselineReportV1 {
  schemaVersion: 1;
  generatedAt: string;
  runnerRevision: string;
  artifacts: BaselineArtifact[];
  environments: BaselineEnvironment[];
  viewports: BaselineViewport[];
  fixture: { schemaVersion: number; sha256: string };
  workloads: JsonObject[];
  runs: BaselineRun[];
  interaction: JsonObject[];
  layout: JsonObject[];
  audits: JsonObject[];
  comparison?: JsonObject[];
  comparisonInputs?: {
    baselineReportSha256: string;
    candidateReportSha256: string;
  };
}

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;
const RUN_TIMESTAMP_KEYS = new Set(['startedAt', 'endedAt', 'startTime', 'endTime']);

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Expected a plain JSON value');
  }

  const object = value as Record<string, unknown>;
  const members = Object.keys(object)
    .sort()
    .map((key) => {
      assertValidUnicode(key);
      if (object[key] === undefined) throw new TypeError(`Expected a JSON value at ${key}`);
      return `${JSON.stringify(key)}:${canonicalize(object[key])}`;
    });
  return `{${members.join(',')}}`;
}

export function hashReport(report: OmmBaselineReportV1 | Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalize(reportHashInput(report)))
    .digest('hex');
}

export function reportHashInput(
  report: OmmBaselineReportV1 | Record<string, unknown>,
): Record<string, unknown> {
  const {
    generatedAt: _generatedAt,
    comparison: _comparison,
    comparisonInputs: _inputs,
    ...input
  } = report;
  if (!Array.isArray(input.runs)) return input;
  return {
    ...input,
    runs: input.runs.map((run) => {
      if (!isRecord(run)) return run;
      return Object.fromEntries(
        Object.entries(run).filter(([key]) => !RUN_TIMESTAMP_KEYS.has(key)),
      );
    }),
  };
}

export function validateReport(value: unknown): OmmBaselineReportV1 {
  if (!isRecord(value)) throw new TypeError('Report must be an object');
  if (value.schemaVersion !== 1) throw new TypeError('schemaVersion must be 1');
  assertString(value.generatedAt, 'generatedAt');
  assertPattern(value.runnerRevision, GIT_REVISION, 'runnerRevision');
  assertArray(value.artifacts, 'artifacts');
  assertArray(value.environments, 'environments');
  assertArray(value.viewports, 'viewports');
  assertArray(value.workloads, 'workloads');
  assertArray(value.runs, 'runs');
  assertArray(value.interaction, 'interaction');
  assertArray(value.layout, 'layout');
  assertArray(value.audits, 'audits');
  if (!isRecord(value.fixture)) throw new TypeError('fixture must be an object');
  if (!Number.isInteger(value.fixture.schemaVersion) || Number(value.fixture.schemaVersion) < 1) {
    throw new TypeError('fixture.schemaVersion must be a positive integer');
  }
  assertPattern(value.fixture.sha256, SHA256, 'fixture.sha256');

  for (const [index, artifact] of value.artifacts.entries()) {
    if (!isRecord(artifact)) throw new TypeError(`artifacts[${index}] must be an object`);
    assertPattern(artifact.appRevision, GIT_REVISION, `artifacts[${index}].appRevision`);
    for (const key of [
      'sourceTreeSha256',
      'lockfileSha256',
      'installedPackageManifestSha256',
      'repeatedInstallManifestSha256',
      'buildSha256',
    ]) {
      assertPattern(artifact[key], SHA256, `artifacts[${index}].${key}`);
    }
  }

  for (const [index, environment] of value.environments.entries()) {
    if (!isRecord(environment)) throw new TypeError(`environments[${index}] must be an object`);
    assertString(environment.id, `environments[${index}].id`);
    assertString(environment.browser, `environments[${index}].browser`);
    assertPattern(environment.executableSha256, SHA256, `environments[${index}].executableSha256`);
    assertString(environment.userAgent, `environments[${index}].userAgent`);
    assertNonNegativeInteger(
      environment.hardwareConcurrency,
      `environments[${index}].hardwareConcurrency`,
    );
    assertString(environment.os, `environments[${index}].os`);
    assertString(environment.cpu, `environments[${index}].cpu`);
    assertPositiveNumber(environment.memoryBytes, `environments[${index}].memoryBytes`);
    assertString(environment.browserExecutable, `environments[${index}].browserExecutable`);
    assertString(environment.browserVersion, `environments[${index}].browserVersion`);
    assertString(environment.playwrightVersion, `environments[${index}].playwrightVersion`);
    assertString(environment.bunVersion, `environments[${index}].bunVersion`);
  }

  for (const [index, viewport] of value.viewports.entries()) {
    if (!isRecord(viewport)) throw new TypeError(`viewports[${index}] must be an object`);
    assertString(viewport.id, `viewports[${index}].id`);
    assertPositiveInteger(viewport.width, `viewports[${index}].width`);
    assertPositiveInteger(viewport.height, `viewports[${index}].height`);
    assertPositiveNumber(
      viewport.requestedDeviceScaleFactor,
      `viewports[${index}].requestedDeviceScaleFactor`,
    );
  }

  canonicalize(value);
  return value as unknown as OmmBaselineReportV1;
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new TypeError('JSON string contains a lone surrogate');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('JSON string contains a lone surrogate');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`);
}

function assertPattern(value: unknown, pattern: RegExp, path: string): asserts value is string {
  assertString(value, path);
  if (!pattern.test(value)) throw new TypeError(`${path} has an invalid format`);
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) <= 0)
    throw new TypeError(`${path} must be a positive integer`);
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0)
    throw new TypeError(`${path} must be a non-negative integer`);
}

function assertPositiveNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${path} must be a finite positive number`);
}

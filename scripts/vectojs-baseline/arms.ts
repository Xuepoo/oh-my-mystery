import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createManifest, hashManifest, type ManifestEntry, type ManifestInclude } from './manifest';

export type ArmName = 'baseline' | 'candidate';

export interface CommandSpec {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  captureOutput?: boolean;
}

export interface PhysicsBundlePlan {
  arm: ArmName;
  root: string;
  entryPoint: string;
  outputDir: string;
  resolvePackage: '@vectojs/graph-layout';
  forbiddenImportRoot: string;
}

export interface ArmPlan {
  arm: ArmName;
  revision: string;
  root: string;
  cacheDir: string;
  temporaryRoot: string;
  createWorktree?: CommandSpec;
  install: CommandSpec;
  build: CommandSpec;
  physicsBundle: PhysicsBundlePlan;
}

export interface BuildArmPlanOptions {
  arm: ArmName;
  revision: string;
  candidateRoot: string;
  runId: string;
  environment: Record<string, string | undefined>;
  baselineSourceRoot?: string;
  physicsEntryPoint?: string;
}

export interface VectoResolution {
  name: string;
  version: string;
  packagePath: string;
}

export interface InstallSnapshot {
  lockfileSha256: string;
  dependencyVersions: Record<string, string>;
  installedPackageManifestSha256: string;
}

export interface RepeatedInstallEquality {
  first: InstallSnapshot;
  second: InstallSnapshot;
  equal: true;
}

const FULL_COMMIT = /^[0-9a-f]{40}$/i;
const SAFE_RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const INHERITED_ENVIRONMENT = [
  'PATH',
  'HOME',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
] as const;

export function assertCleanFullCommit(revision: string, porcelainStatus: string): string {
  if (!FULL_COMMIT.test(revision))
    throw new Error('Revision must be a full 40-character commit ID');
  if (porcelainStatus.trim().length > 0) throw new Error('Source tree is not clean');
  return revision.toLowerCase();
}

export function buildArmPlan(options: BuildArmPlanOptions): ArmPlan {
  const revision = assertFullCommit(options.revision);
  if (!SAFE_RUN_ID.test(options.runId) || options.runId === '.' || options.runId === '..') {
    throw new Error(`Unsafe run ID: ${JSON.stringify(options.runId)}`);
  }
  if (!isAbsolute(options.candidateRoot)) throw new Error('Candidate root must be absolute');

  const tempRoot = join(resolve(options.candidateRoot), 'tmp', 'vectojs-baseline');
  const runsRoot = join(tempRoot, 'runs');
  const temporaryRoot = safeTemporaryPath(runsRoot, `omm-vectojs-${options.runId}`);
  const armTemporaryRoot = safeTemporaryPath(runsRoot, `omm-vectojs-${options.runId}`, options.arm);
  const root =
    options.arm === 'baseline'
      ? safeTemporaryPath(runsRoot, `omm-vectojs-${options.runId}`, 'baseline', 'worktree')
      : safeTemporaryPath(runsRoot, `omm-vectojs-${options.runId}`, 'candidate', 'worktree');
  const cacheDir = safeTemporaryPath(tempRoot, 'bun-cache');
  const env = isolatedBunEnvironment(options.environment, cacheDir, tempRoot);
  const command = (argv: string[]): CommandSpec => ({ argv, cwd: root, env: { ...env } });
  const baselineSourceRoot = resolve(options.baselineSourceRoot ?? options.candidateRoot);

  return {
    arm: options.arm,
    revision,
    root,
    cacheDir,
    temporaryRoot,
    createWorktree: {
      argv: ['git', 'worktree', 'add', '--detach', root, revision],
      cwd: baselineSourceRoot,
      env: inheritedEnvironment(options.environment),
    },
    install: command(['bun', 'install', '--frozen-lockfile', '--ignore-scripts']),
    build: command(['bun', 'run', 'build']),
    physicsBundle: {
      arm: options.arm,
      root,
      entryPoint:
        options.physicsEntryPoint ??
        safeTemporaryPath(runsRoot, `omm-vectojs-${options.runId}`, 'runner', 'physics-entry.ts'),
      outputDir: join(armTemporaryRoot, 'physics-bundle'),
      resolvePackage: '@vectojs/graph-layout',
      forbiddenImportRoot: join(root, 'apps'),
    },
  };
}

export function isolatedBunEnvironment(
  environment: Record<string, string | undefined>,
  cacheDir: string,
  temporaryRoot: string,
): Record<string, string> {
  return {
    ...inheritedEnvironment(environment),
    BUN_INSTALL_CACHE_DIR: assertSafeTemporaryPath(cacheDir, temporaryRoot),
  };
}

export function createSourceManifest(root: string): ManifestEntry[] {
  return createManifest(root, sourceManifestInclude);
}

export function createBuildManifest(
  root: string,
  buildDirectory = 'apps/web/dist',
): ManifestEntry[] {
  const normalized = normalizeRelativeDirectory(buildDirectory);
  return createManifest(join(root, ...normalized.split('/')));
}

export function createInstalledPackageManifest(
  root: string,
  resolutions: readonly VectoResolution[],
): ManifestEntry[] {
  const armRoot = resolve(root);
  const entries: ManifestEntry[] = [];
  const seen = new Set<string>();
  for (const resolution of [...resolutions].sort((left, right) =>
    left.packagePath.localeCompare(right.packagePath),
  )) {
    const packagePath = resolve(resolution.packagePath);
    assertPathInside(armRoot, packagePath, `${resolution.name} package`);
    const prefix = `${resolution.name}@${resolution.version}`;
    for (const entry of createManifest(packagePath)) {
      const path = `${prefix}/${entry.path}`;
      if (seen.has(path)) continue;
      seen.add(path);
      entries.push({ ...entry, path });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function hashPreparedManifest(entries: readonly ManifestEntry[]): string {
  return hashManifest(entries);
}

export function parseVectoLockVersions(lockfile: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const entry = /^\s*"(@vectojs\/[^"/]+)": \["@vectojs\/[^"/]+@([^"\s]+)"/gm;
  for (const match of lockfile.matchAll(entry)) {
    const [, name, version] = match;
    if (versions[name] !== undefined && versions[name] !== version) {
      throw new Error(`Ambiguous lockfile versions for ${name}`);
    }
    versions[name] = version;
  }
  return sortRecord(versions);
}

export function validateVectoResolutions(
  root: string,
  packagePaths: readonly string[],
  lockVersions: Readonly<Record<string, string>>,
): VectoResolution[] {
  const absoluteRoot = realpathSync(resolve(root));
  const resolutions = packagePaths.map((inputPath) => {
    const packagePath = resolve(inputPath);
    assertPathInside(absoluteRoot, packagePath, 'Resolved package');
    if (!lstatSync(packagePath).isDirectory() && !lstatSync(packagePath).isSymbolicLink())
      throw new Error(`Resolved package is not a directory: ${packagePath}`);
    const realPackagePath = realpathSync(packagePath);
    assertPathInside(absoluteRoot, realPackagePath, 'Resolved package target');
    const manifest = JSON.parse(readFileSync(join(realPackagePath, 'package.json'), 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    if (
      typeof manifest.name !== 'string' ||
      !manifest.name.startsWith('@vectojs/') ||
      typeof manifest.version !== 'string'
    ) {
      throw new Error(`Invalid @vectojs package manifest: ${realPackagePath}`);
    }
    if (!realPackagePath.includes(`${sep}node_modules${sep}`))
      throw new Error(`Resolved package is not an installed registry package: ${realPackagePath}`);
    if (lockVersions[manifest.name] !== manifest.version) {
      throw new Error(
        `${manifest.name}@${manifest.version} does not match lockfile version ${String(lockVersions[manifest.name])}`,
      );
    }
    return { name: manifest.name, version: manifest.version, packagePath };
  });

  return resolutions.sort((left, right) =>
    `${left.name}\0${left.packagePath}`.localeCompare(`${right.name}\0${right.packagePath}`),
  );
}

export function dependencyVersionRecord(
  resolutions: readonly VectoResolution[],
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const resolution of resolutions) {
    const previous = versions[resolution.name];
    if (previous !== undefined && previous !== resolution.version) {
      throw new Error(`Multiple installed versions for ${resolution.name}`);
    }
    versions[resolution.name] = resolution.version;
  }
  return sortRecord(versions);
}

export function assertRepeatedInstallEqual(
  first: InstallSnapshot,
  second: InstallSnapshot,
): RepeatedInstallEquality {
  if (first.lockfileSha256 !== second.lockfileSha256) {
    throw new Error('Repeated install changed the lockfile');
  }
  if (
    JSON.stringify(sortRecord(first.dependencyVersions)) !==
    JSON.stringify(sortRecord(second.dependencyVersions))
  ) {
    throw new Error('Repeated install changed the resolved dependency set');
  }
  if (first.installedPackageManifestSha256 !== second.installedPackageManifestSha256) {
    throw new Error('Repeated install changed the installed package manifest');
  }
  return { first, second, equal: true };
}

export function assertSafeTemporaryPath(path: string, temporaryRoot: string): string {
  const root = resolve(temporaryRoot);
  const absolute = resolve(path);
  if (absolute === root || !absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`Path must be a child of ${root}: ${path}`);
  }
  return absolute;
}

function safeTemporaryPath(temporaryRoot: string, ...parts: string[]): string {
  return assertSafeTemporaryPath(join(temporaryRoot, ...parts), temporaryRoot);
}

function inheritedEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of INHERITED_ENVIRONMENT) {
    const value = environment[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

const sourceManifestInclude: ManifestInclude = (path) => {
  const segments = path.replace(/\/$/, '').split('/');
  return !segments.some(
    (segment) =>
      segment === '.git' ||
      segment === 'node_modules' ||
      segment === 'tmp' ||
      segment === 'dist' ||
      segment === 'build',
  );
};

function normalizeRelativeDirectory(path: string): string {
  const normalized = toPosixPath(path).replace(/^\.\//, '').replace(/\/$/, '');
  if (
    normalized.length === 0 ||
    isAbsolute(path) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Build directory must be a safe relative path: ${path}`);
  }
  return normalized;
}

function assertPathInside(root: string, path: string, label: string): void {
  const child = relative(resolve(root), resolve(path));
  if (child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child)))
    return;
  throw new Error(`${label} resolves outside its arm: ${path}`);
}

function assertFullCommit(revision: string): string {
  if (!FULL_COMMIT.test(revision))
    throw new Error('Revision must be a full 40-character commit ID');
  return revision.toLowerCase();
}

function sortRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

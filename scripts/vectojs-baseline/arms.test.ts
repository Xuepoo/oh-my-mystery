import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import {
  assertCleanFullCommit,
  assertRepeatedInstallEqual,
  buildArmPlan,
  createBuildManifest,
  createInstalledPackageManifest,
  createSourceManifest,
  hashPreparedManifest,
  parseVectoLockVersions,
  validateVectoResolutions,
} from './arms';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('requires a clean worktree and a full commit ID', () => {
  expect(() => assertCleanFullCommit('abc', '')).toThrow('full 40-character');
  expect(() => assertCleanFullCommit('a'.repeat(40), ' M package.json\n')).toThrow('not clean');
  expect(assertCleanFullCommit('A'.repeat(40), '')).toBe('a'.repeat(40));
});

test('constructs isolated baseline commands and a minimal environment', () => {
  const plan = buildArmPlan({
    arm: 'baseline',
    revision: 'a'.repeat(40),
    candidateRoot: '/repo/candidate',
    runId: 'run-17',
    environment: {
      PATH: '/bin',
      HOME: '/home/test',
      HTTPS_PROXY: 'http://proxy',
      NODE_PATH: '/ambient',
      BUN_INSTALL: '/ambient/bun',
      npm_config_prefix: '/ambient/npm',
    },
  });

  expect(plan.root).toBe('/tmp/opencode/omm-vectojs-run-17/baseline/worktree');
  expect(plan.cacheDir).toBe('/tmp/opencode/omm-vectojs-run-17/baseline/bun-cache');
  expect(plan.createWorktree?.argv).toEqual([
    'git',
    'worktree',
    'add',
    '--detach',
    plan.root,
    'a'.repeat(40),
  ]);
  expect(plan.install.argv).toEqual(['bun', 'install', '--frozen-lockfile', '--ignore-scripts']);
  expect(plan.build.argv).toEqual(['bun', 'run', 'build']);
  expect(plan.install.cwd).toBe(plan.root);
  expect(plan.install.env).toEqual({
    PATH: '/bin',
    HOME: '/home/test',
    HTTPS_PROXY: 'http://proxy',
    BUN_INSTALL_CACHE_DIR: plan.cacheDir,
  });
  expect(plan.physicsBundle.root).toBe(plan.root);
  expect(plan.physicsBundle.outputDir.startsWith('/tmp/opencode/omm-vectojs-run-17/')).toBeTrue();
  expect(() =>
    buildArmPlan({
      arm: 'candidate',
      revision: 'b'.repeat(40),
      candidateRoot: '/repo/candidate',
      runId: '../escape',
      environment: {},
    }),
  ).toThrow('run ID');
});

test('creates canonical source, build, and selected package manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'omm-arms-'));
  roots.push(root);
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'apps', 'web', 'dist'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '@vectojs', 'core'), { recursive: true });
  mkdirSync(join(root, 'tmp'));
  writeFileSync(join(root, 'source.ts'), 'source');
  writeFileSync(join(root, '.git', 'HEAD'), 'ignored');
  writeFileSync(join(root, 'apps', 'web', 'dist', 'app.js'), 'build');
  writeFileSync(join(root, 'tmp', 'scratch'), 'ignored');
  writeFileSync(join(root, 'node_modules', '@vectojs', 'core', 'index.js'), 'package');

  expect(createSourceManifest(root).map((entry) => entry.path)).toEqual(['source.ts']);
  expect(createBuildManifest(root).map((entry) => entry.path)).toEqual(['app.js']);
  const packages = createInstalledPackageManifest(root, [
    {
      name: '@vectojs/core',
      version: '1.0.0',
      packagePath: join(root, 'node_modules', '@vectojs', 'core'),
    },
  ]);
  expect(packages.map((entry) => entry.path)).toEqual(['@vectojs/core/index.js']);
  expect(hashPreparedManifest(packages)).toMatch(/^[0-9a-f]{64}$/);
});

test('parses lock versions and rejects linked or mismatched VectoJS packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'omm-arms-'));
  roots.push(root);
  const packagePath = join(root, 'node_modules', '@vectojs', 'core');
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(join(packagePath, 'package.json'), '{"name":"@vectojs/core","version":"1.2.3"}');
  const lock = '"@vectojs/core": ["@vectojs/core@1.2.3", "", {}, "sha512-x"],\n';
  const versions = parseVectoLockVersions(lock);
  expect(versions).toEqual({ '@vectojs/core': '1.2.3' });
  expect(validateVectoResolutions(root, [packagePath], versions)).toEqual([
    { name: '@vectojs/core', version: '1.2.3', packagePath },
  ]);

  writeFileSync(join(packagePath, 'package.json'), '{"name":"@vectojs/core","version":"9.0.0"}');
  expect(() => validateVectoResolutions(root, [packagePath], versions)).toThrow('lockfile');
  rmSync(packagePath, { recursive: true });
  mkdirSync(join(root, 'outside'));
  symlinkSync(join(root, 'outside'), packagePath, 'dir');
  expect(() => validateVectoResolutions(root, [packagePath], versions)).toThrow('symbolic link');
});

test('records repeated install equality data and reports the differing field', () => {
  const snapshot = {
    lockfileSha256: 'a'.repeat(64),
    dependencyVersions: { '@vectojs/core': '1.0.0' },
    installedPackageManifestSha256: 'b'.repeat(64),
  };
  expect(assertRepeatedInstallEqual(snapshot, { ...snapshot })).toEqual({
    first: snapshot,
    second: snapshot,
    equal: true,
  });
  expect(() =>
    assertRepeatedInstallEqual(snapshot, {
      ...snapshot,
      installedPackageManifestSha256: 'c'.repeat(64),
    }),
  ).toThrow('installed package manifest');
});

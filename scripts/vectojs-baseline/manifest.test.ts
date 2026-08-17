import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { createManifest, hashBytes, hashManifest, serializeManifest } from './manifest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('builds a path-sorted manifest with executable bits and symlink target hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'omm-manifest-'));
  roots.push(root);
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'z.txt'), 'z');
  writeFileSync(join(root, 'nested', 'run.sh'), '#!/bin/sh\n');
  chmodSync(join(root, 'nested', 'run.sh'), 0o755);
  symlinkSync('../z.txt', join(root, 'nested', 'link'));

  const entries = createManifest(root);
  expect(entries).toEqual([
    { path: 'nested/link', executable: false, sha256: hashBytes('../z.txt') },
    { path: 'nested/run.sh', executable: true, sha256: hashBytes('#!/bin/sh\n') },
    { path: 'z.txt', executable: false, sha256: hashBytes('z') },
  ]);

  const serialized = serializeManifest(entries);
  expect(serialized).toBe(
    `nested/link\u00000\u0000${hashBytes('../z.txt')}\nnested/run.sh\u00001\u0000${hashBytes('#!/bin/sh\n')}\nz.txt\u00000\u0000${hashBytes('z')}\n`,
  );
  expect(hashManifest(entries)).toBe(hashBytes(serialized));
});

test('supports deterministic inclusion without following excluded directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'omm-manifest-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'ambient.js'), 'ambient');
  writeFileSync(join(root, 'source.ts'), 'source');

  expect(createManifest(root, (path) => !path.startsWith('node_modules/'))).toEqual([
    { path: 'source.ts', executable: false, sha256: hashBytes('source') },
  ]);
});

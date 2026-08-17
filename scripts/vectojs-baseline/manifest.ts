import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface ManifestEntry {
  path: string;
  executable: boolean;
  sha256: string;
}

export type ManifestInclude = (relativePath: string) => boolean;

export function hashBytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createManifest(
  root: string,
  include: ManifestInclude = () => true,
): ManifestEntry[] {
  const entries: ManifestEntry[] = [];

  function visit(directory: string, prefix: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      assertManifestPath(relativePath);
      const stats = lstatSync(path);
      if (stats.isDirectory()) {
        if (include(`${relativePath}/`)) visit(path, relativePath);
        continue;
      }
      if (!include(relativePath)) continue;
      if (stats.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          executable: false,
          sha256: hashBytes(readlinkSync(path, { encoding: 'utf8' })),
        });
      } else if (stats.isFile()) {
        entries.push({
          path: relativePath,
          executable: (stats.mode & 0o111) !== 0,
          sha256: hashBytes(readFileSync(path)),
        });
      } else {
        throw new TypeError(`Unsupported manifest entry: ${relativePath}`);
      }
    }
  }

  visit(root, '');
  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

export function serializeManifest(entries: readonly ManifestEntry[]): string {
  return [...entries]
    .sort((left, right) => comparePaths(left.path, right.path))
    .map((entry) => {
      assertManifestPath(entry.path);
      if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
        throw new TypeError(`Invalid SHA-256 for manifest entry: ${entry.path}`);
      }
      return `${entry.path}\0${entry.executable ? '1' : '0'}\0${entry.sha256}\n`;
    })
    .join('');
}

export function hashManifest(entries: readonly ManifestEntry[]): string {
  return hashBytes(serializeManifest(entries));
}

export function hashDirectory(root: string, include?: ManifestInclude): string {
  return hashManifest(createManifest(root, include));
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertManifestPath(path: string): void {
  if (path.length === 0 || path.includes('\0') || path.includes('\n') || path.includes('\\')) {
    throw new TypeError(`Invalid POSIX manifest path: ${JSON.stringify(path)}`);
  }
}

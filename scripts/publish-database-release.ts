import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: bun scripts/publish-database-release.ts [sqlite-path]');
  console.log('Environment: OMM_R2_BUCKET and OMM_RELEASE_BASE are optional overrides.');
  process.exit(0);
}

const database = process.argv[2] ?? 'data/omm-d1.sqlite';
const bucket = process.env.OMM_R2_BUCKET ?? 'cdn-xuepoo-xyz';
const publicBase = process.env.OMM_RELEASE_BASE ?? 'https://cdn.xuepoo.xyz';
const sourceRevision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const generatedAt = new Date().toISOString();
const version = `${generatedAt.slice(0, 19).replaceAll(/[-:T]/g, '')}-${sourceRevision}`;
const tmpDir = join(import.meta.dir, '../tmp/database-release', version);
const compressed = join(tmpDir, 'omm.sqlite.zst');

function run(command: string, args: string[], options?: { stdio?: 'inherit' | 'pipe' }): string {
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: options?.stdio ?? 'pipe',
  });
  return typeof output === 'string' ? output.trim() : '';
}

function query(sql: string): string {
  return run('sqlite3', ['-json', database, sql]);
}

function upload(file: string, key: string, contentType: string, cacheControl: string): void {
  run(
    'wrangler',
    [
      'r2',
      'object',
      'put',
      `${bucket}/${key}`,
      '--remote',
      '--file',
      file,
      '--content-type',
      contentType,
      '--cache-control',
      cacheControl,
      '-y',
    ],
    { stdio: 'inherit' },
  );
}

mkdirSync(tmpDir, { recursive: true });
try {
  if (!existsSync(database)) throw new Error(`SQLite database not found: ${database}`);
  console.log(`Checking ${database}...`);
  if (run('sqlite3', [database, 'PRAGMA integrity_check;']) !== 'ok') {
    throw new Error('SQLite integrity_check failed');
  }

  const tables = JSON.parse(
    query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ),
  ) as { name: string }[];
  const rows: Record<string, number> = {};
  for (const table of tables) {
    const safe = table.name.replaceAll('"', '""');
    rows[table.name] = Number(
      JSON.parse(query(`SELECT COUNT(*) AS count FROM "${safe}"`))[0].count,
    );
  }

  console.log('Compressing SQLite snapshot...');
  run('zstd', ['-T0', '-19', '-f', database, '-o', compressed], { stdio: 'inherit' });
  const checksum = createHash('sha256').update(readFileSync(compressed)).digest('hex');
  const manifest = {
    release_version: version,
    generated_at: generatedAt,
    source_revision: sourceRevision,
    database: 'omm.sqlite',
    format: 'SQLite snapshot compressed with zstd',
    schema_version: 'current',
    public_snapshot: true,
    note: 'This is a public SQLite snapshot, not the live Cloudflare D1 database.',
    compressed: {
      path: `omm/database/releases/${version}/omm.sqlite.zst`,
      bytes: statSync(compressed).size,
      sha256: checksum,
      download_url: `${publicBase}/omm/database/releases/${version}/omm.sqlite.zst`,
    },
    rows,
  };
  const manifestFile = join(tmpDir, 'manifest.json');
  const checksumFile = join(tmpDir, 'sha256.txt');
  const indexFile = join(tmpDir, 'index.json');
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(checksumFile, `${checksum}  omm.sqlite.zst\n`);
  writeFileSync(
    indexFile,
    `${JSON.stringify(
      {
        name: 'Open My Mystery public database releases',
        latest: manifest,
        releases: [
          { version, manifest_url: `${publicBase}/omm/database/releases/${version}/manifest.json` },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const prefix = `omm/database/releases/${version}`;
  upload(
    compressed,
    `${prefix}/omm.sqlite.zst`,
    'application/zstd',
    'public, max-age=31536000, immutable',
  );
  upload(
    manifestFile,
    `${prefix}/manifest.json`,
    'application/json; charset=utf-8',
    'public, max-age=31536000, immutable',
  );
  upload(
    checksumFile,
    `${prefix}/sha256.txt`,
    'text/plain; charset=utf-8',
    'public, max-age=31536000, immutable',
  );
  upload(
    indexFile,
    'omm/database/index.json',
    'application/json; charset=utf-8',
    'public, max-age=300',
  );
  upload(
    manifestFile,
    'omm/database/latest/manifest.json',
    'application/json; charset=utf-8',
    'public, max-age=300',
  );
  console.log(`Published ${version}`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

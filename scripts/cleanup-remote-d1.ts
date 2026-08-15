// One-off: remove stale rows left on the remote D1 by earlier imports.
// Old imports used INSERT OR REPLACE; entities whose id disappeared from the
// current dataset linger. This uploads the canonical id list and deletes rows
// that do not match it.
import { Database } from 'bun:sqlite';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dbPath = join(import.meta.dir, '../data/omm-d1.sqlite');
const tmpDir = join(import.meta.dir, '../tmp/d1_chunks');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

const sqlite = new Database(dbPath);
const ids: { id: string }[] = sqlite.query('SELECT id FROM entities').all();
console.log(`Canonical entity ids: ${ids.length}`);

function runRemote(sqlFile: string, label: string): void {
  console.log(`  ⏳ ${label}...`);
  execSync(`wrangler d1 execute omm-db --remote --file="${sqlFile}" -y`, {
    encoding: 'utf-8',
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`  ✓ ${label} done`);
}

// 1. Create temp table + upload ids
const createFile = join(tmpDir, 'cleanup_create.sql');
writeFileSync(
  createFile,
  'DROP TABLE IF EXISTS _new_ids; CREATE TABLE _new_ids (id TEXT PRIMARY KEY);\n',
);
runRemote(createFile, 'create _new_ids');
unlinkSync(createFile);

const chunkSize = 15000;
for (let offset = 0; offset < ids.length; offset += chunkSize) {
  const part = ids.slice(offset, offset + chunkSize);
  const f = join(tmpDir, `cleanup_ids_${offset}.sql`);
  const lines = part.map(
    (r) => `INSERT OR IGNORE INTO _new_ids VALUES('${r.id.replace(/'/g, "''")}');`,
  );
  writeFileSync(f, lines.join('\n'));
  runRemote(f, `upload ids ${offset}-${offset + part.length}`);
  unlinkSync(f);
}

// 2. Delete stale rows
const deletes = join(tmpDir, 'cleanup_delete.sql');
writeFileSync(
  deletes,
  [
    'DELETE FROM entities WHERE id NOT IN (SELECT id FROM _new_ids);',
    'DELETE FROM search_index WHERE id NOT IN (SELECT id FROM _new_ids);',
    'DELETE FROM search_fts WHERE id NOT IN (SELECT id FROM _new_ids);',
    'DELETE FROM recommendations WHERE entity_id NOT IN (SELECT id FROM _new_ids) OR target_id NOT IN (SELECT id FROM _new_ids);',
    'DROP TABLE _new_ids;',
  ].join('\n'),
);
runRemote(deletes, 'delete stale rows');
unlinkSync(deletes);

console.log('🎉 Remote D1 cleanup complete');

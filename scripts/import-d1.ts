import { Database } from 'bun:sqlite';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dbPath = join(import.meta.dir, '../data/omm-d1.sqlite');
const tmpDir = join(import.meta.dir, '../tmp/d1_chunks');
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

const sqlite = new Database(dbPath);
const resumeIndex = process.argv.indexOf('--resume');
const resumeArg =
  process.argv.find((arg) => arg.startsWith('--resume=')) ??
  (resumeIndex >= 0 ? process.argv[resumeIndex + 1] : undefined);
const resumeValue = resumeArg?.startsWith('--resume=')
  ? resumeArg.slice('--resume='.length)
  : resumeArg;
const [resumeTable, resumeOffsetText] = resumeValue?.split(':') ?? [];
const resumeOffset = resumeOffsetText ? Number(resumeOffsetText) : 0;
const skipClear = process.argv.includes('--skip-clear');

function runRemote(command: string): void {
  execSync(
    `wrangler d1 execute omm-db --remote --command="${command.replaceAll('"', '\\\"')}" -y`,
    {
      encoding: 'utf-8',
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    },
  );
}

function escapeSql(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function importChunk(tableName: string, chunkFile: string): void {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execSync(`wrangler d1 execute omm-db --remote --file="${chunkFile}" -y`, {
        encoding: 'utf-8',
        env: process.env,
        maxBuffer: 50 * 1024 * 1024,
      });
      return;
    } catch (err: any) {
      if (attempt === maxAttempts) throw err;
      const delayMs = attempt * 5000;
      console.warn(`  ⚠️ ${tableName} import attempt ${attempt} failed; retrying in ${delayMs}ms.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

function chunkAndImport(tableName: string, cols: string[], batchSize = 10000): void {
  console.log(`\n📦 Exporting and importing table '${tableName}'...`);
  const countRow: any = sqlite.query(`SELECT count(*) as total FROM ${tableName}`).get();
  const total = countRow.total;
  console.log(`  Total rows: ${total}`);

  const startOffset = resumeTable === tableName ? resumeOffset : 0;
  let offset = startOffset;
  let batchIndex = Math.floor(startOffset / batchSize);
  if (startOffset > 0) console.log(`  Resuming at offset ${startOffset}.`);

  while (offset < total) {
    batchIndex++;
    const chunkFile = join(tmpDir, `${tableName}_part${batchIndex}.sql`);
    const rows: any[] = sqlite
      .query(`SELECT * FROM ${tableName} LIMIT ${batchSize} OFFSET ${offset}`)
      .all();
    if (rows.length === 0) break;

    const lines: string[] = [];
    for (const r of rows) {
      const vals = cols.map((col) => escapeSql(r[col])).join(',');
      lines.push(`INSERT OR REPLACE INTO ${tableName} VALUES(${vals});`);
    }

    writeFileSync(chunkFile, lines.join('\n'));
    console.log(`  🚀 Part ${batchIndex} (${rows.length} rows) written to ${chunkFile}`);

    console.log(`  ⏳ Ingesting part ${batchIndex} into remote D1...`);
    try {
      importChunk(tableName, chunkFile);
      console.log(`  ✓ Part ${batchIndex} succeeded.`);
    } catch (err: any) {
      console.error(`  ❌ Failed to import part ${batchIndex}:`, err.message);
      throw err;
    } finally {
      if (existsSync(chunkFile)) unlinkSync(chunkFile);
    }

    offset += rows.length;
  }
}

// Clear mutable tables before the replacement import. Time Travel protects the
// previous remote state; this prevents stale facts from surviving a full sync.
if (!skipClear) {
  console.log('\n🧹 Clearing remote mutable tables...');
  runRemote(
    'DELETE FROM facts; DELETE FROM recommendations; DELETE FROM search_fts; DELETE FROM search_index; DELETE FROM entities;',
  );
} else {
  console.log('\n♻️ Resuming without clearing remote tables.');
}

// 1. Entities
chunkAndImport(
  'entities',
  ['id', 'qid', 'type', 'names_json', 'bio', 'birth', 'death', 'country', 'source', 'quality'],
  15000,
);

// 2. Search Index
chunkAndImport(
  'search_index',
  ['id', 'type', 'name_zh', 'name_en', 'name_ja', 'aliases_text'],
  15000,
);

// 2b. FTS5 trigram index (populated from search_index on the remote side,
// including separator-stripped variants so CJK queries typed without middle
// dots still match, e.g. 埃勒里奎因 vs stored 埃勒里·奎因)
console.log('\n📦 Populating remote search_fts from search_index...');
try {
  execSync(
    `wrangler d1 execute omm-db --remote --command="INSERT OR REPLACE INTO search_fts (id, content) SELECT id, COALESCE(name_zh, '') || ' ' || COALESCE(name_en, '') || ' ' || COALESCE(name_ja, '') || ' ' || COALESCE(aliases_text, '') || ' ' || lower(replace(replace(replace(replace(replace(replace(COALESCE(name_zh || ' ' || name_en || ' ' || name_ja || ' ' || aliases_text, ''), '·', ''), '・', ''), ' ', ''), '•', ''), '-', ''), '|', '')) FROM search_index" -y`,
    { encoding: 'utf-8', env: process.env, maxBuffer: 50 * 1024 * 1024 },
  );
  console.log('  ✓ search_fts populated');
} catch (err: any) {
  console.error('  ❌ Failed to populate search_fts:', err.message);
  throw err;
}

// 3. Recommendations
chunkAndImport('recommendations', ['entity_id', 'target_id', 'score', 'reason', 'rank'], 15000);

// 4. Facts
chunkAndImport(
  'facts',
  ['id', 'subject_id', 'predicate', 'object_ref', 'object_value', 'qualifiers_json', 'source'],
  15000,
);

console.log('\n🎉 ALL TABLES IMPORTED TO CLOUDFLARE D1 SUCCESSFULLY!');

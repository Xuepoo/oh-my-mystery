import { Database } from 'bun:sqlite';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInsertSql } from './d1-import-utils';

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
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlyTable = onlyArg?.slice('--only='.length);
const importTables = new Set([
  'entities',
  'search_index',
  'recommendations',
  'work_groups',
  'work_group_members',
  'publication_events',
  'facts',
]);
if (onlyTable && !importTables.has(onlyTable)) {
  throw new Error(`Unsupported import table: ${onlyTable}`);
}
const shouldImport = (tableName: string): boolean => !onlyTable || onlyTable === tableName;

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
      lines.push(buildInsertSql(tableName, cols, r));
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
  if (onlyTable) runRemote(`DELETE FROM ${onlyTable};`);
  else
    runRemote(
      'DELETE FROM facts; DELETE FROM recommendations; DELETE FROM publication_events; DELETE FROM work_group_members; DELETE FROM work_groups; DELETE FROM search_fts; DELETE FROM search_index; DELETE FROM entities;',
    );
} else {
  console.log('\n♻️ Resuming without clearing remote tables.');
}

// 1. Entities
if (shouldImport('entities'))
  chunkAndImport(
    'entities',
    ['id', 'qid', 'type', 'names_json', 'bio', 'birth', 'death', 'country', 'source', 'quality'],
    15000,
  );

// 2. Search Index
if (shouldImport('search_index'))
  chunkAndImport(
    'search_index',
    ['id', 'type', 'name_zh', 'name_en', 'name_ja', 'aliases_text'],
    15000,
  );

// 2b. FTS5 trigram index (populated from search_index on the remote side,
// including separator-stripped variants so CJK queries typed without middle
// dots still match, e.g. 埃勒里奎因 vs stored 埃勒里·奎因)
if (shouldImport('search_index')) {
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
}

// 3. Recommendations
if (shouldImport('recommendations'))
  chunkAndImport('recommendations', ['entity_id', 'target_id', 'score', 'reason', 'rank'], 15000);

// 4. Logical work groups and source-specific members
if (shouldImport('work_groups'))
  chunkAndImport(
    'work_groups',
    ['id', 'representative_id', 'normalized_title', 'author_ids_json'],
    15000,
  );
if (shouldImport('work_group_members'))
  chunkAndImport('work_group_members', ['work_group_id', 'entity_id'], 15000);

// 5. Publication editions
if (shouldImport('publication_events'))
  chunkAndImport(
    'publication_events',
    [
      'id',
      'work_id',
      'work_group_id',
      'publisher_id',
      'translator_ids_json',
      'publication_date',
      'isbn',
      'language',
      'region',
      'edition_type',
      'source',
      'provenance_json',
      'fingerprint',
    ],
    15000,
  );

// 6. Facts
if (shouldImport('facts'))
  chunkAndImport(
    'facts',
    ['id', 'subject_id', 'predicate', 'object_ref', 'object_value', 'qualifiers_json', 'source'],
    15000,
  );

console.log('\n🎉 ALL TABLES IMPORTED TO CLOUDFLARE D1 SUCCESSFULLY!');

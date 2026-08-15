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

function escapeSql(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function chunkAndImport(tableName: string, cols: string[], batchSize = 10000): void {
  console.log(`\n📦 Exporting and importing table '${tableName}'...`);
  const countRow: any = sqlite.query(`SELECT count(*) as total FROM ${tableName}`).get();
  const total = countRow.total;
  console.log(`  Total rows: ${total}`);

  let offset = 0;
  let batchIndex = 0;

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
      execSync(`wrangler d1 execute omm-db --remote --file="${chunkFile}" -y`, {
        encoding: 'utf-8',
        env: process.env,
        maxBuffer: 50 * 1024 * 1024,
      });
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

// 2b. FTS5 trigram index (populated from search_index on the remote side)
console.log('\n📦 Populating remote search_fts from search_index...');
try {
  execSync(
    `wrangler d1 execute omm-db --remote --command="INSERT OR REPLACE INTO search_fts (id, content) SELECT id, COALESCE(name_zh, '') || ' ' || COALESCE(name_en, '') || ' ' || COALESCE(name_ja, '') || ' ' || COALESCE(aliases_text, '') FROM search_index" -y`,
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

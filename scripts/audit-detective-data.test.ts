import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import {
  auditDatabase,
  isDoubanPriceId,
  normalizeDetectiveName,
  reconcileConfidence,
  runCli,
} from './audit-detective-data';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
});

function fixture(): { dir: string; path: string; db: Database } {
  const dir = mkdtempSync(join(tmpdir(), 'omm-audit-'));
  dirs.push(dir);
  const path = join(dir, 'fixture.sqlite');
  const db = new Database(path);
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA wal_autocheckpoint=0');
  db.run(`CREATE TABLE entities (id TEXT PRIMARY KEY, qid TEXT, type TEXT, names_json TEXT, source TEXT);
    CREATE TABLE facts (id INTEGER PRIMARY KEY, subject_id TEXT, predicate TEXT, object_ref TEXT, object_value TEXT, qualifiers_json TEXT, source TEXT);
    CREATE TABLE raw_fetch (id INTEGER PRIMARY KEY, source TEXT, key TEXT, raw_json TEXT);
    CREATE TABLE entity_links (source_id TEXT, target_id TEXT, method TEXT);`);
  db.run(
    `INSERT INTO entities VALUES
      ('wd:Q1','Q1','character','{"labels":{"zh":"波洛"},"aliases":{"en":["Poirot"]}}','wikidata'),
      ('wd:Q2','Q2','author','{"labels":{"en":"Mistyped Sleuth"},"aliases":{}}','wikidata'),
      ('wd:Q3','Q3','person','{"labels":{"en":"Film Person"},"aliases":{}}','wikidata'),
      ('wd:Q4','Q4','person','{"labels":{"en":"Mistyped Investigator"},"aliases":{}}','wikidata'),
      ('work:1',NULL,'work','{"labels":{"zh":"作品"},"aliases":{}}','test'),
      ('work:2',NULL,'work','{"labels":{"zh":"错误系列"},"aliases":{}}','test'),
      ('douban:p7',NULL,'publisher','{"labels":{"zh":"7"},"aliases":{}}','douban'),
      ('douban:px',NULL,'publisher','{"labels":{"zh":"x"},"aliases":{}}','douban')`,
  );
  db.run(
    `INSERT INTO facts VALUES
      (1,'work:1','characters','wd:Q1',NULL,NULL,'test'),
      (2,'work:1','series','work:2',NULL,NULL,'test'),
      (3,'work:2','series','work:2',NULL,NULL,'test')`,
  );
  db.run(
    `INSERT INTO raw_fetch VALUES
      (1,'wikidata','entity:Q1','{"claims":{"P31":[{"mainsnak":{"datavalue":{"value":{"id":"Q3656924"}}}}]}}'),
      (2,'wikidata','entity:Q2','{"claims":{"P106":[{"mainsnak":{"datavalue":{"value":{"id":"Q1058617"}}}}]}}'),
      (3,'wikidata','entity:Q3','{"claims":{"P31":[{"mainsnak":{"datavalue":{"value":{"id":"Q11424"}}}}]}}'),
      (4,'wikidata','entity:Q4','{"claims":{"P106":[{"mainsnak":{"datavalue":{"value":{"id":"Q2271194"}}}}]}}')`,
  );
  return { dir, path, db };
}

function state(
  path: string,
): Record<string, { exists: boolean; size?: number; mtimeMs?: number; hash?: string }> {
  return Object.fromEntries(
    [
      ['db', ''],
      ['wal', '-wal'],
      ['shm', '-shm'],
    ].map(([key, suffix]) => {
      const file = `${path}${suffix}`;
      if (!existsSync(file)) return [key, { exists: false }];
      const stat = statSync(file);
      return [
        key,
        {
          exists: true,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash: createHash('sha256').update(readFileSync(file)).digest('hex'),
        },
      ];
    }),
  );
}

test('normalizes brackets and traditional variants without transliteration', () => {
  expect(normalizeDetectiveName('（日） 东野圭吾')).toBe('东野圭吾');
  expect(normalizeDetectiveName('〔日〕東野圭吾')).toBe('东野圭吾');
  expect(normalizeDetectiveName('［美］ Ellery Queen')).toBe('elleryqueen');
});

test('recognizes only complete numeric douban:p suffixes from position nine', () => {
  expect(isDoubanPriceId('douban:p7')).toBe(true);
  expect(isDoubanPriceId('douban:p59.80')).toBe(true);
  expect(isDoubanPriceId('douban:p')).toBe(false);
  expect(isDoubanPriceId('douban:p.')).toBe(false);
  expect(isDoubanPriceId('douban:p7.')).toBe(false);
  expect(isDoubanPriceId('douban:p7x')).toBe(false);
  expect(isDoubanPriceId('douban:q7')).toBe(false);
});

test('reconciliation protects homonyms and type conflicts', () => {
  expect(reconcileConfidence({ exactQid: true })).toBe('high');
  expect(reconcileConfidence({ normalizedNameMatch: true, overlappingWorks: true })).toBe('medium');
  expect(reconcileConfidence({ normalizedNameMatch: true, sameNameDistinct: true })).toBe(
    'conflict',
  );
  expect(reconcileConfidence({ exactQid: true, typeConflict: true })).toBe('conflict');
});

test('WAL snapshot leaves database, WAL, and SHM bytes and metadata unchanged', () => {
  const { path, db } = fixture();
  const before = state(path);
  expect(before.wal.exists).toBe(true);
  expect(before.shm.exists).toBe(true);
  const report = auditDatabase(path, 2) as any;
  expect(state(path)).toEqual(before);
  expect(report.meta.source_opened_by_sqlite).toBe(false);
  expect(report.meta.audit_strategy).toContain('temporary snapshot');
  expect(report.coverage.detective_candidates).toBe(3);
  expect(report.coverage.candidate_confidence_tiers.high).toBe(1);
  expect(report.coverage.candidate_confidence_tiers.conflict).toBe(2);
  expect(report.candidates.find((candidate: any) => candidate.id === 'wd:Q2').conflicts).toEqual([
    'detective evidence contradicts entity type author',
  ]);
  expect(report.candidates.find((candidate: any) => candidate.id === 'wd:Q4').conflicts).toEqual([
    'detective evidence contradicts entity type person',
  ]);
  db.close();
});

test('reports invalid series edge and distinct target counts separately', () => {
  const { path, db } = fixture();
  const report = auditDatabase(path) as any;
  expect(report.coverage.invalid_series_fact_edges).toBe(2);
  expect(report.coverage.distinct_invalid_series_targets).toBe(1);
  expect(report.pollution.invalid_series_target_samples).toEqual([
    { target: 'work:2', type: 'work', edge_count: 2 },
  ]);
  expect(report.pollution.douban_price_ids).toBe(1);
  expect(report.pollution.film_as_person_or_author).toBe(1);
  db.close();
});

test('stable report hashes match across two runs', () => {
  const { path, db } = fixture();
  const first = JSON.stringify(auditDatabase(path));
  const second = JSON.stringify(auditDatabase(path));
  expect(createHash('sha256').update(first).digest('hex')).toBe(
    createHash('sha256').update(second).digest('hex'),
  );
  expect(first).toBe(second);
  db.close();
});

test('CLI help uses stdout and output errors do not overwrite destinations', () => {
  const originalWrite = process.stdout.write;
  let stdout = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    expect(runCli(['--help'])).toBe(0);
  } finally {
    process.stdout.write = originalWrite;
  }
  expect(stdout).toContain('Usage:');

  const { dir, path, db } = fixture();
  const output = join(dir, 'report.json');
  writeFileSync(output, 'keep');
  expect(runCli(['--db', path, '--output', output])).toBe(1);
  expect(readFileSync(output, 'utf8')).toBe('keep');
  db.close();
});

test('missing and invalid databases fail without creating or changing them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omm-audit-'));
  dirs.push(dir);
  const missing = join(dir, 'missing.sqlite');
  expect(runCli(['--db', missing])).toBe(1);
  expect(existsSync(missing)).toBe(false);

  const invalid = join(dir, 'invalid.sqlite');
  writeFileSync(invalid, 'not sqlite');
  expect(runCli(['--db', invalid])).toBe(1);
  expect(readFileSync(invalid, 'utf8')).toBe('not sqlite');
});

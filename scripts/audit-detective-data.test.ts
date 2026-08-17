import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { normalizeDetectiveName, reconcileConfidence, runCli } from './audit-detective-data';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('normalizes presentation brackets without transliteration', () => {
  expect(normalizeDetectiveName('（日） 东野圭吾')).toBe('东野圭吾');
  expect(normalizeDetectiveName('〔日〕東野圭吾')).toBe('东野圭吾');
  expect(normalizeDetectiveName('［美］ Ellery Queen')).toBe('elleryqueen');
});

test('reconciliation protects homonyms and type conflicts', () => {
  expect(reconcileConfidence({ exactQid: true })).toBe('high');
  expect(reconcileConfidence({ normalizedNameMatch: true, overlappingWorks: true })).toBe('medium');
  expect(reconcileConfidence({ normalizedNameMatch: true, sameNameDistinct: true })).toBe(
    'conflict',
  );
  expect(reconcileConfidence({ exactQid: true, typeConflict: true })).toBe('conflict');
});

test('audit extracts candidates from raw claims without detective entity type', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omm-audit-'));
  dirs.push(dir);
  const path = join(dir, 'fixture.sqlite');
  const db = new Database(path);
  db.run(`CREATE TABLE entities (id TEXT PRIMARY KEY, qid TEXT, type TEXT, names_json TEXT, source TEXT);
    CREATE TABLE facts (id INTEGER PRIMARY KEY, subject_id TEXT, predicate TEXT, object_ref TEXT, object_value TEXT, qualifiers_json TEXT, source TEXT);
    CREATE TABLE raw_fetch (id INTEGER PRIMARY KEY, source TEXT, key TEXT, raw_json TEXT);
    CREATE TABLE entity_links (source_id TEXT, target_id TEXT, method TEXT);`);
  db.run(
    `INSERT INTO entities VALUES ('wd:Q1','Q1','character','{"labels":{"zh":"波洛"},"aliases":{"en":["Poirot"]}}','wikidata'), ('work:1',NULL,'work','{"labels":{"zh":"作品"}}','test'), ('work:2',NULL,'work','{"labels":{"zh":"错误系列"}}','test'), ('douban:p59.8',NULL,'person','{"labels":{"zh":"59.8"}}','douban');`,
  );
  db.run(
    `INSERT INTO facts VALUES (1,'work:1','characters','wd:Q1',NULL,NULL,'test'), (2,'work:1','series','work:2',NULL,NULL,'test');`,
  );
  db.run(
    `INSERT INTO raw_fetch VALUES (1,'wikidata','entity:Q1','{"claims":{"P31":[{"mainsnak":{"datavalue":{"value":{"id":"Q3656924"}}}}]}}');`,
  );
  db.close();
  chmodSync(path, 0o444);
  const output = join(dir, 'report.json');
  runCli(['--db', path, '--output', output]);
  const report = JSON.parse(await Bun.file(output).text());
  expect(report.meta.read_only).toBe(true);
  expect(report.coverage.detective_candidates).toBe(1);
  expect(report.coverage.candidate_confidence_tiers.high).toBe(1);
  expect(report.coverage.mistyped_series_targets).toBe(1);
  expect(report.candidates[0].confidence).toBe('high');
  expect(report.pollution.douban_price_ids).toBe(1);
  expect(report.pollution.douban_p_name_matches_people).toBe(0);
});

test('missing database fails without creating it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omm-audit-'));
  dirs.push(dir);
  const path = join(dir, 'missing.sqlite');
  const original = process.exitCode;
  process.exitCode = 0;
  runCli(['--db', path]);
  expect(existsSync(path)).toBe(false);
  process.exitCode = original;
});

test('invalid SQLite input is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omm-audit-'));
  dirs.push(dir);
  const path = join(dir, 'invalid.sqlite');
  writeFileSync(path, 'not sqlite');
  const original = process.exitCode;
  process.exitCode = 0;
  runCli(['--db', path]);
  expect(process.exitCode).toBe(1);
  expect(Bun.file(path).size).toBe(10);
  process.exitCode = original;
});

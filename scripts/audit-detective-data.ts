import { Database } from 'bun:sqlite';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZH_T2S_MAP } from './data/zh-t2s-map';

const DEFAULT_DB = resolve(import.meta.dir, '../../mystery-clawer/data/mystery.db');
const SAMPLE_LIMIT = 50;
const DETECTIVE_CLASS = 'Q3656924';
const DETECTIVE_OCCUPATIONS = new Set(['Q1058617', 'Q842782', 'Q1397808']);
const LOW_OCCUPATIONS = new Set(['Q1347908', 'Q2271194']);
const ROLE_PREFIX =
  /^(?:\((?:[A-Za-z]{2,}|[美英日法德意俄中])\)|（[^（）]{1,8}）|〔[^〕]{1,8}〕|［[^］]{1,8}］|\[[^\]]{1,8}\])\s*/u;

export type Confidence = 'high' | 'medium' | 'low' | 'conflict';
export type Entity = {
  id: string;
  qid: string | null;
  type: string;
  names_json: string;
  source: string | null;
};
export type Candidate = {
  id: string;
  canonical_id: string;
  current_ids: string[];
  display_names: string[];
  aliases: string[];
  source_provenance: string[];
  linked_works: string[];
  evidence: { kind: string; value: string; source: string | null }[];
  confidence: Confidence;
  conflicts: string[];
};

function parseArgs(args: string[]): { db: string; output?: string; help: boolean } {
  let db = DEFAULT_DB;
  let output: string | undefined;
  let help = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--db' && args[i + 1]) db = resolve(args[++i]);
    else if (arg === '--output' && args[i + 1]) output = resolve(args[++i]);
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return { db, output, help };
}

function namesFromJson(value: string): { names: string[]; aliases: string[] } {
  try {
    const parsed = JSON.parse(value) as {
      labels?: Record<string, string>;
      aliases?: Record<string, string[]>;
    };
    const names = Object.values(parsed.labels ?? {}).filter(Boolean);
    const aliases = Object.values(parsed.aliases ?? {})
      .flat()
      .filter(Boolean);
    return { names: [...new Set(names)], aliases: [...new Set(aliases)] };
  } catch {
    return { names: [], aliases: [] };
  }
}

export function normalizeDetectiveName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[（(〔［[]?(?:日|日本|英|英国|美|美国|法|法国|德|德国|中|中国)[）)〕］\]]/gu, '')
    .replace(ROLE_PREFIX, '')
    .replace(/[\s\u00a0·・•,，.。:：;；、/\\_—–-]+/gu, '')
    .toLocaleLowerCase();
  return [...normalized].map((character) => ZH_T2S_MAP[character] ?? character).join('');
}

export function reconcileConfidence(input: {
  exactQid?: boolean;
  explicitAlias?: boolean;
  normalizedNameMatch?: boolean;
  overlappingWorks?: boolean;
  typeConflict?: boolean;
  sameNameDistinct?: boolean;
}): Confidence {
  if (input.typeConflict || input.sameNameDistinct) return 'conflict';
  if (input.exactQid || input.explicitAlias) return 'high';
  if (input.normalizedNameMatch && input.overlappingWorks) return 'medium';
  if (input.normalizedNameMatch) return 'low';
  return 'conflict';
}

function countRows(db: Database, sql: string, ...params: string[]): number {
  const row = db.query(sql).get(...params) as { count: number };
  return Number(row.count);
}

function groupedRows(db: Database, sql: string, ...params: string[]): Record<string, number> {
  const rows = db.query(sql).all(...params) as { key: string | null; count: number }[];
  return Object.fromEntries(rows.map((row) => [row.key ?? '(null)', Number(row.count)]));
}

function requireSchema(db: Database): void {
  const tables = new Set(
    (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name),
  );
  for (const table of ['entities', 'facts', 'raw_fetch', 'entity_links']) {
    if (!tables.has(table))
      throw new Error(`Not an authoritative crawler database: missing table ${table}`);
  }
}

function bounded<T>(values: T[]): T[] {
  return values.slice(0, SAMPLE_LIMIT);
}

function rawClaimEvidence(raw: string | null): { kind: string; value: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { claims?: Record<string, unknown[]> };
    const claims = parsed.claims ?? {};
    const evidence: { kind: string; value: string }[] = [];
    for (const [property, values] of Object.entries(claims)) {
      if (property !== 'P31' && property !== 'P106') continue;
      for (const claim of values ?? []) {
        const mainsnak = (claim as { mainsnak?: { datavalue?: { value?: unknown } } }).mainsnak;
        const value = mainsnak?.datavalue?.value;
        const id = typeof value === 'object' && value !== null && 'id' in value ? value.id : value;
        if (typeof id === 'string') evidence.push({ kind: property, value: id });
      }
    }
    return evidence;
  } catch {
    return [];
  }
}

function candidateRecords(db: Database): Candidate[] {
  const entities = db
    .query(
      "SELECT e.id,e.qid,e.type,e.names_json,e.source,r.raw_json FROM entities e LEFT JOIN raw_fetch r ON r.source='wikidata' AND r.key='entity:' || e.qid WHERE e.type='character'",
    )
    .all() as (Entity & { raw_json: string | null })[];
  const candidates: Candidate[] = [];
  const workRows = db
    .query(
      "SELECT object_ref, subject_id FROM facts WHERE predicate IN ('characters','character','P674') AND object_ref IS NOT NULL",
    )
    .all() as { object_ref: string; subject_id: string }[];
  const works = new Map<string, string[]>();
  for (const row of workRows) {
    const list = works.get(row.object_ref) ?? [];
    list.push(row.subject_id);
    works.set(row.object_ref, list);
  }
  const links = db.query('SELECT source_id,target_id,method FROM entity_links').all() as {
    source_id: string;
    target_id: string;
    method: string;
  }[];
  const linksByEntity = new Map<string, typeof links>();
  for (const link of links) {
    for (const id of [link.source_id, link.target_id]) {
      const list = linksByEntity.get(id) ?? [];
      list.push(link);
      linksByEntity.set(id, list);
    }
  }
  for (const entity of entities) {
    const parsed = namesFromJson(entity.names_json);
    const evidence = rawClaimEvidence(entity.raw_json);
    const explicitClass = evidence.some(
      (item) => item.kind === 'P31' && item.value === DETECTIVE_CLASS,
    );
    const occupation = evidence.some(
      (item) => item.kind === 'P106' && DETECTIVE_OCCUPATIONS.has(item.value),
    );
    const lowOccupation = evidence.some(
      (item) => item.kind === 'P106' && LOW_OCCUPATIONS.has(item.value),
    );
    const linked = linksByEntity.get(entity.id) ?? [];
    const currentIds = [...new Set([entity.id, ...linked.map((link) => link.source_id)])];
    const sourceProvenance = [
      ...new Set([entity.source ?? 'unknown', ...currentIds.map((id) => id.split(':', 1)[0])]),
    ];
    const linkedWorks = works.get(entity.id) ?? [];
    if (!explicitClass && !occupation && !lowOccupation) continue;
    const conflicts = entity.type !== 'character' ? ['role/type contradiction'] : [];
    candidates.push({
      id: entity.id,
      canonical_id: entity.qid ? `wd:${entity.qid}` : entity.id,
      current_ids: bounded(currentIds),
      display_names: bounded(parsed.names),
      aliases: bounded(parsed.aliases),
      source_provenance: bounded(sourceProvenance),
      linked_works: linkedWorks,
      evidence: bounded([
        ...evidence.map((item) => ({ ...item, source: entity.source })),
        ...linked.map((link) => ({
          kind: `entity_link:${link.method}`,
          value: link.target_id,
          source: entity.source,
        })),
      ]),
      confidence: explicitClass
        ? 'high'
        : occupation
          ? 'medium'
          : lowOccupation
            ? 'low'
            : 'conflict',
      conflicts,
    });
  }
  return candidates;
}

function duplicateClusters(db: Database): {
  total: number;
  samples: {
    normalized_name: string;
    count: number;
    ids: string[];
    qids: string[];
    confidence: Confidence;
  }[];
} {
  const rows = db
    .query("SELECT id,qid,names_json FROM entities WHERE id LIKE 'douban:a%'")
    .all() as Pick<Entity, 'id' | 'qid' | 'names_json'>[];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const primary = namesFromJson(row.names_json).names[0];
    if (!primary) continue;
    const normalized = normalizeDetectiveName(primary);
    if (!normalized) continue;
    const group = groups.get(normalized) ?? [];
    group.push(row);
    groups.set(normalized, group);
  }
  const clusters = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([normalizedName, group]) => {
      const qids = [
        ...new Set(group.map((row) => row.qid).filter((qid): qid is string => Boolean(qid))),
      ];
      return {
        normalized_name: normalizedName,
        count: group.length,
        ids: group.map((row) => row.id),
        qids,
        confidence: reconcileConfidence({
          exactQid: qids.length === 1 && group.every((row) => row.qid === qids[0]),
          normalizedNameMatch: true,
          sameNameDistinct: qids.length > 1 || group.some((row) => !row.qid),
        }),
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count || left.normalized_name.localeCompare(right.normalized_name),
    );
  return { total: clusters.length, samples: bounded(clusters) };
}

function audit(dbPath: string): Record<string, unknown> {
  if (!existsSync(dbPath) || !statSync(dbPath).isFile())
    throw new Error(`SQLite database not found: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    requireSchema(db);
    const candidates = candidateRecords(db);
    const duplicates = duplicateClusters(db);
    const entityTypes = groupedRows(
      db,
      'SELECT type AS key, COUNT(*) AS count FROM entities GROUP BY type ORDER BY count DESC',
    );
    const sourcePrefixes = groupedRows(
      db,
      "SELECT substr(id, 1, instr(id, ':') - 1) AS key, COUNT(*) AS count FROM entities WHERE instr(id, ':') > 0 GROUP BY key ORDER BY count DESC",
    );
    const seriesTargets = db
      .query(
        "SELECT f.object_ref AS target, COALESCE(e.type,'missing') AS type FROM facts f LEFT JOIN entities e ON e.id=f.object_ref WHERE f.predicate IN ('series','P179') AND (e.type IS NULL OR e.type != 'series')",
      )
      .all() as { target: string; type: string }[];
    const typeConflictRows = db
      .query(
        "SELECT l.source_id,s.type AS source_type,l.target_id,t.type AS target_type,l.method FROM entity_links l JOIN entities s ON s.id=l.source_id JOIN entities t ON t.id=l.target_id WHERE s.type != t.type AND NOT (s.type='person' AND t.type='author') LIMIT ?",
      )
      .all(SAMPLE_LIMIT) as {
      source_id: string;
      source_type: string;
      target_id: string;
      target_type: string;
      method: string;
    }[];
    const pollutionSamples = db
      .query(
        "SELECT id,type,names_json FROM entities WHERE (id LIKE 'douban:p%' AND (id GLOB 'douban:p[0-9.]*' OR type IN ('person','author'))) OR (id LIKE 'wd:%' AND type='person' AND qid IS NOT NULL) LIMIT ?",
      )
      .all(SAMPLE_LIMIT) as { id: string; type: string; names_json: string }[];
    const personWorkTypes = groupedRows(
      db,
      "SELECT jt.value AS key, COUNT(DISTINCT e.id) AS count FROM raw_fetch r JOIN entities e ON r.key='entity:' || e.qid JOIN json_tree(r.raw_json, '$.claims.P31') jt ON jt.key='id' WHERE e.type='person' AND r.source='wikidata' AND jt.value IN ('Q11424','Q5398426','Q7889','Q5') GROUP BY jt.value ORDER BY count DESC",
    );
    const report = {
      meta: {
        generated_at: new Date().toISOString(),
        database: dbPath,
        read_only: true,
        sample_limit: SAMPLE_LIMIT,
      },
      coverage: {
        entities: countRows(db, 'SELECT COUNT(*) AS count FROM entities'),
        facts: countRows(db, 'SELECT COUNT(*) AS count FROM facts'),
        raw_claim_rows: countRows(db, 'SELECT COUNT(*) AS count FROM raw_fetch'),
        entity_types: entityTypes,
        source_prefixes: sourcePrefixes,
        detective_candidates: candidates.length,
        candidate_confidence_tiers: Object.fromEntries(
          ['high', 'medium', 'low', 'conflict'].map((tier) => [
            tier,
            candidates.filter((candidate) => candidate.confidence === tier).length,
          ]),
        ),
        character_linked_works: countRows(
          db,
          "SELECT COUNT(DISTINCT subject_id) AS count FROM facts WHERE predicate IN ('characters','character','P674')",
        ),
        works_linked_to_candidates: new Set(
          candidates.flatMap((candidate) => candidate.linked_works),
        ).size,
        series_entities: countRows(
          db,
          "SELECT COUNT(*) AS count FROM entities WHERE type='series'",
        ),
        series_linked_works: countRows(
          db,
          "SELECT COUNT(DISTINCT subject_id) AS count FROM facts WHERE predicate IN ('series','P179')",
        ),
        mistyped_series_targets: seriesTargets.length,
        dangling_series_targets: seriesTargets.filter((row) => row.type === 'missing').length,
      },
      candidates,
      duplicates: {
        same_name_douban_author_clusters: duplicates.total,
        samples: duplicates.samples,
      },
      pollution: {
        douban_p_entities: countRows(
          db,
          "SELECT COUNT(*) AS count FROM entities WHERE id LIKE 'douban:p%'",
        ),
        douban_price_ids: countRows(
          db,
          "SELECT COUNT(*) AS count FROM entities WHERE id LIKE 'douban:p%' AND substr(id,10) GLOB '[0-9]*' AND CAST(substr(id,10) AS REAL) > 0",
        ),
        douban_p_author_targets: countRows(
          db,
          "SELECT COUNT(DISTINCT object_ref) AS count FROM facts WHERE predicate IN ('author','aozora_role') AND object_ref LIKE 'douban:p%'",
        ),
        douban_p_name_matches_people: countRows(
          db,
          "SELECT COUNT(DISTINCT p.id) AS count FROM entities p JOIN entities author ON author.type='author' AND lower(trim(COALESCE(json_extract(author.names_json,'$.labels.zh'),json_extract(author.names_json,'$.labels.ja'),json_extract(author.names_json,'$.labels.en'))))=lower(trim(COALESCE(json_extract(p.names_json,'$.labels.zh'),json_extract(p.names_json,'$.labels.ja'),json_extract(p.names_json,'$.labels.en')))) WHERE p.id LIKE 'douban:p%'",
        ),
        douban_p_publisher_facts: countRows(
          db,
          "SELECT COUNT(*) AS count FROM facts WHERE predicate='publisher' AND object_ref LIKE 'douban:p%'",
        ),
        film_as_person_or_author: countRows(
          db,
          "SELECT COUNT(*) AS count FROM raw_fetch r JOIN entities e ON r.key='entity:' || e.qid WHERE e.type='person' AND r.source='wikidata' AND EXISTS (SELECT 1 FROM json_tree(r.raw_json, '$.claims.P31') WHERE key='id' AND value='Q11424')",
        ),
        person_bucket_claims_by_type: personWorkTypes,
        entity_link_type_conflicts: {
          count: countRows(
            db,
            "SELECT COUNT(*) AS count FROM entity_links l JOIN entities s ON s.id=l.source_id JOIN entities t ON t.id=l.target_id WHERE s.type != t.type AND NOT (s.type='person' AND t.type='author')",
          ),
          samples: typeConflictRows,
        },
        invalid_series_targets: bounded(seriesTargets),
        samples: pollutionSamples.map((row) => ({
          id: row.id,
          type: row.type,
          names: namesFromJson(row.names_json).names,
        })),
      },
      reconciliation: {
        rules: [
          'exact external QID or explicit alias provenance: high',
          'normalized name plus overlapping works: medium',
          'name-only: low/conflict, never auto-merge',
          'role/type contradiction: conflict',
        ],
        normalization:
          'NFKC, nationality/role and presentation brackets, punctuation, common Unicode variants; no transliteration inference',
      },
      limitations: [
        'Audit only: no merge, crawl, database write, remote D1 operation, snow operation, or publication.',
      ],
    };
    return report;
  } finally {
    db.close();
  }
}

export function runCli(args = process.argv.slice(2)): void {
  try {
    const options = parseArgs(args);
    if (options.help) {
      console.error('Usage: bun scripts/audit-detective-data.ts [--db <path>] [--output <path>]');
      return;
    }
    const report = audit(options.db);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) writeFileSync(options.output, json, { encoding: 'utf8', flag: 'wx' });
    else process.stdout.write(json);
    const coverage = report.coverage as {
      entities: number;
      detective_candidates: number;
      works_linked_to_candidates: number;
      mistyped_series_targets: number;
    };
    console.error(
      `detective audit: ${coverage.entities} entities, ${coverage.detective_candidates} candidates, ${coverage.works_linked_to_candidates} linked works, ${coverage.mistyped_series_targets} mistyped series targets`,
    );
  } catch (error) {
    console.error(
      `detective audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) runCli();

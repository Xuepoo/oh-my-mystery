import { Database } from 'bun:sqlite';
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ZH_T2S_MAP } from './data/zh-t2s-map';

const DEFAULT_DB = resolve(import.meta.dir, '../../mystery-clawer/data/mystery.db');
const DEFAULT_SAMPLE_LIMIT = 50;
const DETECTIVE_CLASS = 'Q3656924';
const MEDIUM_OCCUPATIONS = new Set(['Q1058617', 'Q842782', 'Q1397808']);
const LOW_OCCUPATIONS = new Set(['Q1347908', 'Q2271194']);
const OCCUPATION_SIGNALS = [...MEDIUM_OCCUPATIONS, ...LOW_OCCUPATIONS];
const ROLE_PREFIX =
  /^(?:\((?:[A-Za-z]{2,}|[美英日法德意俄中])\)|（[^（）]{1,8}）|〔[^〕]{1,8}〕|［[^］]{1,8}］|\[[^\]]{1,8}\])\s*/u;

export type Confidence = 'high' | 'medium' | 'low' | 'conflict';
type Evidence = { kind: 'P31' | 'P106' | string; value: string; source: string | null };
type Candidate = {
  id: string;
  canonical_id: string;
  current_ids: string[];
  type: string;
  display_names: string[];
  aliases: string[];
  source_provenance: string[];
  linked_work_count: number;
  linked_works: string[];
  evidence_count: number;
  evidence: Evidence[];
  confidence: Confidence;
  conflicts: string[];
};
type Args = { db: string; output?: string; sampleLimit: number; help: boolean };
type FileState = { exists: boolean; size?: string; mtimeNs?: string };
type CopyFile = (source: string, destination: string, mode: number) => void;
type OutputOperations = {
  publish: (temporary: string, destination: string) => void;
  cleanup: (temporary: string) => void;
  remove: (temporary: string) => void;
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(stableCompare);
}

function bounded<T>(values: T[], limit: number): T[] {
  return values.slice(0, limit);
}

function parseArgs(args: string[]): Args {
  let db = DEFAULT_DB;
  let output: string | undefined;
  let sampleLimit = DEFAULT_SAMPLE_LIMIT;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--db' && args[index + 1]) db = resolve(args[++index]);
    else if (arg === '--output' && args[index + 1]) output = resolve(args[++index]);
    else if (arg === '--sample-limit' && args[index + 1]) {
      sampleLimit = Number(args[++index]);
      if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 500) {
        throw new Error('--sample-limit must be an integer from 1 to 500');
      }
    } else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return { db, output, sampleLimit, help };
}

function namesFromJson(value: string): { names: string[]; aliases: string[] } {
  try {
    const parsed = JSON.parse(value) as {
      labels?: Record<string, string>;
      aliases?: Record<string, string[]>;
    };
    return {
      names: sortedUnique(Object.values(parsed.labels ?? {}).filter(Boolean)),
      aliases: sortedUnique(
        Object.values(parsed.aliases ?? {})
          .flat()
          .filter(Boolean),
      ),
    };
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
    .toLowerCase();
  return [...normalized].map((character) => ZH_T2S_MAP[character] ?? character).join('');
}

export function isDoubanPriceId(id: string): boolean {
  if (!id.startsWith('douban:p')) return false;
  const suffix = id.slice(8);
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(suffix);
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

function fileState(path: string): FileState {
  if (!existsSync(path)) return { exists: false };
  const stat = statSync(path, { bigint: true });
  return { exists: true, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() };
}

function sourceState(path: string): Record<string, FileState> {
  return {
    database: fileState(path),
    wal: fileState(`${path}-wal`),
    shm: fileState(`${path}-shm`),
    journal: fileState(`${path}-journal`),
  };
}

export function createSnapshot(
  source: string,
  copy: CopyFile = copyFileSync,
): {
  path: string;
  directory: string;
  sourceState: Record<string, FileState>;
} {
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`SQLite database not found: ${source}`);
  }
  const before = sourceState(source);
  const directory = mkdtempSync(join(tmpdir(), 'omm-detective-audit-'));
  const snapshot = join(directory, 'snapshot.sqlite');
  try {
    copy(source, snapshot, constants.COPYFILE_FICLONE);
    if (existsSync(`${source}-wal`)) {
      copy(`${source}-wal`, `${snapshot}-wal`, constants.COPYFILE_FICLONE);
    }
    if (existsSync(`${source}-journal`)) {
      copy(`${source}-journal`, `${snapshot}-journal`, constants.COPYFILE_FICLONE);
    }
    if (JSON.stringify(before) !== JSON.stringify(sourceState(source))) {
      throw new Error(
        'Source database changed while the audit snapshot was copied; retry when idle',
      );
    }
    return { path: snapshot, directory, sourceState: before };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function countRows(db: Database, sql: string, ...params: (string | number)[]): number {
  const row = db.query(sql).get(...params) as { count: number };
  return Number(row.count);
}

function groupedRows(db: Database, sql: string): Record<string, number> {
  const rows = db.query(sql).all() as { key: string | null; count: number }[];
  return Object.fromEntries(rows.map((row) => [row.key ?? '(null)', Number(row.count)]));
}

function requireSchema(db: Database): void {
  const tables = new Set(
    (
      db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((row) => row.name),
  );
  for (const table of ['entities', 'entity_links', 'facts', 'raw_fetch']) {
    if (!tables.has(table))
      throw new Error(`Not an authoritative crawler database: missing table ${table}`);
  }
}

function appendBounded(
  map: Map<string, string[]>,
  key: string,
  value: string,
  limit: number,
): void {
  const values = map.get(key) ?? [];
  if (values.length < limit && !values.includes(value)) values.push(value);
  map.set(key, values);
}

function candidateRecords(db: Database, limit: number): Candidate[] {
  const occupationPlaceholders = OCCUPATION_SIGNALS.map(() => '?').join(',');
  db.run(`CREATE TEMP TABLE audit_evidence (
    id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (id,kind,value)
  ) WITHOUT ROWID`);
  db.query(
    `INSERT OR IGNORE INTO audit_evidence
     SELECT e.id,'P31',json_extract(claim.value,'$.mainsnak.datavalue.value.id')
     FROM entities e JOIN raw_fetch r ON r.source='wikidata' AND r.key='entity:'||e.qid
     JOIN json_each(CASE WHEN json_valid(r.raw_json)
       THEN COALESCE(json_extract(r.raw_json,'$.claims.P31'),'[]') ELSE '[]' END) claim
     WHERE json_extract(claim.value,'$.mainsnak.datavalue.value.id')=?
     UNION ALL
     SELECT e.id,'P106',json_extract(claim.value,'$.mainsnak.datavalue.value.id')
     FROM entities e JOIN raw_fetch r ON r.source='wikidata' AND r.key='entity:'||e.qid
     JOIN json_each(CASE WHEN json_valid(r.raw_json)
       THEN COALESCE(json_extract(r.raw_json,'$.claims.P106'),'[]') ELSE '[]' END) claim
     WHERE json_extract(claim.value,'$.mainsnak.datavalue.value.id') IN (${occupationPlaceholders})`,
  ).run(DETECTIVE_CLASS, ...OCCUPATION_SIGNALS);
  db.run('CREATE TEMP TABLE audit_candidates AS SELECT id FROM audit_evidence GROUP BY id');
  db.run('CREATE UNIQUE INDEX audit_candidates_id ON audit_candidates(id)');
  db.run('CREATE TEMP TABLE audit_links AS SELECT source_id,target_id,method FROM entity_links');
  db.run('CREATE INDEX audit_links_source ON audit_links(source_id)');
  db.run('CREATE INDEX audit_links_target ON audit_links(target_id)');
  db.run(`CREATE TEMP TABLE audit_candidate_links AS
    SELECT c.id AS candidate_id,l.source_id,l.target_id,l.method
    FROM audit_candidates c JOIN audit_links l INDEXED BY audit_links_source ON l.source_id=c.id
    UNION ALL
    SELECT c.id AS candidate_id,l.source_id,l.target_id,l.method
    FROM audit_candidates c JOIN audit_links l INDEXED BY audit_links_target ON l.target_id=c.id
    WHERE l.target_id!=l.source_id`);
  db.run('CREATE INDEX audit_candidate_links_id ON audit_candidate_links(candidate_id)');

  const entities = db
    .query(
      `SELECT e.id,e.qid,e.type,e.names_json,e.source,
       EXISTS(SELECT 1 FROM audit_evidence a WHERE a.id=e.id AND a.kind='P31' AND a.value=?) AS explicit_class,
       EXISTS(SELECT 1 FROM audit_evidence a WHERE a.id=e.id AND a.kind='P106' AND a.value IN (${MEDIUM_OCCUPATIONS.size === 0 ? "''" : [...MEDIUM_OCCUPATIONS].map(() => '?').join(',')})) AS medium
       FROM entities e JOIN audit_candidates c ON c.id=e.id ORDER BY e.id`,
    )
    .all(DETECTIVE_CLASS, ...MEDIUM_OCCUPATIONS) as {
    id: string;
    qid: string | null;
    type: string;
    names_json: string;
    source: string | null;
    explicit_class: number;
    medium: number;
  }[];
  const workCounts = new Map<string, number>();
  const workSamples = new Map<string, string[]>();
  for (const row of db
    .query(
      `SELECT f.object_ref AS id,COUNT(DISTINCT f.subject_id) AS count
       FROM facts f JOIN audit_candidates c ON c.id=f.object_ref
       WHERE f.predicate IN ('P674','character','characters') GROUP BY f.object_ref ORDER BY f.object_ref`,
    )
    .iterate() as Iterable<{ id: string; count: number }>) {
    workCounts.set(row.id, Number(row.count));
  }
  for (const row of db
    .query(
      `SELECT DISTINCT f.object_ref AS id,f.subject_id
       FROM facts f JOIN audit_candidates c ON c.id=f.object_ref
       WHERE f.predicate IN ('P674','character','characters') ORDER BY f.object_ref,f.subject_id`,
    )
    .iterate() as Iterable<{ id: string; subject_id: string }>) {
    appendBounded(workSamples, row.id, row.subject_id, limit);
  }

  const evidenceCounts = new Map<string, number>();
  const evidenceSamples = new Map<string, Evidence[]>();
  for (const row of db
    .query('SELECT id,kind,value FROM audit_evidence ORDER BY id,kind,value')
    .iterate() as Iterable<{ id: string; kind: string; value: string }>) {
    evidenceCounts.set(row.id, (evidenceCounts.get(row.id) ?? 0) + 1);
    const values = evidenceSamples.get(row.id) ?? [];
    if (values.length < limit)
      values.push({ kind: row.kind, value: row.value, source: 'wikidata' });
    evidenceSamples.set(row.id, values);
  }

  const linkCounts = new Map<string, number>();
  const currentIds = new Map<string, string[]>();
  const linkEvidence = new Map<string, Evidence[]>();
  for (const row of db
    .query(
      'SELECT candidate_id,source_id,target_id,method FROM audit_candidate_links ORDER BY candidate_id,source_id,target_id,method',
    )
    .iterate() as Iterable<{
    candidate_id: string;
    source_id: string;
    target_id: string;
    method: string;
  }>) {
    linkCounts.set(row.candidate_id, (linkCounts.get(row.candidate_id) ?? 0) + 1);
    appendBounded(currentIds, row.candidate_id, row.source_id, limit);
    appendBounded(currentIds, row.candidate_id, row.target_id, limit);
    const values = linkEvidence.get(row.candidate_id) ?? [];
    if (values.length < limit) {
      values.push({ kind: `entity_link:${row.method}`, value: row.target_id, source: null });
    }
    linkEvidence.set(row.candidate_id, values);
  }

  return entities.map((entity) => {
    const typeConflict = entity.type !== 'character';
    const names = namesFromJson(entity.names_json);
    const ids = [
      entity.id,
      ...sortedUnique(currentIds.get(entity.id) ?? []).filter((current) => current !== entity.id),
    ];
    const evidence = [...(evidenceSamples.get(entity.id) ?? [])];
    for (const item of linkEvidence.get(entity.id) ?? []) {
      if (evidence.length >= limit) break;
      evidence.push({ ...item, source: entity.source });
    }
    return {
      id: entity.id,
      canonical_id: entity.qid ? `wd:${entity.qid}` : entity.id,
      current_ids: bounded(ids, limit),
      type: entity.type,
      display_names: bounded(names.names, limit),
      aliases: bounded(names.aliases, limit),
      source_provenance: bounded(
        sortedUnique([
          entity.source ?? 'unknown',
          ...ids.map((current) => current.split(':', 1)[0]),
        ]),
        limit,
      ),
      linked_work_count: workCounts.get(entity.id) ?? 0,
      linked_works: workSamples.get(entity.id) ?? [],
      evidence_count: (evidenceCounts.get(entity.id) ?? 0) + (linkCounts.get(entity.id) ?? 0),
      evidence,
      confidence: typeConflict
        ? 'conflict'
        : entity.explicit_class
          ? 'high'
          : entity.medium
            ? 'medium'
            : 'low',
      conflicts: typeConflict ? [`detective evidence contradicts entity type ${entity.type}`] : [],
    };
  });
}

function duplicateClusters(db: Database, limit: number): { total: number; samples: unknown[] } {
  const rows = db
    .query("SELECT id,qid,names_json FROM entities WHERE id LIKE 'douban:a%' ORDER BY id")
    .all() as { id: string; qid: string | null; names_json: string }[];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const primary = namesFromJson(row.names_json).names[0];
    const normalized = primary ? normalizeDetectiveName(primary) : '';
    if (!normalized) continue;
    const group = groups.get(normalized) ?? [];
    group.push(row);
    groups.set(normalized, group);
  }
  const clusters = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([normalized_name, group]) => {
      const qids = sortedUnique(
        group.map((row) => row.qid).filter((qid): qid is string => Boolean(qid)),
      );
      return {
        normalized_name,
        count: group.length,
        ids: bounded(
          group.map((row) => row.id),
          limit,
        ),
        qids: bounded(qids, limit),
        confidence: reconcileConfidence({
          exactQid: qids.length === 1 && group.every((row) => row.qid === qids[0]),
          normalizedNameMatch: true,
          sameNameDistinct: qids.length > 1 || group.some((row) => !row.qid),
        }),
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count || stableCompare(left.normalized_name, right.normalized_name),
    );
  return { total: clusters.length, samples: bounded(clusters, limit) };
}

function candidateLinkQueryPlan(db: Database): string[] {
  return [
    `SELECT c.id FROM audit_candidates c JOIN audit_links l INDEXED BY audit_links_source ON l.source_id=c.id`,
    `SELECT c.id FROM audit_candidates c JOIN audit_links l INDEXED BY audit_links_target ON l.target_id=c.id`,
  ].flatMap((sql) =>
    (db.query(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail),
  );
}

function buildReport(
  db: Database,
  sourcePath: string,
  sampleLimit: number,
): Record<string, unknown> {
  requireSchema(db);
  const candidates = candidateRecords(db, sampleLimit);
  const candidateWorkCount = countRows(
    db,
    `SELECT COUNT(DISTINCT f.subject_id) AS count FROM facts f JOIN audit_candidates c ON c.id=f.object_ref
     WHERE f.predicate IN ('P674','character','characters')`,
  );
  const duplicates = duplicateClusters(db, sampleLimit);
  const invalidSeriesSamples = db
    .query(
      `SELECT f.object_ref AS target,COALESCE(e.type,'missing') AS type,COUNT(*) AS edge_count
       FROM facts f LEFT JOIN entities e ON e.id=f.object_ref
       WHERE f.predicate IN ('P179','series') AND (e.type IS NULL OR e.type!='series')
       GROUP BY f.object_ref,COALESCE(e.type,'missing') ORDER BY edge_count DESC,target,type LIMIT ?`,
    )
    .all(sampleLimit);
  const typeConflictSamples = db
    .query(
      `SELECT l.source_id,s.type AS source_type,l.target_id,t.type AS target_type,l.method
       FROM entity_links l JOIN entities s ON s.id=l.source_id JOIN entities t ON t.id=l.target_id
       WHERE s.type!=t.type AND NOT (s.type='person' AND t.type='author')
       ORDER BY l.source_id,l.target_id,l.method LIMIT ?`,
    )
    .all(sampleLimit);
  const pollutionSamples = db
    .query(
      `SELECT id,type,names_json FROM entities
       WHERE id LIKE 'douban:p%' OR (id LIKE 'wd:%' AND type IN ('author','person'))
       ORDER BY id LIMIT ?`,
    )
    .all(sampleLimit) as { id: string; type: string; names_json: string }[];
  const report = {
    meta: {
      database: sourcePath,
      read_only: true,
      source_opened_by_sqlite: false,
      audit_strategy:
        'copy database, WAL, and rollback-journal bytes when present to an isolated temporary snapshot before opening SQLite',
      snapshot_consistency:
        'best effort: source DB/WAL/SHM/rollback-journal size and nanosecond mtime are compared before and after copying; this is not a transactional SQLite backup',
      expected_processing_complexity:
        'O(relevant evidence, link, fact, and entity rows + candidates); all nested output arrays are sample-limited',
      candidate_link_query_plan: candidateLinkQueryPlan(db),
      sample_limit: sampleLimit,
      deterministic_body: true,
    },
    coverage: {
      entities: countRows(db, 'SELECT COUNT(*) AS count FROM entities'),
      facts: countRows(db, 'SELECT COUNT(*) AS count FROM facts'),
      raw_claim_rows: countRows(db, 'SELECT COUNT(*) AS count FROM raw_fetch'),
      entity_types: groupedRows(
        db,
        'SELECT type AS key,COUNT(*) AS count FROM entities GROUP BY type ORDER BY count DESC,type',
      ),
      source_prefixes: groupedRows(
        db,
        "SELECT substr(id,1,instr(id,':')-1) AS key,COUNT(*) AS count FROM entities WHERE instr(id,':')>0 GROUP BY key ORDER BY count DESC,key",
      ),
      detective_candidates: candidates.length,
      candidate_confidence_tiers: Object.fromEntries(
        ['high', 'medium', 'low', 'conflict'].map((tier) => [
          tier,
          candidates.filter((candidate) => candidate.confidence === tier).length,
        ]),
      ),
      character_linked_works: countRows(
        db,
        "SELECT COUNT(DISTINCT subject_id) AS count FROM facts WHERE predicate IN ('P674','character','characters')",
      ),
      works_linked_to_candidates: candidateWorkCount,
      series_entities: countRows(db, "SELECT COUNT(*) AS count FROM entities WHERE type='series'"),
      series_linked_works: countRows(
        db,
        "SELECT COUNT(DISTINCT subject_id) AS count FROM facts WHERE predicate IN ('P179','series')",
      ),
      invalid_series_fact_edges: countRows(
        db,
        "SELECT COUNT(*) AS count FROM facts f LEFT JOIN entities e ON e.id=f.object_ref WHERE f.predicate IN ('P179','series') AND (e.type IS NULL OR e.type!='series')",
      ),
      distinct_invalid_series_targets: countRows(
        db,
        "SELECT COUNT(DISTINCT f.object_ref) AS count FROM facts f LEFT JOIN entities e ON e.id=f.object_ref WHERE f.predicate IN ('P179','series') AND (e.type IS NULL OR e.type!='series')",
      ),
      distinct_dangling_series_targets: countRows(
        db,
        "SELECT COUNT(DISTINCT f.object_ref) AS count FROM facts f LEFT JOIN entities e ON e.id=f.object_ref WHERE f.predicate IN ('P179','series') AND e.id IS NULL",
      ),
    },
    candidates,
    duplicates: { same_name_douban_author_clusters: duplicates.total, samples: duplicates.samples },
    pollution: {
      douban_p_entities: countRows(
        db,
        "SELECT COUNT(*) AS count FROM entities WHERE id LIKE 'douban:p%'",
      ),
      douban_price_ids: countRows(
        db,
        `SELECT COUNT(*) AS count FROM entities WHERE id LIKE 'douban:p%'
         AND substr(id,9)!='' AND substr(id,9) NOT GLOB '*[^0-9.]*'
         AND substr(id,9) GLOB '*[0-9]*'
         AND substr(id,9) NOT GLOB '*.'
         AND length(substr(id,9))-length(replace(substr(id,9),'.',''))<=1`,
      ),
      douban_p_author_targets: countRows(
        db,
        "SELECT COUNT(DISTINCT object_ref) AS count FROM facts WHERE predicate IN ('aozora_role','author') AND object_ref LIKE 'douban:p%'",
      ),
      douban_p_name_matches_people: countRows(
        db,
        `SELECT COUNT(DISTINCT p.id) AS count FROM entities p JOIN entities a ON a.type='author'
         AND lower(trim(COALESCE(json_extract(a.names_json,'$.labels.zh'),json_extract(a.names_json,'$.labels.ja'),json_extract(a.names_json,'$.labels.en'))))
          =lower(trim(COALESCE(json_extract(p.names_json,'$.labels.zh'),json_extract(p.names_json,'$.labels.ja'),json_extract(p.names_json,'$.labels.en'))))
         WHERE p.id LIKE 'douban:p%'`,
      ),
      douban_p_publisher_facts: countRows(
        db,
        "SELECT COUNT(*) AS count FROM facts WHERE predicate='publisher' AND object_ref LIKE 'douban:p%'",
      ),
      film_as_person_or_author: countRows(
        db,
        `SELECT COUNT(DISTINCT e.id) AS count FROM raw_fetch r JOIN entities e ON r.key='entity:'||e.qid
         JOIN json_each(CASE WHEN json_valid(r.raw_json)
           THEN COALESCE(json_extract(r.raw_json,'$.claims.P31'),'[]') ELSE '[]' END) claim
         WHERE r.source='wikidata' AND e.type IN ('author','person')
         AND json_extract(claim.value,'$.mainsnak.datavalue.value.id')='Q11424'`,
      ),
      person_author_claims_by_type: groupedRows(
        db,
        `SELECT claim_id AS key,COUNT(DISTINCT entity_id) AS count FROM (
           SELECT e.id AS entity_id,json_extract(claim.value,'$.mainsnak.datavalue.value.id') AS claim_id
           FROM raw_fetch r JOIN entities e ON r.key='entity:'||e.qid
           JOIN json_each(CASE WHEN json_valid(r.raw_json)
             THEN COALESCE(json_extract(r.raw_json,'$.claims.P31'),'[]') ELSE '[]' END) claim
           WHERE r.source='wikidata' AND e.type IN ('author','person')
         ) WHERE claim_id IN ('Q11424','Q5398426','Q7889','Q5')
         GROUP BY claim_id ORDER BY count DESC,claim_id`,
      ),
      entity_link_type_conflicts: {
        count: countRows(
          db,
          `SELECT COUNT(*) AS count FROM entity_links l JOIN entities s ON s.id=l.source_id JOIN entities t ON t.id=l.target_id
           WHERE s.type!=t.type AND NOT (s.type='person' AND t.type='author')`,
        ),
        samples: typeConflictSamples,
      },
      invalid_series_target_samples: invalidSeriesSamples,
      samples: pollutionSamples.map((row) => ({
        id: row.id,
        type: row.type,
        names: bounded(namesFromJson(row.names_json).names, sampleLimit),
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
      'Audit only: no merge, crawl, source database write, remote D1 operation, snow operation, or publication.',
    ],
  };
  return report;
}

export function auditDatabase(
  sourcePath: string,
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
): Record<string, unknown> {
  const snapshot = createSnapshot(sourcePath);
  try {
    const db = new Database(snapshot.path, { readonly: true });
    try {
      const report = buildReport(db, sourcePath, sampleLimit);
      if (JSON.stringify(snapshot.sourceState) !== JSON.stringify(sourceState(sourcePath))) {
        throw new Error('Source database changed during audit; report discarded');
      }
      return report;
    } finally {
      db.close();
    }
  } finally {
    rmSync(snapshot.directory, { recursive: true, force: true });
  }
}

export function writeOutput(
  path: string,
  contents: string,
  operations: Partial<OutputOperations> = {},
): { cleanup_warning?: string } {
  if (existsSync(path)) throw new Error(`Output already exists: ${path}`);
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  const publish = operations.publish ?? linkSync;
  const cleanup = operations.cleanup ?? unlinkSync;
  const remove = operations.remove ?? ((file: string) => rmSync(file, { force: true }));
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    publish(temporary, path);
  } catch (error) {
    remove(temporary);
    throw new Error(
      `Atomic no-clobber output publication failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  try {
    cleanup(temporary);
    return {};
  } catch (error) {
    return {
      cleanup_warning: `Published ${path}, but temporary cleanup failed for ${temporary}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function runCli(args = process.argv.slice(2)): number {
  try {
    const options = parseArgs(args);
    if (options.help) {
      process.stdout.write(
        'Usage: bun scripts/audit-detective-data.ts [--db <path>] [--output <path>] [--sample-limit <1-500>]\n',
      );
      return 0;
    }
    const report = auditDatabase(options.db, options.sampleLimit);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      const result = writeOutput(options.output, json);
      if (result.cleanup_warning)
        process.stderr.write(`detective audit warning: ${result.cleanup_warning}\n`);
    } else process.stdout.write(json);
    const coverage = report.coverage as {
      entities: number;
      detective_candidates: number;
      works_linked_to_candidates: number;
      invalid_series_fact_edges: number;
    };
    process.stderr.write(
      `detective audit: ${coverage.entities} entities, ${coverage.detective_candidates} candidates, ${coverage.works_linked_to_candidates} linked works, ${coverage.invalid_series_fact_edges} invalid series edges\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `detective audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (import.meta.main) process.exitCode = runCli();

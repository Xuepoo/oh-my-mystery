import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { formatWikidataDate } from '@omm/shared';
import {
  neighborQuerySchema,
  parseQuery,
  pathQuerySchema,
  relationQuerySchema,
  searchQuerySchema,
  turnstileResponseSchema,
} from './validation';
import type {
  ChronicleTrail,
  EntityDetailResponse,
  EntityNames,
  EntityProfileResponse,
  EntityRecommendationsResponse,
  EntityRelationsResponse,
  OmmEntity,
  OmmFact,
  PublicationEvent,
  PublicationSummary,
  PathfinderResult,
  RecommendationItem,
  RelationItem,
  SearchResponse,
  SearchResultItem,
} from '@omm/shared';

const PREDICATE_LABELS: Record<string, string> = {
  author: '作者',
  aozora_role: '创作',
  publisher: '出版社',
  publisher_name: '出版社',
  award: '奖项',
  award_received: '奖项',
  character: '角色',
  characters: '角色',
  series: '系列',
  translator: '译者',
  genre: '类型',
  isbn: 'ISBN',
  publication_date: '出版日期',
};

const SOURCE_LABELS: Record<string, string> = {
  wd: 'Wikidata',
  wikidata: 'Wikidata',
  douban: '豆瓣',
  ndl: '日本国会图书馆',
  aozora: '青空文库',
  gutenberg: 'Project Gutenberg',
  omm: 'OMM',
  test: 'OMM',
};

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET?: string;
  ENVIRONMENT?: string;
}

export const SEED_AUTHOR_IDS = [
  'wd:Q35610', // Arthur Conan Doyle
  'wd:Q35064', // Agatha Christie
  'wd:Q365664', // John Dickson Carr
  'wd:Q723221', // Ellery Queen
  'wd:Q347412', // Edogawa Ranpo
  'wd:Q1072588', // Seishi Yokomizo
  'wd:Q201580', // Seicho Matsumoto
  'wd:Q835759', // Soji Shimada
  'wd:Q3266537', // Yukito Ayatsuji
  'wd:Q125970', // Keigo Higashino
  'wd:Q186335', // Dashiell Hammett
  'wd:Q180377', // Raymond Chandler
  'wd:Q374824', // Ross Macdonald
  'wd:Q1051441', // Kyotaro Nishimura
  'wd:Q2318799', // Seiichi Morimura
  'wd:Q6547000', // Shizuko Natsuki
  'wd:Q5363645', // Alice Arisugawa
  'wd:Q906814', // Otsuichi
  'wd:Q854737', // Kotaro Isaka
  'douban:a凑佳苗', // Kanae Minato
];

export const app = new Hono<{ Bindings: Env }>();

// Global JSON error responses (Hono defaults return plain text)
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Unhandled API error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Enable CORS for frontend
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Turnstile-Token'],
  }),
);

// HTTP caching: the knowledge graph is static between deploys, so browser/CDN
// caching is safe per route.
app.use('*', async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith('/api/')) return;
  if (c.res.status !== 200) return;
  if (path === '/api/health') {
    c.header('Cache-Control', 'no-store');
  } else if (path === '/api/seeds' || path.startsWith('/api/chronicles')) {
    c.header('Cache-Control', 'public, max-age=86400');
  } else if (path.startsWith('/api/search') || path.startsWith('/api/path')) {
    c.header('Cache-Control', 'private, max-age=60');
  } else if (path.startsWith('/api/entity')) {
    c.header('Cache-Control', 'public, max-age=3600');
  } else {
    c.header('Cache-Control', 'public, max-age=300');
  }
});

// Turnstile protection is enabled whenever the Worker secret is configured.
// Local development remains open when no secret is present.
const turnstileVerify = async (c: any, next: any) => {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) {
    // Secret not configured (local dev / open access)
    return next();
  }

  const token = c.req.header('X-Turnstile-Token');
  if (!token) {
    return c.json({ error: 'Missing challenge token' }, 403);
  }

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: c.req.header('CF-Connecting-IP'),
      }),
    });
    if (!res.ok) {
      return c.json({ error: 'Turnstile verification unavailable' }, 503);
    }
    const outcome = turnstileResponseSchema.safeParse(await res.json());
    if (!outcome.success || !outcome.data.success) {
      return c.json({ error: 'Turnstile verification failed' }, 403);
    }
  } catch (err) {
    console.error('Turnstile verification error:', err);
    return c.json({ error: 'Turnstile verification unavailable' }, 503);
  }

  await next();
};

// 1. Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    service: 'omm-api',
  });
});

// 1b. Global dataset statistics for the welcome layer
app.get('/api/stats', async (c) => {
  const byType = await c.env.DB.prepare(
    'SELECT type, count(*) AS count FROM entities GROUP BY type',
  ).all();
  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of byType.results || []) {
    const t = String((row as { type: unknown }).type ?? 'unknown');
    const n = Number((row as { count: unknown }).count ?? 0);
    counts[t] = n;
    total += n;
  }
  const facts = await c.env.DB.prepare('SELECT count(*) AS count FROM facts').first();
  const awards = await c.env.DB.prepare(
    "SELECT count(*) AS count FROM facts WHERE predicate = 'award_received'",
  ).first();
  return c.json({
    total,
    byType: counts,
    facts: Number((facts as { count: unknown } | null)?.count ?? 0),
    awards: Number((awards as { count: unknown } | null)?.count ?? 0),
  });
});

// 2. Seed entities (20+ core detective fiction masters)
app.get('/api/seeds', async (c) => {
  const placeholders = SEED_AUTHOR_IDS.map(() => '?').join(',');
  const query = `SELECT * FROM entities WHERE id IN (${placeholders})`;
  const rows = await c.env.DB.prepare(query)
    .bind(...SEED_AUTHOR_IDS)
    .all();

  const entities = (rows.results || []).map(formatEntityRow);
  return c.json({
    seeds: entities,
  });
});

// 3. Batch get nodes by IDs
app.get('/api/nodes', async (c) => {
  const idsParam = c.req.query('ids');
  if (!idsParam) {
    return c.json([]);
  }

  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (ids.length === 0) {
    return c.json([]);
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT * FROM entities WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();

  const entities = (rows.results || []).map(formatEntityRow);
  return c.json(entities);
});

// 4. Get 1-Hop Neighbors (Strictly conforms to KgDataSource KgNeighborhood format)
app.get('/api/entity/:id/neighbors', turnstileVerify, async (c) => {
  const id = c.req.param('id');
  const parsedQuery = parseQuery(neighborQuerySchema, {
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
    direction: c.req.query('direction'),
    predicates: c.req.query('predicates'),
  });
  if ('error' in parsedQuery) return c.json({ error: parsedQuery.error }, 400);
  const { limit, cursor, direction, predicates } = parsedQuery.data;

  // 1. Fetch the focal entity
  const entityRow = await c.env.DB.prepare('SELECT * FROM entities WHERE id = ?').bind(id).first();

  const entity: OmmEntity = entityRow
    ? formatEntityRow(entityRow)
    : {
        id,
        type: 'other',
        names: { labels: { '': id } },
      };

  // 2. Fetch all raw facts connected to this entity
  const directionClause =
    direction === 'out'
      ? "(subject_id = ? AND object_ref IS NOT NULL AND object_ref != '')"
      : direction === 'in'
        ? "(object_ref = ? AND subject_id IS NOT NULL AND subject_id != '')"
        : `((subject_id = ? AND object_ref IS NOT NULL AND object_ref != '')
           OR (object_ref = ? AND subject_id IS NOT NULL AND subject_id != ''))`;
  const baseBindings: unknown[] = direction === 'both' ? [id, id] : [id];
  let predicateClause = '';
  if (predicates?.length) {
    predicateClause = ` AND predicate IN (${predicates.map(() => '?').join(',')})`;
  }
  const bindings: unknown[] = [...baseBindings];
  if (predicates?.length) bindings.push(...predicates);
  let cursorClause = '';
  if (cursor) {
    const [priority, factId] = cursor.split(':');
    cursorClause = ` AND (
      CASE WHEN predicate = 'publisher' THEN 0 ELSE 1 END > ?
      OR (CASE WHEN predicate = 'publisher' THEN 0 ELSE 1 END = ? AND id > ?)
    )`;
    bindings.push(Number(priority), Number(priority), factId);
  }
  bindings.push(limit + 1);
  const rawFactsRows = await c.env.DB.prepare(
    `SELECT * FROM facts
     WHERE ${directionClause}
       AND predicate NOT IN ('translator', 'publisher_name', 'genre')
       AND (predicate != 'aozora_role' OR object_value = '著者')
       ${predicateClause}
       ${cursorClause}
     ORDER BY CASE WHEN predicate = 'publisher' THEN 0 ELSE 1 END, id
     LIMIT ?`,
  )
    .bind(...bindings)
    .all();

  const pageRows = (rawFactsRows.results || []).slice(0, limit) as any[];
  const hasMore = (rawFactsRows.results || []).length > limit;

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total
       FROM facts
      WHERE ${directionClause}
        AND predicate NOT IN ('translator', 'publisher_name', 'genre')
        AND (predicate != 'aozora_role' OR object_value = '著者')
        ${predicateClause}`,
  )
    .bind(...baseBindings, ...(predicates ?? []))
    .first();
  const total = Number((totalRow as any)?.total ?? 0);

  const rawFacts: OmmFact[] = pageRows.map((row: any) => ({
    subject_id: row.subject_id,
    predicate: row.predicate,
    object_ref: row.object_ref,
    object_value: row.object_value || undefined,
    qualifiers: safeParseJson(row.qualifiers_json, undefined),
    source: row.source || undefined,
  }));

  // 3. Fetch neighbor entities
  const neighborIds = new Set<string>();
  for (const f of rawFacts) {
    const otherId = f.subject_id === id ? f.object_ref : f.subject_id;
    if (otherId && otherId.trim()) {
      neighborIds.add(otherId);
    }
  }
  neighborIds.delete(id);

  let neighbors: OmmEntity[] = [];
  const validNeighborIdSet = new Set<string>([id]);

  if (neighborIds.size > 0) {
    const idsList = [...neighborIds].slice(0, 100);
    const placeholders = idsList.map(() => '?').join(',');
    const neighborRows = await c.env.DB.prepare(
      `SELECT * FROM entities WHERE id IN (${placeholders})`,
    )
      .bind(...idsList)
      .all();
    const fetchedNeighbors = (neighborRows.results || []).map(formatEntityRow);

    // Sort to prefer Wikidata or canonical IDs
    fetchedNeighbors.sort((a, b) => {
      const aWd = a.id.startsWith('wd:') ? 0 : 1;
      const bWd = b.id.startsWith('wd:') ? 0 : 1;
      return aWd - bWd;
    });

    const seenNames = new Set<string>();
    for (const n of fetchedNeighbors) {
      const labels = n.names.labels || {};
      const zh = labels['zh-cn'] || labels.zh || labels['zh-hans'] || labels['zh-hant'];
      const ja = labels.ja;

      let rawName = zh;
      if (zh) {
        // If zh label has no Han characters but Japanese does, prefer Japanese!
        const hasHan = /[\u4e00-\u9fa5\u3040-\u30ff]/.test(zh);
        if (!hasHan && ja && /[\u4e00-\u9fa5\u3040-\u30ff]/.test(ja)) {
          rawName = ja;
        }
      }
      rawName = rawName || ja || labels.en || n.id;

      const cleanName = normalizeSearchName(rawName);
      if (!cleanName) continue;
      const simpKey = toSimpKey(cleanName);
      const nameKey = `${n.type}|${simpKey}`;

      if (!seenNames.has(nameKey)) {
        seenNames.add(nameKey);
        // Put the best label in standard zh field to ensure frontend displays it correctly
        if (!n.names.labels) n.names.labels = {};
        n.names.labels.zh = rawName;
        neighbors.push(n);
        validNeighborIdSet.add(n.id);
      }
    }
  }

  // 4. Strictly filter facts to only those where both endpoints exist in entity/neighbors
  const validFacts = rawFacts.filter(
    (f) =>
      f.subject_id &&
      f.object_ref &&
      validNeighborIdSet.has(f.subject_id) &&
      validNeighborIdSet.has(f.object_ref),
  );

  // 5. Dynamic Type Inferencing (Fix crawler misclassifications)
  // If an entity is the subject of an 'author' edge, it must be a 'work'
  // If an entity is the object of an 'author' edge, it must be an 'author'
  const inferredTypes = new Map<string, string>();
  for (const f of validFacts) {
    if (f.predicate === 'author' || (f.predicate === 'aozora_role' && f.object_value === '著者')) {
      inferredTypes.set(f.subject_id, 'work');
      inferredTypes.set(f.object_ref, 'author');
    }
  }

  // Ensure KgEntity compatibility: `labels` directly on root
  const kgEntity = {
    ...entity,
    type: inferredTypes.get(entity.id) || entity.type,
    labels: entity.names.labels || { '': entity.id },
  };

  const kgNeighbors = neighbors.map((n) => ({
    ...n,
    type: inferredTypes.get(n.id) || n.type,
    labels: n.names.labels || { '': n.id },
  }));

  return c.json({
    entity: kgEntity,
    facts: validFacts,
    neighbors: kgNeighbors,
    hasMore,
    total,
    nextCursor:
      hasMore && pageRows.length
        ? `${pageRows.at(-1)!.predicate === 'publisher' ? 0 : 1}:${pageRows.at(-1)!.id}`
        : undefined,
  });
});

// 5. Get full entity profile & recommendations for Casefile Drawer
app.get('/api/entity/:id/details', async (c) => {
  const id = c.req.param('id');

  const entityRow = await c.env.DB.prepare('SELECT * FROM entities WHERE id = ?').bind(id).first();
  if (!entityRow) {
    return c.json({ error: 'Entity not found' }, 404);
  }

  const entity = formatEntityRow(entityRow);

  // Fetch facts
  const factsRows = await c.env.DB.prepare(
    `
    SELECT * FROM facts WHERE subject_id = ? OR object_ref = ? LIMIT 60
  `,
  )
    .bind(id, id)
    .all();

  const facts: OmmFact[] = (factsRows.results || []).map((row: any) => ({
    subject_id: row.subject_id,
    predicate: row.predicate,
    object_ref: row.object_ref,
    object_value: row.object_value || undefined,
    qualifiers: safeParseJson(row.qualifiers_json, undefined),
    source: row.source || undefined,
  }));

  // Fetch recommendations
  const recRows = await c.env.DB.prepare(
    `
    SELECT r.*, e.type as target_type, e.names_json as target_names_json
    FROM recommendations r
    LEFT JOIN entities e ON r.target_id = e.id
    WHERE r.entity_id = ?
    ORDER BY r.rank ASC
    LIMIT 10
  `,
  )
    .bind(id)
    .all();

  const recommendations: RecommendationItem[] = (recRows.results || []).map((row: any) => {
    let targetName = row.target_id;
    if (row.target_names_json) {
      const parsed = safeParseJson<{ labels?: Record<string, string> }>(row.target_names_json, {});
      targetName =
        parsed.labels?.zh ||
        parsed.labels?.['zh-cn'] ||
        parsed.labels?.en ||
        parsed.labels?.ja ||
        row.target_id;
    }

    return {
      target_id: row.target_id,
      target_name: targetName,
      target_type: row.target_type || 'other',
      score: row.score,
      reason: row.reason,
      rank: row.rank,
    };
  });

  const publicationSummaryRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count,
            GROUP_CONCAT(DISTINCT publisher_id) AS publisher_ids
       FROM publication_events
      WHERE work_id = ?`,
  )
    .bind(id)
    .first();
  const publications: PublicationSummary = {
    count: Number((publicationSummaryRow as any)?.count ?? 0),
    publisher_ids: String((publicationSummaryRow as any)?.publisher_ids ?? '')
      .split(',')
      .filter(Boolean),
  };

  const response: EntityDetailResponse = {
    entity,
    facts,
    recommendations,
    publications,
  };

  return c.json(response);
});

app.get('/api/entity/:id/profile', async (c) => {
  const id = c.req.param('id');
  const entityRow = await c.env.DB.prepare('SELECT * FROM entities WHERE id = ?').bind(id).first();
  if (!entityRow) return c.json({ error: 'Entity not found' }, 404);

  const entity = formatEntityRow(entityRow);
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.predicate, f.object_ref, f.object_value, e.names_json
       FROM facts f
       LEFT JOIN entities e ON e.id = f.object_ref
      WHERE f.subject_id = ?
      ORDER BY f.id ASC
      LIMIT 60`,
  )
    .bind(id)
    .all();
  const fields: EntityProfileResponse['fields'] = [];
  const addField = (key: string, label: string, value?: string | null) => {
    const cleanValue = value?.trim();
    if (cleanValue) fields.push({ key, label, value: cleanValue, copyValue: cleanValue });
  };

  addField('name', '名称', getReadableName(entityRow.names_json));
  addField('type', '类型', getEntityTypeLabel(entity.type));
  addField('bio', '简介', entity.bio);
  addField('birth', '出生', formatWikidataDate(entity.birth));
  addField('death', '逝世', formatWikidataDate(entity.death));
  let country = getCountryLabel(entity.country);
  if (entity.country?.startsWith('Q')) {
    const countryRow = await c.env.DB.prepare('SELECT names_json FROM entities WHERE id = ?')
      .bind(`wd:${entity.country}`)
      .first();
    country = getReadableName(countryRow?.names_json) || country;
  }
  addField('country', '国家/地区', country);
  for (const row of (rows.results || []) as any[]) {
    const value = getReadableName(row.names_json) || String(row.object_value || '').trim();
    if (!value) continue;
    addField(
      `${String(row.predicate)}:${String(row.object_ref || row.id)}`,
      PREDICATE_LABELS[String(row.predicate)] || String(row.predicate),
      value,
    );
  }
  addField('source', '来源', getSourceLabel(entity.source));

  const response: EntityProfileResponse = { entity, fields };
  return c.json(response);
});

app.get('/api/entity/:id/relations', async (c) => {
  const id = c.req.param('id');
  const parsedQuery = parseQuery(relationQuerySchema, {
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
  });
  if ('error' in parsedQuery) return c.json({ error: parsedQuery.error }, 400);

  let cursor: RelationCursor | undefined;
  if (parsedQuery.data.cursor) {
    cursor = decodeRelationCursor(parsedQuery.data.cursor);
    if (!cursor) return c.json({ error: 'Invalid query parameters' }, 400);
  }

  const entity = await c.env.DB.prepare('SELECT id FROM entities WHERE id = ?').bind(id).first();
  if (!entity) return c.json({ error: 'Entity not found' }, 404);

  const bindings: unknown[] = [id, id, id, id];
  let cursorClause = '';
  if (cursor) {
    cursorClause = `AND (predicate COLLATE BINARY, direction COLLATE BINARY,
                         value COLLATE BINARY, fact_id) > (?, ?, ?, ?)`;
    bindings.push(...cursor);
  }
  bindings.push(parsedQuery.data.limit + 1);

  const rows = await c.env.DB.prepare(
    `WITH connected AS (
       SELECT f.id AS fact_id, f.predicate, f.object_value, f.qualifiers_json, f.source,
              CASE WHEN f.subject_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction,
              CASE WHEN f.subject_id = ? THEN f.object_ref ELSE f.subject_id END AS target_id
         FROM facts f
        WHERE f.subject_id = ? OR (f.object_ref = ? AND f.subject_id <> f.object_ref)
     ), resolved AS (
       SELECT connected.*,
              COALESCE(
                json_extract(e.names_json, '$.labels.zh'),
                json_extract(e.names_json, '$.labels.zh-cn'),
                json_extract(e.names_json, '$.labels.en'),
                json_extract(e.names_json, '$.labels.ja'),
                json_extract(e.names_json, '$.labels.""'),
                (SELECT value FROM json_each(e.names_json, '$.labels')
                  WHERE typeof(value) = 'text' AND trim(value) <> '' ORDER BY key LIMIT 1),
                CASE WHEN connected.direction = 'outgoing' AND trim(connected.object_value) <> ''
                     THEN connected.object_value END
              ) AS value,
              e.id AS resolved_target_id
         FROM connected
         LEFT JOIN entities e ON e.id = connected.target_id
     )
     SELECT fact_id, predicate, direction, value, resolved_target_id AS target_id,
            qualifiers_json, source
       FROM resolved
      WHERE value IS NOT NULL AND trim(value) <> ''
        ${cursorClause}
      ORDER BY predicate COLLATE BINARY ASC, direction COLLATE BINARY ASC,
               value COLLATE BINARY ASC, fact_id ASC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all();
  const pageRows = (rows.results || []).slice(0, parsedQuery.data.limit) as any[];
  const items: RelationItem[] = pageRows.map((row) => {
    const evidence = safeParseJson<{ assertions?: Record<string, unknown>[] }>(
      row.qualifiers_json,
      {},
    );
    return {
      factId: Number(row.fact_id),
      predicate: String(row.predicate),
      label: PREDICATE_LABELS[String(row.predicate)] || String(row.predicate),
      value: String(row.value),
      copyValue: String(row.value),
      ...(row.target_id ? { targetId: String(row.target_id) } : {}),
      ...(evidence.assertions?.length ? { assertions: evidence.assertions } : {}),
      ...(row.source ? { source: String(row.source) } : {}),
      direction: row.direction,
    };
  });
  const last = pageRows.at(-1);
  const response: EntityRelationsResponse = {
    entityId: id,
    items,
    nextCursor:
      (rows.results || []).length > parsedQuery.data.limit && last
        ? encodeRelationCursor([
            String(last.predicate),
            last.direction,
            String(last.value),
            Number(last.fact_id),
          ])
        : undefined,
  };
  return c.json(response);
});

app.get('/api/entity/:id/recommendations', async (c) => {
  const id = c.req.param('id');
  const entity = await c.env.DB.prepare('SELECT id FROM entities WHERE id = ?').bind(id).first();
  if (!entity) return c.json({ error: 'Entity not found' }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT r.target_id, r.score, r.reason, e.type, e.names_json
       FROM recommendations r
       JOIN entities e ON e.id = r.target_id
      WHERE r.entity_id = ?
      ORDER BY r.rank ASC, r.target_id COLLATE BINARY ASC
      LIMIT 10`,
  )
    .bind(id)
    .all();
  const items = (rows.results || []).flatMap((row: any) => {
    const name = getReadableName(row.names_json);
    return name
      ? [
          {
            targetId: String(row.target_id),
            name,
            copyValue: name,
            type: row.type || 'other',
            score: Number(row.score),
            reason: String(row.reason),
          },
        ]
      : [];
  });
  const response: EntityRecommendationsResponse = { entityId: id, items };
  return c.json(response);
});

app.get('/api/entity/:id/publications', async (c) => {
  const id = c.req.param('id');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM publication_events
      WHERE work_id = ?
      ORDER BY publication_date ASC, id ASC`,
  )
    .bind(id)
    .all();
  const publications: PublicationEvent[] = (rows.results || []).map((row: any) => ({
    id: Number(row.id),
    work_id: row.work_id,
    work_group_id: row.work_group_id || null,
    publisher_id: row.publisher_id || null,
    translator_ids: safeParseJson<string[]>(row.translator_ids_json, []),
    publication_date: row.publication_date || null,
    isbn: row.isbn || null,
    language: row.language || null,
    region: row.region || null,
    edition_type: row.edition_type || null,
    source: row.source || null,
    provenance: safeParseJson<Record<string, unknown>>(row.provenance_json, {}),
  }));
  return c.json({ work_id: id, publications });
});

function normalizeSearchName(name: string): string {
  return (
    name
      // Strip nationality/country brackets: (日), （日）, [日], 【日】, 〔日〕, ［日］ etc.
      .replace(/^[（([【〔［][日中美英法德俄韩港台欧日\w\s]+[）)\]】〕］][、，,\s·.]*/g, '')
      // Strip roles: 原作：, 作画：, 著：, 译：, 编：
      .replace(/^(原作|作畫|作画|著|编|譯|译|繪|絵|画|イラスト)[：:\s]+/g, '')
      // Replace broken typos like 力イウ -> カイウ
      .replace(/[\u529B]イウ/g, 'カイウ')
      // Strip trailing or leading unclosed brackets and punctuation: (, （, ), ）, 、, ,, ·
      .replace(/^[（([【()\]】〕］、，,·.\s]+|[（([【()\]】〕］、，,·.\s]+$/g, '')
      .trim()
  );
}

function toSimpKey(str: string): string {
  return str
    .replace(/戶/g, '户')
    .replace(/亂/g, '乱')
    .replace(/步/g, '步')
    .replace(/東/g, '东')
    .replace(/野/g, '野')
    .replace(/圭/g, '圭')
    .replace(/吾/g, '吾')
    .replace(/島/g, '岛')
    .replace(/莊/g, '庄')
    .replace(/司/g, '司')
    .replace(/綾/g, '绫')
    .replace(/辻/g, '辻')
    .replace(/行/g, '行')
    .replace(/人/g, '人')
    .replace(/賞/g, '奖')
    .replace(/獎/g, '奖')
    .replace(/獲/g, '获')
    .replace(/館/g, '馆')
    .replace(/筆/g, '笔')
    .replace(/書/g, '书')
    .replace(/國/g, '国')
    .replace(/會/g, '会')
    .toLowerCase()
    .replace(/[\s\-_·.]+/g, '');
}

// 6. Search across multi-language names and aliases
app.get('/api/search', async (c) => {
  const parsedQuery = parseQuery(searchQuerySchema, {
    q: c.req.query('q'),
    limit: c.req.query('limit'),
  });
  if ('error' in parsedQuery) return c.json({ error: parsedQuery.error }, 400);
  const { q, limit } = parsedQuery.data;

  if (!q || q.length < 1) {
    const emptyResp: SearchResponse = { query: q, results: [] };
    return c.json(emptyResp);
  }

  const pattern = `%${q}%`;
  // Fetch up to 60 candidates to ensure canonical entities (Wikidata/Clean) are preferred.
  // FTS5 trigram for >=3 char queries (indexed substring match), LIKE fallback for
  // shorter queries or when the FTS index is unavailable.
  let rows: any;
  if ([...q].length >= 3) {
    try {
      rows = await c.env.DB.prepare(
        `
        SELECT s.id, s.type, s.name_zh, s.name_en, s.name_ja, e.names_json
        FROM search_fts f
        JOIN search_index s ON s.id = f.id
        LEFT JOIN entities e ON s.id = e.id
        WHERE search_fts MATCH ?
        ORDER BY
          (CASE WHEN s.id LIKE 'wd:%' THEN 0 ELSE 1 END),
          (CASE WHEN s.name_zh = ? OR s.name_en = ? OR s.name_ja = ? THEN 0 ELSE 1 END),
          LENGTH(COALESCE(s.name_zh, s.name_en, s.name_ja)) ASC
        LIMIT 60
      `,
      )
        .bind(`"${q.replaceAll('"', '""')}"`, q, q, q)
        .all();
    } catch (err) {
      console.warn('FTS search failed, falling back to LIKE:', err);
      rows = { results: [] };
    }
  }
  if (!rows || (rows.results || []).length === 0) {
    rows = await c.env.DB.prepare(
      `
      SELECT s.id, s.type, s.name_zh, s.name_en, s.name_ja, e.names_json
      FROM search_index s
      LEFT JOIN entities e ON s.id = e.id
      WHERE s.name_zh LIKE ? OR s.name_en LIKE ? OR s.name_ja LIKE ? OR s.aliases_text LIKE ?
      ORDER BY
        (CASE WHEN s.id LIKE 'wd:%' THEN 0 ELSE 1 END),
        (CASE WHEN s.name_zh = ? OR s.name_en = ? OR s.name_ja = ? THEN 0 ELSE 1 END),
        LENGTH(COALESCE(s.name_zh, s.name_en, s.name_ja)) ASC
      LIMIT 60
    `,
    )
      .bind(pattern, pattern, pattern, pattern, q, q, q)
      .all();
  }

  const results: SearchResultItem[] = [];
  const searchRows = (rows.results || []) as any[];
  const seenIds = new Set<string>();

  interface SearchCandidate {
    id: string;
    type: string;
    name: string;
    subtitle?: string;
    simpKey: string;
    wd: boolean;
    personish: boolean;
  }

  const candidates: SearchCandidate[] = [];
  for (const row of searchRows) {
    const id = String(row.id);
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    let rawName = row.name_zh || row.name_en || row.name_ja || id;
    let subtitle =
      row.name_ja && row.name_ja !== rawName
        ? row.name_ja
        : row.name_en && row.name_en !== rawName
          ? row.name_en
          : undefined;

    if (row.names_json) {
      const parsed = safeParseJson<{ labels?: Record<string, string> }>(row.names_json, {});
      const labels: Record<string, string> = parsed.labels ?? {};
      rawName =
        labels['zh-cn'] ||
        labels.zh ||
        labels['zh-hans'] ||
        labels['zh-hant'] ||
        labels.ja ||
        labels.en ||
        rawName;
      if (!subtitle && labels.ja && labels.ja !== rawName) {
        subtitle = labels.ja;
      } else if (!subtitle && labels.en && labels.en !== rawName) {
        subtitle = labels.en;
      }
    }

    const cleanName = normalizeSearchName(rawName);
    if (!cleanName || cleanName.length < 1) continue;

    // Filter out multi-author anthology conglomerate strings in author type (e.g. 2+ authors joined by 、 or /)
    if (row.type === 'author') {
      const commaCount = (cleanName.match(/[、,/]/g) || []).length;
      if (commaCount >= 1) {
        continue;
      }
    }

    const type = row.type || 'other';
    candidates.push({
      id,
      type,
      name: cleanName,
      subtitle,
      simpKey: toSimpKey(cleanName),
      wd: id.startsWith('wd:'),
      personish: type === 'author' || type === 'person',
    });
  }

  // Group by normalized name. A canonical Wikidata person claims the whole name
  // group: same-name duplicates from other sources (including polluted
  // publisher/work rows) collapse into it. Distinct Wikidata entities sharing a
  // name (homonyms) all survive. Without a canonical person, dedupe per type as
  // before so legitimate publishers/works with the same name stay visible.
  const nameGroups = new Map<string, SearchCandidate[]>();
  for (const candidate of candidates) {
    const group = nameGroups.get(candidate.simpKey) ?? [];
    group.push(candidate);
    nameGroups.set(candidate.simpKey, group);
  }
  for (const group of nameGroups.values()) {
    const canonicalPerson = group.find((candidate) => candidate.wd && candidate.personish);
    const keep = canonicalPerson
      ? group.filter((candidate) => candidate.wd)
      : (() => {
          const seenTypes = new Set<string>();
          return group.filter((candidate) => {
            if (seenTypes.has(candidate.type)) return false;
            seenTypes.add(candidate.type);
            return true;
          });
        })();
    for (const candidate of keep) {
      seenIds.add(candidate.id);
      results.push({
        id: candidate.id,
        type: candidate.type,
        name: candidate.name,
        subtitle: candidate.subtitle,
        score: 1.0,
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  const response: SearchResponse = {
    query: q,
    results,
  };

  return c.json(response);
});

// 7. Pathfinder: Shortest relational chain between Source and Target
app.get('/api/path', turnstileVerify, async (c) => {
  const parsedQuery = parseQuery(pathQuerySchema, {
    source: c.req.query('source'),
    target: c.req.query('target'),
  });
  if ('error' in parsedQuery) {
    return c.json({ error: 'Both source and target parameters are required' }, 400);
  }
  const { source, target } = parsedQuery.data;

  if (source === target) {
    const node = await c.env.DB.prepare('SELECT * FROM entities WHERE id = ?').bind(source).first();
    if (!node) return c.json({ error: 'Source and target entity not found' }, 404);
    return c.json({
      found: true,
      nodes: node ? [formatEntityRow(node)] : [],
      edges: [],
      hops: 0,
      explanation: '起点与终点为同一实体',
    });
  }

  const endpoints = await c.env.DB.prepare('SELECT id FROM entities WHERE id IN (?, ?)')
    .bind(source, target)
    .all();
  const endpointIds = new Set((endpoints.results || []).map((row: any) => String(row.id)));
  if (!endpointIds.has(source) || !endpointIds.has(target)) {
    return c.json({ error: 'Source and target must be existing entities' }, 404);
  }

  // Breadth-first pathfinding (Max 5 hops)
  const pathResult = await findShortestPath(c.env.DB, source, target, 5);

  if (pathResult.status !== 'found') {
    const notFound: PathfinderResult = {
      found: false,
      nodes: [],
      edges: [],
      hops: -1,
      explanation:
        pathResult.status === 'budget_exhausted'
          ? '关系网络过于庞大，已在安全搜索上限内停止，请尝试选择关联更紧密的实体'
          : '在限定跳数内未发现直接关联路径',
    };
    return c.json(notFound);
  }
  const path = pathResult.path;

  // Fetch nodes in path
  const nodeIds = [...new Set(path.nodes)];
  const placeholders = nodeIds.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT * FROM entities WHERE id IN (${placeholders})`)
    .bind(...nodeIds)
    .all();

  const nodeMap = new Map<string, OmmEntity>();
  for (const r of rows.results || []) {
    const e = formatEntityRow(r);
    nodeMap.set(e.id, e);
  }

  const orderedNodes = path.nodes.map((nid) => nodeMap.get(nid)).filter(Boolean) as OmmEntity[];
  if (
    orderedNodes.length !== path.nodes.length ||
    orderedNodes.length !== path.edges.length + 1 ||
    orderedNodes[0]?.id !== source ||
    orderedNodes.at(-1)?.id !== target ||
    path.edges.some(
      (edge, index) => edge.source !== path.nodes[index] || edge.target !== path.nodes[index + 1],
    )
  ) {
    return c.json({ error: 'Path response invariants failed' }, 500);
  }

  const result: PathfinderResult = {
    found: true,
    nodes: orderedNodes,
    edges: path.edges,
    hops: path.edges.length,
    explanation: `成功连通，共经过 ${path.edges.length} 条关系跳跃`,
  };

  return c.json(result);
});

// 8. Chronicle Trails
app.get('/api/chronicles', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM chronicles').all();
  const trails: ChronicleTrail[] = [];
  for (const r of (rows.results || []) as any[]) {
    const steps = parseJsonOrUndefined(r.steps_json);
    if (!Array.isArray(steps)) {
      console.warn(`Skipping chronicle ${r.id}: steps_json is not an array`);
      continue;
    }
    trails.push({
      id: r.id,
      slug: r.slug,
      title: safeParseJson<ChronicleTrail['title']>(r.title_json, {}),
      description: safeParseJson<ChronicleTrail['description']>(r.description_json, {}),
      steps: steps as ChronicleTrail['steps'],
    });
  }
  return c.json(trails);
});

app.get('/api/chronicles/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await c.env.DB.prepare('SELECT * FROM chronicles WHERE slug = ?').bind(slug).first();
  if (!row) {
    return c.json({ error: 'Trail not found' }, 404);
  }
  const steps = parseJsonOrUndefined(row.steps_json);
  if (!Array.isArray(steps)) {
    return c.json({ error: 'Trail data corrupted' }, 500);
  }
  const trail: ChronicleTrail = {
    id: row.id as string,
    slug: row.slug as string,
    title: safeParseJson<ChronicleTrail['title']>(row.title_json, {}),
    description: safeParseJson<ChronicleTrail['description']>(row.description_json, {}),
    steps: steps as ChronicleTrail['steps'],
  };
  return c.json(trail);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function formatEntityRow(row: any): OmmEntity {
  const parsed = safeParseJson<{
    labels?: Record<string, string>;
    aliases?: Record<string, string[]>;
  }>(row.names_json, { labels: {} });
  const names: EntityNames = {
    labels: parsed.labels ?? {},
    ...(parsed.aliases ? { aliases: parsed.aliases } : {}),
  };

  return {
    id: row.id,
    qid: row.qid || null,
    type: row.type,
    names,
    bio: row.bio || null,
    birth: row.birth || null,
    death: row.death || null,
    country: row.country || null,
    source: row.source || 'wikidata',
    quality: row.quality || 1,
  };
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getReadableName(rawNames: unknown): string | undefined {
  const names = safeParseJson<{ labels?: Record<string, unknown> }>(rawNames, {});
  const labels = names.labels || {};
  for (const language of ['zh', 'zh-cn', 'en', 'ja', '']) {
    const value = labels[language];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return Object.keys(labels)
    .sort()
    .map((key) => labels[key])
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    ?.trim();
}

function getEntityTypeLabel(type: string): string {
  return (
    {
      author: '作者',
      work: '作品',
      publisher: '出版社',
      award: '奖项',
      character: '角色',
      series: '系列',
      genre: '类型',
      person: '人物',
      other: '其他',
    }[type] || '其他'
  );
}

function getCountryLabel(country?: string | null): string | undefined {
  if (!country) return undefined;
  return (
    {
      CN: '中国',
      DE: '德国',
      FR: '法国',
      GB: '英国',
      JP: '日本',
      KR: '韩国',
      US: '美国',
    }[country.toUpperCase()] || country
  );
}

function getSourceLabel(source?: string): string | undefined {
  if (!source) return undefined;
  const prefix = source.split(':', 1)[0]!.toLowerCase();
  return SOURCE_LABELS[source.toLowerCase()] || SOURCE_LABELS[prefix];
}

type RelationCursor = [string, 'incoming' | 'outgoing', string, number];

function encodeRelationCursor(cursor: RelationCursor): string {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(cursor))));
  return encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeRelationCursor(value: string): RelationCursor | undefined {
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const json = decodeURIComponent(
      escape(atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)),
    );
    const cursor: unknown = JSON.parse(json);
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 4 ||
      typeof cursor[0] !== 'string' ||
      (cursor[1] !== 'incoming' && cursor[1] !== 'outgoing') ||
      typeof cursor[2] !== 'string' ||
      !Number.isSafeInteger(cursor[3]) ||
      cursor[3] < 1
    ) {
      return undefined;
    }
    return cursor as RelationCursor;
  } catch {
    return undefined;
  }
}

// Strict variant: returns undefined when the row is not valid JSON,
// so callers can distinguish malformed data from legitimate fallbacks.
function parseJsonOrUndefined(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const PATH_FRONTIER_BATCH_SIZE = 50;
const PATH_MAX_QUERIES = 50;
const PATH_MAX_VISITED = 2_000;
const PATH_MAX_EXAMINED_EDGES = 4_000;

interface PathEdge {
  source: string;
  target: string;
  predicate: string;
  storedSource: string;
  storedTarget: string;
}

type PathSearchResult =
  | { status: 'found'; path: { nodes: string[]; edges: PathEdge[] } }
  | { status: 'no_path' | 'budget_exhausted' };

async function findShortestPath(
  db: D1Database,
  start: string,
  end: string,
  maxDepth = 5,
): Promise<PathSearchResult> {
  interface Parent {
    node: string;
    edge: PathEdge;
  }

  const sourceParents = new Map<string, Parent>();
  const targetParents = new Map<string, Parent>();
  const sourceDepths = new Map([[start, 0]]);
  const targetDepths = new Map([[end, 0]]);
  const sourceVisited = new Set([start]);
  const targetVisited = new Set([end]);
  let sourceFrontier = [start];
  let targetFrontier = [end];
  let queryCount = 0;
  let examinedEdges = 0;

  const queryEdges = async (frontier: string[]) => {
    const adjacency: {
      current: string;
      neighbor: string;
      predicate: string;
      storedSource: string;
      storedTarget: string;
    }[] = [];
    for (let offset = 0; offset < frontier.length; offset += PATH_FRONTIER_BATCH_SIZE) {
      const ids = frontier.slice(offset, offset + PATH_FRONTIER_BATCH_SIZE);
      const placeholders = ids.map(() => '?').join(',');
      for (const direction of ['outgoing', 'incoming'] as const) {
        if (++queryCount > PATH_MAX_QUERIES) return { exhausted: true, adjacency };
        const remaining = PATH_MAX_EXAMINED_EDGES - examinedEdges;
        if (remaining <= 0) return { exhausted: true, adjacency };
        const column = direction === 'outgoing' ? 'subject_id' : 'object_ref';
        const neighborColumn = direction === 'outgoing' ? 'object_ref' : 'subject_id';
        const rows = await db
          .prepare(
            `SELECT f.subject_id, f.object_ref, f.predicate
             FROM facts f
             JOIN entities neighbor ON neighbor.id = f.${neighborColumn}
             WHERE f.${column} IN (${placeholders})
             ORDER BY f.${column} COLLATE BINARY, f.predicate COLLATE BINARY,
                      f.subject_id COLLATE BINARY, f.object_ref COLLATE BINARY
             LIMIT ?`,
          )
          .bind(...ids, remaining + 1)
          .all();
        const results = (rows.results || []) as any[];
        examinedEdges += Math.min(results.length, remaining);
        if (results.length > remaining) return { exhausted: true, adjacency };
        for (const row of results) {
          const storedSource = String(row.subject_id);
          const storedTarget = String(row.object_ref);
          adjacency.push({
            current: direction === 'outgoing' ? storedSource : storedTarget,
            neighbor: direction === 'outgoing' ? storedTarget : storedSource,
            predicate: String(row.predicate),
            storedSource,
            storedTarget,
          });
        }
      }
    }
    adjacency.sort((a, b) => {
      const left = [a.current, a.neighbor, a.predicate, a.storedSource, a.storedTarget].join('\0');
      const right = [b.current, b.neighbor, b.predicate, b.storedSource, b.storedTarget].join('\0');
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return { exhausted: false, adjacency };
  };

  const buildPath = (meeting: string): PathSearchResult => {
    const sourceNodes = [meeting];
    const sourceEdges: PathEdge[] = [];
    for (let current = meeting; current !== start;) {
      const parent = sourceParents.get(current)!;
      sourceNodes.push(parent.node);
      sourceEdges.push(parent.edge);
      current = parent.node;
    }
    sourceNodes.reverse();
    sourceEdges.reverse();

    const targetNodes: string[] = [];
    const targetEdges: PathEdge[] = [];
    for (let current = meeting; current !== end;) {
      const parent = targetParents.get(current)!;
      targetNodes.push(parent.node);
      targetEdges.push(parent.edge);
      current = parent.node;
    }
    return {
      status: 'found',
      path: { nodes: [...sourceNodes, ...targetNodes], edges: [...sourceEdges, ...targetEdges] },
    };
  };

  for (let depth = 0; depth < maxDepth; depth++) {
    const fromSource = depth % 2 === 0;
    const frontier = fromSource ? sourceFrontier : targetFrontier;
    if (frontier.length === 0) continue;
    const queried = await queryEdges(frontier);
    if (queried.exhausted) return { status: 'budget_exhausted' };

    const ownVisited = fromSource ? sourceVisited : targetVisited;
    const otherVisited = fromSource ? targetVisited : sourceVisited;
    const ownDepths = fromSource ? sourceDepths : targetDepths;
    const otherDepths = fromSource ? targetDepths : sourceDepths;
    const parents = fromSource ? sourceParents : targetParents;
    const nextFrontier: string[] = [];
    let meeting: string | undefined;
    let meetingDepth = Number.POSITIVE_INFINITY;
    for (const row of queried.adjacency) {
      if (ownVisited.has(row.neighbor)) continue;
      if (sourceVisited.size + targetVisited.size >= PATH_MAX_VISITED) {
        return { status: 'budget_exhausted' };
      }
      ownVisited.add(row.neighbor);
      nextFrontier.push(row.neighbor);
      ownDepths.set(row.neighbor, ownDepths.get(row.current)! + 1);
      parents.set(row.neighbor, {
        node: row.current,
        edge: fromSource
          ? {
              source: row.current,
              target: row.neighbor,
              predicate: row.predicate,
              storedSource: row.storedSource,
              storedTarget: row.storedTarget,
            }
          : {
              source: row.neighbor,
              target: row.current,
              predicate: row.predicate,
              storedSource: row.storedSource,
              storedTarget: row.storedTarget,
            },
      });
      if (otherVisited.has(row.neighbor)) {
        const totalDepth = ownDepths.get(row.neighbor)! + otherDepths.get(row.neighbor)!;
        if (totalDepth < meetingDepth || (totalDepth === meetingDepth && row.neighbor < meeting!)) {
          meeting = row.neighbor;
          meetingDepth = totalDepth;
        }
      }
    }
    if (meeting) return buildPath(meeting);
    if (fromSource) sourceFrontier = nextFrontier;
    else targetFrontier = nextFrontier;
  }

  return { status: 'no_path' };
}

export default app;

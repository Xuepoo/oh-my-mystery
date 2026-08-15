import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type {
  ChronicleTrail,
  EntityDetailResponse,
  EntityNames,
  OmmEntity,
  OmmFact,
  PathfinderResult,
  RecommendationItem,
  SearchResponse,
  SearchResultItem,
} from '@omm/shared';

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

// Turnstile optional protection middleware.
// NOTE: intentionally disabled in production — TURNSTILE_SECRET is not set.
// The frontend does not load the Cloudflare turnstile script. If the secret is
// ever configured, the web app must load the challenge and send
// X-Turnstile-Token (D1DataSource.setTurnstileToken) or all neighbor requests
// will 403 and graph expansion breaks.
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
    const outcome = (await res.json()) as { success: boolean };
    if (!outcome.success) {
      return c.json({ error: 'Turnstile verification failed' }, 403);
    }
  } catch (err) {
    console.error('Turnstile verification error:', err);
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
  const limit = Math.min(Number(c.req.query('limit') || 50), 100);

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
  const rawFactsRows = await c.env.DB.prepare(
    `
    SELECT * FROM facts 
    WHERE ((subject_id = ? AND object_ref IS NOT NULL AND object_ref != '')
       OR (object_ref = ? AND subject_id IS NOT NULL AND subject_id != ''))
       AND predicate NOT IN ('translator', 'publisher', 'publisher_name', 'genre')
       AND (predicate != 'aozora_role' OR object_value = '著者')
    LIMIT ?
  `,
  )
    .bind(id, id, limit)
    .all();

  const rawFacts: OmmFact[] = (rawFactsRows.results || []).map((row: any) => ({
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

  const response: EntityDetailResponse = {
    entity,
    facts,
    recommendations,
  };

  return c.json(response);
});

function normalizeSearchName(name: string): string {
  return (
    name
      // Strip nationality/country brackets: (日), （日）, [日], 【日】, (美), （英）, (日)、, （日）· etc.
      .replace(/^[（([【][日中美英法德俄韩港台欧日\w\s]+[）)\]】][、，,\s·.]*/g, '')
      // Strip roles: 原作：, 作画：, 著：, 译：, 编：
      .replace(/^(原作|作畫|作画|著|编|譯|译|繪|絵|画|イラスト)[：:\s]+/g, '')
      // Replace broken typos like 力イウ -> カイウ
      .replace(/[\u529B]イウ/g, 'カイウ')
      // Strip trailing or leading unclosed brackets and punctuation: (, （, ), ）, 、, ,, ·
      .replace(/^[（([【()\]】、，,·.\s]+|[（([【()\]】、，,·.\s]+$/g, '')
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
  const q = c.req.query('q')?.trim() || '';
  const limit = Math.min(Number(c.req.query('limit') || 8), 20);

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
  const seenNames = new Set<string>();

  for (const row of searchRows) {
    const id = String(row.id);
    if (seenIds.has(id)) continue;

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

    const simpKey = toSimpKey(cleanName);
    const nameKey = `${row.type || 'other'}|${simpKey}`;
    if (seenNames.has(nameKey)) continue;

    seenIds.add(id);
    seenNames.add(nameKey);

    results.push({
      id,
      type: row.type || 'other',
      name: cleanName,
      subtitle,
      score: 1.0,
    });

    if (results.length >= limit) break;
  }

  const response: SearchResponse = {
    query: q,
    results,
  };

  return c.json(response);
});

// 7. Pathfinder: Shortest relational chain between Source and Target
app.get('/api/path', async (c) => {
  const source = c.req.query('source')?.trim();
  const target = c.req.query('target')?.trim();

  if (!source || !target) {
    return c.json({ error: 'Both source and target parameters are required' }, 400);
  }

  if (source === target) {
    const node = await c.env.DB.prepare('SELECT * FROM entities WHERE id = ?').bind(source).first();
    return c.json({
      found: true,
      nodes: node ? [formatEntityRow(node)] : [],
      edges: [],
      hops: 0,
      explanation: '起点与终点为同一实体',
    });
  }

  // Breadth-first pathfinding (Max 5 hops)
  const path = await findShortestPath(c.env.DB, source, target, 5);

  if (!path) {
    const notFound: PathfinderResult = {
      found: false,
      nodes: [],
      edges: [],
      hops: -1,
      explanation: '在限定跳数内未发现直接关联路径',
    };
    return c.json(notFound);
  }

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

  const orderedNodes: OmmEntity[] = path.nodes.map(
    (nid) =>
      nodeMap.get(nid) || {
        id: nid,
        type: 'other',
        names: { labels: { '': nid } },
      },
  );

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

async function findShortestPath(
  db: D1Database,
  start: string,
  end: string,
  maxDepth = 5,
): Promise<{
  nodes: string[];
  edges: { source: string; target: string; predicate: string }[];
} | null> {
  interface QueueItem {
    id: string;
    pathNodes: string[];
    pathEdges: { source: string; target: string; predicate: string }[];
  }

  const queue: QueueItem[] = [{ id: start, pathNodes: [start], pathEdges: [] }];
  const visited = new Set<string>([start]);
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    if (current.pathEdges.length >= maxDepth) continue;

    const rows = await db
      .prepare(
        'SELECT * FROM facts WHERE subject_id = ? OR object_ref = ? OR object_value = ? LIMIT 60',
      )
      .bind(current.id, current.id, current.id)
      .all();

    for (const r of (rows.results || []) as any[]) {
      const neighbor = r.subject_id === current.id ? r.object_ref || r.object_value : r.subject_id;
      if (
        !neighbor ||
        typeof neighbor !== 'string' ||
        !neighbor.trim() ||
        neighbor.startsWith('+')
      ) {
        continue;
      }

      const edge = {
        source: r.subject_id,
        target: r.object_ref || r.object_value,
        predicate: r.predicate,
      };

      if (neighbor === end) {
        return {
          nodes: [...current.pathNodes, neighbor],
          edges: [...current.pathEdges, edge],
        };
      }

      if (!visited.has(neighbor) && current.pathEdges.length + 1 < maxDepth) {
        visited.add(neighbor);
        queue.push({
          id: neighbor,
          pathNodes: [...current.pathNodes, neighbor],
          pathEdges: [...current.pathEdges, edge],
        });
      }
    }
  }

  return null;
}

export default app;

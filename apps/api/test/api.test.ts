import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, SEED_AUTHOR_IDS } from '../src/index';

// Create a D1Database mock wrapper around bun:sqlite
function createMockD1(db: Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...args: any[]) {
          return {
            async first(colName?: string) {
              const stmt = db.query(query);
              const res = stmt.get(...args) as any;
              if (colName && res) return res[colName];
              return res || null;
            },
            async all() {
              const stmt = db.query(query);
              const res = stmt.all(...args);
              return { results: res, success: true, meta: {} };
            },
            async run() {
              const stmt = db.query(query);
              stmt.run(...args);
              return { success: true, meta: {} };
            },
          };
        },
        async first(colName?: string) {
          const stmt = db.query(query);
          const res = stmt.get() as any;
          if (colName && res) return res[colName];
          return res || null;
        },
        async all() {
          const stmt = db.query(query);
          const res = stmt.all();
          return { results: res, success: true, meta: {} };
        },
        async run() {
          const stmt = db.query(query);
          stmt.run();
          return { success: true, meta: {} };
        },
      } as any;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    async batch() {
      return [];
    },
    async exec(query: string) {
      db.run(query);
      return { count: 1, duration: 0 };
    },
  };
}

function names(zh: string, en = zh): string {
  return JSON.stringify({ labels: { zh, en }, aliases: {} });
}

function buildTestDatabase(): Database {
  const db = new Database(':memory:');
  db.run(readFileSync(join(import.meta.dir, '../schema.sql'), 'utf8'));

  const insertEntity = db.prepare(
    'INSERT INTO entities (id, qid, type, names_json, source) VALUES (?, ?, ?, ?, ?)',
  );
  const seedNames: Record<string, string> = {
    'wd:Q35610': '阿瑟·柯南·道尔',
    'wd:Q35064': '阿加莎·克里斯蒂',
    'wd:Q347412': '江户川乱步',
    'wd:Q125970': '东野圭吾',
  };
  for (const [index, id] of SEED_AUTHOR_IDS.entries()) {
    insertEntity.run(
      id,
      id.replace('wd:', ''),
      'author',
      names(seedNames[id] ?? `测试作家${index}`),
      'test',
    );
  }
  insertEntity.run('wd:Q710681', 'Q710681', 'work', names('白夜行'), 'test');
  insertEntity.run('test:publisher', null, 'publisher', names('南海出版公司'), 'test');
  insertEntity.run('test:award', null, 'award', names('测试推理奖'), 'test');
  insertEntity.run('wd:Q586362', 'Q586362', 'author', names('埃勒里·奎因'), 'test');
  insertEntity.run('test:work-2', null, 'work', names('第二部作品'), 'test');

  const insertPublication = db.prepare(
    `INSERT INTO publication_events
      (work_id, publisher_id, translator_ids_json, publication_date, isbn, language, region, edition_type, source, provenance_json, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertPublication.run(
    'wd:Q710681',
    'test:publisher',
    JSON.stringify(['test:translator']),
    '1999-01-01',
    '9780000000001',
    'zh',
    'CN',
    'reprint',
    'test',
    JSON.stringify({ source: 'test' }),
    'edition-1',
  );

  const insertFact = db.prepare(
    'INSERT INTO facts (subject_id, predicate, object_ref, qualifiers_json, source) VALUES (?, ?, ?, ?, ?)',
  );
  insertFact.run('wd:Q347412', 'influenced_by', 'wd:Q35064', null, 'test');
  insertFact.run('wd:Q710681', 'publisher', 'test:publisher', null, 'test');
  insertFact.run('test:work-2', 'publisher', 'test:publisher', null, 'test');
  insertFact.run('test:publisher', 'related_to', 'test:award', null, 'test');
  insertFact.run('wd:Q125970', 'award_received', 'test:award', null, 'test');

  db.prepare(
    'INSERT INTO recommendations (entity_id, target_id, score, reason, rank) VALUES (?, ?, ?, ?, ?)',
  ).run('wd:Q125970', 'wd:Q710681', 1, '代表作品', 1);

  const insertSearch = db.prepare(
    'INSERT INTO search_index (id, type, name_zh, name_en, name_ja, aliases_text) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertFts = db.prepare('INSERT INTO search_fts (id, content) VALUES (?, ?)');
  const searches = [
    ['wd:Q125970', 'author', '东野圭吾', 'Keigo Higashino', '東野圭吾', ''],
    ['wd:Q347412', 'author', '江户川乱步', 'Edogawa Ranpo', '江戸川乱歩', '（日）江户川乱步'],
    ['wd:Q586362', 'author', '埃勒里·奎因', 'Ellery Queen', '', '埃勒里奎因'],
  ];
  for (const row of searches) {
    insertSearch.run(...row);
    insertFts.run(row[0], row.slice(2).join(' '));
  }

  const steps = JSON.stringify(
    Array.from({ length: 4 }, (_, index) => ({
      year: 1920 + index,
      summary: { zh: `步骤${index + 1}` },
    })),
  );
  const insertChronicle = db.prepare(
    'INSERT INTO chronicles (id, slug, title_json, description_json, steps_json) VALUES (?, ?, ?, ?, ?)',
  );
  insertChronicle.run(
    'golden-age-trio',
    'golden-age-trio',
    '{"zh":"黄金时代三巨匠"}',
    '{"zh":"测试"}',
    steps,
  );
  insertChronicle.run(
    'japanese-mystery',
    'japanese-mystery',
    '{"zh":"日本推理"}',
    '{"zh":"测试"}',
    '[]',
  );
  return db;
}

const sqlite = buildTestDatabase();

const mockEnv = {
  DB: createMockD1(sqlite),
};

const protectedEnv = {
  ...mockEnv,
  TURNSTILE_SECRET: 'test-secret',
};

describe('OMM Backend API Endpoints', () => {
  it('rejects protected requests without a Turnstile token', async () => {
    const res = await app.request('/api/path?source=wd:Q347412&target=wd:Q35064', {}, protectedEnv);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Missing challenge token' });
  });

  it('rejects invalid protected query parameters before database work', async () => {
    const res = await app.request('/api/path?source=wd:Q1&target=wd:Q2', {}, protectedEnv);
    expect(res.status).toBe(403);
    const invalidLimit = await app.request('/api/entity/wd:Q347412/neighbors?limit=0', {}, mockEnv);
    expect(invalidLimit.status).toBe(400);
    const invalidCursor = await app.request(
      '/api/entity/wd:Q347412/neighbors?cursor=1:9223372036854775808',
      {},
      mockEnv,
    );
    expect(invalidCursor.status).toBe(400);
    const malformedCursor = await app.request(
      '/api/entity/wd:Q347412/neighbors?cursor=1:not-a-number',
      {},
      mockEnv,
    );
    expect(malformedCursor.status).toBe(400);
    const invalidSearch = await app.request('/api/search?limit=not-a-number', {}, mockEnv);
    expect(invalidSearch.status).toBe(400);
  });

  it('GET /api/health returns ok', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');
  });

  it('GET /api/stats returns dataset statistics', async () => {
    const res = await app.request('/api/stats', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(20);
    expect(body.byType.work).toBeGreaterThanOrEqual(1);
    expect(body.byType.author).toBeGreaterThanOrEqual(15);
    expect(body.byType.award).toBeGreaterThanOrEqual(1);
    expect(body.facts).toBeGreaterThanOrEqual(3);
    expect(body.awards).toBeGreaterThan(0);
  });

  it('GET /api/seeds returns 20+ core master authors', async () => {
    const res = await app.request('/api/seeds', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.seeds.length).toBeGreaterThanOrEqual(15);
    const doyle = body.seeds.find((s: any) => s.id === 'wd:Q35610');
    expect(doyle).toBeDefined();
    expect(doyle.names.labels.zh).toContain('柯南·道尔');
  });

  it('GET /api/entity/:id/neighbors returns 1-hop neighborhood for Edogawa Ranpo', async () => {
    const res = await app.request('/api/entity/wd:Q347412/neighbors', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entity.id).toBe('wd:Q347412');
    expect(body.facts.length).toBeGreaterThan(0);
    expect(body.neighbors.length).toBeGreaterThan(0);
  });

  it('GET /api/entity/:id/neighbors includes publisher neighbors for works', async () => {
    const res = await app.request('/api/entity/wd:Q710681/neighbors', {}, mockEnv); // Byakuyako
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const publishers = (body.neighbors as any[]).filter((n) => n.type === 'publisher');
    expect(publishers.length).toBeGreaterThan(0);
    expect(publishers[0].names.labels.zh).toContain('南海出版公司');
    const publisherFacts = (body.facts as any[]).filter((f) => f.predicate === 'publisher');
    expect(publisherFacts.length).toBeGreaterThan(0);
  });

  it('paginates neighbors with stable non-overlapping cursors and publisher edges first', async () => {
    const first = await app.request('/api/entity/test:publisher/neighbors?limit=1', {}, mockEnv);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as any;
    expect(firstBody.facts).toHaveLength(1);
    expect(firstBody.facts[0].predicate).toBe('publisher');
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).toBeString();

    const second = await app.request(
      `/api/entity/test:publisher/neighbors?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      {},
      mockEnv,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as any;
    expect(secondBody.facts).toHaveLength(1);
    expect(secondBody.facts[0].subject_id).not.toBe(firstBody.facts[0].subject_id);
    expect(secondBody.facts[0].predicate).toBe('publisher');
  });

  it('filters neighbor pages by direction and predicate', async () => {
    const incoming = await app.request(
      '/api/entity/test:publisher/neighbors?direction=in&predicates=publisher',
      {},
      mockEnv,
    );
    expect(incoming.status).toBe(200);
    const incomingBody = (await incoming.json()) as any;
    expect(incomingBody.facts).toHaveLength(2);
    expect(incomingBody.facts.every((fact: any) => fact.predicate === 'publisher')).toBe(true);

    const outgoing = await app.request(
      '/api/entity/test:publisher/neighbors?direction=out&predicates=publisher',
      {},
      mockEnv,
    );
    expect(outgoing.status).toBe(200);
    expect(((await outgoing.json()) as any).facts).toHaveLength(0);
  });

  it('GET /api/entity/:id/details returns recommendations and metadata', async () => {
    const res = await app.request('/api/entity/wd:Q125970/details', {}, mockEnv); // Keigo Higashino
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entity.id).toBe('wd:Q125970');
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations[0].reason).toBeDefined();
  });

  it('GET /api/entity/:id/details returns publication summary', async () => {
    const res = await app.request('/api/entity/wd:Q710681/details', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.publications).toEqual({ count: 1, publisher_ids: ['test:publisher'] });
  });

  it('GET /api/entity/:id/publications returns detailed publication events', async () => {
    const res = await app.request('/api/entity/wd:Q710681/publications', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.work_id).toBe('wd:Q710681');
    expect(body.publications).toHaveLength(1);
    expect(body.publications[0].isbn).toBe('9780000000001');
    expect(body.publications[0].translator_ids).toEqual(['test:translator']);
  });

  it('GET /api/search finds authors by Chinese / English name', async () => {
    const res = await app.request('/api/search?q=东野圭吾', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].id).toBe('wd:Q125970');
  });

  it('GET /api/path finds relational path between two authors', async () => {
    // Path from Edogawa Ranpo to Agatha Christie
    const res = await app.request('/api/path?source=wd:Q347412&target=wd:Q35064', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.found).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(1);
    expect(body.edges.length).toBeGreaterThan(0);
    expect(body.nodes.length).toBe(body.edges.length + 1);
    expect(body.nodes[0].id).toBe('wd:Q347412');
    expect(body.nodes.at(-1).id).toBe('wd:Q35064');
    expect(body.hops).toBe(body.edges.length);
    for (let i = 0; i < body.edges.length; i++) {
      expect(body.edges[i].source).toBe(body.nodes[i].id);
      expect(body.edges[i].target).toBe(body.nodes[i + 1].id);
    }
  });

  it('GET /api/path traverses stored facts in reverse direction', async () => {
    const forward = await app.request('/api/path?source=wd:Q347412&target=wd:Q35064', {}, mockEnv);
    const forwardBody = (await forward.json()) as any;
    const reverse = await app.request('/api/path?source=wd:Q35064&target=wd:Q347412', {}, mockEnv);
    expect(reverse.status).toBe(200);
    const body = (await reverse.json()) as any;
    expect(body.found).toBe(true);
    expect(body.nodes[0].id).toBe('wd:Q35064');
    expect(body.nodes.at(-1).id).toBe('wd:Q347412');
    expect(body.hops).toBe(forwardBody.hops);
    for (let i = 0; i < body.edges.length; i++) {
      expect(body.edges[i].source).toBe(body.nodes[i].id);
      expect(body.edges[i].target).toBe(body.nodes[i + 1].id);
      expect(body.edges[i].storedSource).toBeDefined();
      expect(body.edges[i].storedTarget).toBeDefined();
    }
  });

  it('GET /api/chronicles returns curated storytelling trails', async () => {
    const res = await app.request('/api/chronicles', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0].slug).toBe('golden-age-trio');
    expect(body[0].steps.length).toBe(4);
  });

  // --- Edge Cases Testing ---
  it('Edge Case: GET /api/path with source === target returns 0-hop identity', async () => {
    const res = await app.request('/api/path?source=wd:Q347412&target=wd:Q347412', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.found).toBe(true);
    expect(body.hops).toBe(0);
    expect(body.nodes.length).toBe(1);
    expect(body.edges.length).toBe(0);
  });

  it('Edge Case: GET /api/path rejects unknown endpoints', async () => {
    const same = await app.request(
      '/api/path?source=wd:Q0-not-real&target=wd:Q0-not-real',
      {},
      mockEnv,
    );
    expect(same.status).toBe(404);
    const distinct = await app.request(
      '/api/path?source=wd:Q347412&target=wd:Q0-not-real',
      {},
      mockEnv,
    );
    expect(distinct.status).toBe(404);
  });

  it('Edge Case: GET /api/path with missing parameters returns 400', async () => {
    const res = await app.request('/api/path?source=wd:Q347412', {}, mockEnv);
    expect(res.status).toBe(400);
  });

  it('Edge Case: GET /api/search with empty string or spaces returns empty results gracefully', async () => {
    const res = await app.request('/api/search?q=   ', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results).toEqual([]);
  });

  it('Edge Case: GET /api/search with SQL wildcard characters is handled safely', async () => {
    const res = await app.request('/api/search?q=%25_test%27', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('Edge Case: GET /api/entity/:id/details with non-existent ID returns 404', async () => {
    const res = await app.request('/api/entity/non_existent_12345/details', {}, mockEnv);
    expect(res.status).toBe(404);
  });

  it('GET /api/search cleanly deduplicates author name variants and nationality prefixes', async () => {
    const res = await app.request('/api/search?q=江户川乱步', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.length).toBeGreaterThan(0);
    // Canonical author entity should be top result
    const authorHit = body.results.find((r: any) => r.type === 'author');
    expect(authorHit).toBeDefined();
    expect(authorHit.name).not.toContain('（日）');
    expect(authorHit.name).not.toContain('(');
  });
});

function buildCorruptEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'omm-corrupt-'));
  const dbPath = join(dir, 'corrupt.sqlite');
  const db = new Database(dbPath);
  const schema = readFileSync(join(import.meta.dir, '../schema.sql'), 'utf-8');
  db.run(schema);
  db.run(`
    INSERT INTO entities (id, qid, type, names_json) VALUES
      ('wd:Q1', 'Q1', 'author', '{"labels": {"zh": "测试作者"}, "aliases": {}}'),
      ('wd:Q2', 'Q2', 'work', '{"labels": {"zh": "测试作品"}, "aliases": {}}')
  `);
  db.run(`
    INSERT INTO facts (subject_id, predicate, object_ref, object_value, qualifiers_json, source) VALUES
      ('wd:Q1', 'author', 'wd:Q2', NULL, '{"year": 2000}', 'test'),
      ('wd:Q1', 'award_received', 'wd:Q2', NULL, '{bad json', 'test')
  `);
  db.run(`
    INSERT INTO chronicles (id, slug, title_json, description_json, steps_json) VALUES
      ('good', 'good-slug', '{"zh": "好"}', '{"zh": "描述"}', '[{"year": 1900, "summary": {"zh": "s"}}]'),
      ('bad', 'bad-slug', '{bad', '{bad', '{bad')
  `);
  const env = { DB: createMockD1(db) };
  return { db, dir, env };
}

it('GET /api/search with 3+ char query uses FTS and still returns results', async () => {
  const res = await app.request('/api/search?q=%E4%B8%9C%E9%87%8E%E5%9C%AD%E5%90%BE', {}, mockEnv);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.results.length).toBeGreaterThan(0);
  expect(body.results[0].id).toBe('wd:Q125970');
});

it('GET /api/search matches names typed without middle dots via FTS variants', async () => {
  const res = await app.request(
    '/api/search?q=%E5%9F%83%E5%8B%92%E9%87%8C%E5%A5%8E%E5%9B%A0',
    {},
    mockEnv,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  const ids = body.results.map((r: any) => r.id);
  expect(ids).toContain('wd:Q586362');
});

it('sets Cache-Control headers per route', async () => {
  const chronicles = await app.request('/api/chronicles', {}, mockEnv);
  expect(chronicles.headers.get('cache-control')).toContain('max-age=86400');
  const search = await app.request('/api/search?q=test', {}, mockEnv);
  expect(search.headers.get('cache-control')).toContain('max-age=60');
  const health = await app.request('/api/health', {}, mockEnv);
  expect(health.headers.get('cache-control')).toBe('no-store');
});

describe('Malformed data resilience', () => {
  it('facts with broken qualifiers_json do not 500 neighbors/details', async () => {
    const { env, db, dir } = buildCorruptEnv();
    try {
      const resN = await app.request('/api/entity/wd:Q1/neighbors', {}, env);
      expect(resN.status).toBe(200);
      const bodyN = (await resN.json()) as any;
      const badFact = bodyN.facts.find(
        (f: any) => f.qualifiers === undefined && f.predicate === 'award_received',
      );
      expect(badFact).toBeDefined();

      const resD = await app.request('/api/entity/wd:Q1/details', {}, env);
      expect(resD.status).toBe(200);
      const bodyD = (await resD.json()) as any;
      expect(Array.isArray(bodyD.facts)).toBe(true);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('chronicles list skips corrupt rows, slug endpoint returns 500 JSON', async () => {
    const { env, db, dir } = buildCorruptEnv();
    try {
      const res = await app.request('/api/chronicles', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.length).toBe(1);
      expect(body[0].slug).toBe('good-slug');

      const bad = await app.request('/api/chronicles/bad-slug', {}, env);
      expect(bad.status).toBe(500);
      const badBody = (await bad.json()) as any;
      expect(badBody.error).toBeDefined();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unknown api routes return JSON 404', async () => {
    const res = await app.request('/api/does-not-exist', {}, mockEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });
});

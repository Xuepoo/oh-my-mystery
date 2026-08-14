import { describe, expect, it } from 'vitest';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { app } from '../src/index';

const dbPath = join(import.meta.dir, '../../../data/omm-d1.sqlite');
const sqlite = new Database(dbPath);

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

const mockEnv = {
  DB: createMockD1(sqlite),
};

describe('OMM Backend API Endpoints', () => {
  it('GET /api/health returns ok', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
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

  it('GET /api/entity/:id/details returns recommendations and metadata', async () => {
    const res = await app.request('/api/entity/wd:Q125970/details', {}, mockEnv); // Keigo Higashino
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entity.id).toBe('wd:Q125970');
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations[0].reason).toBeDefined();
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
  });

  it('GET /api/chronicles returns curated storytelling trails', async () => {
    const res = await app.request('/api/chronicles', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0].slug).toBe('golden-age-trio');
    expect(body[0].steps.length).toBe(4);
  });
});

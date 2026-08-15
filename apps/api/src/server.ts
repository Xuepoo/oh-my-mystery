import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { app } from './index';

const dbPath = join(import.meta.dir, '../../../data/omm-d1.sqlite');
const sqlite = new Database(dbPath);

// Create D1Database mock wrapper around local SQLite
function createLocalD1(db: Database): D1Database {
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

const env = {
  DB: createLocalD1(sqlite),
  ENVIRONMENT: 'development',
};

const port = Number(process.env.PORT || 8787);

console.log(`🚀 OMM Local API Server listening on http://localhost:${port}`);

export default {
  port,
  fetch(req: Request) {
    return app.fetch(req, env);
  },
};

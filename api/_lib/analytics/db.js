// Database access for analytics.
// Production: Neon Postgres over HTTP (DATABASE_URL, added by the Vercel Neon integration).
// Local tests and the dashboard's sample data: PGlite, an in-memory Postgres.
import { SCHEMA, ensurePartitions } from './schema.js';

const cache = {};

async function neonDb(url) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return { kind: 'neon', q: (text, params = []) => sql.query(text, params) };
}

async function pgliteDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.waitReady;
  return { kind: 'pglite', q: async (text, params = []) => (await pg.query(text, params)).rows, pg };
}

async function migrate(db) {
  for (const stmt of SCHEMA) await db.q(stmt);
  await ensurePartitions(db, new Date());
}

// The real store. Without DATABASE_URL (local development) it falls back to one shared PGlite instance.
export function realDb() {
  if (!cache.real) {
    cache.real = (async () => {
      // The Neon integration was connected with the ADESSA_ prefix; the plain names work too.
      const url = process.env.DATABASE_URL || process.env.ADESSA_DATABASE_URL || process.env.POSTGRES_URL || process.env.ADESSA_POSTGRES_URL;
      // On Vercel an in-memory store would silently lose data, so refuse instead.
      if (!url && process.env.VERCEL) throw Object.assign(new Error('DATABASE_URL is not set'), { code: 'NO_DB' });
      const db = url ? await neonDb(url) : await pgliteDb();
      await migrate(db);
      return db;
    })().catch((e) => { cache.real = null; throw e; });
  }
  return cache.real;
}

// A throwaway in-memory store for the dashboard's sample data switch. Nothing here is ever saved.
export function sampleDb(seedFn) {
  if (!cache.sample) {
    cache.sample = (async () => {
      const db = await pgliteDb();
      await migrate(db);
      await seedFn(db);
      db.seededAt = Date.now();
      return db;
    })().catch((e) => { cache.sample = null; throw e; });
  }
  return cache.sample;
}

export function resetSampleDb() { cache.sample = null; }

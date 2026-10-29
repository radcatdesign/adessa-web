import { randomId, localDay } from './util.js';

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  excluded_ips: [],          // [{ key, label, added_at }]
  heat_pages: '*',           // '*' for every page, or an array of paths
  benchmark_overrides: {},   // { metricId: { low, high, goal } }
};

let settingsCache = { at: 0, value: null, db: null };

export async function getSettings(db, fresh = false) {
  if (!fresh && settingsCache.db === db && Date.now() - settingsCache.at < 60_000) return settingsCache.value;
  const rows = await db.q(`SELECT key, value FROM analytics_settings`);
  const value = { ...DEFAULT_SETTINGS };
  for (const r of rows) value[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  settingsCache = { at: Date.now(), value, db };
  return value;
}

export async function setSetting(db, key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error('unknown setting');
  await db.q(`INSERT INTO analytics_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
  settingsCache = { at: 0, value: null, db: null };
}

// ---------- daily salt ----------
let saltCache = { day: '', salt: '', db: null };

// The salt is random, used for one day (in the site's time zone, the same days the reports use)
// and then deleted, so a visitor hash can't be linked across days.
export async function todaysSalt(db) {
  const day = localDay();
  if (saltCache.db === db && saltCache.day === day) return saltCache.salt;
  let rows = await db.q(`SELECT salt FROM analytics_salts WHERE day = $1`, [day]);
  if (!rows.length) {
    await db.q(`INSERT INTO analytics_salts (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING`, [day, randomId(32)]);
    rows = await db.q(`SELECT salt FROM analytics_salts WHERE day = $1`, [day]);
  }
  await db.q(`DELETE FROM analytics_salts WHERE day <> $1`, [day]);
  saltCache = { day, salt: rows[0].salt, db };
  return saltCache.salt;
}

// ---------- bot counter ----------
// Requests dropped by the user-agent filter are only counted, per day.
export async function countBot(db, kind) {
  const day = localDay();
  await db.q(`INSERT INTO analytics_daily (day, dim, key, views) VALUES ($1, 'bots', $2, 1)
    ON CONFLICT (day, dim, key) DO UPDATE SET views = analytics_daily.views + 1`, [day, kind]);
}

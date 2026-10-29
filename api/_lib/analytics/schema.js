// Tables for first-party analytics. Every statement is safe to run again.
export const SCHEMA = [
  // One row per page view or action. A page's active time and scroll depth are written onto its view row
  // when the page is left (left = true), so a view and its "leave" live together.
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id bigserial,
    kind text NOT NULL,
    name text,
    label text,
    path text NOT NULL,
    view_id text,
    visit_id text NOT NULL,
    browser_id text,
    visitor_hash text NOT NULL,
    referrer_host text,
    source text,
    utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
    device text, browser text, os text, language text,
    country text, region text, city text,
    active_ms integer NOT NULL DEFAULT 0,
    scroll_pct smallint NOT NULL DEFAULT 0,
    left_page boolean NOT NULL DEFAULT false,
    is_returning boolean,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
  ) PARTITION BY RANGE (created_at)`,
  `CREATE TABLE IF NOT EXISTS analytics_events_default PARTITION OF analytics_events DEFAULT`,
  `CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events (created_at)`,
  `CREATE INDEX IF NOT EXISTS analytics_events_path_idx ON analytics_events (path, created_at)`,
  `CREATE INDEX IF NOT EXISTS analytics_events_visit_idx ON analytics_events (visit_id)`,
  `CREATE INDEX IF NOT EXISTS analytics_events_browser_idx ON analytics_events (browser_id) WHERE browser_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS analytics_events_view_idx ON analytics_events (view_id) WHERE view_id IS NOT NULL`,

  // Who is on the site right now. Rows are removed 30 minutes after they were last seen.
  `CREATE TABLE IF NOT EXISTS analytics_presence (
    key text PRIMARY KEY,
    visit_id text NOT NULL,
    browser_id text,
    path text NOT NULL,
    source text, device text,
    country text, region text, city text, lat real, lon real,
    started_at timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz
  )`,

  // Heatmap counts per page, device, kind (click, move, scroll, el) and grid cell, per day.
  `CREATE TABLE IF NOT EXISTS analytics_heat (
    day date NOT NULL,
    page text NOT NULL,
    device text NOT NULL,
    kind text NOT NULL,
    cell text NOT NULL,
    count integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, page, device, kind, cell)
  )`,

  // Daily totals by dimension (total, page, source, campaign, device, browser, os, language, country,
  // region, action, bots). Rolled up nightly and kept after raw events expire.
  `CREATE TABLE IF NOT EXISTS analytics_daily (
    day date NOT NULL,
    dim text NOT NULL,
    key text NOT NULL,
    views integer NOT NULL DEFAULT 0,
    visitors integer NOT NULL DEFAULT 0,
    visits integer NOT NULL DEFAULT 0,
    bounces integer NOT NULL DEFAULT 0,
    entries integer NOT NULL DEFAULT 0,
    exits integer NOT NULL DEFAULT 0,
    active_ms bigint NOT NULL DEFAULT 0,
    scroll_sum bigint NOT NULL DEFAULT 0,
    scroll_n integer NOT NULL DEFAULT 0,
    actions integer NOT NULL DEFAULT 0,
    returning_visits integer NOT NULL DEFAULT 0,
    known_visits integer NOT NULL DEFAULT 0,
    action_visits integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, dim, key)
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_rollups (day date PRIMARY KEY, rolled_at timestamptz NOT NULL DEFAULT now())`,

  // Today's salt for the daily visitor hash. Yesterday's is deleted when the day turns.
  `CREATE TABLE IF NOT EXISTS analytics_salts (day date PRIMARY KEY, salt text NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS analytics_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,

  `CREATE TABLE IF NOT EXISTS analytics_shots (
    page text NOT NULL, width integer NOT NULL, url text NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (page, width)
  )`,

  // A browser linked to an email after a form submission from that browser.
  `CREATE TABLE IF NOT EXISTS analytics_identities (
    browser_id text PRIMARY KEY, email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];

function monthStart(d, add = 0) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
}
const iso = (d) => d.toISOString().slice(0, 10);
const partName = (d) => `analytics_events_y${d.getUTCFullYear()}m${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// Monthly partitions for this month and next, so new rows never land in the default partition.
export async function ensurePartitions(db, now) {
  for (const add of [0, 1]) {
    const from = monthStart(now, add), to = monthStart(now, add + 1);
    try {
      await db.q(`CREATE TABLE IF NOT EXISTS ${partName(from)} PARTITION OF analytics_events FOR VALUES FROM ('${iso(from)}') TO ('${iso(to)}')`);
    } catch (e) {
      // Rows for this month already sit in the default partition. They still count; leave them there.
      if (!/default partition|would be violated/i.test(String(e.message))) throw e;
    }
  }
}

// Drop whole monthly partitions that end before the cutoff, then trim the remainder row by row.
export async function dropOldPartitions(db, cutoff) {
  const rows = await db.q(`SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'analytics_events'`);
  for (const { name } of rows) {
    const m = /^analytics_events_y(\d{4})m(\d{2})$/.exec(name);
    if (!m) continue;
    const end = new Date(Date.UTC(+m[1], +m[2], 1));
    if (end <= cutoff) await db.q(`DROP TABLE IF EXISTS ${name}`);
  }
  await db.q(`DELETE FROM analytics_events WHERE created_at < $1`, [cutoff.toISOString()]);
}

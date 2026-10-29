// Dashboard API: GET/POST /api/analytics/data?r=<route>. Staff only, except r=config.
import { realDb, sampleDb } from './db.js';
import { staffUser, login, logout, authConfigured } from './auth.js';
import { seedSample, freshenSamplePresence } from './sample.js';
import { getSettings, setSetting } from './store.js';
import { parseRange, rangeRows, chartRows, series, sumBy, list, totals, localDay } from './query.js';
import { live, visitors, visitor, visitLog } from './people.js';
import { heatmap } from './heat.js';
import { benchmarks } from './benchmarks.js';
import { send, readJson, clientIp, ipKey, clip, normPath, TZ } from './util.js';

const AUTO_ACTIONS = new Set(['Email click', 'Phone click', 'Download', 'Outbound link', 'Form submit']);

const pct = (a, b) => (b ? a / b : null);
function pageRow(r) {
  return {
    key: r.key, views: r.views, visitors: r.visitors, entries: r.entries, exits: r.exits,
    avg_active_ms: r.views ? r.active_ms / r.views : null, avg_scroll: r.scroll_n ? r.scroll_sum / r.scroll_n : null,
    bounce_rate: pct(r.bounces, r.entries), exit_rate: pct(r.exits, r.views),
  };
}
function visitRow(r) {
  return { key: r.key, visits: r.visits, visitors: r.visitors, views: r.views, bounce_rate: pct(r.bounces, r.visits), avg_visit_ms: r.visits ? r.active_ms / r.visits : null, actions: r.actions };
}

async function rangeData(db, q) {
  const range = parseRange(q);
  const [rows, prevRows, hourly] = await Promise.all([rangeRows(db, range), rangeRows(db, range, 'previous'), chartRows(db, range)]);
  return { range, dims: sumBy(rows), prev: sumBy(prevRows), chart: series(range, hourly || rows), rows };
}
const rangeOut = (r) => ({ key: r.key, from: r.from, to: r.to, days: r.days, gran: r.gran, tz: TZ, start: r.start, end: r.end });

const ROUTES = {
  async overview(db, q) {
    const { range, dims, prev, chart } = await rangeData(db, q);
    return {
      range: rangeOut(range), totals: totals(dims), prev: totals(prev), chart,
      top: {
        pages: list(dims, 'page', 'views', 8).map(pageRow),
        sources: list(dims, 'source', 'visits', 8).map(visitRow),
        campaigns: list(dims, 'campaign', 'visits', 8).map(visitRow),
        devices: list(dims, 'device', 'visits', 3).map(visitRow),
        countries: list(dims, 'country', 'visits', 8).map(visitRow),
        actions: list(dims, 'action', 'actions', 8).map((r) => ({ key: r.key, count: r.actions, visitors: r.visitors, visits: r.visits })),
      },
      benchmarks: benchmarks(totals(dims), await getSettings(db)),
    };
  },

  async pages(db, q) {
    const { range, dims } = await rangeData(db, q);
    const pages = list(dims, 'page', 'views', 500).map(pageRow);
    const hours = await db.q(`SELECT extract(isodow FROM created_at AT TIME ZONE $3)::int AS dow, extract(hour FROM created_at AT TIME ZONE $3)::int AS hour, count(*)::int AS views
      FROM analytics_events WHERE kind = 'view' AND created_at >= $1 AND created_at < $2 AND (left_page OR created_at > now() - interval '30 minutes')
      GROUP BY 1, 2`, [range.start.toISOString(), range.end.toISOString(), TZ]);
    return {
      range: rangeOut(range), pages,
      landing: [...pages].filter((p) => p.entries).sort((a, b) => b.entries - a.entries).slice(0, 20),
      exits: [...pages].filter((p) => p.exits).sort((a, b) => b.exits - a.exits).slice(0, 20),
      hours,
    };
  },

  async audience(db, q) {
    const { range, dims } = await rangeData(db, q);
    const out = { range: rangeOut(range) };
    for (const d of ['source', 'referrer', 'campaign', 'medium', 'device', 'browser', 'os', 'language', 'country', 'region']) out[d] = list(dims, d, 'visits', 50).map(visitRow);
    out.total_visits = dims.total?.get('all')?.visits || 0;
    return out;
  },

  async actions(db, q) {
    const { range, dims, rows, chart } = await rangeData(db, q);
    const acts = list(dims, 'action', 'actions', 200);
    const trend = {};
    if (range.gran !== 'hour') for (const r of rows) if (r.dim === 'action') (trend[r.key] ||= {})[r.b] = r.actions;
    const pages = await db.q(`SELECT name, path, count(*)::int AS n FROM analytics_events WHERE kind = 'action' AND created_at >= $1 AND created_at < $2
      GROUP BY 1, 2 ORDER BY 3 DESC`, [range.start.toISOString(), range.end.toISOString()]);
    const total = dims.total?.get('all') || { visits: 0 };
    return {
      range: rangeOut(range), total_visits: total.visits,
      actions: acts.map((a) => ({
        key: a.key, count: a.actions, visitors: a.visitors, visits: a.visits, rate: pct(a.visits, total.visits), custom: !AUTO_ACTIONS.has(a.key),
        trend: range.gran === 'hour' ? [] : chart.map((c) => trend[a.key]?.[c.t] || 0),
        pages: pages.filter((p) => p.name === a.key).slice(0, 8).map((p) => ({ path: p.path, count: p.n })),
      })),
      days: chart.map((c) => c.t),
    };
  },

  async action(db, q) {
    const range = parseRange(q);
    const name = clip(q.name, 80);
    if (!name) return { visits: [] };
    const rows = await db.q(`
      WITH hits AS (SELECT DISTINCT visit_id FROM analytics_events WHERE kind = 'action' AND name = $3 AND created_at >= $1 AND created_at < $2 LIMIT 200)
      SELECT e.visit_id, min(e.created_at) AS started, count(*) FILTER (WHERE kind = 'view')::int AS views,
        count(*) FILTER (WHERE kind = 'action' AND name = $3)::int AS hits,
        sum(e.active_ms) FILTER (WHERE kind = 'view')::bigint AS active_ms,
        (array_agg(e.source ORDER BY e.created_at) FILTER (WHERE kind = 'view'))[1] AS source,
        (array_agg(e.device ORDER BY e.created_at) FILTER (WHERE kind = 'view'))[1] AS device,
        (array_agg(e.country ORDER BY e.created_at) FILTER (WHERE kind = 'view'))[1] AS country,
        (array_agg(e.city ORDER BY e.created_at) FILTER (WHERE kind = 'view'))[1] AS city,
        max(e.browser_id) AS browser_id, max(i.email) AS email,
        array_agg(e.label ORDER BY e.created_at) FILTER (WHERE kind = 'action' AND name = $3) AS labels
      FROM analytics_events e JOIN hits USING (visit_id) LEFT JOIN analytics_identities i ON i.browser_id = e.browser_id
      WHERE e.created_at >= $1::timestamptz - interval '1 day' AND e.created_at < $2::timestamptz + interval '1 day'
      GROUP BY e.visit_id ORDER BY started DESC LIMIT 100`, [range.start.toISOString(), range.end.toISOString(), name]);
    return { name, range: rangeOut(range), visits: rows.map((r) => ({ ...r, active_ms: Number(r.active_ms || 0), labels: (r.labels || []).filter(Boolean).slice(0, 3) })) };
  },

  async visit(db, q) { return visitLog(db, clip(q.id, 40)); },
  async live(db) { return live(db); },
  async visitors(db, q) { return visitors(db, parseRange(q), q); },
  async visitor(db, q) { return visitor(db, clip(q.id, 40)); },
  async heat(db, q) { return heatmap(db, parseRange(q), normPath(q.page || '/'), q.device); },

  async settings(db, q, req, ctx) {
    const s = await getSettings(db, true);
    const since = localDay(new Date(Date.now() - 30 * 864e5));
    const bots = await db.q(`SELECT key, sum(views)::int AS hits, sum(visits)::int AS visits FROM analytics_daily WHERE dim = 'bots' AND day >= $1 GROUP BY key`, [since]);
    const liveBots = sumBy(await rangeRows(db, parseRange({ range: '7d' }))).bots?.get('no interaction')?.visits || 0;
    const custom = await db.q(`SELECT name, count(*)::int AS n, max(created_at) AS last FROM analytics_events WHERE kind = 'action' AND created_at > now() - interval '90 days'
      AND name NOT IN ('Email click', 'Phone click', 'Download', 'Outbound link', 'Form submit') GROUP BY 1 ORDER BY 2 DESC LIMIT 50`);
    const oldest = await db.q(`SELECT min(created_at) AS t, count(*)::int AS n FROM analytics_events`);
    const pages = await db.q(`SELECT DISTINCT path FROM analytics_events WHERE kind = 'view' AND created_at > now() - interval '90 days' ORDER BY 1 LIMIT 300`);
    return {
      settings: s, me: ctx.user.email, sample: ctx.sample,
      your_ip: ipKey(clientIp(req)),
      bots: {
        user_agent_30d: bots.find((b) => b.key === 'user agent')?.hits || 0,
        no_interaction_30d: (bots.find((b) => b.key === 'no interaction')?.visits || 0),
        no_interaction_7d_live: liveBots,
      },
      custom_actions: custom, retention_days: 400, oldest_event: oldest[0]?.t || null, event_count: oldest[0]?.n || 0,
      pages: pages.map((p) => p.path), tz: TZ,
    };
  },
};

const WRITES = {
  async exclude_ip(db, body, req) {
    const s = await getSettings(db, true);
    const key = ipKey(clientIp(req));
    if (!key) return { ok: false };
    if (!s.excluded_ips.some((x) => x.key === key)) s.excluded_ips.push({ key, label: clip(body.label, 60) || 'Added from the dashboard', added_at: new Date().toISOString() });
    await setSetting(db, 'excluded_ips', s.excluded_ips);
    return { ok: true, key };
  },
  async remove_ip(db, body) {
    const s = await getSettings(db, true);
    await setSetting(db, 'excluded_ips', s.excluded_ips.filter((x) => x.key !== body.key));
    return { ok: true };
  },
  async heat_pages(db, body) {
    const v = body.value === '*' ? '*' : Array.isArray(body.value) ? [...new Set(body.value.map(normPath))].slice(0, 200) : null;
    if (!v) return { ok: false };
    await setSetting(db, 'heat_pages', v);
    return { ok: true };
  },
  async delete_visitor(db, body) {
    const id = clip(body.browser_id, 40);
    if (!id) return { ok: false };
    const rows = await db.q(`DELETE FROM analytics_events WHERE browser_id = $1 RETURNING 1`, [id]);
    await db.q(`DELETE FROM analytics_presence WHERE browser_id = $1 OR key = $1`, [id]);
    await db.q(`DELETE FROM analytics_identities WHERE browser_id = $1`, [id]);
    return { ok: true, deleted: rows.length };
  },
};

// ---------- CSV export ----------
const EXPORTS = {
  events: `SELECT created_at, kind, name, label, path, visit_id, browser_id, source, referrer_host, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    device, browser, os, language, country, region, city, active_ms, scroll_pct, left_page, is_returning FROM analytics_events
    WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at LIMIT 200000`,
  daily: `SELECT day, dim, key, views, visitors, visits, bounces, entries, exits, active_ms, scroll_sum, scroll_n, actions, returning_visits, known_visits, action_visits
    FROM analytics_daily WHERE day >= ($1::timestamptz AT TIME ZONE '${TZ}')::date AND day < ($2::timestamptz AT TIME ZONE '${TZ}')::date ORDER BY day, dim, key`,
  heat: `SELECT day, page, device, kind, cell, count FROM analytics_heat WHERE day >= $1::date AND day < $2::date ORDER BY day, page`,
  presence: `SELECT key, visit_id, path, source, device, country, region, city, started_at, last_seen, left_at FROM analytics_presence WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL`,
};
function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

// ---------- handler ----------
export async function data(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  try {
    if (q.r === 'config') {
      return send(res, 200, { signIn: authConfigured(), tz: TZ, devAuth: process.env.ANALYTICS_DEV_AUTH === '1' && !process.env.VERCEL });
    }
    if (q.r === 'login' || q.r === 'logout') {
      if (req.method !== 'POST') return send(res, 405);
      const body = q.r === 'login' ? await readJson(req, 4096).catch(() => ({})) : {};
      const { status, ...out } = q.r === 'login' ? login(req, res, body || {}) : logout(req, res);
      return send(res, status, out);
    }
    const user = await staffUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to see analytics.' });
    if (user.denied) return send(res, 403, { error: 'This account is not on the analytics staff list.', email: user.email });
    if (q.r === 'me') return send(res, 200, { email: user.email, name: user.name || user.email });

    const sample = q.sample === '1';
    const db = sample ? await sampleDb(seedSample) : await realDb();
    if (sample && q.r === 'live') await freshenSamplePresence(db);
    const ctx = { user, sample };

    if (req.method === 'POST') {
      if (sample) return send(res, 409, { error: 'Sample data is on. Nothing is saved.' });
      const body = await readJson(req, 16 * 1024);
      const fn = Object.hasOwn(WRITES, body.op) ? WRITES[body.op] : null;
      if (!fn) return send(res, 400, { error: 'Unknown action' });
      return send(res, 200, await fn(db, body, req));
    }
    if (q.r === 'export') {
      const sql = Object.hasOwn(EXPORTS, q.table) ? EXPORTS[q.table] : null;
      if (!sql) return send(res, 400, { error: 'Unknown table' });
      const range = parseRange(q);
      const rows = q.table === 'heat' ? await db.q(sql, [range.from || localDay(range.start), localDayAfter(range.to || localDay(range.end))])
        : await db.q(sql, [range.start.toISOString(), range.end.toISOString()]);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-${q.table}-${range.from || localDay(range.start)}-to-${range.to || localDay(range.end)}${sample ? '-sample' : ''}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.end(csv(rows));
    }
    const route = Object.hasOwn(ROUTES, q.r) ? ROUTES[q.r] : null;
    if (!route) return send(res, 404, { error: 'Unknown report' });
    const out = await route(db, q, req, ctx);
    return send(res, 200, { ...out, sample });
  } catch (e) {
    if (e.code === 'NO_DB') return send(res, 503, { error: 'The analytics database isn\u2019t connected yet. Turn on Sample data to look around.' });
    console.error('analytics data', q.r, e);
    return send(res, 500, { error: 'Something went wrong loading this report.' });
  }
}
function localDayAfter(day) { return new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10); }

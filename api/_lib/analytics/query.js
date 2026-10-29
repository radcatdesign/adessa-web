// Dashboard queries. Every number is defined once, in aggregate(), and the nightly rollup stores the same
// numbers per day in analytics_daily, so long ranges read a few small rows instead of raw events.
import { TZ, localDay } from './util.js';

const DAY = 864e5;

// ---------- time zone helpers ----------
function tzOffset(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
// The instant local midnight starts on a YYYY-MM-DD date in the site's time zone.
export function localMidnight(day, tz = TZ) {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return new Date(t);
}
export { localDay };
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);

// ---------- ranges ----------
const PRESETS = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };

export function parseRange(q, now = new Date()) {
  const today = localDay(now);
  let r = q.range || '30d';
  if (r === '24h') {
    const end = now, start = new Date(now - DAY);
    return { key: r, start, end, prevStart: new Date(start - DAY), prevEnd: start, gran: 'hour', aligned: false, today };
  }
  let from, to;
  if (r === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) {
    from = q.from < q.to ? q.from : q.to; to = q.from < q.to ? q.to : q.from;
    const earliest = addDays(today, -400);
    if (from < earliest) from = earliest;
    if (to > today) to = today;
  } else {
    if (!PRESETS[r]) r = '30d';
    to = today; from = addDays(today, -(PRESETS[r] - 1));
  }
  const days = daysBetween(from, to) + 1;
  const start = localMidnight(from), end = localMidnight(addDays(to, 1));
  const prevFrom = addDays(from, -days), prevTo = addDays(from, -1);
  return {
    key: r, from, to, days, start, end, today,
    prevFrom, prevTo, prevStart: localMidnight(prevFrom), prevEnd: start,
    gran: days <= 2 ? 'hour' : days > 120 ? 'week' : 'day', aligned: true,
  };
}

// ---------- the one aggregate ----------
const METRICS = ['views', 'visitors', 'visits', 'bounces', 'entries', 'exits', 'active_ms', 'scroll_sum', 'scroll_n', 'actions', 'returning_visits', 'known_visits', 'action_visits'];
const visitDim = (dim, keyExpr) => `
  SELECT b, '${dim}' AS dim, ${keyExpr} AS key, sum(views) AS views, count(DISTINCT vkey) AS visitors, count(*) AS visits,
    count(*) FILTER (WHERE bounced) AS bounces, 0 AS entries, 0 AS exits, sum(active_ms) AS active_ms, 0 AS scroll_sum, 0 AS scroll_n,
    sum(actions) AS actions, count(*) FILTER (WHERE is_returning) AS returning_visits, count(*) FILTER (WHERE is_returning IS NOT NULL) AS known_visits,
    count(*) FILTER (WHERE actions > 0) AS action_visits
  FROM good WHERE ${keyExpr} IS NOT NULL GROUP BY 1, 3`;

/**
 * Totals per bucket ('day', 'hour' or 'all') and dimension for visits that started in [start, end).
 * Definitions:
 *  - a visit is one visit_id (one tab; renewed after 30 minutes without a page view or action);
 *  - a visit counts only if it sent a leave beacon or an action, or is still under 30 minutes old;
 *    the rest are "likely bots" (dim 'bots', key 'no interaction');
 *  - a bounce is a visit with one page, no action and under 10 seconds of active time;
 *  - visitors are unique per day (daily hash), added up across days.
 */
export async function aggregate(db, start, end, bucket = 'day', tz = TZ) {
  const b = bucket === 'hour' ? `to_char(started AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24')`
    : bucket === 'day' ? `to_char(started AT TIME ZONE $3, 'YYYY-MM-DD')` : `'all'`;
  const sql = `
  WITH ev AS (
    -- Read a day past the end too, so a visit that starts before the end keeps its later pages.
    SELECT * FROM analytics_events WHERE created_at >= ($1::timestamptz - interval '1 day') AND created_at < ($2::timestamptz + interval '1 day')
  ), w AS (
    -- One pass with window functions: every event carries its visit's facts, no joins needed.
    SELECT ev.*,
      min(created_at) OVER v AS started, max(created_at) OVER v AS last_at,
      count(*) FILTER (WHERE kind = 'view') OVER v AS v_views, count(*) FILTER (WHERE kind = 'action') OVER v AS v_actions,
      coalesce(sum(active_ms) FILTER (WHERE kind = 'view') OVER v, 0) AS v_active, bool_or(left_page) OVER v AS v_left,
      row_number() OVER fv AS rn, first_value(path) OVER fv AS entry, first_value(visitor_hash) OVER fv AS v_hash,
      first_value(path) OVER (PARTITION BY visit_id ORDER BY (kind <> 'view'), created_at DESC, id DESC) AS exit_page
    FROM ev
    WINDOW v AS (PARTITION BY visit_id), fv AS (PARTITION BY visit_id ORDER BY (kind <> 'view'), created_at, id)
  ), x AS (
    SELECT *, (v_left OR v_actions > 0 OR last_at > now() - interval '30 minutes') AS valid,
      (v_left AND v_views = 1 AND v_actions = 0 AND v_active < 10000) AS bounced,
      ${b} AS b, to_char(started AT TIME ZONE $3, 'YYYY-MM-DD') || v_hash AS vkey
    FROM w WHERE started >= $1::timestamptz AND started < $2::timestamptz AND v_views > 0
  ), vv AS (
    SELECT visit_id, started, v_views AS views, v_actions AS actions, v_active AS active_ms, valid, bounced, b, vkey, entry, exit_page,
      source, referrer_host, utm_campaign AS campaign, utm_medium AS medium, device, browser, os, language, country, region, is_returning
    FROM x WHERE rn = 1
  ), good AS (SELECT * FROM vv WHERE valid),
  pv AS (SELECT path, active_ms, scroll_pct, left_page, b, vkey FROM x WHERE kind = 'view' AND valid),
  act AS (SELECT name, visit_id, b, vkey FROM x WHERE kind = 'action' AND valid),
  rows AS (
    ${visitDim('total', `'all'`)}
    UNION ALL ${visitDim('source', 'source')}
    UNION ALL ${visitDim('referrer', 'referrer_host')}
    UNION ALL ${visitDim('campaign', 'campaign')}
    UNION ALL ${visitDim('medium', 'medium')}
    UNION ALL ${visitDim('device', 'device')}
    UNION ALL ${visitDim('browser', 'browser')}
    UNION ALL ${visitDim('os', 'os')}
    UNION ALL ${visitDim('language', 'language')}
    UNION ALL ${visitDim('country', 'country')}
    UNION ALL ${visitDim('region', `CASE WHEN region IS NOT NULL THEN country || ' / ' || region END`)}
    UNION ALL SELECT b, 'page', path, count(*), count(DISTINCT vkey), 0, 0, 0, 0, sum(active_ms), sum(scroll_pct) FILTER (WHERE left_page),
      count(*) FILTER (WHERE left_page), 0, 0, 0, 0 FROM pv GROUP BY 1, 3
    UNION ALL SELECT b, 'page', entry, 0, 0, count(*), count(*) FILTER (WHERE bounced), count(*), 0, 0, 0, 0, 0, 0, 0, 0 FROM good GROUP BY 1, 3
    UNION ALL SELECT b, 'page', exit_page, 0, 0, 0, 0, 0, count(*), 0, 0, 0, 0, 0, 0, 0 FROM good GROUP BY 1, 3
    UNION ALL SELECT b, 'action', name, 0, count(DISTINCT vkey), count(DISTINCT visit_id), 0, 0, 0, 0, 0, 0, count(*), 0, 0, count(DISTINCT visit_id) FROM act GROUP BY 1, 3
    UNION ALL SELECT b, 'bots', 'no interaction', 0, 0, count(*), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 FROM vv WHERE NOT valid GROUP BY 1
  )
  SELECT b, dim, key, ${METRICS.map((m) => `sum(${m})::bigint AS ${m}`).join(', ')} FROM rows GROUP BY b, dim, key`;
  const rows = await db.q(sql, [start.toISOString(), end.toISOString(), tz]);
  return rows.map(numify);
}

function numify(r) {
  const o = { b: r.b ?? (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10)), dim: r.dim, key: r.key };
  for (const m of METRICS) o[m] = Number(r[m] || 0);
  return o;
}

// ---------- daily rows: rolled days from analytics_daily, the rest computed live ----------
export async function dailyRows(db, from, to) {
  const rolled = new Set((await db.q(`SELECT to_char(day, 'YYYY-MM-DD') AS d FROM analytics_rollups WHERE day BETWEEN $1 AND $2`, [from, to])).map((r) => r.d));
  const out = [];
  if (rolled.size) {
    const rows = await db.q(`SELECT to_char(day, 'YYYY-MM-DD') AS b, dim, key, ${METRICS.join(', ')} FROM analytics_daily
      WHERE day BETWEEN $1 AND $2 AND dim <> 'bots' OR (day BETWEEN $1 AND $2 AND dim = 'bots' AND key = 'no interaction')`, [from, to]);
    for (const r of rows) if (rolled.has(r.b)) out.push(numify(r));
  }
  // Contiguous runs of days without a rollup are computed from raw events in one pass each.
  let runStart = null;
  const days = daysBetween(from, to) + 1;
  for (let i = 0; i <= days; i++) {
    const d = i < days ? addDays(from, i) : null;
    const missing = d && !rolled.has(d);
    if (missing && runStart === null) runStart = d;
    if (!missing && runStart !== null) {
      const runEnd = addDays(from, i - 1);
      out.push(...(await aggregate(db, localMidnight(runStart), localMidnight(addDays(runEnd, 1)), 'day')));
      runStart = null;
    }
  }
  return out;
}

// ---------- shaping ----------
export function sumBy(rows) {
  const dims = {};
  for (const r of rows) {
    const d = (dims[r.dim] ||= new Map());
    const cur = d.get(r.key) || Object.fromEntries(METRICS.map((m) => [m, 0]));
    for (const m of METRICS) cur[m] += r[m];
    d.set(r.key, cur);
  }
  return dims;
}

export function list(dims, dim, sortBy = 'visits', limit = 10) {
  const m = dims[dim];
  if (!m) return [];
  return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b[sortBy] - a[sortBy] || String(a.key).localeCompare(String(b.key))).slice(0, limit);
}

export function totals(dims) {
  const t = dims.total?.get('all') || Object.fromEntries(METRICS.map((m) => [m, 0]));
  return {
    visitors: t.visitors, views: t.views, visits: t.visits, actions: t.actions,
    bounce_rate: t.visits ? t.bounces / t.visits : null,
    avg_visit_ms: t.visits ? t.active_ms / t.visits : null,
    pages_per_visit: t.visits ? t.views / t.visits : null,
    returning_visits: t.returning_visits, new_visits: t.known_visits - t.returning_visits, unknown_visits: t.visits - t.known_visits,
    returning_share: t.known_visits ? t.returning_visits / t.known_visits : null,
    action_visits: t.action_visits, action_rate: t.visits ? t.action_visits / t.visits : null,
    form_visits: dims.action?.get('Form submit')?.visits || 0,
    form_rate: t.visits ? (dims.action?.get('Form submit')?.visits || 0) / t.visits : null,
  };
}

// Range rows for a parsed range: hourly ranges and 24h are always live; day ranges use rollups.
export async function rangeRows(db, range, which = 'current') {
  const cur = which === 'current';
  const start = cur ? range.start : range.prevStart, end = cur ? range.end : range.prevEnd;
  if (!range.aligned) return aggregate(db, start, end, 'all');
  return dailyRows(db, cur ? range.from : range.prevFrom, cur ? range.to : range.prevTo);
}

export async function chartRows(db, range) {
  if (range.gran === 'hour') {
    const rows = await aggregate(db, range.start, range.end, 'hour');
    return rows.filter((r) => r.dim === 'total');
  }
  return null; // day ranges chart from rangeRows
}

// Buckets with zeros filled in, so a chart never skips a quiet day.
export function series(range, rows) {
  const map = new Map(rows.filter((r) => r.dim === 'total').map((r) => [r.b, r]));
  const out = [];
  if (range.gran === 'hour') {
    const startHour = Math.floor(range.start / 36e5) * 36e5;
    for (let t = startHour; t < range.end; t += 36e5) {
      const key = hourKey(new Date(t));
      const r = map.get(key);
      out.push({ t: key, visitors: r?.visitors || 0, views: r?.views || 0, visits: r?.visits || 0 });
    }
    return out;
  }
  for (let i = 0; i < range.days; i++) {
    const d = addDays(range.from, i), r = map.get(d);
    out.push({ t: d, visitors: r?.visitors || 0, views: r?.views || 0, visits: r?.visits || 0 });
  }
  if (range.gran === 'week') {
    const weeks = [];
    for (let i = 0; i < out.length; i += 7) {
      const chunk = out.slice(i, i + 7);
      weeks.push({ t: chunk[0].t, visitors: chunk.reduce((s, x) => s + x.visitors, 0), views: chunk.reduce((s, x) => s + x.views, 0), visits: chunk.reduce((s, x) => s + x.visits, 0) });
    }
    return weeks;
  }
  return out;
}
function hourKey(date, tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

// ---------- rollup ----------
export async function rollupDay(db, day) {
  const rows = await aggregate(db, localMidnight(day), localMidnight(addDays(day, 1)), 'day');
  await db.q(`DELETE FROM analytics_daily WHERE day = $1 AND NOT (dim = 'bots' AND key = 'user agent')`, [day]);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const params = [];
    const values = chunk.map((r, j) => {
      const base = j * (METRICS.length + 3);
      params.push(day, r.dim, String(r.key).slice(0, 300), ...METRICS.map((m) => r[m]));
      return `(${Array.from({ length: METRICS.length + 3 }, (_, k) => `$${base + k + 1}`).join(',')})`;
    });
    await db.q(`INSERT INTO analytics_daily (day, dim, key, ${METRICS.join(', ')}) VALUES ${values.join(',')}
      ON CONFLICT (day, dim, key) DO UPDATE SET ${METRICS.map((m) => `${m} = EXCLUDED.${m}`).join(', ')}`, params);
  }
  await db.q(`INSERT INTO analytics_rollups (day, rolled_at) VALUES ($1, now()) ON CONFLICT (day) DO UPDATE SET rolled_at = now()`, [day]);
  return rows.length;
}

// Days are final once they are two days old; roll up every final day that has events and no rollup yet.
export async function rollupPending(db, maxDays = 30) {
  const lastFinal = addDays(localDay(), -2);
  const firstRow = await db.q(`SELECT min(created_at) AS t FROM analytics_events`);
  if (!firstRow[0]?.t) return [];
  let d = localDay(new Date(firstRow[0].t));
  const floor = addDays(localDay(), -400);
  if (d < floor) d = floor;
  const rolled = new Set((await db.q(`SELECT to_char(day, 'YYYY-MM-DD') AS d FROM analytics_rollups WHERE day >= $1`, [d])).map((r) => r.d));
  const done = [];
  for (; d <= lastFinal && done.length < maxDays; d = addDays(d, 1)) {
    if (rolled.has(d)) continue;
    await rollupDay(db, d);
    done.push(d);
  }
  return done;
}

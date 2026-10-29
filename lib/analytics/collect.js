// Collection endpoints. The browser reports what happened; the server decides who is a bot, which visitor
// and visit the event belongs to, and where it came from.
import { realDb } from './db.js';
import { getSettings, todaysSalt, countBot } from './store.js';
import {
  header, clientIp, geo, readJson, sameOrigin, rateLimited, send, isBotUa, parseUa,
  sourceFor, clip, normPath, sha, ipKey, utcDay,
} from './util.js';

const DEVICES = new Set(['phone', 'tablet', 'desktop']);
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const id = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);

async function guard(req, res, maxBytes, perMinute) {
  if (req.method !== 'POST') { send(res, 405); return null; }
  if (!sameOrigin(req)) { send(res, 403); return null; }
  const ip = clientIp(req);
  if (rateLimited(ip, perMinute)) { send(res, 429); return null; }
  let body;
  try { body = await readJson(req, maxBytes); } catch { send(res, 413); return null; }
  if (!body || typeof body !== 'object') { send(res, 400); return null; }
  const db = await realDb();
  const ua = header(req, 'user-agent');
  // Browsers driven by automation report navigator.webdriver; the script passes it on as `wd`.
  if (isBotUa(ua) || body.wd) { await countBot(db, 'user agent').catch(() => {}); send(res, 204); return null; }
  const settings = await getSettings(db);
  const key = ipKey(ip);
  if (settings.excluded_ips.some((x) => x.key === key)) { send(res, 204); return null; }
  // Global Privacy Control sent as a header: never keep a browser ID.
  if (header(req, 'sec-gpc') === '1') body.b = null;
  return { db, body, ua, ip, settings };
}

function externalHost(ref, req) {
  if (typeof ref !== 'string' || !ref) return null;
  try {
    const host = new URL(ref).host.toLowerCase();
    const own = [header(req, 'host'), header(req, 'x-forwarded-host')].filter(Boolean);
    const extra = (process.env.ANALYTICS_ORIGINS || '').split(',').map((s) => s.trim().replace(/^https?:\/\//, '')).filter(Boolean);
    if (own.includes(host) || extra.includes(host)) return null;
    return host.slice(0, 120);
  } catch { return null; }
}

async function insertView(ctx, req) {
  const { db, body, ua, ip } = ctx;
  const visit = id(body.v), view = id(body.id);
  if (!visit || !view) return;
  const salt = await todaysSalt(db);
  const visitorHash = sha(salt + ip + ua).slice(0, 24);
  const u = body.u && typeof body.u === 'object' ? body.u : {};
  const refHost = externalHost(body.r, req);
  const utm = {
    source: clip(u.utm_source, 100), medium: clip(u.utm_medium, 100), campaign: clip(u.utm_campaign, 150),
    term: clip(u.utm_term, 150), content: clip(u.utm_content, 150),
  };
  const { browser, os } = parseUa(ua);
  const g = geo(req);
  await db.q(
    `INSERT INTO analytics_events (kind, path, view_id, visit_id, browser_id, visitor_hash, referrer_host, source,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content, device, browser, os, language,
      country, region, city, is_returning)
     VALUES ('view',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [normPath(body.p), view, visit, id(body.b), visitorHash, refHost, sourceFor(refHost, utm.source, clip(u.ref, 60)),
      utm.source, utm.medium, utm.campaign, utm.term, utm.content,
      DEVICES.has(body.dv) ? body.dv : 'desktop', browser, os, clip(body.l, 12),
      g.country, g.region, g.city, id(body.b) ? body.ret === true : null],
  );
}

async function updateLeave(ctx) {
  const { db, body } = ctx;
  const view = id(body.id);
  if (!view) return;
  const active = Math.max(0, Math.min(6 * 3600_000, Math.round(+body.a || 0)));
  const scroll = Math.max(0, Math.min(100, Math.round(+body.s || 0)));
  // Leave beacons repeat (each time the tab is hidden) with running totals, so keep the largest values.
  await db.q(
    `UPDATE analytics_events SET left_page = true, active_ms = GREATEST(active_ms, $2), scroll_pct = GREATEST(scroll_pct, $3)
     WHERE view_id = $1 AND kind = 'view' AND created_at > now() - interval '2 days'`,
    [view, active, scroll],
  );
}

async function insertAction(ctx) {
  const { db, body } = ctx;
  const visit = id(body.v), name = clip(body.n, 80);
  if (!visit || !name) return;
  // Copy visitor details from the visit's latest view, so an action never needs its own lookup.
  const rows = await db.q(
    `SELECT visitor_hash, browser_id, source, device, browser, os, language, country, region, city, is_returning
     FROM analytics_events WHERE visit_id = $1 AND kind = 'view' AND created_at > now() - interval '1 day'
     ORDER BY created_at DESC LIMIT 1`, [visit]);
  if (!rows.length) return;
  const v = rows[0];
  await db.q(
    `INSERT INTO analytics_events (kind, name, label, path, visit_id, browser_id, visitor_hash, source, device, browser, os,
      language, country, region, city, is_returning)
     VALUES ('action',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [name, clip(body.lb, 200), normPath(body.p), visit, v.browser_id, v.visitor_hash, v.source, v.device, v.browser, v.os,
      v.language, v.country, v.region, v.city, v.is_returning],
  );
}

const CELL_RE = /^\d{1,2}\.\d{1,4}$/;
const SEL_RE = /^[a-z0-9 >._#:-]{1,120}$/i;

async function addHeat(ctx) {
  const { db, body, settings } = ctx;
  const page = normPath(body.p);
  const pages = settings.heat_pages;
  if (pages !== '*' && !(Array.isArray(pages) && pages.includes(page))) return;
  const device = DEVICES.has(body.dv) ? body.dv : 'desktop';
  const day = utcDay();
  const rows = [];
  const take = (obj, kind, re, limit) => {
    if (!obj || typeof obj !== 'object') return;
    let n = 0;
    for (const [cell, c] of Object.entries(obj)) {
      if (n++ >= limit) break;
      const count = Math.min(500, Math.max(0, Math.round(+c || 0)));
      if (count && re.test(cell)) rows.push([kind, cell, count]);
    }
  };
  take(body.c, 'click', CELL_RE, 300);
  take(body.m, 'move', CELL_RE, 600);
  take(body.e, 'el', SEL_RE, 50);
  if (Number.isFinite(+body.s) && body.s !== null) rows.push(['scroll', String(Math.max(0, Math.min(100, Math.round(+body.s / 5) * 5))), 1]);
  if (!rows.length) return;
  // One statement for the whole batch.
  const values = [], params = [day, page, device];
  rows.forEach(([k, cell, count], i) => {
    values.push(`($1,$2,$3,$${4 + i * 3},$${5 + i * 3},$${6 + i * 3}::int)`);
    params.push(k, cell, count);
  });
  await db.q(`INSERT INTO analytics_heat (day, page, device, kind, cell, count) VALUES ${values.join(',')}
    ON CONFLICT (day, page, device, kind, cell) DO UPDATE SET count = analytics_heat.count + EXCLUDED.count`, params);
}

async function identify(ctx) {
  const { db, body } = ctx;
  const browser = id(body.b), email = clip(body.email, 200);
  if (!browser || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  await db.q(`INSERT INTO analytics_identities (browser_id, email) VALUES ($1, lower($2))
    ON CONFLICT (browser_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`, [browser, email]);
}

export async function collect(req, res) {
  try {
    const ctx = await guard(req, res, 24 * 1024, 240);
    if (!ctx) return;
    const k = ctx.body.k;
    if (k === 'view') await insertView(ctx, req);
    else if (k === 'leave') await updateLeave(ctx);
    else if (k === 'action') await insertAction(ctx);
    else if (k === 'heat') await addHeat(ctx);
    else if (k === 'id') await identify(ctx);
    send(res, 204);
  } catch (e) {
    console.error('analytics collect', e);
    send(res, 204); // never surface errors to the page
  }
}

export async function presence(req, res) {
  try {
    const ctx = await guard(req, res, 4 * 1024, 120);
    if (!ctx) return;
    const { db, body } = ctx;
    const visit = id(body.v), browser = id(body.b);
    const key = browser || visit;
    if (!key) return send(res, 204);
    if (body.t === 'gone') {
      await db.q(`UPDATE analytics_presence SET left_at = now(), last_seen = now() WHERE key = $1`, [key]);
      return send(res, 204);
    }
    const g = geo(req);
    // Source and start come from the visit's first view.
    const first = await db.q(`SELECT source, created_at FROM analytics_events WHERE visit_id = $1 AND kind = 'view'
      AND created_at > now() - interval '1 day' ORDER BY created_at LIMIT 1`, [visit]);
    await db.q(
      `INSERT INTO analytics_presence (key, visit_id, browser_id, path, source, device, country, region, city, lat, lon, started_at, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now()), now())
       ON CONFLICT (key) DO UPDATE SET visit_id = EXCLUDED.visit_id, path = EXCLUDED.path, last_seen = now(), left_at = NULL,
         device = EXCLUDED.device, source = COALESCE(EXCLUDED.source, analytics_presence.source),
         started_at = CASE WHEN analytics_presence.visit_id = EXCLUDED.visit_id THEN analytics_presence.started_at ELSE EXCLUDED.started_at END`,
      [key, visit, browser, normPath(body.p), first[0]?.source || null, DEVICES.has(body.dv) ? body.dv : 'desktop',
        g.country, g.region, g.city, g.lat, g.lon, first[0]?.created_at || null],
    );
    send(res, 204);
  } catch (e) {
    console.error('analytics presence', e);
    send(res, 204);
  }
}

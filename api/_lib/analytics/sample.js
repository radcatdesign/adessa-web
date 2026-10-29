// Made-up traffic for the dashboard's sample data switch. It lives only in an in-memory database.
import { localDay, localMidnight, addDays } from './query.js';
import HOTSPOTS from './sample-hotspots.js';

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, items) => {
  let x = r() * items.reduce((s, i) => s + i[1], 0);
  for (const [v, w] of items) { if ((x -= w) <= 0) return v; }
  return items[items.length - 1][0];
};
const id = (r, n = 12) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(r() * 62)]).join('');

export const SAMPLE_PAGES = ['/', '/miami-showroom', '/investors', '/miami', '/phl', '/privacy-policy', '/detail_team'];
const NEXT = {
  '/': [['/miami', 3], ['/investors', 2], ['/phl', 2], ['/privacy-policy', 0.3], ['/detail_team', 1]],
  '/miami': [['/', 2], ['/phl', 1], ['/investors', 1]],
  '/phl': [['/', 2], ['/miami', 1]],
  '/investors': [['/miami-showroom', 2], ['/', 1], ['/detail_team', 1]],
  '/miami-showroom': [['/investors', 1], ['/', 1]],
  '/detail_team': [['/', 1], ['/investors', 1]],
  '/privacy-policy': [['/', 1]],
};
const SOURCES = [
  [{ source: 'Direct' }, 34], [{ source: 'Google', ref: 'www.google.com' }, 24], [{ source: 'Instagram', ref: 'l.instagram.com' }, 14],
  [{ source: 'newsletter', utm: ['newsletter', 'email', 'oct-brief'] }, 7], [{ source: 'LinkedIn', ref: 'www.linkedin.com' }, 6],
  [{ source: 'ChatGPT', ref: 'chatgpt.com' }, 3], [{ source: 'Facebook', ref: 'm.facebook.com' }, 3], [{ source: 'Bing', ref: 'www.bing.com' }, 2],
  [{ source: 'instagram', utm: ['instagram', 'social', 'miami-popup'] }, 4], [{ source: 'wellnessweekly.com', ref: 'wellnessweekly.com' }, 1.5],
  [{ source: 'X', ref: 't.co' }, 1.5],
];
const PLACES = [
  [['US', 'FL', 'Miami', 25.8, -80.2], 30], [['US', 'NY', 'New York', 40.7, -74], 14], [['US', 'CA', 'Los Angeles', 34.1, -118.2], 9],
  [['US', 'TX', 'Austin', 30.3, -97.7], 5], [['US', 'PA', 'Philadelphia', 40, -75.2], 6], [['US', 'IL', 'Chicago', 41.9, -87.6], 4],
  [['US', 'FL', 'Fort Lauderdale', 26.1, -80.1], 6], [['US', 'OR', 'Bend', 44.1, -121.3], 2], [['US', 'GA', 'Atlanta', 33.7, -84.4], 3],
  [['CA', 'ON', 'Toronto', 43.7, -79.4], 3], [['GB', 'ENG', 'London', 51.5, -0.1], 3], [['MX', 'CMX', 'Mexico City', 19.4, -99.1], 2],
  [['BR', 'SP', 'São Paulo', -23.5, -46.6], 1.5], [['DE', 'BE', 'Berlin', 52.5, 13.4], 1], [['AE', 'DU', 'Dubai', 25.2, 55.3], 1],
];
const EU = new Set(['GB', 'DE']);
const DEVICE = [['phone', 58], ['desktop', 34], ['tablet', 8]];
const ENV = {
  phone: [[['Safari', 'iOS'], 62], [['Chrome', 'Android'], 30], [['Samsung Internet', 'Android'], 5], [['Chrome', 'iOS'], 3]],
  tablet: [[['Safari', 'iPadOS'], 80], [['Chrome', 'Android'], 20]],
  desktop: [[['Chrome', 'macOS'], 38], [['Safari', 'macOS'], 22], [['Chrome', 'Windows'], 26], [['Edge', 'Windows'], 8], [['Firefox', 'Windows'], 4], [['Firefox', 'Linux'], 2]],
};
const LANG = [['en-US', 84], ['es-US', 6], ['en-GB', 4], ['pt-BR', 2], ['es-MX', 2], ['de-DE', 1], ['fr-FR', 1]];
const NAMES = ['jordan.lee', 'sam.rivera', 'alex.chen', 'maria.gomez', 'taylor.brooks', 'chris.patel', 'dana.kim', 'morgan.ellis'];

const COLS = ['kind', 'name', 'label', 'path', 'view_id', 'visit_id', 'browser_id', 'visitor_hash', 'referrer_host', 'source', 'utm_source', 'utm_medium', 'utm_campaign',
  'device', 'browser', 'os', 'language', 'country', 'region', 'city', 'active_ms', 'scroll_pct', 'left_page', 'is_returning', 'created_at'];
const TYPES = { active_ms: 'int[]', scroll_pct: 'smallint[]', left_page: 'boolean[]', is_returning: 'boolean[]', created_at: 'timestamptz[]' };

export async function seedSample(db, days = 400) {
  const r = rng(20261028);
  const cols = Object.fromEntries(COLS.map((c) => [c, []]));
  const DEF = { active_ms: 0, scroll_pct: 0, left_page: false };
  const push = (row) => { for (const c of COLS) cols[c].push(row[c] ?? DEF[c] ?? null); };
  const people = []; // returning browsers
  const now = Date.now();
  const today = localDay();
  const presence = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const dayStart = localMidnight(day).getTime();
    const dow = new Date(day + 'T12:00:00Z').getUTCDay();
    const growth = 0.45 + 0.55 * ((days - i) / days);
    const weekly = [0.72, 1.05, 1.1, 1.08, 1.02, 0.95, 0.8][dow];
    const spike = Math.max(0, 1 - Math.abs(i - 60) / 6) * 2.6 + Math.max(0, 1 - Math.abs(i - 12) / 4) * 1.3;
    let visits = Math.round(58 * growth * weekly * (1 + spike) * (0.8 + r() * 0.4));
    if (i === 0) visits = Math.round(visits * Math.min(1, (now - dayStart) / 864e5 + 0.05));
    const hashes = new Map();
    for (let v = 0; v < visits; v++) {
      const place = pick(r, PLACES);
      const device = pick(r, DEVICE);
      const [browser, os] = pick(r, ENV[device]);
      const noId = EU.has(place[0]) || r() < 0.08;
      let person = null, returning = null;
      if (!noId) {
        if (people.length && r() < 0.27) { person = people[Math.floor(Math.pow(r(), 1.6) * people.length)]; returning = true; }
        else { person = { id: id(r), device, browser, os, place }; people.push(person); returning = false; }
      }
      const who = person || { device, browser, os, place };
      const src = pick(r, SOURCES);
      // Hour of day: evenings and lunch are busier.
      const hour = pick(r, Array.from({ length: 24 }, (_, h) => [h, h < 6 ? 0.25 : h < 9 ? 0.8 : h < 12 ? 1.2 : h < 14 ? 1.5 : h < 18 ? 1.2 : h < 22 ? 1.7 : 0.7]));
      let t = dayStart + hour * 36e5 + Math.floor(r() * 36e5);
      if (t > now - 60_000) t = now - Math.floor(r() * 3 * 36e5) - 60_000;
      const visitId = id(r);
      const hashKey = person ? person.id : visitId;
      if (!hashes.has(hashKey)) hashes.set(hashKey, id(r, 24));
      const base = {
        visit_id: visitId, browser_id: person ? person.id : null, visitor_hash: hashes.get(hashKey), device: who.device, browser: who.browser, os: who.os,
        language: pick(r, LANG), country: who.place[0], region: who.place[1], city: who.place[2], is_returning: returning,
      };
      // Bots that slipped past the user-agent filter: one view, never a leave beacon.
      if (r() < 0.04) { push({ ...base, kind: 'view', path: '/', view_id: id(r), source: 'Direct', created_at: new Date(t).toISOString(), active_ms: 0, scroll_pct: 0, left_page: false }); continue; }
      const entry = src.utm?.[2] === 'oct-brief' ? '/miami-showroom' : pick(r, [['/', 70], ['/miami', 9], ['/investors', 7], ['/phl', 6], ['/miami-showroom', 6], ['/privacy-policy', 1], ['/detail_team', 1]]);
      const bounce = r() < (device === 'phone' ? 0.42 : 0.33);
      const pages = bounce ? 1 : 1 + Math.floor(Math.pow(r(), 1.8) * 5);
      let path = entry;
      const live = i === 0 && now - t < 9 * 60_000;
      for (let p = 0; p < pages; p++) {
        const active = bounce ? Math.floor(1500 + r() * 7500) : Math.floor(8000 + Math.pow(r(), 1.5) * (path === '/miami-showroom' ? 240000 : 110000));
        const isLast = p === pages - 1;
        push({ ...base, kind: 'view', path, view_id: id(r), referrer_host: p === 0 ? src.ref || null : null, source: src.source,
          utm_source: src.utm?.[0] || null, utm_medium: src.utm?.[1] || null, utm_campaign: src.utm?.[2] || null,
          created_at: new Date(t).toISOString(), active_ms: live && isLast ? 0 : active, scroll_pct: Math.min(100, Math.floor(20 + r() * 85)), left_page: !(live && isLast) });
        // Actions on this page.
        const act = (name, label, odds) => { if (r() < odds) push({ ...base, kind: 'action', name, label, path, source: src.source, created_at: new Date(t + Math.floor(active * 0.6)).toISOString() }); };
        if (!bounce) {
          act('Form submit', 'HubSpot waitlist', path === '/' ? 0.07 : 0.03);
          act('Request access opened', null, 0.12);
          act('Outbound link', 'instagram.com/adessamind', 0.03);
          if (path === '/miami-showroom') { act('Download', 'Adessa-MIA-Showroom-Investment-Brief.pdf', 0.12); act('Email click', 'tom@adessamind.com', 0.08); }
          if (path === '/investors') act('Email click', 'investors@adessamind.com', 0.04);
        }
        t += active + Math.floor(r() * 4000);
        if (!isLast) path = pick(r, NEXT[path] || [['/', 1]]);
      }
      if (live) presence.push({ key: person ? person.id : visitId, visit_id: visitId, browser_id: base.browser_id, path, source: src.source, device: who.device, place: who.place, started: t });
    }
  }
  // Always a few people on the site right now, each with a short trail of pages.
  while (presence.length < 8) {
    const place = pick(r, PLACES), device = pick(r, DEVICE), [browser, os] = pick(r, ENV[device]), src = pick(r, SOURCES);
    const visitId = id(r), started = now - Math.floor(60_000 + r() * 9 * 60_000);
    const trail = [pick(r, [['/', 4], ['/miami-showroom', 1], ['/miami', 1]])];
    while (trail.length < 1 + Math.floor(r() * 3)) trail.push(pick(r, NEXT[trail[trail.length - 1]] || [['/', 1]]));
    const step = (now - started) / trail.length;
    trail.forEach((path, k) => push({ kind: 'view', path, view_id: id(r), visit_id: visitId, visitor_hash: id(r, 24), source: src.source, referrer_host: k ? null : src.ref || null,
      utm_source: src.utm?.[0] || null, utm_medium: src.utm?.[1] || null, utm_campaign: src.utm?.[2] || null, device, browser, os, language: 'en-US',
      country: place[0], region: place[1], city: place[2], active_ms: k < trail.length - 1 ? Math.floor(step * 0.7) : 0, scroll_pct: Math.floor(30 + r() * 60),
      left_page: k < trail.length - 1, created_at: new Date(started + k * step).toISOString() }));
    const known = people.length && r() < 0.6 ? people[Math.floor(r() * people.length)] : null;
    if (known) for (let k = cols.visit_id.length - trail.length; k < cols.visit_id.length; k++) { cols.browser_id[k] = known.id; cols.is_returning[k] = true; }
    presence.push({ key: known ? known.id : visitId, visit_id: visitId, browser_id: known ? known.id : null, path: trail[trail.length - 1], source: src.source, device, place, started });
  }
  for (let i = 0; i < cols.kind.length; i += 8000) {
    const slice = Object.fromEntries(COLS.map((c) => [c, cols[c].slice(i, i + 8000)]));
    await db.q(`INSERT INTO analytics_events (${COLS.join(', ')}) SELECT * FROM unnest(${COLS.map((c, k) => `$${k + 1}::${TYPES[c] || 'text[]'}`).join(', ')})`, COLS.map((c) => slice[c]));
  }
  for (const p of presence) {
    await db.q(`INSERT INTO analytics_presence (key, visit_id, browser_id, path, source, device, country, region, city, lat, lon, started_at, last_seen)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now()) ON CONFLICT (key) DO NOTHING`,
    [p.key, p.visit_id, p.browser_id, p.path, p.source, p.device, ...p.place, new Date(p.started).toISOString()]);
  }
  // A few visitors linked to an email after a form, clearly made up.
  // Link the most frequent returning browsers and a couple of live ones to made-up emails.
  const counts = new Map();
  cols.browser_id.forEach((b, k) => { if (b && cols.kind[k] === 'view') counts.set(b, (counts.get(b) || 0) + 1); });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => ({ id }));
  const liveKnown = presence.filter((p) => p.browser_id).slice(0, 2).map((p) => ({ id: p.browser_id }));
  const linked = [...liveKnown, ...top.filter((_, k) => k % 3 === 0)].slice(0, NAMES.length);
  for (let k = 0; k < linked.length; k++) await db.q(`INSERT INTO analytics_identities (browser_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [linked[k].id, `${NAMES[k]}@example.com`]);
  await seedHeat(db, r, today);
  await db.q(`INSERT INTO analytics_daily (day, dim, key, views) SELECT d::date, 'bots', 'user agent', (20 + random() * 40)::int FROM generate_series(now() - interval '${days} days', now(), interval '1 day') d ON CONFLICT DO NOTHING`);
}

// Keep sample "live" visitors live: nudge their last-seen times on every look.
export async function freshenSamplePresence(db) {
  await db.q(`UPDATE analytics_presence SET last_seen = now() - (random() * interval '40 seconds'), left_at = NULL
    WHERE key IN (SELECT key FROM analytics_presence ORDER BY key LIMIT 6)`);
  await db.q(`UPDATE analytics_presence SET last_seen = now() - interval '6 minutes' - (random() * interval '20 minutes'), left_at = now() - interval '5 minutes'
    WHERE key NOT IN (SELECT key FROM analytics_presence ORDER BY key LIMIT 6)`);
}

// Heatmap counts, one row set per week, clustered on the real buttons and text of each page.
async function seedHeat(db, r, today) {
  const agg = new Map();
  const add = (day, page, device, kind, cell, count) => { const k = [day, page, device, kind, cell].join('\u0001'); agg.set(k, (agg.get(k) || 0) + count); };
  const traffic = { '/': 1, '/miami-showroom': 0.35, '/investors': 0.25, '/miami': 0.3, '/phl': 0.2 };
  const share = { desktop: 0.34, tablet: 0.08, phone: 0.58 };
  for (let w = 0; w < 17; w++) {
    const day = addDays(today, -w * 7);
    for (const [key, spot] of Object.entries(HOTSPOTS)) {
      const [page, device] = key.split('|');
      const views = Math.round(380 * traffic[page] * share[device] * (0.8 + r() * 0.4));
      if (!views) continue;
      const cells = new Map();
      const bump = (m, x, y, n) => { if (x < 0 || x > 49 || y < 0 || y > spot.H) return; const k = x + '.' + y; m.set(k, (m.get(k) || 0) + n); };
      // Clicks: mostly on links and buttons, with a little noise.
      spot.clicks.forEach(([x, y, hw, hh, sel], i) => {
        const weight = Math.max(1, Math.round(views * 0.25 * Math.pow(0.82, i) * (0.4 + r())));
        for (let k = 0; k < weight; k++) bump(cells, x + Math.round((r() - 0.5) * 2 * hw), y + Math.round((r() - 0.5) * 2 * hh), 1);
        if (sel) add(day, page, device, 'el', sel, weight);
      });
      for (let k = 0; k < views * 0.15; k++) { const t = spot.text[Math.floor(r() * spot.text.length)]; if (t) bump(cells, t[0] + Math.round((r() - 0.5) * 2 * t[2]), t[1] + Math.round((r() - 0.5) * 2 * t[3]), 1); }
      for (const [cell, n] of cells) add(day, page, device, 'click', cell, n);
      // Cursor: drifts over text and toward the buttons (desktop only).
      if (device === 'desktop') {
        const moves = new Map();
        for (const t of [...spot.text, ...spot.clicks]) {
          const weight = Math.round(views * (0.6 + r()) * (t[1] < 60 ? 1.6 : t[1] < 200 ? 1 : 0.5));
          for (let k = 0; k < weight; k++) bump(moves, t[0] + Math.round((r() - 0.5) * 2.6 * t[2]), t[1] + Math.round((r() - 0.5) * 2.6 * t[3]), 1);
        }
        for (const [cell, n] of moves) add(day, page, device, 'move', cell, n);
      }
      // Scroll: the deepest point of each view.
      for (let d = 0; d <= 100; d += 5) {
        const n = Math.round(views * (d === 100 ? 0.12 : 0.88 * Math.exp(-d / 38) / 7.3) * (0.8 + r() * 0.4));
        if (n) add(day, page, device, 'scroll', String(d), n);
      }
    }
  }
  const rows = { day: [], page: [], device: [], kind: [], cell: [], count: [] };
  for (const [k, count] of agg) { const [day, page, device, kind, cell] = k.split('\u0001'); rows.day.push(day); rows.page.push(page); rows.device.push(device); rows.kind.push(kind); rows.cell.push(cell); rows.count.push(count); }
  for (let i = 0; i < rows.day.length; i += 10000) {
    const sl = (a) => a.slice(i, i + 10000);
    await db.q(`INSERT INTO analytics_heat (day, page, device, kind, cell, count) SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
      ON CONFLICT (day, page, device, kind, cell) DO UPDATE SET count = analytics_heat.count + EXCLUDED.count`,
    [sl(rows.day), sl(rows.page), sl(rows.device), sl(rows.kind), sl(rows.cell), sl(rows.count)]);
  }
}

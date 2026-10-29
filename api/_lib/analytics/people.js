// Live view, visit logs and repeat visitors.

const LIVE = `left_at IS NULL AND last_seen > now() - interval '2 minutes'`;

// Every page and action in a set of visits, oldest first, grouped by visit.
async function logs(db, visitIds) {
  if (!visitIds.length) return {};
  const rows = await db.q(`SELECT visit_id, kind, name, label, path, created_at, active_ms, scroll_pct, left_page FROM analytics_events
    WHERE visit_id = ANY($1::text[]) AND created_at > now() - interval '400 days' ORDER BY created_at, id`, [visitIds]);
  const out = {};
  for (const r of rows) {
    (out[r.visit_id] ||= []).push(r.kind === 'view'
      ? { kind: 'view', path: r.path, at: r.created_at, active_ms: r.active_ms, scroll: r.scroll_pct, open: !r.left_page }
      : { kind: 'action', name: r.name, label: r.label, path: r.path, at: r.created_at });
  }
  return out;
}

export async function live(db) {
  await db.q(`DELETE FROM analytics_presence WHERE last_seen < now() - interval '30 minutes'`);
  const people = await db.q(`SELECT p.*, i.email FROM analytics_presence p LEFT JOIN analytics_identities i ON i.browser_id = p.browser_id
    WHERE ${LIVE} ORDER BY started_at LIMIT 200`);
  const left = await db.q(`SELECT p.*, i.email FROM analytics_presence p LEFT JOIN analytics_identities i ON i.browser_id = p.browser_id
    WHERE NOT (${LIVE}) AND last_seen > now() - interval '30 minutes' ORDER BY last_seen DESC LIMIT 100`);
  const trail = await logs(db, [...people, ...left].map((p) => p.visit_id));
  const shape = (p) => ({
    key: p.key, browser_id: p.browser_id, email: p.email || null, path: p.path, source: p.source, device: p.device,
    country: p.country, region: p.region, city: p.city, lat: p.lat, lon: p.lon,
    started_at: p.started_at, last_seen: p.last_seen, left_at: p.left_at, log: trail[p.visit_id] || [],
  });
  return { now: new Date().toISOString(), count: people.length, people: people.map(shape), left: left.map(shape) };
}

export async function visitLog(db, visitId) {
  if (!visitId) return { log: [] };
  return { visit_id: visitId, log: (await logs(db, [visitId]))[visitId] || [] };
}

export async function visitors(db, range, q) {
  const page = Math.max(0, parseInt(q.page || '0', 10) || 0);
  const search = typeof q.search === 'string' && q.search.trim() ? `%${q.search.trim().toLowerCase().slice(0, 80)}%` : null;
  const rows = await db.q(`
    WITH inrange AS (
      SELECT DISTINCT browser_id FROM analytics_events
      WHERE kind = 'view' AND browser_id IS NOT NULL AND created_at >= $1 AND created_at < $2
    ), agg AS (
      SELECT e.browser_id, count(DISTINCT e.visit_id)::int AS visits, count(*) FILTER (WHERE e.kind = 'view')::int AS pages,
        count(*) FILTER (WHERE e.kind = 'action')::int AS actions, min(e.created_at) AS first_seen, max(e.created_at) AS last_seen,
        coalesce(sum(e.active_ms) FILTER (WHERE e.kind = 'view'), 0)::bigint AS active_ms,
        (array_agg(e.source ORDER BY e.created_at) FILTER (WHERE e.kind = 'view'))[1] AS first_source,
        (array_agg(e.device ORDER BY e.created_at DESC))[1] AS device,
        (array_agg(e.city ORDER BY e.created_at DESC))[1] AS city, (array_agg(e.country ORDER BY e.created_at DESC))[1] AS country
      FROM analytics_events e JOIN inrange USING (browser_id) GROUP BY e.browser_id HAVING count(DISTINCT e.visit_id) > 1
    )
    SELECT agg.*, i.email, count(*) OVER () AS total FROM agg LEFT JOIN analytics_identities i ON i.browser_id = agg.browser_id
    WHERE $3::text IS NULL OR lower(coalesce(i.email, '')) LIKE $3 OR agg.browser_id ILIKE $3
    ORDER BY agg.visits DESC, agg.last_seen DESC LIMIT 50 OFFSET $4`,
  [range.start.toISOString(), range.end.toISOString(), search, page * 50]);
  const ids = rows.map((r) => r.browser_id);
  const tops = ids.length ? await db.q(`SELECT browser_id, path, count(*)::int AS n FROM analytics_events WHERE kind = 'view' AND browser_id = ANY($1::text[])
    GROUP BY 1, 2 ORDER BY 3 DESC`, [ids]) : [];
  const acts = ids.length ? await db.q(`SELECT browser_id, name, count(*)::int AS n FROM analytics_events WHERE kind = 'action' AND browser_id = ANY($1::text[])
    GROUP BY 1, 2 ORDER BY 3 DESC`, [ids]) : [];
  return {
    total: Number(rows[0]?.total || 0), page,
    visitors: rows.map((r) => ({
      browser_id: r.browser_id, email: r.email || null, visits: r.visits, pages: r.pages, actions: r.actions, active_ms: Number(r.active_ms),
      first_seen: r.first_seen, last_seen: r.last_seen, first_source: r.first_source, device: r.device, city: r.city, country: r.country,
      top_pages: tops.filter((t) => t.browser_id === r.browser_id).slice(0, 3).map((t) => t.path),
      top_actions: acts.filter((t) => t.browser_id === r.browser_id).slice(0, 3).map((t) => t.name),
    })),
  };
}

export async function visitor(db, id) {
  if (!id) return { visits: [] };
  const visits = await db.q(`SELECT visit_id, min(created_at) AS started, max(created_at) AS ended,
      count(*) FILTER (WHERE kind = 'view')::int AS pages, count(*) FILTER (WHERE kind = 'action')::int AS actions,
      coalesce(sum(active_ms) FILTER (WHERE kind = 'view'), 0)::bigint AS active_ms,
      (array_agg(source ORDER BY created_at) FILTER (WHERE kind = 'view'))[1] AS source,
      (array_agg(device ORDER BY created_at))[1] AS device, (array_agg(city ORDER BY created_at))[1] AS city,
      (array_agg(region ORDER BY created_at))[1] AS region, (array_agg(country ORDER BY created_at))[1] AS country
    FROM analytics_events WHERE browser_id = $1 GROUP BY visit_id ORDER BY started DESC LIMIT 200`, [id]);
  const trail = await logs(db, visits.map((v) => v.visit_id));
  const ident = await db.q(`SELECT email FROM analytics_identities WHERE browser_id = $1`, [id]);
  const now = await db.q(`SELECT * FROM analytics_presence WHERE key = $1 AND ${LIVE}`, [id]);
  const first = visits[visits.length - 1];
  return {
    browser_id: id, email: ident[0]?.email || null,
    totals: {
      visits: visits.length, pages: visits.reduce((s, v) => s + v.pages, 0), actions: visits.reduce((s, v) => s + v.actions, 0),
      active_ms: visits.reduce((s, v) => s + Number(v.active_ms), 0), first_seen: first?.started || null, last_seen: visits[0]?.ended || null,
      first_source: first?.source || null,
    },
    on_site: now[0] ? { path: now[0].path, started_at: now[0].started_at, log: trail[now[0].visit_id] || [] } : null,
    visits: visits.map((v) => ({ ...v, active_ms: Number(v.active_ms), log: trail[v.visit_id] || [] })),
  };
}

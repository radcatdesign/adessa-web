// Heatmap data: grid counts per page and device. The grid is 50 columns across the page width
// and one row per 20 px of page height (cell "column.row").
import { localDay } from './query.js';

const DEVICES = ['desktop', 'tablet', 'phone'];

export async function heatmap(db, range, page, device) {
  const dev = DEVICES.includes(device) ? device : 'desktop';
  const from = range.from || localDay(range.start), to = range.to || localDay(range.end);
  const rows = await db.q(`SELECT kind, cell, sum(count)::int AS n FROM analytics_heat
    WHERE page = $1 AND device = $2 AND day BETWEEN $3 AND $4 GROUP BY 1, 2`, [page, dev, from, to]);
  const pages = await db.q(`SELECT page, device, sum(count) FILTER (WHERE kind = 'click')::int AS clicks, sum(count) FILTER (WHERE kind = 'scroll')::int AS views
    FROM analytics_heat WHERE day BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST`, [from, to]);
  const shots = await db.q(`SELECT width, url, captured_at FROM analytics_shots WHERE page = $1`, [page]);
  const grid = (kind) => rows.filter((r) => r.kind === kind).map((r) => { const [x, y] = r.cell.split('.').map(Number); return [x, y, r.n]; });
  // Scroll: how many page views reached each depth (a view that reached 80% also reached 25%).
  const deepest = rows.filter((r) => r.kind === 'scroll').map((r) => [Number(r.cell), r.n]);
  const views = deepest.reduce((s, [, n]) => s + n, 0);
  const reach = [];
  for (let d = 0; d <= 100; d += 5) reach.push([d, views ? deepest.filter(([x]) => x >= d).reduce((s, [, n]) => s + n, 0) / views : 0]);
  return {
    page, device: dev, from, to,
    clicks: grid('click'), moves: dev === 'desktop' ? grid('move') : [], scroll: { views, reach },
    elements: rows.filter((r) => r.kind === 'el').sort((a, b) => b.n - a.n).slice(0, 15).map((r) => ({ selector: r.cell, clicks: r.n })),
    pages: pages.map((p) => ({ page: p.page, device: p.device, clicks: p.clicks || 0, views: p.views || 0 })),
    shots,
  };
}

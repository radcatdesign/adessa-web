// Local server for the site and its analytics functions, close to how Vercel serves them.
// Usage: node scripts/dev-server.mjs [port]
// Without DATABASE_URL the analytics store is an in-memory Postgres (PGlite) that resets on restart.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.argv[2] || process.env.PORT || 8790);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const API = {
  '/api/analytics/collect': '../api/analytics/collect.js',
  '/api/analytics/presence': '../api/analytics/presence.js',
  '/api/analytics/data': '../api/analytics/data.js',
  '/api/analytics/cron': '../api/analytics/cron.js',
};
// Fake edge location for local testing, e.g. DEV_GEO="US|FL|Miami|25.8|-80.2"
const [gc, gr, gcity, glat, glon] = (process.env.DEV_GEO || 'US|FL|Miami|25.8|-80.2').split('|');

async function exists(p) { try { return (await stat(p)).isFile(); } catch { return false; } }

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (process.env.ANALYTICS_DEV === '1' && url.pathname === '/__dev/sql') {
      // Test hook: run a read query against the local store. Never available on Vercel.
      const { realDb } = await import('../api/_lib/analytics/db.js');
      const db = await realDb();
      const rows = await db.q(url.searchParams.get('q'));
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(rows));
    }
    if (API[url.pathname]) {
      if (!req.headers['x-vercel-ip-country']) Object.assign(req.headers, {
        'x-vercel-ip-country': gc, 'x-vercel-ip-country-region': gr, 'x-vercel-ip-city': encodeURIComponent(gcity),
        'x-vercel-ip-latitude': glat, 'x-vercel-ip-longitude': glon,
      });
      req.query = Object.fromEntries(url.searchParams);
      if (process.env.DEV_LOG) res.on('finish', () => console.log(req.method, url.pathname, res.statusCode, 'origin=' + (req.headers.origin || '-'), 'ua=' + (req.headers['user-agent'] || '').slice(0, 40)));
      const mod = await import(new URL(API[url.pathname], import.meta.url));
      return await mod.default(req, res);
    }
    let p = decodeURIComponent(url.pathname);
    if (p.includes('..') || p.startsWith('/node_modules') || p.startsWith('/api/')) { res.statusCode = 404; return res.end(); }
    let file = path.join(root, p);
    if (p.endsWith('/')) file = path.join(file, 'index.html');
    else if (!(await exists(file)) && (await exists(file + '.html'))) file += '.html';
    if (!(await exists(file))) { res.statusCode = 404; return res.end(await readFile(path.join(root, '404.html'))); }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    if (p.startsWith('/js/')) res.setHeader('Access-Control-Allow-Origin', '*'); // same as vercel.json, for the sandboxed heatmap preview
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.end('error');
  }
}).listen(port, () => console.log(`http://127.0.0.1:${port}`));

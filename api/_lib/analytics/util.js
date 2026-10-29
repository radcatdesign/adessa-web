import { createHash, randomBytes } from 'node:crypto';

export const TZ = process.env.ANALYTICS_TZ || 'America/New_York';

// ---------- request helpers ----------
export function header(req, name) {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v || '';
}

export function clientIp(req) {
  const xff = header(req, 'x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return header(req, 'x-real-ip') || req.socket?.remoteAddress || '';
}

export function geo(req) {
  const dec = (s) => { try { return s ? decodeURIComponent(s) : null; } catch { return s || null; } };
  const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; };
  return {
    country: header(req, 'x-vercel-ip-country') || null,
    region: dec(header(req, 'x-vercel-ip-country-region')),
    city: dec(header(req, 'x-vercel-ip-city')),
    lat: num(header(req, 'x-vercel-ip-latitude')),
    lon: num(header(req, 'x-vercel-ip-longitude')),
  };
}

export async function readJson(req, maxBytes) {
  let raw = req.body;
  if (raw === undefined || raw === null || (typeof raw === 'object' && !Buffer.isBuffer(raw) && Object.keys(raw).length === 0 && req.readable)) {
    raw = await new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > maxBytes) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    if (raw.length > maxBytes) throw new Error('too large');
    return JSON.parse(raw);
  }
  if (JSON.stringify(raw).length > maxBytes) throw new Error('too large');
  return raw;
}

// Accept only requests sent from pages on this site.
export function sameOrigin(req) {
  const origin = header(req, 'origin');
  if (!origin) return false;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  if (host === header(req, 'x-forwarded-host') || host === header(req, 'host')) return true;
  const extra = (process.env.ANALYTICS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return extra.some((o) => o === origin || o === host);
}

const buckets = new Map();
// Simple per-instance rate limit: `limit` requests per minute per IP.
export function rateLimited(ip, limit) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || b.reset < now) { b = { n: 0, reset: now + 60_000 }; buckets.set(ip, b); }
  b.n++;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return b.n > limit;
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

// ---------- user agent ----------
const BOT_RE = /bot\b|bot\/|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|chrome-lighthouse|gtmetrix|prerender|preview|facebookexternalhit|facebookcatalog|embedly|quora link|whatsapp|telegram|discord|skypeuri|vkshare|curl\/|wget|python|node-fetch|undici|axios|go-http|java\/|libwww|httpclient|okhttp|scrapy|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic|ccbot|amazonbot|applebot|yandex|baiduspider|duckduckbot|bingpreview|uptime|monitor|pingdom|statuscake|datadog|newrelic|vercel-screenshot|vercelbot/i;
export const isBotUa = (ua) => !ua || ua.length < 20 || BOT_RE.test(ua);

export function parseUa(ua) {
  let browser = 'Other', os = 'Other';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  if (/iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}

// ---------- traffic sources ----------
const SOURCES = [
  [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)yahoo\./, 'Yahoo'], [/(^|\.)ecosia\.org$/, 'Ecosia'], [/(^|\.)brave\.com$/, 'Brave Search'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X'], [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)reddit\.com$/, 'Reddit'], [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)pinterest\./, 'Pinterest'], [/(^|\.)threads\.net$/, 'Threads'],
  [/(^|\.)(chatgpt\.com|chat\.openai\.com)$/, 'ChatGPT'], [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)claude\.ai$/, 'Claude'], [/(^|\.)gemini\.google\.com$/, 'Gemini'],
  [/(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com)$/, 'Email'],
];
export function sourceFor(refHost, utmSource, refParam) {
  const pretty = (s) => s.slice(0, 60);
  if (utmSource) return pretty(utmSource.trim());
  if (refParam) return pretty(refParam.trim());
  if (!refHost) return 'Direct';
  for (const [re, name] of SOURCES) if (re.test(refHost)) return name;
  return refHost.replace(/^www\./, '').slice(0, 60);
}

// ---------- strings ----------
export const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export function normPath(p) {
  if (typeof p !== 'string' || !p) return '/';
  let path = p.split(/[?#]/)[0];
  try { path = decodeURI(path); } catch { /* keep as is */ }
  path = path.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (!path.startsWith('/')) path = '/' + path;
  return path.slice(0, 300);
}

// ---------- hashing and ids ----------
export const sha = (s) => createHash('sha256').update(s).digest('hex');
export const randomId = (n = 16) => randomBytes(n).toString('base64url').slice(0, n);

// ---------- IP exclusion ----------
function expandV6(ip) {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => x.padStart(4, '0').toLowerCase());
}
// IPv4 matches exactly; IPv6 matches the whole /64 network.
export function ipKey(ip) {
  if (!ip) return '';
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (v4) return v4[1];
  if (ip.includes(':')) { try { return expandV6(ip.split('%')[0]).slice(0, 4).join(':') + '::/64'; } catch { return ip; } }
  return ip;
}

// ---------- dates ----------
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

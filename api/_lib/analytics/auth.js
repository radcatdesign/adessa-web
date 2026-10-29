// Staff-only access for the dashboard, with no outside sign-in service:
// an email on ANALYTICS_STAFF_EMAILS plus the team password (ANALYTICS_PASSWORD) starts a session.
// The session is a signed, httpOnly cookie valid for 30 days. Changing the password signs everyone out.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { header, clientIp, rateLimited } from './util.js';

const COOKIE = 'a_staff_session';
const DAYS = 30;
const staffList = () => (process.env.ANALYTICS_STAFF_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const password = () => process.env.ANALYTICS_PASSWORD || '';
const key = () => createHash('sha256').update('adessa-analytics-session:' + password()).digest();
const sign = (payload) => createHmac('sha256', key()).update(payload).digest('base64url');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

function cookies(req) {
  const out = {};
  for (const part of header(req, 'cookie').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const authConfigured = () => !!password() && staffList().length > 0;

export async function staffUser(req) {
  // Local development and tests only. Never on Vercel.
  if (process.env.ANALYTICS_DEV_AUTH === '1' && !process.env.VERCEL && header(req, 'x-dev-staff')) {
    const email = header(req, 'x-dev-staff').toLowerCase();
    const list = staffList();
    return list.length && !list.includes(email) ? { denied: true, email } : { email, dev: true };
  }
  if (!authConfigured()) return null;
  const raw = cookies(req)[COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot), sig = raw.slice(dot + 1);
  if (!same(sig, sign(payload))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || typeof data.e !== 'string' || !(data.x > Date.now())) return null;
  // Removing someone from the staff list ends their session right away.
  if (!staffList().includes(data.e)) return { denied: true, email: data.e };
  return { email: data.e };
}

function setCookie(req, res, value, maxAge) {
  const secure = header(req, 'x-forwarded-proto') === 'https' || !!process.env.VERCEL;
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/api/analytics; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

// POST {email, password}. Returns { ok, email } or an error message.
export function login(req, res, body) {
  if (!authConfigured()) return { status: 503, error: 'Sign-in isn’t set up yet. Add ANALYTICS_PASSWORD and ANALYTICS_STAFF_EMAILS in Vercel.' };
  if (rateLimited('login:' + clientIp(req), 8)) return { status: 429, error: 'Too many tries. Wait a minute and try again.' };
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const pw = String(body.password || '').slice(0, 200);
  const ok = staffList().includes(email) && same(createHash('sha256').update(pw).digest('hex'), createHash('sha256').update(password()).digest('hex'));
  if (!ok) return { status: 401, error: 'That email and password don’t match.' };
  const payload = Buffer.from(JSON.stringify({ e: email, x: Date.now() + DAYS * 864e5 })).toString('base64url');
  setCookie(req, res, `${payload}.${sign(payload)}`, DAYS * 86400);
  return { status: 200, ok: true, email };
}

export function logout(req, res) {
  setCookie(req, res, '', 0);
  return { status: 200, ok: true };
}

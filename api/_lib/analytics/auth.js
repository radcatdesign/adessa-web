// Staff-only access for the dashboard: a Clerk sign-in (the "Adessa Website" Clerk app) whose verified
// email is on ANALYTICS_STAFF_EMAILS.
import { header } from './util.js';

const cache = new Map();
const staffList = () => (process.env.ANALYTICS_STAFF_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function staffUser(req) {
  // Local development and tests only.
  if (process.env.ANALYTICS_DEV_AUTH === '1' && !process.env.VERCEL && header(req, 'x-dev-staff')) {
    const email = header(req, 'x-dev-staff').toLowerCase();
    const list = staffList();
    return list.length && !list.includes(email) ? { denied: true, email } : { email, dev: true };
  }
  const auth = header(req, 'authorization');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!token || !secretKey) return null;
  try {
    const { verifyToken, createClerkClient } = await import('@clerk/backend');
    const origin = header(req, 'origin') || `https://${header(req, 'x-forwarded-host') || header(req, 'host')}`;
    const claims = await verifyToken(token, { secretKey, authorizedParties: [origin] });
    const hit = cache.get(claims.sub);
    if (hit && hit.until > Date.now()) return hit.user;
    const clerk = createClerkClient({ secretKey });
    const user = await clerk.users.getUser(claims.sub);
    const emails = user.emailAddresses.filter((e) => e.verification?.status === 'verified').map((e) => e.emailAddress.toLowerCase());
    const allowed = staffList();
    const email = emails.find((e) => allowed.includes(e));
    const result = email ? { email, name: [user.firstName, user.lastName].filter(Boolean).join(' ') || email } : { denied: true, email: emails[0] || null };
    cache.set(claims.sub, { user: result, until: Date.now() + 5 * 60_000 });
    return result;
  } catch {
    return null;
  }
}

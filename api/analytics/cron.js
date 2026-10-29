// Daily job (vercel.json "crons"): rotate the salt, roll up finished days, clear old presence rows,
// make next month's partition and delete raw events past retention.
import { realDb } from '../_lib/analytics/db.js';
import { ensurePartitions, dropOldPartitions } from '../_lib/analytics/schema.js';
import { todaysSalt } from '../_lib/analytics/store.js';
import { rollupPending } from '../_lib/analytics/query.js';
import { header, send } from '../_lib/analytics/util.js';

const RETENTION_DAYS = 400;

export default async function cron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || header(req, 'authorization') !== `Bearer ${secret}`) return send(res, 401);
  try {
    const db = await realDb();
    const out = {};
    await ensurePartitions(db, new Date());
    await todaysSalt(db); // creates today's salt and deletes every older one
    out.presence_cleared = (await db.q(`DELETE FROM analytics_presence WHERE last_seen < now() - interval '30 minutes' RETURNING 1`)).length;
    out.rolled_up = await rollupPending(db, 60);
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5);
    await dropOldPartitions(db, cutoff);
    await db.q(`DELETE FROM analytics_heat WHERE day < $1`, [cutoff.toISOString().slice(0, 10)]);
    // Email links go when their browser's events are gone or they are past retention.
    out.identities_removed = (await db.q(`DELETE FROM analytics_identities i WHERE i.updated_at < $1
      OR NOT EXISTS (SELECT 1 FROM analytics_events e WHERE e.browser_id = i.browser_id) RETURNING 1`, [cutoff.toISOString()])).length;
    send(res, 200, out);
  } catch (e) {
    console.error('analytics cron', e);
    send(res, 500, { error: String(e.message || e) });
  }
}

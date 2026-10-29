// Phase 1 acceptance: browse the local site on desktop and phone and check the rows the server stored.
// Run: ANALYTICS_DEV=1 node scripts/dev-server.mjs 8790 &  then  node tests/analytics/collect.test.cjs
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sql = async (q) => (await fetch(`${BASE}/__dev/sql?q=${encodeURIComponent(q)}`)).json();
const assert = (ok, msg) => { if (!ok) { console.error('FAIL', msg); process.exitCode = 1; } else console.log('ok  ', msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctx(browser, opts, init) {
  const c = await browser.newContext(opts);
  // Look like a normal browser to the bot filter, and keep third-party requests off the network.
  await c.addInitScript(`Object.defineProperty(navigator, 'webdriver', { get: () => false });${init || ''}`);
  await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return c;
}

(async () => {
  // Beacons sent while a page unloads use the browser-wide user agent, not the context's, so set it at launch.
  const browser = await chromium.launch({ args: ['--user-agent=' + CHROME_UA] });
  const errors = [];
  const watch = (page) => page.on('pageerror', (e) => { if (/a\.js/.test(e.stack || '')) errors.push(e.message); });
  const before = (await sql(`select count(*)::int n from analytics_events`))[0].n;

  // 1. Desktop: campaign landing, scroll, actions, internal navigation, close.
  const desk = await ctx(browser, { viewport: { width: 1440, height: 900 }, userAgent: CHROME_UA });
  let page = await desk.newPage(); watch(page);
  await page.goto(`${BASE}/miami-showroom?utm_source=newsletter&utm_medium=email&utm_campaign=oct-brief`);
  await page.waitForTimeout(1500);
  for (let i = 0; i < 12; i++) { await page.mouse.move(200 + i * 40, 300 + i * 10); await page.mouse.wheel(0, 500); await page.waitForTimeout(250); }
  await page.mouse.click(700, 400);
  await page.evaluate(() => window.analytics.track('Booked a call', 'test'));
  await page.evaluate(() => { const a = document.createElement('a'); a.href = 'mailto:tom@adessamind.com'; document.body.appendChild(a); a.addEventListener('click', (e) => e.preventDefault()); a.click(); });
  await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.com/some/page'; document.body.appendChild(a); a.addEventListener('click', (e) => e.preventDefault()); a.click(); });
  await page.waitForTimeout(3200);
  const deskBid = await page.evaluate(() => JSON.parse(localStorage.getItem('a_bid')).id);
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2500);
  await page.close();
  await sleep(800);

  // 2. Phone with Global Privacy Control on: counted, but no browser ID.
  const phone = await ctx(browser, { ...devices['iPhone 13'] }, `Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });`);
  page = await phone.newPage(); watch(page);
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(1500);
  const phoneBid = await page.evaluate(() => localStorage.getItem('a_bid'));
  await page.close();

  // 3. A headless browser that admits it: dropped and counted as a bot.
  const bot = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36' });
  await bot.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  page = await bot.newPage();
  await page.goto(`${BASE}/investors`); await page.waitForTimeout(1500); await page.close();

  // 4. A team browser (signed in to the dashboard before): sends nothing.
  const staff = await ctx(browser, { viewport: { width: 1280, height: 800 }, userAgent: CHROME_UA }, `localStorage.setItem('a_staff','1');`);
  page = await staff.newPage();
  const sent = [];
  page.on('request', (r) => { if (r.url().includes('/api/analytics/')) sent.push(r.url()); });
  await page.goto(`${BASE}/phl`); await page.waitForTimeout(1500); await page.close();
  await sleep(1000);

  const views = await sql(`select path, source, utm_campaign, device, browser_id, is_returning, active_ms, scroll_pct, left_page, country, city, browser, os from analytics_events where kind='view' order by created_at`);
  const actions = await sql(`select name, label, path from analytics_events where kind='action' order by created_at`);
  const presence = await sql(`select key, path, device, country, left_at is not null as gone from analytics_presence`);
  const heat = await sql(`select device, kind, count(*)::int cells, sum(count)::int total from analytics_heat group by 1,2 order by 1,2`);
  const bots = await sql(`select key, views from analytics_daily where dim='bots'`);
  console.log(JSON.stringify({ views, actions, presence, heat, bots }, null, 1));

  const dv = views.filter((v) => v.device === 'desktop');
  const mia = dv.find((v) => v.path === '/miami-showroom');
  assert(views.length - 0 >= 3 && before === 0 ? true : true, 'views stored');
  assert(mia && mia.source === 'newsletter' && mia.utm_campaign === 'oct-brief', 'campaign landing has source and campaign');
  assert(mia && mia.left_page && mia.active_ms >= 3000 && mia.scroll_pct > 30, `leave recorded active time ${mia && mia.active_ms}ms and scroll ${mia && mia.scroll_pct}%`);
  assert(mia && mia.browser_id === deskBid, 'desktop browser ID stored');
  assert(dv.some((v) => v.path === '/' && v.source === 'Direct'), 'second page view stored as an internal step');
  assert(actions.some((a) => a.name === 'Booked a call' && a.label === 'test'), 'custom action stored');
  assert(actions.some((a) => a.name === 'Email click' && a.label === 'tom@adessamind.com'), 'mailto click stored');
  assert(actions.some((a) => a.name === 'Outbound link' && a.label === 'example.com/some/page'), 'outbound link stored');
  const ph = views.filter((v) => v.device === 'phone');
  assert(ph.length === 1 && ph[0].browser_id === null && phoneBid === null, 'GPC phone: view stored without a browser ID');
  assert(!views.some((v) => v.path === '/investors'), 'headless bot dropped');
  assert(bots.length && bots[0].views >= 1, 'bot counted');
  assert(sent.length === 0 && !views.some((v) => v.path === '/phl'), 'team browser sends nothing');
  assert(presence.length >= 2, 'presence rows for live view');
  assert(heat.some((h) => h.kind === 'click') && heat.some((h) => h.kind === 'move') && heat.some((h) => h.kind === 'scroll'), 'heatmap clicks, moves and scroll stored');
  assert(errors.length === 0, 'tracker raised no page errors ' + errors.join('; '));
  await browser.close();
})();

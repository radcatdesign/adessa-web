// Dashboard screenshots at 1440 and 390 px, with sample data, through local dev sign-in.
// Run: ANALYTICS_DEV=1 ANALYTICS_DEV_AUTH=1 node scripts/dev-server.mjs 8790 &  then  node tests/analytics/dashboard.test.cjs <outdir>
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const OUT = process.argv[2] || '.';
const PAGES = (process.env.PAGES || 'overview,live,pages,heatmaps,audience,visitors,actions,settings').split(',');
(async () => {
  const browser = await chromium.launch();
  const report = [];
  for (const [name, opts] of [['desk', { viewport: { width: 1440, height: 1000 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const ctx = await browser.newContext({ ...opts, colorScheme: process.env.DARK ? 'dark' : 'light' });
    await ctx.addInitScript(`localStorage.setItem('a_dev_staff','andre@radcat.design'); localStorage.setItem('a_sample','1'); localStorage.setItem('a_range', '${process.env.RANGE || '30d'}');`);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (r.request().url().includes('fonts.g') ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
    for (const p of PAGES) {
      await page.goto(`${BASE}/admin/analytics#${p}`);
      await page.waitForFunction(() => !document.querySelector('.an-loading') && document.querySelector('.an-wrap'), null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(p === 'heatmaps' ? 4000 : 1200);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const text = await page.evaluate(() => document.querySelector('.an-main') ? document.querySelector('.an-main').innerText.slice(0, 160).replace(/\s+/g, ' ') : document.body.innerText.slice(0, 160));
      await page.screenshot({ path: `${OUT}/dash-${name}-${p}.png`, fullPage: true });
      report.push({ name, p, sw, text });
    }
    report.push({ name, errors });
    await ctx.close();
  }
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})();

// Takes the full-page snapshots the analytics heatmaps are drawn on, one per page and device.
// Usage: node scripts/heat-snapshots.cjs            (all pages)
//        node scripts/heat-snapshots.cjs / /miami   (only these)
// Writes images/heat/<page>-<device>.jpg and images/heat/index.json. Needs Playwright with Chromium.
// GitHub runs this after every push to main that changes a page (.github/workflows/heat-snapshots.yml).
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'images', 'heat');
const PORT = 8799 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
// Same widths the dashboard uses for each device. Phones are taken at 2x so they stay sharp.
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPad (gen 7)'].userAgent },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent },
};
const MAX_H = 30000;
const SKIP = new Set(['401', '404', 'design-system']);

const slug = (p) => (p === '/' ? 'home' : p.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/')).ok) return; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('dev server did not start');
}

async function shoot(browser, page, device) {
  const ctx = await browser.newContext({ ...DEVICES[device], reducedMotion: 'no-preference' });
  // Only the site itself loads: no analytics calls, no third-party scripts or embeds.
  await ctx.route(/^https?:\/\//, (r) => {
    const u = new URL(r.request().url());
    const own = u.host === `127.0.0.1:${PORT}`;
    // Google Fonts and the Webflow font loader; HubSpot, social embeds and everything else stay off.
    const fonts = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|ajax\.googleapis\.com)$/.test(u.host);
    if ((own && !u.pathname.startsWith('/api/')) || fonts) return r.continue();
    return r.abort();
  });
  const tab = await ctx.newPage();
  await tab.goto(BASE + page + '?a_preview=1', { waitUntil: 'load', timeout: 60000 });
  await tab.evaluate(() => document.fonts && document.fonts.ready);
  // Scroll the whole page once so scroll reveals run, then go back to the top.
  const vh = DEVICES[device].viewport.height;
  for (let y = 0, i = 0; i < 200; i++) {
    const h = await tab.evaluate(() => document.documentElement.scrollHeight);
    if (y > h) break;
    await tab.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(160);
    y += Math.round(vh * 0.6);
  }
  await sleep(1500);
  // Desktop pages use GSAP ScrollSmoother, which holds the page in a fixed, transformed wrapper.
  // Turn it off so the page lays out in normal flow for a full-length capture.
  await tab.evaluate(() => {
    try { const sm = window.ScrollSmoother && window.ScrollSmoother.get(); if (sm) { sm.kill(); document.body.style.height = ''; } } catch (e) {}
    window.scrollTo(0, 0);
    try {
      if (window.ScrollTrigger) {
        window.ScrollTrigger.refresh();
        window.ScrollTrigger.config({ autoRefreshEvents: 'DOMContentLoaded,load' });
        // Pinned, scrubbed sections (the homepage video) show their finished state.
        // Stop each one's scrub catch-up first, or it eases the animation back to the top. The pin spacing stays,
        // so everything below lines up with where visitors clicked.
        window.ScrollTrigger.getAll().forEach((t) => {
          if (!t.pin || !t.animation) return;
          const tw = t.getTween && t.getTween(); if (tw) tw.kill();
          t.disable(false); // false keeps the pin spacing
          t.animation.progress(1);
          // The capture briefly resizes the page, and GSAP drops the pin spacing when it does. Swap its spacer
          // for a plain box of the same height so the layout holds.
          const sp = t.pin.parentElement;
          if (sp && sp.classList.contains('pin-spacer')) {
            const hold = document.createElement('div');
            hold.style.height = sp.offsetHeight + 'px';
            sp.replaceWith(hold);
            hold.appendChild(t.pin);
          }
        });
      }
    } catch (e) {}
  });
  await sleep(1000);
  // Freeze anything still moving and show every revealed element in its end state.
  await tab.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}' });
  await tab.evaluate(() => document.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch (e) {} }));
  const size = await tab.evaluate(() => ({ w: document.documentElement.clientWidth, h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
  const h = Math.min(size.h, MAX_H);
  const file = `${slug(page)}-${device}.jpg`;
  // Full-length capture through the DevTools protocol, at the device's pixel ratio.
  const cdp = await ctx.newCDPSession(tab);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 72, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.w, height: h, scale: DEVICES[device].deviceScaleFactor } });
  fs.writeFileSync(path.join(outDir, file), Buffer.from(shot.data, 'base64'));
  await ctx.close();
  return { file, w: size.w, h };
}

(async () => {
  const want = process.argv.slice(2);
  const pages = want.length ? want : fs.readdirSync(root)
    .filter((f) => f.endsWith('.html') && !SKIP.has(f.slice(0, -5)))
    .map((f) => (f === 'index.html' ? '/' : '/' + f.slice(0, -5)))
    .sort();
  fs.mkdirSync(outDir, { recursive: true });
  const indexFile = path.join(outDir, 'index.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { pages: {} };

  const server = spawn(process.execPath, [path.join(root, 'scripts', 'dev-server.mjs'), String(PORT)], { stdio: 'ignore' });
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const taken = new Date().toISOString();
    for (const page of pages) {
      index.pages[page] = index.pages[page] || {};
      for (const device of Object.keys(DEVICES)) {
        const shot = await shoot(browser, page, device);
        index.pages[page][device] = { ...shot, taken };
        console.log(page, device, shot.w + 'x' + shot.h);
      }
    }
    await browser.close();
    // Drop pages whose HTML file is gone.
    for (const p of Object.keys(index.pages)) {
      const f = p === '/' ? 'index.html' : p.slice(1) + '.html';
      if (!fs.existsSync(path.join(root, f))) {
        for (const d of Object.values(index.pages[p])) fs.rmSync(path.join(outDir, d.file), { force: true });
        delete index.pages[p];
      }
    }
    index.updated = taken;
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + '\n');
  } finally {
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });

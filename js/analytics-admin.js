/* Adessa analytics dashboard (staff only). Plain JS, no dependencies. Docs: docs/analytics.md */
(function () {
  'use strict';

  // ---------- tiny DOM helpers (text always goes in as text, never HTML) ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    append(el, kids);
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    setAttrs(el, attrs);
    append(el, kids);
    return el;
  }
  function setAttrs(el, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  // ---------- formatting ----------
  const nf = new Intl.NumberFormat('en-US');
  const n = (v) => (v == null ? '–' : nf.format(Math.round(v)));
  const n1 = (v) => (v == null ? '–' : v.toFixed(1));
  const pct = (v, d = 0) => (v == null ? '–' : (v * 100).toFixed(d) + '%');
  function dur(ms) {
    if (ms == null) return '–';
    const t = Math.round(ms / 1000);
    if (t < 60) return t + 's';
    const m = Math.floor(t / 60), sec = t % 60;
    if (m < 60) return m + 'm ' + String(sec).padStart(2, '0') + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  let TZ = 'America/New_York';
  const dtf = (o) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, o));
  const dayLabel = (d) => dtf({ month: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00Z'));
  const time = (t) => dtf({ hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  const dateTime = (t) => dtf({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  const date = (t) => dtf({ month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t));
  function ago(t) {
    const sec = Math.max(0, (Date.now() - new Date(t)) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
    return Math.floor(sec / 86400) + ' d ago';
  }
  function bucketLabel(t, gran) {
    if (t.includes('T')) {
      const [d, hh] = t.split('T');
      const hr = +hh;
      return dayLabel(d) + ', ' + (hr % 12 || 12) + (hr < 12 ? ' AM' : ' PM');
    }
    return gran === 'week' ? 'Week of ' + dayLabel(t) : dayLabel(t);
  }
  const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) : '');
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* old browser */ }
  const country = (cc) => (cc ? (regionNames ? regionNames.of(cc) : cc) || cc : 'Unknown');
  let langNames = null;
  try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch (e) { /* old browser */ }
  const language = (l) => { try { return langNames ? langNames.of(l) : l; } catch (e) { return l; } };
  const place = (p) => [p.city, p.region && p.country === 'US' ? p.region : null, p.country && p.country !== 'US' ? country(p.country) : null].filter(Boolean).join(', ') || country(p.country);
  const visitorName = (v) => v.email || (v.browser_id ? 'Visitor ' + v.browser_id.slice(0, 6) : 'Visitor without an ID');
  const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);

  // ---------- "?" explanations ----------
  const HELP = {
    visitors: 'People counted once per day. We never store anything that links one day to the next for most people, so someone who visits on three different days counts three times. Ranges add up the daily counts.',
    views: 'Every page opened, including a second look at the same page.',
    visits: 'A visit runs from the first page until the tab closes or 30 minutes pass with no activity. Visits with no sign of a person (no leave signal and no action) are left out and counted as likely bots in Settings.',
    bounce: 'A bounce is a visit that saw one page, did no action and left within 10 seconds of active time. Bounce rate is bounces divided by visits.',
    avgvisit: 'Active time per visit, added up across its pages. Time only counts while the page is visible and the person scrolled, clicked, tapped, typed or moved the mouse in the last 2 minutes, so a tab left open doesn’t inflate it.',
    ppv: 'Page views divided by visits.',
    returning: 'Share of visits from a browser that has been here before. Only browsers that keep an ID can be told apart: visitors with Global Privacy Control or Do Not Track, and visitors in the EU, EEA, UK or Switzerland, are counted but never marked new or returning.',
    actions: 'Things people did: email and phone link clicks, downloads, links to other sites, form submissions and any custom action the team adds with analytics.track().',
    chart: 'Visitors and page views for each day (each hour for ranges of two days or less, each week for ranges over 120 days).',
    pages: 'Views, unique visitors per day, average active time, how far people scrolled, how many visits started here (entries), bounce rate of those visits, and how many visits ended here (exits).',
    scroll: 'Average of the deepest point people reached on the page, as a share of the page height.',
    sources: 'Where a visit came from: the utm_source tag if the link had one, then a ?ref= tag, then the referring site. "Direct" means no referring site (typed, bookmarked, or from an app that hides it).',
    campaigns: 'Visits that arrived from links tagged with utm_campaign.',
    devices: 'Phone, tablet or desktop, from the screen size and touch support of the browser.',
    countries: 'Approximate location from the visitor’s IP address at the edge. The IP address itself is never stored.',
    live: 'Browsers with the site open and visible that interacted in the last 10 minutes. They check in every 45 seconds, so this is up to about a minute behind. A browser with several tabs counts once.',
    hours: 'When pages are viewed, by day of the week and hour, in the site’s time zone.',
    repeat: 'Browsers with more than one visit, at least one of them in this range. Only browsers that keep an ID (not EU, EEA, UK or Swiss visitors, and not those with Global Privacy Control or Do Not Track) can be followed across visits.',
    entries: 'Visits that started on this page, with the bounce rate of those visits.',
    exits: 'Visits that ended on this page.',
    heat: 'Clicks and cursor movement are grouped into a grid (50 columns across, 20 px rows) per page and device, then painted over the page at that device’s width. Cursor data is desktop only.',
    scrollmap: 'Share of page views that reached each depth. Marks at 25, 50, 75 and 100 percent.',
    bench: 'Rated only when the range has 30 or more visits. Figures come from the published studies linked in each row.',
    bots: 'Requests from known crawlers, preview tools and automated browsers are dropped on arrival. Visits that never sent a leave signal and never did anything are left out of every report and counted here.',
  };
  let pop = null, popFor = null;
  function q(key, title) {
    const b = h('button', { type: 'button', class: 'an-q', 'aria-label': 'How ' + (title || 'this') + ' is measured', 'aria-expanded': 'false', text: '?' });
    const show = () => {
      hidePop();
      popFor = b;
      b.setAttribute('aria-expanded', 'true');
      pop = h('div', { class: 'an-pop', role: 'tooltip' }, title ? h('strong', { text: title }) : null, HELP[key] || key);
      document.body.appendChild(pop);
      const r = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = Math.min(Math.max(16, r.left + r.width / 2 - pw / 2), innerWidth - pw - 16);
      let top = r.bottom + 10;
      if (top + ph > innerHeight - 16) top = r.top - ph - 10;
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    };
    b.addEventListener('mouseenter', () => { if (matchMedia('(hover: hover)').matches) show(); });
    b.addEventListener('mouseleave', () => { if (matchMedia('(hover: hover)').matches) hidePop(); });
    b.addEventListener('focus', show);
    b.addEventListener('blur', hidePop);
    b.addEventListener('click', (e) => { e.stopPropagation(); popFor === b && pop ? hidePop() : show(); });
    return b;
  }
  function hidePop() { if (pop) pop.remove(); if (popFor) popFor.setAttribute('aria-expanded', 'false'); pop = null; popFor = null; }
  document.addEventListener('click', hidePop);
  addEventListener('scroll', hidePop, { passive: true });

  // ---------- toast ----------
  let toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = h('div', { class: 'an-toast', role: 'status' }); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
  }

  // ---------- state and API ----------
  const state = {
    range: store.get('a_range') || '30d', from: store.get('a_from') || '', to: store.get('a_to') || '',
    sample: store.get('a_sample') === '1', user: null, config: null, devStaff: store.get('a_dev_staff') || '',
  };
  let getToken = async () => null;

  async function api(r, params, opts) {
    const qs = new URLSearchParams(Object.assign({ r }, params || {}));
    if (state.sample) qs.set('sample', '1');
    const headers = {};
    const token = await getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (state.devStaff) headers['x-dev-staff'] = state.devStaff;
    const init = { headers, credentials: 'same-origin' };
    if (opts && opts.body) { init.method = 'POST'; init.body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
    const res = await fetch('/api/analytics/data?' + qs, init);
    if (opts && opts.raw) return res;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { gate('signin'); throw new Error('signed out'); }
    if (res.status === 403) { gate('denied', data.email); throw new Error('denied'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  const rangeParams = () => (state.range === 'custom' ? { range: 'custom', from: state.from, to: state.to } : { range: state.range });

  // ---------- boot and sign-in ----------
  const app = document.getElementById('app');
  function logo(cls) { return s('svg', { viewBox: '0 0 975 345', class: cls, role: 'img', 'aria-label': 'Adessa Mind' }, s('use', { href: '#adessa-mind' })); }

  function gate(kind, email) {
    stopTimers();
    const box = h('div', { class: 'an-gate__box' }, logo());
    if (kind === 'signin') {
      box.append(h('h1', { class: 'ds-h3', text: 'Analytics' }), h('p', { class: 'ds-body-s ds-text-secondary', text: 'For the Adessa team. Sign in with your staff email.' }));
      if (window.Clerk && state.config && state.config.clerkPublishableKey) {
        const mount = h('div');
        box.append(mount);
        window.Clerk.mountSignIn(mount, { forceRedirectUrl: location.href, signUpUrl: location.href });
      } else if (state.config && state.config.devAuth) {
        const input = h('input', { class: 'ds-input', type: 'email', placeholder: 'Staff email', 'aria-label': 'Staff email', value: state.devStaff || '' });
        box.append(input, h('button', { class: 'ds-btn', type: 'button', text: 'Continue (local only)', onclick: () => { state.devStaff = input.value.trim(); store.set('a_dev_staff', state.devStaff); start(); } }));
      } else {
        box.append(h('p', { class: 'ds-body-s ds-text-secondary', text: 'Sign-in isn’t set up yet. Add CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to this project in Vercel.' }));
      }
    } else if (kind === 'denied') {
      box.append(h('h1', { class: 'ds-h3', text: 'Not on the list' }),
        h('p', { class: 'ds-body-s ds-text-secondary', text: (email ? email + ' isn’t' : 'This account isn’t') + ' on the analytics staff list. Ask an admin to add it to ANALYTICS_STAFF_EMAILS.' }),
        h('button', { class: 'ds-btn ds-btn--secondary', type: 'button', text: 'Sign out', onclick: signOut }));
    } else {
      box.append(h('p', { class: 'ds-body-s ds-text-secondary', text: email || 'Something went wrong.' }));
    }
    clear(app).append(h('main', { class: 'an-gate' }, box));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true; el.crossOrigin = 'anonymous';
      el.onload = resolve; el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  async function initClerk(pk) {
    // The Frontend API host is encoded in the publishable key.
    const fapi = atob(pk.split('_')[2]).replace(/\$$/, '');
    await loadScript('https://' + fapi + '/npm/@clerk/ui@1.39.1/dist/ui.browser.js');
    const el = document.createElement('script');
    el.setAttribute('data-clerk-publishable-key', pk);
    await new Promise((resolve, reject) => { el.src = 'https://' + fapi + '/npm/@clerk/clerk-js@6.38.1/dist/clerk.browser.js'; el.crossOrigin = 'anonymous'; el.onload = resolve; el.onerror = reject; document.head.appendChild(el); });
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    getToken = async () => (window.Clerk.session ? window.Clerk.session.getToken() : null);
    return window.Clerk.isSignedIn;
  }
  async function signOut() {
    store.set('a_dev_staff', null); state.devStaff = '';
    if (window.Clerk && window.Clerk.signOut) await window.Clerk.signOut();
    location.reload();
  }

  async function start() {
    try {
      state.config = await (await fetch('/api/analytics/data?r=config')).json();
      TZ = state.config.tz || TZ;
      if (state.config.clerkPublishableKey && !state.devStaff) {
        const signedIn = await initClerk(state.config.clerkPublishableKey);
        if (!signedIn) return gate('signin');
      } else if (!state.devStaff) {
        return gate('signin');
      }
      state.user = await api('me');
      // A browser that signs in here is the team's: the tracking script on the site will skip it.
      if (store.get('a_staff_counted') !== '1') store.set('a_staff', '1');
      shell();
      route();
    } catch (e) {
      if (!/signed out|denied/.test(e.message)) gate('error', 'The dashboard couldn’t load. ' + e.message);
    }
  }

  // ---------- shell ----------
  const NAV = [
    ['overview', 'Overview'], ['live', 'Live'], ['pages', 'Pages'], ['heatmaps', 'Heatmaps'], ['audience', 'Audience'],
    ['visitors', 'Visitors'], ['actions', 'Actions'], ['settings', 'Settings'],
  ];
  let mainEl, sideEl, navEl, liveBadge;
  function shell() {
    navEl = h('ul', { class: 'an-nav' }, NAV.map(([id, label]) => h('li', null, h('a', { href: '#' + id, 'data-id': id, onclick: () => sideEl.classList.remove('is-open') },
      h('span', { text: label }), id === 'live' ? (liveBadge = h('span', { class: 'an-nav__live', hidden: true }, h('i', { class: 'an-dot' }), h('span', { text: '0' }))) : null))));
    const themeBtn = h('button', { type: 'button', class: 'an-linkbtn', text: themeLabel(), onclick: () => { toggleTheme(); themeBtn.textContent = themeLabel(); } });
    const sampleSwitch = h('button', { type: 'button', role: 'switch', class: 'an-switch', 'aria-checked': String(state.sample), 'aria-label': 'Sample data', onclick: () => setSample(!state.sample) });
    sideEl = h('aside', { class: 'an-side', 'aria-label': 'Analytics' },
      h('a', { class: 'an-brand', href: '#overview' }, logo(), h('span', { class: 'ds-caption-m ds-text-secondary', text: 'Analytics' })),
      h('nav', { 'aria-label': 'Reports' }, navEl),
      h('div', { class: 'an-side__foot' },
        h('label', { class: 'an-label' }, h('span', { text: 'Sample data' }), sampleSwitch),
        h('div', { class: 'an-who', text: state.user.email }),
        h('div', { class: 'ds-row', style: { '--row-gap': '20px' } }, themeBtn, h('button', { type: 'button', class: 'an-linkbtn', text: 'Sign out', onclick: signOut }))));
    const menuBtn = h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', 'aria-expanded': 'false', text: 'Menu', onclick: () => {
      const open = !sideEl.classList.contains('is-open');
      sideEl.classList.toggle('is-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.textContent = open ? 'Close' : 'Menu';
    } });
    const top = h('header', { class: 'an-topbar' }, h('a', { href: '#overview', 'aria-label': 'Analytics overview' }, logo()), menuBtn);
    mainEl = h('main', { class: 'an-main', id: 'main' });
    clear(app).append(top, h('div', { class: 'an-shell' }, sideEl, mainEl));
    addEventListener('hashchange', () => { menuBtn.textContent = 'Menu'; menuBtn.setAttribute('aria-expanded', 'false'); sideEl.classList.remove('is-open'); route(); });
    pollLiveBadge();
  }
  function themeLabel() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light mode' : 'Dark mode'; }
  function toggleTheme() {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    store.set('a_theme', t);
    route();
  }
  function setSample(on) {
    state.sample = on;
    store.set('a_sample', on ? '1' : null);
    document.querySelectorAll('.an-switch[aria-label="Sample data"]').forEach((b) => b.setAttribute('aria-checked', String(on)));
    toast(on ? 'Sample data on. Nothing is saved.' : 'Showing real data');
    pollLiveBadge();
    route();
  }

  // ---------- timers ----------
  let timers = [];
  function every(ms, fn) { const t = setInterval(() => { if (!document.hidden) fn(); }, ms); timers.push(t); return t; }
  function stopTimers() { timers.forEach(clearInterval); timers = []; }
  let badgeTimer = 0;
  function pollLiveBadge() {
    clearInterval(badgeTimer);
    const tick = async () => {
      try {
        const d = await api('live');
        if (liveBadge) { liveBadge.hidden = !d.count; liveBadge.lastChild.textContent = d.count; }
      } catch (e) { /* ignore */ }
    };
    tick();
    badgeTimer = setInterval(() => { if (!document.hidden) tick(); }, 30000);
  }

  // ---------- routing ----------
  let renderSeq = 0;
  function route() {
    stopTimers();
    hidePop();
    closePanel();
    const hash = decodeURIComponent(location.hash.slice(1)) || 'overview';
    const [page, ...rest] = hash.split('/');
    const arg = rest.join('/');
    const id = NAV.some(([k]) => k === page) ? page : page === 'visitor' ? 'visitors' : 'overview';
    navEl.querySelectorAll('a').forEach((a) => { if (a.dataset.id !== id) a.removeAttribute('aria-current'); else a.setAttribute('aria-current', 'page'); });
    const fn = page === 'visitor' ? () => pageVisitor(arg) : PAGES[id];
    const seq = ++renderSeq;
    fn(seq);
    window.scrollTo(0, 0);
  }

  function frame(title, sub, opts) {
    const wrap = h('div', { class: 'an-wrap' });
    if (state.sample) wrap.append(h('div', { class: 'an-banner', role: 'status' }, h('span', null, h('strong', { text: 'Sample data' }), 'Made-up numbers for demos. Nothing is saved while this is on.'), h('button', { type: 'button', class: 'ds-btn', text: 'Show real data', onclick: () => setSample(false) })));
    const head = h('div', { class: 'an-head' }, h('div', { class: 'an-head__title' }, h('h1', { text: title }), sub ? h('p', { class: 'an-sub', text: sub }) : null));
    if (!opts || opts.range !== false) head.append(rangePicker());
    wrap.append(head);
    const body = h('div', { class: 'an-body' });
    wrap.append(body);
    clear(mainEl).append(wrap);
    return body;
  }

  // ---------- range picker ----------
  const RANGES = [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months'], ['custom', 'Custom']];
  function rangePicker() {
    const box = h('div', { class: 'an-filters', role: 'group', 'aria-label': 'Date range' });
    const custom = h('div', { class: 'an-custom', hidden: state.range !== 'custom' });
    const today = new Date().toISOString().slice(0, 10);
    const earliest = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    const from = h('input', { class: 'an-input', type: 'date', 'aria-label': 'From', min: earliest, max: today, value: state.from || new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10) });
    const to = h('input', { class: 'an-input', type: 'date', 'aria-label': 'To', min: earliest, max: today, value: state.to || today });
    const apply = () => { if (!from.value || !to.value) return; state.from = from.value; state.to = to.value; store.set('a_from', state.from); store.set('a_to', state.to); route(); };
    from.addEventListener('change', apply); to.addEventListener('change', apply);
    custom.append(from, h('span', { text: 'to' }), to);
    const seg = h('div', { class: 'an-seg' }, RANGES.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(state.range === k), text: label, onclick: () => {
      state.range = k; store.set('a_range', k);
      if (k === 'custom') { custom.hidden = false; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === label))); apply(); return; }
      route();
    } })));
    box.append(seg, custom);
    return box;
  }
  const rangeText = (r) => (r.key === '24h' ? 'last 24 hours' : r.from === r.to ? date(r.from + 'T12:00:00Z') : dayLabel(r.from) + ' to ' + dayLabel(r.to));

  // ---------- building blocks ----------
  function card(title, help, span, ...kids) {
    return h('section', { class: 'an-card', style: { '--span': span || 12 } },
      h('div', { class: 'an-card__head' }, h('h2', { class: 'an-card__title' }, title, help ? q(help, title) : null)), kids);
  }
  function delta(cur, prev) {
    if (cur == null || prev == null || prev === 0) return h('span', { class: 'an-delta', text: prev === 0 && cur ? 'new this period' : 'no earlier data' });
    const d = (cur - prev) / prev;
    const arrow = d > 0.005 ? '↑' : d < -0.005 ? '↓' : '→';
    return h('span', { class: 'an-delta' }, h('b', { text: arrow + ' ' + Math.abs(d * 100).toFixed(d && Math.abs(d) < 0.1 ? 1 : 0) + '%' }), ' vs previous');
  }
  function stat(label, help, value, cur, prev) {
    return h('div', { class: 'an-stat' }, h('div', { class: 'an-stat__label' }, label, q(help, label)), h('div', { class: 'an-stat__value', text: value }), delta(cur, prev));
  }
  function bars(rows, opts) {
    if (!rows || !rows.length) return h('p', { class: 'an-empty', text: 'Nothing here yet for this range.' });
    const max = Math.max(...rows.map((r) => r.value)) || 1;
    return h('div', null,
      opts && opts.cols ? h('div', { class: 'an-bars__head' }, h('span', { text: opts.cols[0] }), h('span', { text: opts.cols[1] })) : null,
      h('ul', { class: 'an-bars' }, rows.map((r) => {
        const inner = [h('span', { class: 'an-bar__k', title: r.label, text: r.label }), h('span', { class: 'an-bar__v' }, n(r.value), r.extra ? h('small', { text: r.extra }) : null)];
        const style = { '--w': (r.value / max * 100).toFixed(1) + '%' };
        return h('li', null, r.onclick ? h('button', { type: 'button', class: 'an-bar', style, onclick: r.onclick }, inner) : r.href ? h('a', { class: 'an-bar', href: r.href, style }, inner) : h('div', { class: 'an-bar', style }, inner));
      })));
  }
  function table(cols, rows, opts) {
    opts = opts || {};
    let sortKey = opts.sort || cols[1].key, dir = -1;
    const tbody = h('tbody');
    const thead = h('thead');
    const draw = () => {
      const sorted = [...rows].sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        if (typeof x === 'string' || typeof y === 'string') return String(x || '').localeCompare(String(y || '')) * dir;
        return ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)) * dir;
      });
      clear(thead).append(h('tr', null, cols.map((c) => h('th', { scope: 'col', 'aria-sort': c.key === sortKey ? (dir < 0 ? 'descending' : 'ascending') : null },
        h('button', { type: 'button', onclick: () => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = typeof rows[0]?.[c.key] === 'string' ? 1 : -1; } draw(); } }, c.label, c.key === sortKey ? (dir < 0 ? ' ↓' : ' ↑') : '')))));
      clear(tbody).append(...sorted.slice(0, opts.limit || 500).map((r) => h('tr', null, cols.map((c) => h('td', { title: c.key === cols[0].key ? String(r[c.key] ?? '') : null }, c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key]) : r[c.key])))));
    };
    if (!rows.length) return h('p', { class: 'an-empty', text: opts.empty || 'Nothing here yet for this range.' });
    draw();
    return h('div', { class: 'an-tablebox' }, h('table', { class: 'an-table' }, thead, tbody));
  }

  // Line chart with a crosshair tooltip. Two series of the same unit on one axis.
  function lineChart(points, series, gran) {
    const box = h('div', { class: 'an-chart' });
    const legend = h('div', { class: 'an-legend' }, series.map((sr) => h('span', null, h('i', { style: { background: sr.color } }), sr.name)));
    const draw = () => {
      const W = Math.max(300, box.clientWidth || 800), H = W < 600 ? 220 : 280, padL = 44, padR = 16, padT = 12, padB = 30;
      const max = Math.max(1, ...points.flatMap((p) => series.map((sr) => p[sr.key])));
      const stepV = Math.max(1, niceMax(max / 4)), nice = stepV * Math.ceil(max / stepV);
      const tickN = Math.round(nice / stepV);
      const x = (i) => padL + (points.length < 2 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (points.length - 1));
      const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': series.map((sr) => sr.name).join(' and ') + ' over time' });
      for (let k = 0; k <= tickN; k++) {
        const v = stepV * k;
        svg.append(s('line', { class: 'an-grid-line', x1: padL, x2: W - padR, y1: y(v), y2: y(v), 'stroke-dasharray': k ? '2 4' : null }));
        svg.append(s('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', text: compact(v) }));
      }
      const ticks = Math.min(points.length, W < 600 ? 4 : 7);
      for (let k = 0; k < ticks; k++) {
        const i = Math.round(k * (points.length - 1) / Math.max(1, ticks - 1));
        const t = points[i].t;
        const label = t.includes('T') ? hourLabel(t) : dayLabel(t);
        svg.append(s('text', { x: x(i), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle', text: label }));
      }
      for (const sr of series) {
        const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[sr.key]).toFixed(1)).join(' ');
        svg.append(s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
      const cross = s('line', { y1: padT, y2: H - padB, stroke: 'currentColor', 'stroke-width': 1, opacity: 0, style: { color: 'var(--color-text-muted)' } });
      const dots = series.map((sr) => s('circle', { r: 4, fill: sr.color, stroke: 'var(--an-card)', 'stroke-width': 2, opacity: 0 }));
      svg.append(cross, ...dots);
      const hit = s('rect', { x: padL, y: 0, width: W - padL - padR, height: H, fill: 'transparent', tabindex: 0, 'aria-label': 'Chart values, use arrow keys' });
      svg.append(hit);
      const tip = h('div', { class: 'an-tip', hidden: true });
      let cur = points.length - 1;
      const showAt = (i) => {
        cur = Math.max(0, Math.min(points.length - 1, i));
        const p = points[cur];
        cross.setAttribute('x1', x(cur)); cross.setAttribute('x2', x(cur)); cross.setAttribute('opacity', 1);
        dots.forEach((dt, k) => { dt.setAttribute('cx', x(cur)); dt.setAttribute('cy', y(p[series[k].key])); dt.setAttribute('opacity', 1); });
        clear(tip).append(h('div', { class: 'an-tip__t', text: bucketLabel(p.t, gran) }), series.map((sr) => h('div', { class: 'an-tip__r' }, h('i', { style: { background: sr.color } }), h('b', { text: n(p[sr.key]) }), sr.name)));
        tip.hidden = false;
        const scale = box.clientWidth / W;
        const left = x(cur) * scale;
        tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), box.clientWidth - tip.offsetWidth) + 'px';
        tip.style.top = '-8px';
      };
      const hide = () => { tip.hidden = true; cross.setAttribute('opacity', 0); dots.forEach((dt) => dt.setAttribute('opacity', 0)); };
      hit.addEventListener('pointermove', (e) => {
        const r = svg.getBoundingClientRect();
        const px = (e.clientX - r.left) * (W / r.width);
        showAt(Math.round((px - padL) / ((W - padL - padR) / Math.max(1, points.length - 1))));
      });
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', () => showAt(cur));
      hit.addEventListener('blur', hide);
      hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { showAt(cur - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { showAt(cur + 1); e.preventDefault(); } });
      clear(box).append(svg, tip);
    };
    requestAnimationFrame(draw);
    onResize(box, draw);
    return h('div', { class: 'ds-stack', style: { '--stack-gap': '16px' } }, legend, box);
  }
  function hourLabel(t) { const hr = +t.split('T')[1]; return (hr % 12 || 12) + (hr < 12 ? 'a' : 'p'); }
  function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function compact(v) { return v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v * 10) / 10); }
  function spark(values) {
    const W = 120, H = 28, max = Math.max(1, ...values);
    const d = values.map((v, i) => (i ? 'L' : 'M') + (values.length < 2 ? 0 : i * W / (values.length - 1)).toFixed(1) + ' ' + (H - 2 - (H - 4) * v / max).toFixed(1)).join(' ');
    return s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', style: { display: 'block' } }, s('path', { d, fill: 'none', stroke: 'var(--an-series-1)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
  }
  const resizers = new Set();
  function onResize(el, fn) {
    let w = 0;
    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (Math.abs(el.clientWidth - w) > 4) { w = el.clientWidth; fn(); } });
    ro.observe(el);
    resizers.add(ro);
  }

  // ---------- side panel ----------
  let panelEl, scrimEl, lastFocus;
  function openPanel(title, sub, body) {
    closePanel();
    lastFocus = document.activeElement;
    scrimEl = h('div', { class: 'an-scrim', onclick: closePanel });
    const closeBtn = h('button', { type: 'button', class: 'an-close', 'aria-label': 'Close', onclick: closePanel }, s('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' }, s('path', { d: 'M1 1l12 12M13 1L1 13', stroke: 'currentColor', 'stroke-width': 1.5 })));
    panelEl = h('aside', { class: 'an-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'an-panel__head' }, h('div', { class: 'ds-stack', style: { '--stack-gap': '6px' } }, h('h2', { class: 'ds-h4', text: title }), sub ? h('p', { class: 'an-meta', text: sub }) : null), closeBtn),
      h('div', { class: 'an-panel__body' }, body));
    document.body.append(scrimEl, panelEl);
    requestAnimationFrame(() => { scrimEl.classList.add('is-open'); panelEl.classList.add('is-open'); closeBtn.focus(); });
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closePanel(); }
  function closePanel() {
    if (!panelEl) return;
    const p = panelEl, sc = scrimEl;
    p.classList.remove('is-open'); sc.classList.remove('is-open');
    setTimeout(() => { p.remove(); sc.remove(); }, 330);
    panelEl = null; scrimEl = null;
    document.removeEventListener('keydown', escClose);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // A visit, page by page.
  function visitLog(log, opts) {
    if (!log || !log.length) return h('p', { class: 'an-empty', text: 'No pages recorded for this visit.' });
    return h('ol', { class: 'an-log' }, log.map((e) => e.kind === 'view'
      ? h('li', { class: e.open ? 'is-open' : null }, h('time', { text: time(e.at) }), h('span', { class: 'p', title: e.path, text: e.path }),
        h('span', { class: 'm', text: e.open && opts && opts.live ? 'here now' : dur(e.active_ms) + ' · ' + e.scroll + '%' }))
      : h('li', { class: 'is-action' }, h('time', { text: time(e.at) }), h('span', { class: 'p', title: (e.label || '') + ' on ' + e.path, text: e.name + (e.label ? ': ' + e.label : '') }), h('span', { class: 'm', text: 'action' }))));
  }

  // ---------- loading wrapper ----------
  async function load(seq, body, fn) {
    body.classList.add('an-loading');
    try {
      await fn();
    } catch (e) {
      if (seq !== renderSeq || /signed out|denied/.test(e.message)) return;
      clear(body).append(h('p', { class: 'an-empty', text: 'This report didn’t load. ' + e.message }));
    } finally { body.classList.remove('an-loading'); }
  }

  // ==================================================================
  // Pages
  // ==================================================================
  const PAGES = {};

  PAGES.overview = (seq) => {
    const body = frame('Overview', null);
    body.append(h('p', { class: 'an-empty', text: 'Loading…' }));
    load(seq, body, async () => {
      const d = await api('overview', rangeParams());
      if (seq !== renderSeq) return;
      const t = d.totals, p = d.prev;
      const sub = mainEl.querySelector('.an-head__title');
      if (!sub.querySelector('.an-sub')) sub.append(h('p', { class: 'an-sub', text: cap(rangeText(d.range)) + ', ' + d.range.tz.replace('_', ' ') + ' time' }));
      clear(body).append(
        h('div', { class: 'an-stats' },
          stat('Visitors', 'visitors', n(t.visitors), t.visitors, p.visitors),
          stat('Page views', 'views', n(t.views), t.views, p.views),
          stat('Visits', 'visits', n(t.visits), t.visits, p.visits),
          stat('Bounce rate', 'bounce', pct(t.bounce_rate), t.bounce_rate, p.bounce_rate),
          stat('Average visit', 'avgvisit', dur(t.avg_visit_ms), t.avg_visit_ms, p.avg_visit_ms),
          stat('Pages per visit', 'ppv', n1(t.pages_per_visit), t.pages_per_visit, p.pages_per_visit),
          stat('Returning', 'returning', t.returning_share == null ? '–' : pct(t.returning_share), t.returning_share, p.returning_share),
          stat('Actions', 'actions', n(t.actions), t.actions, p.actions)),
        h('div', { class: 'an-grid' },
          card('Visitors and page views', 'chart', 12, lineChart(d.chart, [{ key: 'visitors', name: 'Visitors', color: 'var(--an-series-1)' }, { key: 'views', name: 'Page views', color: 'var(--an-series-2)' }], d.range.gran)),
          card('Top pages', 'pages', 6, bars(d.top.pages.map((r) => ({ label: r.key, value: r.views, extra: n(r.visitors) + ' visitors' })), { cols: ['Page', 'Views'] }), h('a', { class: 'an-linkbtn', href: '#pages', text: 'All pages' })),
          card('Top sources', 'sources', 6, bars(d.top.sources.map((r) => ({ label: r.key, value: r.visits, extra: pct(r.bounce_rate) + ' bounce' })), { cols: ['Source', 'Visits'] }), h('a', { class: 'an-linkbtn', href: '#audience', text: 'All sources' })),
          card('Campaigns', 'campaigns', 4, bars(d.top.campaigns.map((r) => ({ label: r.key, value: r.visits })), { cols: ['Campaign', 'Visits'] })),
          card('Devices', 'devices', 4, bars(d.top.devices.map((r) => ({ label: cap(r.key), value: r.visits, extra: pct(r.visits / (t.visits || 1)) })), { cols: ['Device', 'Visits'] })),
          card('Countries', 'countries', 4, bars(d.top.countries.map((r) => ({ label: flag(r.key) + ' ' + country(r.key), value: r.visits })), { cols: ['Approximate', 'Visits'] })),
          card('Top actions', 'actions', 6, bars(d.top.actions.map((r) => ({ label: r.key, value: r.count, extra: n(r.visits) + ' visits', href: '#actions' })), { cols: ['Action', 'Times'] })),
          card('New and returning', 'returning', 6, bars([
            { label: 'New', value: t.new_visits, extra: t.visits ? pct(t.new_visits / t.visits) : '' },
            { label: 'Returning', value: t.returning_visits, extra: t.visits ? pct(t.returning_visits / t.visits) : '' },
            { label: 'Not identifiable', value: t.unknown_visits, extra: t.visits ? pct(t.unknown_visits / t.visits) : '' },
          ], { cols: ['Visits', 'Count'] })),
          benchCard(d.benchmarks)));
    });
  };

  function benchCard(b) {
    if (!b || !b.rows || !b.rows.length) return null;
    const fmtV = (r, v) => (v == null ? '–' : r.unit === 'percent' ? pct(v) : r.unit === 'seconds' ? dur(v * 1000) : n1(v));
    const rows = h('div', { class: 'an-bench' });
    for (const r of b.rows) {
      const lo = Math.min(r.low, r.high, r.goal, r.value ?? r.low), hi = Math.max(r.low, r.high, r.goal, r.value ?? r.high);
      const span = (hi - lo) || 1, padv = span * 0.15, min = lo - padv, max = hi + padv;
      const posPct = (v) => ((v - min) / (max - min) * 100).toFixed(2) + '%';
      const status = r.status ? h('span', { class: 'an-chip an-chip--' + (r.status === 'At goal' ? 'good' : r.status === 'Typical' ? 'warn' : 'bad') }, r.status === 'At goal' ? '✓ ' : r.status === 'Typical' ? '– ' : '! ', r.status) : h('span', { class: 'an-chip', text: 'Needs 30 visits' });
      const note = h('div', { class: 'an-bench__note', hidden: true },
        h('p', { text: r.note.what }), h('p', null, h('strong', { text: 'What moves it: ' }), r.note.moves),
        h('p', { class: 'an-meta' }, 'Typical ', fmtV(r, r.low), ' to ', fmtV(r, r.high), ', goal ', fmtV(r, r.goal), (r.higher_is_better ? ' or higher' : ' or lower'), '. Sources: ',
          r.sources.map((src, i) => [i ? ', ' : '', h('a', { href: src.url, target: '_blank', rel: 'noopener', text: src.name })])));
      const row = h('button', { type: 'button', class: 'an-bench__row', 'aria-expanded': 'false', onclick: () => { note.hidden = !note.hidden; row.setAttribute('aria-expanded', String(!note.hidden)); } },
        h('span', { text: r.label }), h('span', { class: 'an-bench__v', text: fmtV(r, r.value) }),
        h('span', { class: 'an-range', 'aria-hidden': 'true' }, h('span', { class: 'an-range__track' }), h('span', { class: 'an-range__band', style: { left: posPct(Math.min(r.low, r.high)), width: ((Math.abs(r.high - r.low)) / (max - min) * 100).toFixed(2) + '%' } }),
          h('span', { class: 'an-range__goal', style: { left: posPct(r.goal) } }), r.value != null ? h('span', { class: 'an-range__you', style: { left: posPct(r.value) } }) : null),
        status);
      rows.append(row, note);
    }
    return card('How you compare', 'bench', 12,
      h('p', { class: 'an-card__note', text: 'Against published figures for ' + b.site_type.toLowerCase() + '. The shaded band is the typical range, the tick is the goal, the dot is you. Open a row for what it means and the sources.' }), rows);
  }

  PAGES.pages = (seq) => {
    const body = frame('Pages', 'What people look at, where visits start and end');
    load(seq, body, async () => {
      const d = await api('pages', rangeParams());
      if (seq !== renderSeq) return;
      const search = h('input', { class: 'an-input an-search', type: 'search', placeholder: 'Search pages', 'aria-label': 'Search pages' });
      const tableBox = h('div');
      const cols = [
        { key: 'key', label: 'Page' }, { key: 'views', label: 'Views', fmt: n }, { key: 'visitors', label: 'Visitors', fmt: n },
        { key: 'avg_active_ms', label: 'Avg time', fmt: dur }, { key: 'avg_scroll', label: 'Scroll', fmt: (v) => (v == null ? '–' : Math.round(v) + '%') },
        { key: 'entries', label: 'Entries', fmt: n }, { key: 'bounce_rate', label: 'Bounce', fmt: (v) => pct(v) }, { key: 'exits', label: 'Exits', fmt: n },
      ];
      const drawTable = () => { const ql = search.value.trim().toLowerCase(); clear(tableBox).append(table(cols, d.pages.filter((p) => !ql || p.key.toLowerCase().includes(ql)), { sort: 'views' })); };
      search.addEventListener('input', drawTable);
      drawTable();
      clear(body).append(h('div', { class: 'an-grid' },
        card('All pages', 'pages', 12, search, tableBox),
        card('Landing pages', 'entries', 6, bars(d.landing.map((p) => ({ label: p.key, value: p.entries, extra: pct(p.bounce_rate) + ' bounce' })), { cols: ['Page', 'Entries'] })),
        card('Exit pages', 'exits', 6, bars(d.exits.map((p) => ({ label: p.key, value: p.exits, extra: pct(p.exit_rate) + ' of views' })), { cols: ['Page', 'Exits'] })),
        card('When people visit', 'hours', 12, hoursGrid(d.hours))));
    });
  };

  function hoursGrid(cells) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const map = new Map(cells.map((c) => [c.dow + ':' + c.hour, c.views]));
    const max = Math.max(1, ...cells.map((c) => c.views));
    const grid = h('div', { class: 'an-hours', role: 'table', 'aria-label': 'Page views by day and hour' });
    const tip = h('div', { class: 'an-tip', hidden: true });
    grid.append(h('span'));
    for (let hr = 0; hr < 24; hr++) grid.append(h('span', { class: 'an-hours__x', text: hr % 3 === 0 ? (hr % 12 || 12) + (hr < 12 ? 'a' : 'p') : '' }));
    days.forEach((dname, i) => {
      grid.append(h('span', { class: 'an-hours__l', text: dname }));
      for (let hr = 0; hr < 24; hr++) {
        const v = map.get(i + 1 + ':' + hr) || 0;
        const label = dname + ' ' + (hr % 12 || 12) + (hr < 12 ? ' AM' : ' PM') + ': ' + n(v) + ' views';
        const cell = h('span', { class: 'an-hours__c', role: 'cell', tabindex: 0, 'aria-label': label, style: { '--a': (0.05 + 0.9 * Math.sqrt(v / max)).toFixed(3) } });
        const show = () => { tip.textContent = label; tip.hidden = false; const r = cell.getBoundingClientRect(), g = wrapEl.getBoundingClientRect(); tip.style.left = Math.min(r.left - g.left, g.width - 170) + 'px'; tip.style.top = (r.top - g.top - 44) + 'px'; };
        cell.addEventListener('pointerenter', show); cell.addEventListener('focus', show);
        cell.addEventListener('pointerleave', () => { tip.hidden = true; }); cell.addEventListener('blur', () => { tip.hidden = true; });
        grid.append(cell);
      }
    });
    const wrapEl = h('div', { class: 'an-chart' }, grid, tip);
    return h('div', { class: 'ds-stack', style: { '--stack-gap': '12px' } }, wrapEl,
      h('div', { class: 'an-scale' }, 'Fewer', h('i', { style: { background: 'linear-gradient(90deg, rgba(var(--an-seq),0.06), rgba(var(--an-seq),0.95))' } }), 'More'));
  }

  PAGES.audience = (seq) => {
    const body = frame('Audience', 'Where visits come from and what they use');
    load(seq, body, async () => {
      const d = await api('audience', rangeParams());
      if (seq !== renderSeq) return;
      const tv = d.total_visits || 1;
      const list = (rows, label, opts) => bars(rows.slice(0, opts && opts.limit || 12).map((r) => ({ label: label ? label(r.key) : r.key, value: r.visits, extra: pct(r.visits / tv) })), { cols: [opts && opts.col || 'Name', 'Visits'] });
      clear(body).append(h('div', { class: 'an-grid' },
        card('Sources', 'sources', 6, list(d.source, null, { col: 'Source' })),
        card('Referring sites', 'sources', 6, list(d.referrer, null, { col: 'Site' })),
        card('Campaigns', 'campaigns', 6, list(d.campaign, null, { col: 'utm_campaign' })),
        card('Mediums', 'campaigns', 6, list(d.medium, null, { col: 'utm_medium' })),
        card('Devices', 'devices', 4, list(d.device, cap, { col: 'Device' })),
        card('Browsers', null, 4, list(d.browser, null, { col: 'Browser' })),
        card('Operating systems', null, 4, list(d.os, null, { col: 'System' })),
        card('Countries', 'countries', 6, list(d.country, (k) => flag(k) + ' ' + country(k), { col: 'Approximate' })),
        card('Regions', 'countries', 6, list(d.region, (k) => { const [c, r] = k.split(' / '); return flag(c) + ' ' + r + ', ' + c; }, { col: 'Approximate' })),
        card('Languages', null, 6, list(d.language, (k) => language(k) + ' (' + k + ')', { col: 'Browser language' }))));
    });
  };

  PAGES.actions = (seq) => {
    const body = frame('Actions', 'Clicks, downloads, forms and custom actions');
    load(seq, body, async () => {
      const d = await api('actions', rangeParams());
      if (seq !== renderSeq) return;
      const cols = [
        { key: 'key', label: 'Action', render: (r) => h('button', { type: 'button', class: 'an-linkbtn', style: { textTransform: 'none', letterSpacing: '0', fontSize: '14px', fontWeight: '500' }, text: r.key, onclick: () => actionPanel(r.key) }) },
        { key: 'count', label: 'Times', fmt: n }, { key: 'visitors', label: 'Visitors', fmt: n }, { key: 'visits', label: 'Visits', fmt: n },
        { key: 'rate', label: 'Of visits', fmt: (v) => pct(v, 1) },
        { key: 'trend', label: 'Trend', render: (r) => (r.trend.length ? spark(r.trend) : '–') },
        { key: 'pages', label: 'Top pages', render: (r) => r.pages.slice(0, 2).map((p) => p.path).join(', ') || '–' },
        { key: 'custom', label: 'Type', render: (r) => h('span', { class: 'an-chip', text: r.custom ? 'Custom' : 'Automatic' }) },
      ];
      clear(body).append(h('div', { class: 'an-grid' },
        card('All actions', 'actions', 12, table(cols, d.actions, { sort: 'count', empty: 'No actions in this range. Add your own with analytics.track() (see Settings).' }))));
    });
  };
  async function actionPanel(name) {
    const body = h('div', { class: 'ds-stack' }, h('p', { class: 'an-empty', text: 'Loading…' }));
    openPanel(name, 'Visits that included this action', body);
    try {
      const d = await api('action', Object.assign({ name }, rangeParams()));
      clear(body).append(d.visits.length ? h('ul', { class: 'an-people' }, d.visits.map((v) => h('li', { class: 'an-person' },
        h('div', { class: 'an-person__who' }, h('b', { text: v.email || (v.browser_id ? 'Visitor ' + v.browser_id.slice(0, 6) : 'Visitor without an ID') }), h('span', { class: 'an-meta', text: dateTime(v.started) + ' · ' + (v.source || 'Direct') + ' · ' + cap(v.device || '') })),
        h('span', { class: 'an-meta', text: v.pages + ' pages, ' + dur(v.active_ms) + (v.labels.length ? ' · ' + v.labels.join(', ') : '') }),
        h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', text: 'Visit', onclick: () => visitPanel(v.visit_id, dateTime(v.started)) })))) : h('p', { class: 'an-empty', text: 'No visits found.' }));
    } catch (e) { clear(body).append(h('p', { class: 'an-empty', text: e.message })); }
  }
  async function visitPanel(id, when) {
    const body = h('div', { class: 'ds-stack' }, h('p', { class: 'an-empty', text: 'Loading…' }));
    openPanel('Visit', when, body);
    try { const d = await api('visit', { id }); clear(body).append(visitLog(d.log)); } catch (e) { clear(body).append(h('p', { class: 'an-empty', text: e.message })); }
  }

  // ---------- Live ----------
  PAGES.live = (seq) => {
    const body = frame('Live', 'Who is on the site right now', { range: false });
    const draw = async () => {
      const d = await api('live');
      if (seq !== renderSeq) return;
      if (liveBadge) { liveBadge.hidden = !d.count; liveBadge.lastChild.textContent = d.count; }
      const people = d.people;
      clear(body).append(
        h('div', { class: 'an-livecount' }, h('b', { text: n(d.count) }), h('span', { text: d.count === 1 ? 'person on the site now' : 'people on the site now' }), q('live', 'Live visitors')),
        h('div', { class: 'an-grid' },
          card('Where they are', 'countries', 12, worldMap(people)),
          card('On the site', 'live', 12, people.length ? h('ul', { class: 'an-people' }, people.map((p) => personRow(p, true))) : h('p', { class: 'an-empty', text: 'Nobody right now. This refreshes on its own.' })),
          card('Left in the last 30 minutes', null, 12, d.left.length ? h('ul', { class: 'an-people' }, d.left.map((p) => personRow(p, false))) : h('p', { class: 'an-empty', text: 'Nobody left in the last 30 minutes.' }))));
    };
    load(seq, body, draw);
    every(12000, () => draw().catch(() => {}));
  };
  function personRow(p, isLive) {
    const name = visitorName(p);
    return h('li', { class: 'an-person' },
      h('div', { class: 'an-person__who' }, h('b', { text: name }), h('span', { class: 'an-meta', text: place(p) + ' · ' + cap(p.device || '') + ' · ' + (p.source || 'Direct') })),
      h('div', { class: 'an-person__who' }, h('span', { class: 'an-bar__k', title: p.path, text: isLive ? 'On ' + p.path : 'Last on ' + p.path }), h('span', { class: 'an-meta', text: isLive ? dur(Date.now() - new Date(p.started_at)) + ' on the site' : 'left ' + ago(p.left_at || p.last_seen) })),
      h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', text: 'Log', onclick: () => openPanel(name, place(p) + ' · ' + (p.source || 'Direct') + (isLive ? ' · here now' : ''),
        h('div', { class: 'ds-stack' }, visitLog(p.log, { live: isLive }), p.browser_id ? h('a', { class: 'ds-btn ds-btn--secondary ds-btn--s', href: '#visitor/' + encodeURIComponent(p.browser_id), onclick: closePanel, text: 'All visits' }) : null)) }));
  }
  function worldMap(people) {
    const W = window.ANALYTICS_WORLD;
    const cols = W ? W.cols : 180, rows = W ? W.rows.length : 71, cell = 6;
    const svg = s('svg', { viewBox: `0 0 ${cols * cell} ${rows * cell}`, role: 'img', 'aria-label': 'Map of live visitors, approximate locations' });
    if (W) {
      const g = s('g', { class: 'land' });
      W.rows.forEach((hex, r) => {
        for (let i = 0; i < hex.length; i++) {
          const bits = parseInt(hex[i], 16);
          for (let b = 0; b < 4; b++) if (bits & (8 >> b)) g.append(s('circle', { cx: (i * 4 + b) * cell + cell / 2, cy: r * cell + cell / 2, r: 1.5 }));
        }
      });
      svg.append(g);
    }
    const lat0 = W ? W.lat0 : 83, lon0 = W ? W.lon0 : -179, step = W ? W.step : 2;
    for (const p of people) {
      if (p.lat == null || p.lon == null) continue;
      const x = ((p.lon - lon0) / step) * cell + cell / 2, y = ((lat0 - p.lat) / step) * cell + cell / 2;
      svg.append(s('circle', { class: 'ring', cx: x, cy: y, r: 6 }), s('circle', { class: 'pin', cx: x, cy: y, r: 6 }, s('title', { text: visitorName(p) + ', ' + place(p) })));
    }
    return h('div', { class: 'an-map' }, svg, h('p', { class: 'an-meta', text: 'Locations are approximate, from the visitor’s network.' }));
  }

  // ---------- Visitors ----------
  PAGES.visitors = (seq) => {
    const body = frame('Visitors', 'Browsers that came back');
    let page = 0, searchTerm = '';
    const search = h('input', { class: 'an-input an-search', type: 'search', placeholder: 'Search by email or ID', 'aria-label': 'Search visitors' });
    let t = 0;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { searchTerm = search.value.trim(); page = 0; draw(); }, 300); });
    const listBox = h('div');
    const draw = () => load(seq, listBox, async () => {
      const d = await api('visitors', Object.assign({ page, search: searchTerm }, rangeParams()));
      if (seq !== renderSeq) return;
      const cols = [
        { key: 'name', label: 'Visitor', render: (r) => h('a', { href: '#visitor/' + encodeURIComponent(r.browser_id), text: visitorName(r) }) },
        { key: 'visits', label: 'Visits', fmt: n }, { key: 'pages', label: 'Pages', fmt: n }, { key: 'actions', label: 'Actions', fmt: n },
        { key: 'first', label: 'First seen', render: (r) => date(r.first_seen) }, { key: 'last', label: 'Last seen', render: (r) => ago(r.last_seen) },
        { key: 'top', label: 'Top pages', render: (r) => r.top_pages.slice(0, 2).join(', ') },
        { key: 'acts', label: 'Did', render: (r) => r.top_actions.slice(0, 2).join(', ') || '–' },
      ];
      const rows = d.visitors.map((v) => Object.assign({ name: visitorName(v), first: v.first_seen, last: v.last_seen, top: '', acts: '' }, v));
      clear(listBox).append(table(cols, rows, { sort: 'visits', empty: searchTerm ? 'No visitors match.' : 'No repeat visitors in this range yet.' }),
        d.total > 50 ? h('div', { class: 'ds-row' },
          h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', disabled: page === 0, text: 'Previous', onclick: () => { page--; draw(); } }),
          h('span', { class: 'an-meta', text: 'Page ' + (page + 1) + ' of ' + Math.ceil(d.total / 50) }),
          h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', disabled: (page + 1) * 50 >= d.total, text: 'Next', onclick: () => { page++; draw(); } })) : null);
    });
    body.append(h('div', { class: 'an-grid' }, card('Repeat visitors', 'repeat', 12, search, listBox)));
    draw();
  };

  function pageVisitor(id) {
    const seq = renderSeq;
    const body = frame('Visitor', null, { range: false });
    load(seq, body, async () => {
      const d = await api('visitor', { id });
      if (seq !== renderSeq) return;
      mainEl.querySelector('h1').textContent = visitorName(d);
      const t = d.totals;
      clear(body).append(
        h('a', { class: 'an-linkbtn', href: '#visitors', text: 'Back to visitors' }),
        d.on_site ? h('div', { class: 'an-banner', role: 'status' }, h('span', null, h('strong', { text: 'On the site now' }), 'Viewing ' + d.on_site.path + ' for ' + dur(Date.now() - new Date(d.on_site.started_at)) + ' this visit.')) : null,
        h('div', { class: 'an-stats' },
          h('div', { class: 'an-stat' }, h('div', { class: 'an-stat__label', text: 'Visits' }), h('div', { class: 'an-stat__value', text: n(t.visits) })),
          h('div', { class: 'an-stat' }, h('div', { class: 'an-stat__label', text: 'Pages' }), h('div', { class: 'an-stat__value', text: n(t.pages) })),
          h('div', { class: 'an-stat' }, h('div', { class: 'an-stat__label', text: 'Active time' }), h('div', { class: 'an-stat__value', text: dur(t.active_ms) })),
          h('div', { class: 'an-stat' }, h('div', { class: 'an-stat__label', text: 'Actions' }), h('div', { class: 'an-stat__value', text: n(t.actions) }))),
        h('p', { class: 'an-meta', text: 'First seen ' + (t.first_seen ? date(t.first_seen) : '–') + ' from ' + (t.first_source || 'Direct') + '. Last seen ' + (t.last_seen ? ago(t.last_seen) : '–') + '. ID ' + d.browser_id + '.' }),
        d.on_site ? card('This visit, live', 'live', 12, visitLog(d.on_site.log, { live: true })) : null,
        h('div', { class: 'an-grid' }, d.visits.map((v) => card(dateTime(v.started), null, 6,
          h('p', { class: 'an-meta', text: v.pages + ' pages · ' + dur(v.active_ms) + ' active · ' + (v.source || 'Direct') + ' · ' + cap(v.device || '') + ' · ' + place(v) }),
          visitLog(v.log)))));
      if (d.on_site) every(15000, () => { if (location.hash.startsWith('#visitor/')) route(); });
    });
  }

  // ---------- Heatmaps ----------
  const WIDTHS = { desktop: 1440, tablet: 820, phone: 390 };
  PAGES.heatmaps = (seq) => {
    const body = frame('Heatmaps', 'Where people click, move and stop scrolling');
    const st = { page: store.get('a_heat_page') || '/', device: store.get('a_heat_device') || 'desktop', mode: 'click' };
    const draw = () => load(seq, body, async () => {
      const d = await api('heat', Object.assign({ page: st.page, device: st.device }, rangeParams()));
      if (seq !== renderSeq) return;
      const pages = [...new Set([st.page, ...d.pages.map((p) => p.page)])];
      const pageSel = h('select', { class: 'an-input', 'aria-label': 'Page' }, pages.map((p) => h('option', { value: p, selected: p === st.page, text: p })));
      pageSel.addEventListener('change', () => { st.page = pageSel.value; store.set('a_heat_page', st.page); draw(); });
      const devSeg = h('div', { class: 'an-seg', role: 'group', 'aria-label': 'Device' }, Object.keys(WIDTHS).map((k) => h('button', { type: 'button', 'aria-pressed': String(st.device === k), text: cap(k), onclick: () => { st.device = k; store.set('a_heat_device', k); if (k !== 'desktop' && st.mode === 'move') st.mode = 'click'; draw(); } })));
      const modes = [['click', 'Clicks'], ['move', 'Cursor'], ['scroll', 'Scroll']].filter(([k]) => k !== 'move' || st.device === 'desktop');
      const modeSeg = h('div', { class: 'an-seg', role: 'group', 'aria-label': 'Heatmap type' }, modes.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(st.mode === k), text: label, onclick: () => { st.mode = k; draw(); } })));
      const views = d.scroll.views;
      clear(body).append(
        h('div', { class: 'an-filters' }, pageSel, devSeg, modeSeg),
        h('div', { class: 'an-grid' },
          card(st.mode === 'scroll' ? 'Scroll depth' : st.mode === 'move' ? 'Cursor movement' : 'Clicks', st.mode === 'scroll' ? 'scrollmap' : 'heat', 8,
            h('p', { class: 'an-card__note', text: n(views) + ' page views on ' + st.device + ' in this range. The page is shown live at ' + WIDTHS[st.device] + ' px wide.' }),
            heatView(d, st)),
          card('Most clicked', 'heat', 4, bars(d.elements.map((e) => ({ label: e.selector, value: e.clicks })), { cols: ['Element', 'Clicks'] }),
            h('p', { class: 'an-meta', text: 'Elements are named by tag and class, never by their text.' }))));
    });
    draw();
  };
  // The page loads live in a sandboxed frame (its own opaque origin, so its scripts can't reach the dashboard)
  // at the device's width and viewport height. js/a-preview.js inside the page asks for the heat data and draws it
  // at page coordinates, so it lines up while you scroll the preview.
  const VIEWPORT = { desktop: 900, tablet: 1180, phone: 844 };
  function heatView(d, st) {
    const W = WIDTHS[st.device], VH = VIEWPORT[st.device];
    const box = h('div', { class: 'an-heat' });
    let src = null;
    try { const u = new URL(d.page, location.origin); if (u.origin === location.origin) { u.search = '?a_preview=1'; u.hash = ''; src = u.href; } } catch (e) { /* bad path */ }
    if (!src) return h('p', { class: 'an-empty', text: 'This page can’t be previewed.' });
    const iframe = h('iframe', { class: 'an-heat__frame', title: 'Page preview with heatmap. Scroll inside it to see the whole page.', src, width: W, height: VH, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer' });
    iframe.style.pointerEvents = 'auto';
    box.append(iframe);
    const fit = () => {
      const scale = Math.min(1, box.parentElement ? box.parentElement.clientWidth / W : 1);
      iframe.style.transform = 'scale(' + scale + ')';
      box.style.width = Math.round(W * scale) + 'px';
      box.style.height = Math.round(VH * scale) + 'px';
    };
    const pts = st.mode === 'move' ? d.moves : d.clicks;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--an-heat').trim() || '196, 82, 30';
    const onMsg = (e) => {
      if (!iframe.isConnected) { removeEventListener('message', onMsg); return; }
      if (e.source !== iframe.contentWindow || !e.data || e.data.type !== 'a-ready') return;
      iframe.contentWindow.postMessage({ type: 'a-heat', mode: st.mode === 'scroll' ? 'scroll' : 'points', device: st.device, ink, points: pts, reach: d.scroll.reach }, '*');
    };
    addEventListener('message', onMsg);
    requestAnimationFrame(fit);
    onResize(box.parentElement || box, fit);
    const holder = h('div', { style: { width: '100%' } }, box);
    onResize(holder, fit);
    const empty = st.mode === 'scroll' ? !d.scroll.views : !pts.length;
    return h('div', { class: 'ds-stack', style: { '--stack-gap': '16px' } },
      empty ? h('p', { class: 'an-empty', text: 'No ' + (st.mode === 'scroll' ? 'scroll' : st.mode === 'move' ? 'cursor' : 'click') + ' data for this page and device in this range.' }) : null,
      st.mode !== 'scroll' ? h('div', { class: 'an-scale' }, 'Fewer', h('i'), 'More') : h('p', { class: 'an-meta', text: 'Darker means fewer people scrolled that far.' }),
      holder);
  }

  // ---------- Settings ----------
  PAGES.settings = (seq) => {
    const body = frame('Settings', null, { range: false });
    load(seq, body, async () => {
      const d = await api('settings');
      if (seq !== renderSeq) return;
      const counted = store.get('a_staff') !== '1';
      const post = async (b, ok) => {
        try { const r = await api('settings', null, { body: b }); toast(ok || 'Saved'); route(); return r; } catch (e) { toast(e.message); }
      };
      const ipRows = d.settings.excluded_ips.map((x) => h('div', { class: 'an-row' }, h('div', null, h('b', { text: x.key }), h('p', { class: 'an-meta', text: x.label + ' · added ' + date(x.added_at) })),
        h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', text: 'Remove', onclick: () => post({ op: 'remove_ip', key: x.key }, 'Removed') })));
      const snippet = "analytics.track('Booked a call', 'Intro call')";
      const allPages = d.settings.heat_pages === '*';
      const heatList = h('div', { class: 'an-rows', hidden: allPages }, d.pages.map((p) => {
        const on = allPages || (Array.isArray(d.settings.heat_pages) && d.settings.heat_pages.includes(p));
        return h('label', { class: 'an-row' }, h('span', { text: p }), h('input', { type: 'checkbox', checked: on, 'data-page': p }));
      }));
      const heatAll = h('button', { type: 'button', role: 'switch', class: 'an-switch', 'aria-checked': String(allPages), 'aria-label': 'Record heatmaps on every page', onclick: () => { const v = heatAll.getAttribute('aria-checked') !== 'true'; heatAll.setAttribute('aria-checked', String(v)); heatList.hidden = v; } });
      const exportTable = h('select', { class: 'an-input', 'aria-label': 'Table' }, [['events', 'Events (views and actions)'], ['daily', 'Daily totals'], ['heat', 'Heatmap counts'], ['presence', 'Live presence']].map(([v, l]) => h('option', { value: v, text: l })));
      const delInput = h('input', { class: 'an-input', placeholder: 'Browser ID', 'aria-label': 'Browser ID to delete', style: { minWidth: '220px' } });
      clear(body).append(h('div', { class: 'an-grid' },
        card('Your team', null, 12, h('div', { class: 'an-rows' },
          h('div', { class: 'an-row' }, h('div', null, h('b', { text: counted ? 'This browser is counted' : 'This browser isn’t counted' }),
            h('p', { text: counted ? 'Visits from this browser show up in the reports.' : 'You signed in here, so the site skips this browser on any network. Count it again to test the tracking.' })),
          h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', text: counted ? 'Stop counting it' : 'Count it again', onclick: () => {
            if (counted) { store.set('a_staff', '1'); store.set('a_staff_counted', null); } else { store.set('a_staff', null); store.set('a_staff_counted', '1'); }
            toast(counted ? 'This browser won’t be counted' : 'This browser counts again'); route();
          } })),
          h('div', { class: 'an-row' }, h('div', null, h('b', { text: 'Excluded networks' }), h('p', { text: 'Visits from these IP addresses are dropped. IPv6 addresses exclude the whole /64 network. Your current address: ' + (d.your_ip || 'unknown') + '.' })),
            h('button', { type: 'button', class: 'ds-btn ds-btn--s', text: 'Exclude my current IP', onclick: () => post({ op: 'exclude_ip', label: 'Added by ' + d.me }, 'Excluded') })),
          ipRows)),
        card('Bot filter', 'bots', 6, h('div', { class: 'an-rows' },
          h('div', { class: 'an-row' }, h('span', { text: 'Dropped by user agent, last 30 days' }), h('b', { text: n(d.bots.user_agent_30d) })),
          h('div', { class: 'an-row' }, h('span', { text: 'Likely bots (no sign of a person), last 7 days' }), h('b', { text: n(d.bots.no_interaction_7d_live) })))),
        card('Data', null, 6, h('div', { class: 'an-rows' },
          h('div', { class: 'an-row' }, h('span', { text: 'Raw events kept for' }), h('b', { text: d.retention_days + ' days' })),
          h('div', { class: 'an-row' }, h('span', { text: 'Daily totals' }), h('b', { text: 'Kept' })),
          h('div', { class: 'an-row' }, h('span', { text: 'Events stored' }), h('b', { text: n(d.event_count) })),
          h('div', { class: 'an-row' }, h('span', { text: 'Oldest event' }), h('b', { text: d.oldest_event ? date(d.oldest_event) : '–' })),
          h('div', { class: 'an-row' }, h('span', { text: 'Time zone' }), h('b', { text: d.tz })))),
        card('Custom actions', 'actions', 12,
          h('p', { class: 'an-card__note', text: 'Add your own actions from any page on the site. The first value is the action name, the second is an optional label.' }),
          h('div', { class: 'an-code-wrap' }, h('pre', { class: 'an-code', text: snippet }),
            h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', text: 'Copy', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(snippet).then(() => toast('Copied')); } })),
          d.custom_actions.length ? bars(d.custom_actions.map((a) => ({ label: a.name, value: a.n, extra: 'last ' + ago(a.last) })), { cols: ['Tracked custom actions', 'Last 90 days'] })
            : h('p', { class: 'an-empty', text: 'No custom actions yet.' })),
        card('Heatmap pages', 'heat', 6,
          h('label', { class: 'an-label' }, h('span', { text: 'Record on every page' }), heatAll), heatList,
          h('button', { type: 'button', class: 'ds-btn ds-btn--s', text: 'Save heatmap pages', onclick: () => {
            const all = heatAll.getAttribute('aria-checked') === 'true';
            post({ op: 'heat_pages', value: all ? '*' : [...heatList.querySelectorAll('input:checked')].map((i) => i.dataset.page) });
          } })),
        card('Export', null, 6,
          h('p', { class: 'an-card__note', text: 'A CSV file for the date range picked on the other pages (' + (state.range === 'custom' ? state.from + ' to ' + state.to : RANGES.find((r) => r[0] === state.range)[1]) + ').' }),
          h('div', { class: 'ds-row' }, exportTable, h('button', { type: 'button', class: 'ds-btn ds-btn--s', text: 'Download CSV', onclick: async () => {
            const res = await api('export', Object.assign({ table: exportTable.value }, rangeParams()), { raw: true });
            if (!res.ok) return toast('Export failed');
            const blob = await res.blob();
            const a = h('a', { href: URL.createObjectURL(blob), download: (res.headers.get('Content-Disposition') || '').split('filename="')[1]?.replace('"', '') || 'analytics.csv' });
            document.body.append(a); a.click(); a.remove();
          } }))),
        card('Delete a visitor', null, 6,
          h('p', { class: 'an-card__note', text: 'Removes every event, live row and email link for one browser ID, for example after a deletion request. This can’t be undone.' }),
          h('div', { class: 'ds-row' }, delInput, h('button', { type: 'button', class: 'ds-btn ds-btn--secondary ds-btn--s', text: 'Delete', onclick: async () => {
            const id = delInput.value.trim();
            if (!id) return;
            if (!confirm('Delete all data for browser ' + id + '?')) return;
            const r = await post({ op: 'delete_visitor', browser_id: id }, 'Deleted');
            if (r) toast('Deleted ' + n(r.deleted) + ' events');
          } }))),
        card('Sample data', null, 6,
          h('label', { class: 'an-label' }, h('span', { text: 'Fill every page with made-up data for demos. Nothing is saved while it’s on.' }),
            h('button', { type: 'button', role: 'switch', class: 'an-switch', 'aria-checked': String(state.sample), 'aria-label': 'Sample data', onclick: () => setSample(!state.sample) })))));
    });
  };

  start();
})();

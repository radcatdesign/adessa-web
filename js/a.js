/* Adessa first-party analytics. No cookies, no third parties. Docs: docs/analytics.md */
(function () {
  var w = window, d = document, n = navigator;
  if (w.__adessaA) return;
  w.__adessaA = 1;
  var noop = function () {};
  w.analytics = w.analytics || { track: noop };
  try {
    var API = '/api/analytics/', now = Date.now;
    var store = function (name) { try { var s = w[name], t = '__a'; s.setItem(t, '1'); s.removeItem(t); return s; } catch (e) { return null; } };
    var ls = store('localStorage'), ss = store('sessionStorage');
    // Browsers that have signed in to the dashboard are the team's: send nothing.
    if (ls && ls.getItem('a_staff') === '1') return;

    var rid = function () {
      var a = new Uint8Array(12), s = '', c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      (w.crypto || w.msCrypto).getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += c[a[i] % 62];
      return s;
    };
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    // No browser ID with Global Privacy Control or Do Not Track, or in the EU, EEA, UK or Switzerland
    // (all Europe/* time zones, plus Atlantic islands that belong to them).
    var optOut = n.globalPrivacyControl === true || n.doNotTrack === '1' || w.doNotTrack === '1';
    var consentZone = /^Europe\/|^Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe)|^Arctic\//.test(tz);
    var bid = null, ret = false, YEARISH = 395 * 864e5;
    if (!optOut && !consentZone && ls) {
      var saved = null;
      try { saved = JSON.parse(ls.getItem('a_bid') || 'null'); } catch (e) {}
      if (saved && saved.id && now() - saved.t < YEARISH) { bid = saved.id; ret = true; }
      else { bid = rid(); saved = { id: bid, t: now() }; }
      ls.setItem('a_bid', JSON.stringify(saved));
    } else if (ls) ls.removeItem('a_bid');

    // A visit lasts until the tab closes or 30 minutes pass without a page view or action.
    var visitId = function () {
      var v = null;
      try { v = JSON.parse((ss && ss.getItem('a_vid')) || 'null'); } catch (e) {}
      if (!v || now() - v.t > 18e5) v = { id: rid(), t: now() };
      v.t = now();
      if (ss) ss.setItem('a_vid', JSON.stringify(v));
      return v.id;
    };
    var vw = Math.min(screen.width || 0, screen.height || 0) || w.innerWidth;
    var touch = 'ontouchstart' in w || n.maxTouchPoints > 0;
    var device = vw < 600 ? 'phone' : (touch && vw < 1100 ? 'tablet' : 'desktop');

    var post = function (path, data, beacon) {
      try {
        data.wd = n.webdriver === true ? 1 : undefined;
        var body = JSON.stringify(data);
        if (beacon && n.sendBeacon && n.sendBeacon(API + path, new Blob([body], { type: 'text/plain' }))) return;
        if (w.fetch) w.fetch(API + path, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } })['catch'](noop);
      } catch (e) {}
    };

    // ---------- page state ----------
    var page = null, lastInput = now(), visible = d.visibilityState !== 'hidden';
    var docH = function () { var b = d.body, e = d.documentElement; return Math.max(b ? b.scrollHeight : 0, e.scrollHeight, e.clientHeight); };
    var scrollPct = function () { var h = docH(); return h ? Math.min(100, Math.round(((w.scrollY || w.pageYOffset) + w.innerHeight) / h * 100)) : 0; };
    var heat = null, views = 0;

    var startPage = function () {
      var params = {}, q = new URLSearchParams(location.search), keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];
      for (var i = 0; i < keys.length; i++) if (q.get(keys[i])) params[keys[i]] = q.get(keys[i]).slice(0, 150);
      page = { id: rid(), path: location.pathname, active: 0, scroll: scrollPct(), started: now(), sentScroll: false };
      lastInput = now();
      heat = { c: {}, m: {}, e: {}, n: 0 };
      var ref = views++ ? '' : d.referrer;
      post('collect', { k: 'view', id: page.id, p: page.path, r: ref, u: params, dv: device, l: (n.language || '').slice(0, 12), tz: tz, v: visitId(), b: bid, ret: ret });
      beat();
    };
    var leave = function () {
      if (!page) return;
      post('collect', { k: 'leave', id: page.id, a: page.active, s: page.scroll, v: visitId() }, true);
      flushHeat(true);
    };

    // Active time: counts while the page is visible and there was input in the last 2 minutes.
    setInterval(function () {
      if (page && visible && now() - lastInput < 12e4) page.active += 1000;
    }, 1000);
    var onInput = function () { lastInput = now(); };
    ['click', 'keydown', 'touchstart', 'pointerdown', 'wheel'].forEach(function (ev) { d.addEventListener(ev, onInput, { passive: true, capture: true }); });
    var lastMove = 0;
    d.addEventListener('mousemove', function (e) {
      var t = now();
      if (t - lastMove < 100) return;
      lastMove = t; lastInput = t;
      if (device === 'desktop') addHeat('m', e.pageX, e.pageY);
    }, { passive: true });
    w.addEventListener('scroll', function () { lastInput = now(); if (page) page.scroll = Math.max(page.scroll, scrollPct()); }, { passive: true });

    // ---------- heatmap points ----------
    var addHeat = function (kind, x, y) {
      if (!heat || heat.n > 2000) return;
      var width = Math.max(d.documentElement.scrollWidth, w.innerWidth) || 1;
      var cell = Math.min(49, Math.floor(x / width * 50)) + '.' + Math.floor(y / 20);
      heat[kind][cell] = (heat[kind][cell] || 0) + 1;
      heat.n++;
    };
    var selector = function (el) {
      var parts = [];
      for (var i = 0; el && el.nodeType === 1 && i < 3; i++, el = el.parentElement) {
        var s = el.tagName.toLowerCase();
        if (el.id && /^[A-Za-z][\w-]{0,40}$/.test(el.id)) { parts.unshift(s + '#' + el.id); break; }
        var cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(function (c) { return /^[A-Za-z][\w-]{0,40}$/.test(c) && !/^(w-|is-|active)/.test(c); })[0];
        parts.unshift(cls ? s + '.' + cls : s);
      }
      return parts.join(' > ').slice(0, 120);
    };
    var flushHeat = function (beacon) {
      if (!page || !heat) return;
      var hasPoints = heat.n > 0, sendScroll = beacon && !page.sentScroll;
      if (!hasPoints && !sendScroll) return;
      var data = { k: 'heat', p: page.path, dv: device, c: heat.c, m: heat.m, e: heat.e };
      if (sendScroll) { data.s = page.scroll; page.sentScroll = true; }
      heat = { c: {}, m: {}, e: {}, n: 0 };
      post('collect', data, beacon);
    };
    setInterval(function () { flushHeat(false); }, 1e4);

    // ---------- actions ----------
    var track = function (name, label) {
      try {
        if (!name) return;
        visitId();
        post('collect', { k: 'action', n: String(name).slice(0, 80), lb: label == null ? undefined : String(label).slice(0, 200), p: location.pathname, v: visitId() });
      } catch (e) {}
    };
    w.analytics = { track: track };
    var DL = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|txt|rtf|key|pages|numbers|dmg|exe|mp3|mp4|mov|webm|wav|epub)$/i;
    d.addEventListener('click', function (e) {
      try {
        var t = e.target;
        if (t && t.closest) {
          var hit = t.closest('a,button,input,select,textarea,label,[role=button]') || t;
          addHeat('c', e.pageX, e.pageY);
          var sel = selector(hit);
          if (sel && heat) heat.e[sel] = (heat.e[sel] || 0) + 1;
          var a = t.closest('a[href]');
          if (!a) return;
          var href = a.getAttribute('href') || '';
          if (/^mailto:/i.test(href)) return track('Email click', href.slice(7).split('?')[0]);
          if (/^tel:/i.test(href)) return track('Phone click', href.slice(4));
          var url = new URL(a.href, location.href);
          if (DL.test(url.pathname)) return track('Download', url.pathname.split('/').pop());
          if (/^https?:$/.test(url.protocol) && url.host !== location.host) track('Outbound link', url.host + url.pathname.replace(/\/$/, ''));
        }
      } catch (err) {}
    }, true);
    d.addEventListener('submit', function (e) {
      var f = e.target;
      track('Form submit', (f && (f.getAttribute('name') || f.id || f.getAttribute('data-name'))) || 'Unnamed form');
    }, true);
    // HubSpot embedded forms report submissions with a window event.
    w.addEventListener('hs-form-event:on-submission:success', function (e) {
      try {
        var id = (e.detail && (e.detail.formId || e.detail.formGuid)) || 'HubSpot form';
        track('Form submit', 'HubSpot ' + String(id).slice(0, 40));
        var api = w.HubSpotFormsV4, form = api && api.getFormFromEvent && api.getFormFromEvent(e);
        if (bid && form && form.getFormFieldValues) {
          form.getFormFieldValues().then(function (vals) {
            for (var i = 0; i < vals.length; i++) if (/(^|\/)email$/.test(vals[i].name)) post('collect', { k: 'id', b: bid, email: String(vals[i].value) });
          })['catch'](noop);
        }
      } catch (err) {}
    });

    // ---------- presence (live view) ----------
    var beatTimer = null;
    var beat = function () {
      if (!page || !visible || now() - lastInput > 6e5) return;
      post('presence', { t: 'beat', p: page.path, v: visitId(), b: bid, dv: device });
    };
    var startBeats = function () { if (!beatTimer) beatTimer = setInterval(beat, 45e3); };
    var stopBeats = function () { clearInterval(beatTimer); beatTimer = null; };

    d.addEventListener('visibilitychange', function () {
      visible = d.visibilityState !== 'hidden';
      if (!visible) { leave(); stopBeats(); }
      else { lastInput = now(); beat(); startBeats(); }
    });
    w.addEventListener('pagehide', function () {
      leave();
      stopBeats();
      post('presence', { t: 'gone', v: visitId(), b: bid }, true);
    });

    // ---------- single-page apps ----------
    var onNav = function () {
      if (!page || location.pathname === page.path) return;
      leave();
      page = null;
      startPage();
    };
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      if (typeof orig !== 'function') return;
      history[m] = function () { var r = orig.apply(this, arguments); setTimeout(onNav, 0); return r; };
    });
    w.addEventListener('popstate', onNav);

    startPage();
    startBeats();
  } catch (e) { /* never break the page */ }
})();

/* Heatmap layer for the analytics dashboard's preview. Loaded by js/a.js only on ?a_preview=1 pages,
   which the dashboard shows in a sandboxed frame. The dashboard sends the heat data by postMessage. */
(function () {
  var d = document, w = window;
  // Nothing in the preview navigates.
  d.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
  d.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  var data = null;
  function ready() { try { w.parent.postMessage({ type: 'a-ready' }, '*'); } catch (e) {} }

  function draw() {
    if (!data || !d.body) return;
    var old = d.getElementById('__a_heat');
    if (old) old.remove();
    var de = d.documentElement;
    var pageW = Math.max(de.scrollWidth, w.innerWidth), pageH = Math.min(Math.max(de.scrollHeight, d.body.scrollHeight), 30000);
    var layer = d.createElement('div');
    layer.id = '__a_heat';
    layer.style.cssText = 'position:absolute;left:0;top:0;width:' + pageW + 'px;height:' + pageH + 'px;pointer-events:none;z-index:2147483000;';
    var canvas = d.createElement('canvas');
    canvas.width = pageW; canvas.height = pageH;
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:' + pageW + 'px;height:' + pageH + 'px;';
    layer.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var font = (data.device === 'phone' ? 12 : 14) + 'px/1.2 "Plus Jakarta Sans",Arial,sans-serif';
    if (data.mode === 'scroll') {
      // Darker means fewer page views reached that depth.
      data.reach.forEach(function (r) {
        var y0 = r[0] / 100 * pageH, y1 = Math.min(pageH, (r[0] + 5) / 100 * pageH);
        ctx.fillStyle = 'rgba(34,29,23,' + (0.62 * (1 - r[1])).toFixed(3) + ')';
        ctx.fillRect(0, y0, pageW, y1 - y0);
      });
      [25, 50, 75, 100].forEach(function (m) {
        var hit = data.reach.filter(function (r) { return r[0] === m; })[0];
        var mark = d.createElement('div');
        mark.style.cssText = 'position:absolute;left:0;right:0;top:' + (m / 100 * pageH - (m === 100 ? 2 : 0)) + 'px;border-top:2px dashed rgba(34,29,23,.6);';
        var tag = d.createElement('span');
        tag.textContent = m + '% of page · ' + Math.round((hit ? hit[1] : 0) * 100) + '% reached';
        tag.style.cssText = 'position:absolute;right:16px;top:' + (m === 100 ? '-34px' : '6px') + ';padding:6px 12px;border-radius:999px;background:rgba(34,29,23,.82);color:#fffaf0;font:600 ' + font + ';letter-spacing:.06em;';
        mark.appendChild(tag);
        layer.appendChild(mark);
      });
    } else {
      var pts = data.points || [], max = 1;
      pts.forEach(function (p) { if (p[2] > max) max = p[2]; });
      var colW = pageW / 50;
      pts.forEach(function (p) {
        var cx = (p[0] + 0.5) * colW, cy = (p[1] + 0.5) * 20;
        if (cy > pageH) return;
        var a = 0.3 + 0.7 * Math.sqrt(p[2] / max), r = Math.max(30, colW * 1.7);
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(' + data.ink + ',' + a.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + data.ink + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      });
    }
    d.body.appendChild(layer);
  }

  w.addEventListener('message', function (e) {
    if (e.source !== w.parent || !e.data || e.data.type !== 'a-heat') return;
    var m = e.data;
    data = {
      mode: m.mode === 'scroll' ? 'scroll' : 'points', device: String(m.device || ''),
      ink: /^\d{1,3}, ?\d{1,3}, ?\d{1,3}$/.test(m.ink || '') ? m.ink : '196, 82, 30',
      points: Array.isArray(m.points) ? m.points.slice(0, 20000) : [], reach: Array.isArray(m.reach) ? m.reach : [],
    };
    draw();
  });
  w.addEventListener('load', function () { setTimeout(ready, 700); setTimeout(ready, 2500); });
  if (d.readyState === 'complete') { setTimeout(ready, 700); setTimeout(ready, 2500); }
})();

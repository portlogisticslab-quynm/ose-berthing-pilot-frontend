// Đồ thị đường trên canvas, không dùng thư viện ngoài. Vẽ lại toàn bộ mỗi lần (tối đa vài nghìn điểm, đủ nhanh ở 1 Hz).

const CSS = getComputedStyle(document.documentElement);
export const C = {
  ink: CSS.getPropertyValue('--ink').trim() || '#e9eff2', chart: CSS.getPropertyValue('--chart').trim() || '#4fa3c7',
  grid: CSS.getPropertyValue('--line').trim() || '#2c4351', axis: CSS.getPropertyValue('--concrete').trim() || '#8d9aa1',
  bad: CSS.getPropertyValue('--bad').trim() || '#e5484d', warn: CSS.getPropertyValue('--warn').trim() || '#f2b33d',
  ok: CSS.getPropertyValue('--ok').trim() || '#3fb27f',
};
const FONT = '12px Barlow, system-ui, sans-serif';

/** Chuẩn bị canvas theo kích thước hiển thị và mật độ điểm ảnh. */
export function fit(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), r = cv.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)).replace('.', ',');

/**
 * opts: { x:[lo,hi], y:[lo,hi], xLabel, yLabel, xFmt, series:[{ pts:[[x,y]...], color, dash, width }],
 *         bands:[{ pts:[[x,lo,hi]...], color }], hlines:[{ y, color, dash }], vlines:[{ x, color, dash }],
 *         dots:[{ x, y, color, r, ring }], labels:[{ text, x, y | px, py, color, align }] }
 */
export function lineChart(cv, o) {
  const { g, w, h } = fit(cv);
  const L = 44, R = 10, T = 8, B = 26, pw = w - L - R, ph = h - T - B;
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * pw, Y = (y) => T + ph - ((y - y0) / (y1 - y0 || 1)) * ph;
  g.font = FONT; g.lineWidth = 1; g.strokeStyle = C.grid; g.fillStyle = C.axis;
  for (const t of niceTicks(y0, y1)) { const y = Math.round(Y(t)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.textAlign = 'right'; g.fillText(fmt(t), L - 6, y + 4); }
  g.textAlign = 'center';
  for (const t of niceTicks(Math.min(x0, x1), Math.max(x0, x1), Math.max(3, Math.floor(pw / 90)))) { const x = X(t); g.fillText(o.xFmt ? o.xFmt(t) : fmt(t), x, T + ph + 16); }
  if (o.yLabel) { g.save(); g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText(o.yLabel, 0, 0); g.restore(); }
  g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
  for (const b of o.bands ?? []) {
    if (b.pts.length < 2) continue;
    g.fillStyle = b.color; g.beginPath();
    b.pts.forEach(([x, lo], i) => (i ? g.lineTo(X(x), Y(lo)) : g.moveTo(X(x), Y(lo))));
    for (let i = b.pts.length - 1; i >= 0; i--) g.lineTo(X(b.pts[i][0]), Y(b.pts[i][2]));
    g.closePath(); g.fill();
  }
  for (const l of o.vlines ?? []) { if (l.x === null || l.x === undefined) continue; g.strokeStyle = l.color; g.setLineDash(l.dash ?? []); g.lineWidth = l.width ?? 1.5; g.beginPath(); g.moveTo(X(l.x), T); g.lineTo(X(l.x), T + ph); g.stroke(); }
  for (const l of o.hlines ?? []) { g.strokeStyle = l.color; g.setLineDash(l.dash ?? []); g.lineWidth = 1.5; g.beginPath(); g.moveTo(L, Y(l.y)); g.lineTo(L + pw, Y(l.y)); g.stroke(); }
  for (const s of o.series) {
    g.strokeStyle = s.color; g.lineWidth = s.width ?? 1.6; g.setLineDash(s.dash ?? []); g.beginPath();
    let pen = false;
    for (const p of s.pts) { if (p[1] === null || !Number.isFinite(p[1])) { pen = false; continue; } pen ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); pen = true; }
    g.stroke();
  }
  for (const d of o.dots ?? []) {
    if (d.y === null || d.y === undefined || !Number.isFinite(d.y)) continue;
    g.fillStyle = d.color; g.beginPath(); g.arc(X(d.x), Y(d.y), d.r ?? 4, 0, Math.PI * 2); g.fill();
    if (d.ring) { g.strokeStyle = d.ring; g.lineWidth = 1.5; g.stroke(); }
  }
  g.restore(); g.setLineDash([]);
  for (const t of o.labels ?? []) { g.fillStyle = t.color ?? C.axis; g.textAlign = t.align ?? 'left'; g.fillText(t.text, t.px ?? X(t.x), t.py ?? Y(t.y)); }
  if (o.empty) { g.fillStyle = C.axis; g.textAlign = 'center'; g.fillText(o.empty, L + pw / 2, T + ph / 2); }
}

export function extent(vals, pad = 0.08, min = null) {
  const v = vals.filter((x) => x !== null && Number.isFinite(x));
  if (!v.length) return [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  if (min !== null) lo = Math.min(lo, min);
  const d = (hi - lo) || Math.abs(hi) || 1;
  return [lo - d * pad, hi + d * pad];
}

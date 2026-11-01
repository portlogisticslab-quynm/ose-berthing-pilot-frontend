// Phần vẽ dùng chung cho Live Berthing và màn hình xem lại lượt cập.
import { lineChart, extent, C } from './charts.js';

export const nearD = (f) => { if (!f) return null; const v = [f.d1, f.d2].filter((x) => x !== null); return v.length ? Math.min(...v) : null; };
export const maxV = (f) => { const v = f ? [f.v1, f.v2].filter((x) => x !== null) : []; return v.length ? Math.max(...v) : null; };
/** Vận tốc cho phép (cm/s) tại khoảng cách d theo biên dạng của bến (Hợp đồng số liệu, công thức 7.1). */
export const vAllowAt = (b, d) => (b && d !== null && Number.isFinite(d) ? b.v_design_cms + 100 * b.envelope_beta * Math.max(0, d) ** b.envelope_gamma : null);

/** els: { dist, vel, vc, p } là các canvas; b: cấu hình bến; cursorMs: thời điểm đang xem (chế độ xem lại) hoặc null. */
export function drawCharts(els, fr, b, cursorMs = null) {
  const t = (f) => Date.parse(f.ts), xt = fr.length ? [t(fr[0]), Math.max(t(fr.at(-1)), t(fr[0]) + 60_000)] : [0, 1];
  const tf = (ms) => new Date(ms).toLocaleTimeString('vi-VN', { timeZone: b?.timezone || 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false });
  const empty = fr.length ? null : 'Chưa có số liệu';
  const cur = cursorMs !== null ? [{ x: cursorMs, color: '#b388ff', width: 1.5 }] : [];
  lineChart(els.dist, { x: xt, y: extent(fr.flatMap((f) => [f.d1, f.d2]), 0.06, 0), xFmt: tf, yLabel: 'm', empty, vlines: cur,
    series: [{ pts: fr.map((f) => [t(f), f.d1]), color: C.ink }, { pts: fr.map((f) => [t(f), f.d2]), color: C.ink, width: 1, dash: [2, 2] }] });

  const ds = fr.map(nearD).filter((x) => x !== null && Number.isFinite(x)), dMax = ds.length ? Math.max(...ds) : 100;
  const env = [], warn = [];
  for (let i = 0; i <= 60; i++) { const d = (dMax * i) / 60, v = vAllowAt(b, d); env.push([d, v]); warn.push([d, v === null ? null : v * (b?.envelope_yellow_ratio ?? 0.8)]); }
  const vs = fr.map(maxV).filter((x) => x !== null);
  const vTop = Math.max(10, ...vs.map((x) => x * 1.15));
  const curD = cursorMs !== null ? nearD(fr.find((f) => t(f) >= cursorMs) ?? fr.at(-1)) : null;
  lineChart(els.vel, { x: [dMax * 1.02, 0], y: [0, vTop], yLabel: 'cm/s', empty, vlines: curD !== null ? [{ x: curD, color: '#b388ff' }] : [],
    series: [{ pts: env, color: C.bad, width: 1.5 }, { pts: warn, color: C.warn, width: 1, dash: [4, 3] },
      { pts: fr.map((f) => [nearD(f), maxV(f)]), color: C.ink }, { pts: fr.filter((f) => f.est).map((f) => [nearD(f), f.est.v]), color: C.chart, dash: [5, 3] }] });

  const fcs = fr.filter((f) => f.fc), noFc = fcs.length ? null : 'Chưa có dự báo';
  lineChart(els.vc, { x: xt, y: extent([...fcs.flatMap((f) => [f.fc.vc[0], f.fc.vc[2]]), b?.v_design_cms ?? 0], 0.08, 0), xFmt: tf, yLabel: 'cm/s', empty: noFc, vlines: cur,
    bands: [{ pts: fcs.map((f) => [t(f), f.fc.vc[0], f.fc.vc[2]]), color: 'rgba(79,163,199,0.30)' }],
    hlines: b ? [{ y: b.v_design_cms, color: C.axis, dash: [5, 4] }] : [],
    series: [{ pts: fcs.map((f) => [t(f), f.fc.vc[1]]), color: C.chart, width: 2 }] });
  lineChart(els.p, { x: xt, y: [0, 100], xFmt: tf, yLabel: '%', empty: noFc, vlines: cur,
    hlines: b ? [{ y: b.p_star * 100, color: C.bad }] : [],
    series: [{ pts: fcs.map((f) => [t(f), f.fc.p * 100]), color: C.chart, width: 2 }] });
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const LEVEL_VN = { Normal: 'Bình thường', Caution: 'Chú ý', Warning: 'Cảnh báo', Critical: 'Nguy hiểm' };
export const STATUS_VN = { open: 'Đang theo dõi', approach: 'Đang tiếp cận', contact: 'Đã chạm đệm', moored: 'Đã cập', closed: 'Đã đóng', aborted: 'Bỏ dở', merged: 'Đã gộp' };
export const LED_VN = { green: 'Xanh', yellow: 'Vàng', red: 'Đỏ', white: 'Mất tín hiệu' };
export const SOURCE_VN = { live: 'Số liệu thật', sim: 'Giả lập', replay: 'Phát lại' };
export const END_VN = { N1: 'phía N1', N2: 'phía N2', both: 'đều cả thân' };

/** Khung nội suy giữa a và b (t ∈ [0,1]) để tàu trượt mượt giữa hai khung 1 Hz. Thiếu số đo ở một phía thì lấy khung đích. */
export function lerpFrame(a, b, t) {
  if (!a || !b || t >= 1) return b; if (t <= 0) return a;
  const L = (x, y) => (x === null || x === undefined || y === null || y === undefined ? y : x + (y - x) * t);
  const est = a.est && b.est ? { v: L(a.est.v, b.est.v), alpha: L(a.est.alpha, b.est.alpha), omega: b.est.omega } : b.est;
  return { ...b, d1: L(a.d1, b.d1), d2: L(a.d2, b.d2), v1: L(a.v1, b.v1), v2: L(a.v2, b.v2), angle: L(a.angle, b.angle), est, interp: true };
}
/** Vị trí thực (số thực) trong mảng khung → khung nội suy. */
export function frameAt(fr, pos) {
  if (!fr.length) return null;
  const p = Math.max(0, Math.min(fr.length - 1, pos)), i = Math.floor(p);
  return i >= fr.length - 1 ? fr[fr.length - 1] : lerpFrame(fr[i], fr[i + 1], p - i);
}
/** Chuẩn hoá cấp độ cảnh báo của dự báo (mới nhất tới vị trí i). */
export function fcAt(fr, i) { for (let j = Math.min(i, fr.length - 1); j >= 0; j--) if (fr[j].fc) return fr[j].fc; return null; }
export const LEVEL_COLOR = { Normal: '#3fb27f', Caution: '#f2b33d', Warning: '#f07a2a', Critical: '#e5484d' };

/** Phản ứng đệm theo năng lượng hấp thụ (kJ), cùng cách tính với lõi 3.6.5: độ nén δ/H, phản lực kN, nén hết hay chưa. */
export function fenderResponse(F, E) {
  if (!F || E === null || E === undefined || !Number.isFinite(E)) return null;
  const c = F.curve, cum = F.cumulative, s = Math.max(0, E) / (F.rated_reaction_kn * F.H);
  const rAt = (dx) => { for (let i = 1; i < c.length; i++) if (dx <= c[i][0]) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; return y0 + ((y1 - y0) * (dx - x0)) / (x1 - x0); } return c.at(-1)[1]; };
  for (let i = 1; i < c.length; i++) if (s <= cum[i]) {
    const [x0, y0] = c[i - 1], [x1, y1] = c[i], need = s - cum[i - 1], m = (y1 - y0) / (x1 - x0);
    let dx;
    if (Math.abs(m) < 1e-9) dx = need / y0;
    else { const disc = y0 * y0 + 2 * m * need; dx = (-y0 + Math.sqrt(Math.max(0, disc))) / m; }
    const xd = x0 + dx;
    return { ratio: xd, deflection: xd * F.H, reaction: rAt(xd) * F.rated_reaction_kn, bottomed: false };
  }
  const last = c.at(-1);
  return { ratio: last[0], deflection: last[0] * F.H, reaction: F.rated_reaction_kn * (last[1] + Math.min(2, (s - cum.at(-1)) / 0.05)), bottomed: true };
}

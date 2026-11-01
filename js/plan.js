// Sơ đồ mặt bằng: mép bến, hàng đệm, tuyến mặt đệm, hai BRT N1, N2 và tia đo, thân tàu theo khoảng cách và góc đo được,
// hướng mũi tàu (điều độ khai báo), điểm chạm đầu tiên. Tỷ lệ đều hai trục; tự phóng to khi tàu tiến gần.
import { fit, C } from './charts.js';

const zooms = new WeakMap();   // { k, t } tỷ lệ px/m đang hiển thị của từng canvas và lúc vẽ (làm mượt theo thời gian)

/**
 * st: { spacing, loa, beam, fenderDepth, bowToward: 'N1'|'N2'|null, frames: LiveFrame[] (mới nhất ở cuối), vesselLabel,
 *       contact: { end: 'N1'|'N2'|'both', angle, compression } | null }
 */
export function drawPlan(cv, st) {
  const { g, w, h } = fit(cv);
  const s = st.spacing || 100, loa = st.loa || 180, beam = st.beam || loa / 6.5, fd = st.fenderDepth ?? 2;
  const f = st.frames.at(-1);
  const side = f ? sideOf(f, s) : null;
  const dMax = side ? Math.max(side.y1, side.y2) : 60;
  const worldW = Math.max(loa * 1.3, s * 1.7, 160), worldH = Math.max(dMax + beam + fd + 25, 70);
  const target = Math.min((w - 40) / worldW, (h - 70) / worldH);
  const prev = zooms.get(cv), now = performance.now();
  const a = prev ? 1 - Math.exp(-Math.min(1000, now - prev.t) / 350) : 1;
  const k = !prev || matchMedia('(prefers-reduced-motion: reduce)').matches ? target : prev.k + (target - prev.k) * a;
  zooms.set(cv, { k, t: now });
  const ox = w / 2, oy = h - 46;                          // gốc: giữa hai BRT, trên tuyến mặt đệm
  const P = (x, y) => [ox + x * k, oy - y * k];
  const depthPx = Math.max(6, fd * k);                    // đệm luôn nhìn thấy được, kể cả khi thu nhỏ

  // mặt bến (phía sau mép bến) và hàng đệm giữa mép bến với tuyến mặt đệm
  const qy = oy + depthPx;
  g.fillStyle = '#26343c'; g.fillRect(0, qy, w, h - qy);
  g.strokeStyle = C.axis; g.lineWidth = 2; g.beginPath(); g.moveTo(0, qy); g.lineTo(w, qy); g.stroke();
  const step = 20 * k >= 14 ? 20 : 40, fw = Math.max(4, 3 * k);
  g.fillStyle = '#56656e';
  for (let x = -Math.ceil(w / 2 / k / step) * step; x * k < w / 2; x += step) { const [px] = P(x, 0); g.fillRect(px - fw / 2, oy, fw, depthPx); }
  g.strokeStyle = 'rgba(141,154,161,0.6)'; g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, oy + 0.5); g.lineTo(w, oy + 0.5); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.axis; g.font = '12px Barlow, system-ui'; g.textAlign = 'left';
  g.fillText('Tuyến mặt đệm', 10, oy - 6);
  g.fillText(`Mép bến (đệm sâu ${fd.toString().replace('.', ',')} m)`, 10, qy + 15);
  // thước tỷ lệ
  const bar = [10, 20, 50, 100, 200].find((m) => m * k >= 70) ?? 200;
  g.strokeStyle = C.axis; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w - 20 - bar * k, h - 10); g.lineTo(w - 20, h - 10); g.stroke();
  g.textAlign = 'right'; g.fillText(`${bar} m`, w - 20, h - 16);

  const bow = st.bowToward === 'N1' ? -1 : 1;             // mũi về phía N2 (mặc định) hoặc N1
  // vệt vị trí 10 s/lần trong 60 s gần nhất
  const fr = st.frames;
  for (let back = 60; back >= 10; back -= 10) {
    const p = fr[fr.length - 1 - back]; if (!p) continue;
    const sd = sideOf(p, s); if (!sd) continue;
    g.strokeStyle = `rgba(233,239,242,${0.06 + (60 - back) / 600})`; g.lineWidth = 1;
    hull(g, P, sd, loa, beam, bow, false);
  }
  // BRT và tia đo (BRT đặt ở mép bến, đo tới tuyến mặt đệm rồi tới mạn tàu)
  for (const [name, x, d, ok] of [['N1', -s / 2, f?.d1, f && f.d1 !== null], ['N2', s / 2, f?.d2, f && f.d2 !== null]]) {
    const [px] = P(x, 0);
    g.fillStyle = ok ? C.chart : f ? C.bad : C.axis;
    g.beginPath(); g.moveTo(px, qy - 2); g.lineTo(px - 6, qy + 9); g.lineTo(px + 6, qy + 9); g.closePath(); g.fill();
    g.fillStyle = C.ink; g.textAlign = 'center'; g.fillText(name, px, qy + 24);
    if (side && ok) {
      const yHit = x < 0 ? side.y1 : side.y2;
      g.strokeStyle = C.chart; g.setLineDash([4, 4]); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(px, qy); g.lineTo(...P(x, yHit)); g.stroke(); g.setLineDash([]);
      const [lx, ly] = P(x, Math.max(yHit, 0) / 2);
      g.fillStyle = C.ink; g.textAlign = x < 0 ? 'right' : 'left';
      g.font = '600 15px "Barlow Semi Condensed", system-ui'; g.fillText(`${num(d, d !== null && Math.abs(d) < 10 ? 2 : 1)} m`, lx + (x < 0 ? -8 : 8), Math.min(ly, oy - 18));
      g.font = '12px Barlow, system-ui';
    } else if (f && !ok) { g.fillStyle = C.bad; g.textAlign = 'center'; g.fillText('mất mục tiêu', px, oy - 8); }
  }
  // thân tàu
  if (side) {
    g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = 'rgba(233,239,242,0.07)';
    const pts = hull(g, P, side, loa, beam, bow, true);
    const [cx, cy] = P(0, (side.y1 + side.y2) / 2 + beam / 2);
    g.fillStyle = C.axis; g.textAlign = 'center'; g.fillText(st.vesselLabel ?? '', cx, cy + 4);
    // ký hiệu mũi tàu
    g.fillStyle = C.axis; g.font = '11px Barlow, system-ui'; g.fillText('mũi', ...pts.bowLabel);
    g.font = '12px Barlow, system-ui';
    // điểm chạm đầu tiên (tại BRT phía đầu chạm trước – hai đầu mạn phẳng)
    if (st.contact && ['Contact', 'Moored'].includes(f?.state ?? '') || (st.contact && st.showContactAlways)) {
      const c = st.contact, along = c.end === 'both' ? 0 : (c.end === 'N1' ? -1 : 1) * Math.min(s / 2, 0.45 * loa);
      const [mx, my] = pts.at(along, 0);
      g.fillStyle = C.bad; g.beginPath(); g.arc(mx, my, 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      const txt = `Chạm đầu tiên: ${c.end === 'both' ? 'đều cả thân' : 'phía ' + c.end}` + (c.angle !== null && c.angle !== undefined ? `, góc ${num(c.angle, 1)}°` : '')
        + (c.compression ? `, nén đệm ${num(c.compression, 2)} m` : '');
      // chú thích đặt ở góc trên, không đè lên số đo cạnh tia BRT
      g.font = '600 13px Barlow, system-ui'; g.textAlign = 'left'; g.fillStyle = C.bad;
      g.beginPath(); g.arc(16, 16, 5, 0, Math.PI * 2); g.fill(); g.fillText(txt, 28, 20); g.font = '12px Barlow, system-ui';
    }
  }
}

/** Mạn tàu phía bến: đi qua (−s/2, d1) và (s/2, d2). Thiếu một khoảng cách thì dùng góc ước lượng (hoặc 0). */
function sideOf(f, s) {
  if (f.d1 === null && f.d2 === null) return null;
  const a = ((f.angle ?? f.est?.alpha ?? 0) * Math.PI) / 180;
  const y1 = f.d1 ?? f.d2 - s * Math.tan(a), y2 = f.d2 ?? f.d1 + s * Math.tan(a);
  return { y1: Math.max(-1, y1), y2: Math.max(-1, y2), s };
}

/**
 * Vẽ thân tàu; mạn phía bến là đoạn thẳng đi qua hai điểm đo và luôn phủ cả N1, N2. Mũi và đuôi vuốt cong vào phía biển
 * (theo dạng thân tàu của 3.6.5), nên đuôi không bao giờ cắt tuyến mặt đệm. bow = +1: mũi về phía N2; −1: mũi về phía N1.
 */
function hull(g, P, sd, loa, beam, bow, fill) {
  const ux = sd.s, uy = sd.y2 - sd.y1, n = Math.hypot(ux, uy), u = [ux / n, uy / n], nv = [-u[1], u[0]];
  const cy = (sd.y1 + sd.y2) / 2, half = loa / 2;
  const at = (along, off) => P(u[0] * along + nv[0] * off, cy + u[1] * along + nv[1] * off);
  const A = (a) => a * bow;                               // đổi chiều theo hướng mũi
  const L = (a, o) => at(A(a), o);
  const { fa, ff } = hullExtent(loa, sd.s);
  const aftTop = -Math.max(fa, 0.35 * loa);
  g.beginPath();
  g.moveTo(...L(-fa, 0)); g.lineTo(...L(ff, 0));                                          // mạn phẳng phía bến
  g.quadraticCurveTo(...L(half * 0.97, 0.02 * beam), ...L(half, 0.5 * beam));           // mũi
  g.quadraticCurveTo(...L(half * 0.97, 0.98 * beam), ...L(ff, beam));
  g.lineTo(...L(aftTop, beam));                                                          // mạn phía biển
  g.quadraticCurveTo(...L(-half * 0.98, beam), ...L(-half, 0.8 * beam));                 // đuôi tròn
  g.lineTo(...L(-half, 0.22 * beam));                                                    // vách đuôi
  g.quadraticCurveTo(...L(-half * 0.97, 0.01 * beam), ...L(-fa, 0));                     // vuốt về mạn phẳng
  g.closePath();
  if (fill) g.fill(); g.stroke();
  return { at, bowLabel: at(A(half - loa * 0.11), beam / 2) };
}
/** Đoạn mạn phẳng: phía đuôi dừng ở BRT gần đuôi (s/2), phía mũi vượt BRT gần mũi ít nhất 8 m (như 3.6.5). */
export function hullExtent(loa, s) { return { fa: Math.min(0.45 * loa, s / 2), ff: Math.min(0.45 * loa, Math.max(0.35 * loa, s / 2 + 8)) }; }

export const num = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d).replace('.', ','));

// Hoạt cảnh cập tàu cho khung Xem lại (chuyển từ hoạt cảnh Live Berthing của 3.6.5): hai khung đồng bộ –
// toàn cảnh (cả quá trình tiếp cận, la bàn gió/dòng chảy) và phóng to quanh điểm chạm (đệm co lại khi chạm).
// Mặt bằng: x = khoảng cách ra biển tính từ tuyến mặt đệm (m), y = dọc mép bến (m, hướng lên). BRT N1 ở y = −s/2, N2 ở y = +s/2.
// BRT không đo vị trí dọc bến, nên giữa đoạn mạn phẳng luôn vẽ ở y = 0 (như 3.6.5).
import { fit, C } from './charts.js';
import { frameAt, fcAt, LEVEL_COLOR, LEVEL_VN, fenderResponse } from './views.js';
import { hullExtent, num } from './plan.js';

const FENDER_SPACING = 20;   // m, minh hoạ
const T = { water: '#10283a', land: '#26343c', grid: 'rgba(79,163,199,0.13)', edge: '#c9d3d8', fender: '#5d6d76', hull: '#33434e', laser: '#ff6b6b', zoom: '#b388ff', ghost: 'rgba(200,214,222,0.28)' };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Hệ toạ độ thân tàu từ hai khoảng cách tại N1 (y = −s/2) và N2 (y = +s/2): at(u, w), u dọc thân về phía N2, w ra phía biển. */
function hullFrame(d1, d2, s) {
  const ex = d2 - d1, ey = s, n0 = Math.hypot(ex, ey), e = [ex / n0, ey / n0], n = [e[1], -e[0]];
  const M = [(d1 + d2) / 2, 0];
  return { e, n, at: (u, w) => [M[0] + u * e[0] + w * n[0], M[1] + u * e[1] + w * n[1]] };
}
/** Hai khoảng cách của một khung (thiếu một bên thì suy từ góc ước lượng). */
function dists(f, s) {
  if (!f || (f.d1 === null && f.d2 === null)) return null;
  const t = Math.tan(((f.angle ?? f.est?.alpha ?? 0) * Math.PI) / 180);
  return [f.d1 ?? f.d2 - s * t, f.d2 ?? f.d1 + s * t];
}
/** Đường bao thân tàu (đã lấy mẫu các đoạn cong) theo dạng 3.6.5: mạn phẳng phủ cả hai BRT, mũi nhọn, đuôi vuốt. */
function hullPts(fr, L, B, s, bow) {
  const { fa, ff } = hullExtent(L, s), h = L / 2, aftTop = -Math.max(fa, 0.35 * L);
  const out = [], q = (a, c, b, n = 8) => { for (let k = 1; k <= n; k++) { const t = k / n, m = 1 - t; out.push([m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]]); } };
  out.push([-fa, 0], [ff, 0]);
  q([ff, 0], [h * 0.97, 0.02 * B], [h, 0.5 * B]); q([h, 0.5 * B], [h * 0.97, 0.98 * B], [ff, B]);
  out.push([aftTop, B]);
  q([aftTop, B], [-h * 0.98, B], [-h, 0.8 * B], 6); out.push([-h, 0.22 * B]);
  q([-h, 0.22 * B], [-h * 0.97, 0.01 * B], [-fa, 0], 6);
  return out.map(([u, w]) => fr.at(u * bow, w));
}

/**
 * o: { frames, pos (vị trí thực, cho phép lẻ để trượt mượt), event, cfg (berth_config kèm fender), env: [{ts, wind_speed_ms, ...}] }
 * Trả về false nếu không có gì để vẽ.
 */
export function drawAnim(cvOver, cvZoom, o) {
  const m = model(o); if (!m) { for (const cv of [cvOver, cvZoom]) { const { g, w, h } = fit(cv); g.fillStyle = C.axis; g.textAlign = 'center'; g.fillText('Lượt cập không có khung số liệu', w / 2, h / 2); } return false; }
  const zoom = panel(cvZoom, true, m, null);
  panel(cvOver, false, m, zoom);
  return true;
}

function model(o) {
  const fr = o.frames; if (!fr.length) return null;
  const e = o.event, cfg = o.cfg ?? {}, s = cfg.brt_spacing_m || 100;
  const i = clamp(Math.floor(o.pos), 0, fr.length - 1), f = frameAt(fr, o.pos), dd = dists(f, s);
  if (!dd) return null;
  const L = e.loa_m || 180, B = e.beam_m || L / 6.5, fd = cfg.fender_depth_m ?? 2;
  const fc = fcAt(fr, i), lvl = fc?.level ?? 'Normal';
  const tMs = Date.parse(f.ts), contactMs = e.contact_at ? Date.parse(e.contact_at) : null;
  const done = ['Contact', 'Moored'].includes(f.state) || (contactMs !== null && tMs >= contactMs);
  const ang = f.angle ?? f.est?.alpha ?? 0;
  const end = e.contact_end ?? (dd[0] <= dd[1] ? 'N1' : 'N2');
  const contactY = end === 'both' ? 0 : end === 'N1' ? -s / 2 : s / 2;
  let env = null; for (const r of o.env ?? []) { if (Date.parse(r.ts) <= tMs + 500) env = r; else break; }
  env ??= o.env?.[0] ?? null;
  // tác động khi chạm: năng lượng → độ nén theo đường đặc tính, mức rủi ro theo năng lượng và chuyển vị
  const F = cfg.fender, Er = F?.rated_energy_kj ?? cfg.fender_rated_energy_kj ?? 1;
  const resp = fenderResponse(F, e.energy_knm);
  const ratio = resp?.ratio ?? (e.max_compression_m != null && F?.H ? clamp(e.max_compression_m / F.H, 0, 0.9) : 0.3);
  const er = e.energy_knm != null ? e.energy_knm / Er : null, dr = e.disp_est_mm != null && cfg.disp_limit_mm ? e.disp_est_mm / cfg.disp_limit_mm : null;
  const ilvl = Math.max(er === null ? 0 : er >= 1 ? 3 : er >= 0.85 ? 2 : er >= 0.6 ? 1 : 0, dr === null ? 0 : dr >= 1 ? 3 : dr >= 0.8 ? 2 : 0);
  const impact = { level: ['Normal', 'Caution', 'Warning', 'Critical'][ilvl], ratio, resp, er };
  const first = dists(fr.find((x) => dists(x, s)) ?? f, s);
  return { fr, i, f, dd, e, cfg, s, L, B, fd, fc, lvl, done, ang, end, contactY, env, impact, bow: e.bow_toward === 'N1' ? -1 : 1, dFirst: Math.max(...first), Er };
}

function panel(cv, close, m, zoomBox) {
  const { g, w, h } = fit(cv);
  if (w < 120 || h < 80 || cv.offsetParent === null) return;
  const { fr, i, f, dd, e, cfg, s, L, B, fd, fc, lvl, done, contactY, env, impact, bow } = m;
  const dNear = Math.max(0, Math.min(...dd));
  // khung nhìn (tỷ lệ đều hai trục)
  const padL = 40, padR = 12, padT = 12, padB = 24, W = w - padL - padR, H = h - padT - padB;
  let k, x0, yc;
  if (close) { const xMax = clamp(dNear * 1.25 + B * 0.6 + 10, 45, 150); x0 = -fd - 6; k = W / (xMax - x0); yc = contactY; }
  else { const xMax = m.dFirst + B + 60; x0 = -fd - 12; k = Math.min(W / (xMax - x0), H / (1.2 * Math.max(L, s + 40))); yc = 0; }
  const X = (x) => padL + (x - x0) * k, Y = (y) => padT + H / 2 - (y - yc) * k, P = ([x, y]) => [X(x), Y(y)];
  const yTop = yc + H / 2 / k, yBot = yc - H / 2 / k, xEnd = x0 + W / k;
  // nước, mặt bến
  g.fillStyle = T.water; g.fillRect(padL, padT, W, H);
  g.fillStyle = T.land; g.fillRect(padL, padT, Math.max(0, X(-fd) - padL), H);
  g.save(); g.beginPath(); g.rect(padL, padT, W, H); g.clip();
  g.strokeStyle = T.grid; g.lineWidth = 1;
  const step = [5, 10, 20, 50, 100, 200].find((st) => st * k >= 45) || 200;
  for (let x = 0; x <= xEnd; x += step) { g.beginPath(); g.moveTo(X(x), padT); g.lineTo(X(x), padT + H); g.stroke(); }
  // mép bến, tuyến mặt đệm, hàng đệm
  g.strokeStyle = T.edge; g.lineWidth = 3; g.beginPath(); g.moveTo(X(-fd), padT); g.lineTo(X(-fd), padT + H); g.stroke();
  g.strokeStyle = 'rgba(141,154,161,0.55)'; g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), padT); g.lineTo(X(0), padT + H); g.stroke(); g.setLineDash([]);
  const fh = Math.max(4, 2.5 * k), fw = Math.max(3, fd * k);
  for (let y = contactY - FENDER_SPACING * Math.ceil((contactY - yBot) / FENDER_SPACING); y <= yTop; y += FENDER_SPACING) {
    if (done && Math.abs(y - contactY) < 1e-6) continue;
    g.fillStyle = T.fender; g.fillRect(X(-fd), Y(y) - fh / 2, fw, fh);
  }
  // BRT và tia đo
  for (const [id, y, d, ok] of [['N1', -s / 2, dd[0], f.d1 !== null], ['N2', s / 2, dd[1], f.d2 !== null]]) {
    const qx = X(-fd);
    if (ok) { g.setLineDash([5, 4]); g.strokeStyle = T.laser; g.lineWidth = 1.2; g.beginPath(); g.moveTo(qx, Y(y)); g.lineTo(X(Math.max(-fd, d)), Y(y)); g.stroke(); g.setLineDash([]); }
    g.fillStyle = ok ? T.laser : C.axis; g.beginPath(); g.moveTo(qx - 9, Y(y) - 6); g.lineTo(qx - 1, Y(y)); g.lineTo(qx - 9, Y(y) + 6); g.fill();
    g.font = '600 11px Barlow, system-ui'; g.textAlign = 'left';
    if (!ok) { g.fillStyle = C.bad; g.fillText(`${id} mất mục tiêu`, qx + 4, Y(y) - 6); }
    else if (!done && X(d) - qx > 120) { g.fillStyle = '#ffb4b4'; g.fillText(`BRT-${id}  ${num(Math.max(0, d), 1)} m`, Math.min(X(d / 2) - 30, w - 140), Y(y) - 6); }
  }
  const poly = (pts, fill, stroke, dash = [], lw = 1.5) => {
    g.beginPath(); pts.forEach((p, n) => { const [px, py] = P(p); n ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.setLineDash(dash); g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); g.setLineDash([]); }
  };
  // vết mỗi 60 s (xám), vị trí chạm bến dự báo (đỏ đứt: P50; mờ: P90)
  for (let j = i - 60; j >= 0 && j > i - 60 * 9; j -= 60) { const q = dists(fr[j], s); if (q) poly(hullPts(hullFrame(q[0], q[1], s), L, B, s, bow), null, T.ghost, [], 1); }
  if (!done && fc) {
    const sg = (m.ang ?? 0) < 0 ? -1 : 1;
    const ghost = (a) => { const t = s * Math.tan((Math.abs(a) * Math.PI) / 180); return sg > 0 ? hullFrame(0, t, s) : hullFrame(t, 0, s); };
    if (fc.two) poly(hullPts(ghost(fc.ac[1]), L, B, s, bow), null, 'rgba(229,72,77,.4)', [3, 4], 1);
    poly(hullPts(ghost(fc.two ? fc.ac[0] : 0), L, B, s, bow), 'rgba(229,72,77,.06)', C.bad, [7, 5], 1.5);
  }
  // tàu lai đẩy phía biển
  const hf = hullFrame(dd[0], dd[1], s);
  const nt = e.tugs ?? 0, us = nt <= 0 ? [] : nt === 1 ? [0] : nt === 2 ? [-0.25 * L, 0.25 * L] : [-0.3 * L, 0, 0.3 * L, 0.15 * L].slice(0, nt);
  for (const u of us) poly([[u - 5, B + 2], [u + 5, B + 2], [u + 5, B + 28], [u, B + 32], [u - 5, B + 28]].map(([a, b]) => hf.at(a, b)), '#f2b33d', '#7a5310', [], 1);
  // thân tàu, màu viền theo mức cảnh báo dự báo
  poly(hullPts(hf, L, B, s, bow), T.hull, LEVEL_COLOR[lvl], [], 3);
  poly([[-0.44 * L, 0.22 * B], [-0.36 * L, 0.22 * B], [-0.36 * L, 0.78 * B], [-0.44 * L, 0.78 * B]].map(([u, ww]) => hf.at(u * bow, ww)), '#cfd8dc', null);
  {
    const [mx, my] = P(hf.at(0.05 * L * bow, 0.5 * B)), label = e.vessel_name ? `${e.vessel_name}${e.vessel_type ? ' – ' + e.vessel_type : ''}` : 'Chưa gắn tàu (tàu thiết kế)';
    g.font = '600 12px Barlow, system-ui';
    if (!close && B * k > 13 && g.measureText(label).width < 0.6 * L * k) {
      let a = Math.atan2(-hf.e[1], hf.e[0]); if (Math.abs(a) > Math.PI / 2) a += Math.PI;   // chữ luôn đọc được (không lộn ngược)
      g.save(); g.translate(mx, my); g.rotate(a); g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(label, 0, 4); g.restore();
    }
  }
  if (zoomBox) {
    g.setLineDash([6, 4]); g.strokeStyle = T.zoom; g.lineWidth = 1.5;
    const [ax, ay] = P([Math.max(zoomBox.x0, x0), zoomBox.yTop]), [bx, by] = P([zoomBox.xEnd, zoomBox.yBot]);
    g.strokeRect(ax, ay, bx - ax, by - ay); g.setLineDash([]);
    g.fillStyle = T.zoom; g.font = '600 11px Barlow, system-ui'; g.textAlign = 'left'; g.fillText('vùng phóng to', ax + 4, by + 13);
  }
  // chạm: đệm co lại theo độ nén, vòng sáng, mũi tên phản lực
  if (done) {
    const col = LEVEL_COLOR[impact.level], [cx, cy] = P([0, contactY]);
    const pw = Math.max(2, fd * (1 - Math.min(0.9, impact.ratio)) * k);
    g.fillStyle = col; g.fillRect(X(-fd), cy - fh / 2, pw, fh);
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 16, 0, 2 * Math.PI); g.stroke();
    g.globalAlpha = 0.4; g.beginPath(); g.arc(cx, cy, 26, 0, 2 * Math.PI); g.stroke(); g.globalAlpha = 1;
    const ax = X(-fd) - 4; g.beginPath(); g.moveTo(cx - 4, cy); g.lineTo(ax - 30, cy); g.stroke();
    g.fillStyle = col; g.beginPath(); g.moveTo(ax - 34, cy); g.lineTo(ax - 22, cy - 6); g.lineTo(ax - 22, cy + 6); g.fill();
  }
  g.restore();
  // khung, trục
  g.strokeStyle = C.grid; g.lineWidth = 1; g.strokeRect(padL, padT, W, H);
  g.fillStyle = C.axis; g.font = '11px Barlow, system-ui'; g.textAlign = 'center';
  const xl = close ? 'ra biển (m)' : 'khoảng cách ra biển (m)', xlw = g.measureText(xl).width + 20;
  for (let x = 0; x <= xEnd; x += step) if (X(x) < w - padR - xlw) g.fillText(String(x), X(x), h - 8);
  g.textAlign = 'right'; g.fillText(xl, w - padR, h - 8);
  g.save(); g.translate(12, padT + H / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('dọc mép bến (m)', 0, 0); g.restore();
  g.textAlign = 'left';
  if (close && dNear > xEnd) { g.fillStyle = C.ink; g.font = '600 12px Barlow, system-ui'; const t = `tàu còn cách ${num(dNear, 0)} m →`; g.fillText(t, padL + W - g.measureText(t).width - 8, padT + 18); }
  if (!close) compass(g, w - padR - 120, padT + 8, env, cfg);
  // chú giải
  g.font = '11px Barlow, system-ui';
  const legend = close ? `Điểm chạm BRT-${m.end === 'both' ? 'N1/N2' : m.end}${done ? ' · đệm co theo độ nén' : ' · đỏ đứt = dự báo'}`
    : `Toàn cảnh · ${done ? 'đã chạm bến' : fc ? 'đỏ đứt = chạm bến dự báo (P50' + (fc.two ? ', mờ P90)' : ', góc 0°)') : 'chưa có dự báo'} · xám = mỗi 60 s`;
  g.fillStyle = 'rgba(10,20,27,.85)'; g.fillRect(padL + 2, padT + H - 22, g.measureText(legend).width + 10, 18);
  g.fillStyle = C.ink; g.fillText(legend, padL + 6, padT + H - 8);
  if (done && close) {
    const col = LEVEL_COLOR[impact.level], E = e.energy_knm;
    const lines = [`CHẠM BẾN · ${(LEVEL_VN[impact.level] ?? '').toUpperCase()}`,
      `v ${num(e.v_contact_cms, 1)} cm/s · góc ${num(e.angle_contact_deg, 1)}°`,
      E != null ? `E ${num(E, 0)} kJ (${num(100 * impact.er, 0)} % Er)` : 'E: chưa tính',
      `R ${num(e.force_est_kn, 0)} kN · δ bến ${num(e.disp_est_mm, 1)} mm`,
      `Nén đệm ${num(100 * impact.ratio, 0)} %${e.max_compression_m != null ? ` · đo ${num(e.max_compression_m, 2)} m` : ''}`];
    g.font = '600 12px Barlow, system-ui'; const bw = Math.max(...lines.map((t) => g.measureText(t).width)) + 16, bx = padL + 8, by = padT + 8;
    g.fillStyle = 'rgba(10,20,27,.93)'; g.fillRect(bx, by, bw, 18 * lines.length + 8); g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(bx, by, bw, 18 * lines.length + 8);
    lines.forEach((t, n) => { g.fillStyle = n ? C.ink : col; g.font = n ? '12px Barlow, system-ui' : '700 12px Barlow, system-ui'; g.fillText(t, bx + 8, by + 18 + 18 * n); });
  }
  return { x0, xEnd, yBot, yTop };
}

/** La bàn: hướng Bắc, gió (hướng thổi tới), dòng chảy (hướng chảy tới) quy về mặt bằng theo pháp tuyến ra biển của bến. */
function compass(g, ix, iy, env, cfg) {
  const R = 34, cx = ix + 60, cy = iy + 48, sn = cfg.seaward_normal_deg ?? 0;
  const toPlan = (c) => { const th = (-(c - sn) * Math.PI) / 180; return [Math.cos(th), Math.sin(th)]; };
  g.fillStyle = 'rgba(10,20,27,.88)'; g.fillRect(ix, iy, 116, 116); g.strokeStyle = C.grid; g.lineWidth = 1; g.strokeRect(ix, iy, 116, 116);
  const arrow = ([dx, dy], len, col, label) => {
    const ex = cx + dx * len, ey = cy - dy * len;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
    const a = Math.atan2(ey - cy, ex - cx); g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - 8 * Math.cos(a - 0.4), ey - 8 * Math.sin(a - 0.4)); g.lineTo(ex - 8 * Math.cos(a + 0.4), ey - 8 * Math.sin(a + 0.4)); g.fill();
    if (label) { g.font = '600 10px Barlow, system-ui'; g.textAlign = 'left'; g.fillText(label, ex + (dx >= 0 ? 3 : -12), ey + (dy >= 0 ? -3 : 10)); }
  };
  arrow(toPlan(0), R, C.ink, 'N');
  g.font = '10px Barlow, system-ui'; g.textAlign = 'left';
  if (!env) { g.fillStyle = C.axis; g.fillText('chưa có gió, dòng chảy', ix + 4, iy + 108); return; }
  if (env.wind_speed_ms != null && env.wind_dir_deg != null) arrow(toPlan(env.wind_dir_deg + 180), clamp(8 + env.wind_speed_ms * 1.6, 8, R), '#6fa8ff', '');
  if (env.current_speed_ms != null && env.current_dir_deg != null) arrow(toPlan(env.current_dir_deg), clamp(8 + env.current_speed_ms * 30, 8, R), '#3dd6c4', '');
  g.fillStyle = '#6fa8ff'; g.fillText(`gió ${num(env.wind_speed_ms, 1)} m/s`, ix + 4, iy + 100);
  g.fillStyle = '#3dd6c4'; g.fillText(`dòng ${num(env.current_speed_ms, 2)} m/s`, ix + 4, iy + 112);
}

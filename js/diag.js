// Chế độ đo đường truyền (mở bằng ?diag=1): đo trên chính thiết bị đang xem (điện thoại 4G, máy tính bảng của hoa tiêu…).
// Mỗi khung SSE mang giờ đo (ts, giờ gateway), giờ máy chủ nhận (rx) và giờ máy chủ phát (sx). Tách độ trễ:
//   lên = rx − ts (gateway → máy chủ), xử lý = sx − rx, xuống = giờ máy này nhận (đã quy về giờ máy chủ) − sx, tổng = nhận − ts.
// Lệch đồng hồ máy này so với máy chủ ước lượng qua GET /health (lấy lần có RTT nhỏ nhất), cập nhật mỗi 5 phút.
import { apiBase } from './api.js';

export function createDiag() {
  if (new URLSearchParams(location.search).get('diag') !== '1') return null;
  const S = { tot: [], up: [], srv: [], down: [] };
  let t0 = Date.now(), frames = 0, reconnects = 0, wasOn = false, stall = 0, prev = null, offset = 0, rtt = null, wake = null, hidden = false;
  const box = document.createElement('aside');
  box.className = 'diag'; box.setAttribute('aria-live', 'polite');
  document.body.append(box);

  async function sync() {
    let best = null;
    for (let i = 0; i < 5; i++) {
      const a0 = Date.now();
      try { const r = await fetch(apiBase() + '/health', { cache: 'no-store' }); const j = await r.json(); const a1 = Date.now(); if (j.time && (!best || a1 - a0 < best.rtt)) best = { off: Date.parse(j.time) - (a0 + a1) / 2, rtt: a1 - a0 }; } catch { /* bỏ qua */ }
    }
    if (best) { offset = best.off; rtt = best.rtt; }
  }
  void sync(); setInterval(() => void sync(), 300_000);

  const q = (x, p) => { if (!x.length) return NaN; const y = [...x].sort((a, b) => a - b); return y[Math.min(y.length - 1, Math.floor(p * y.length))]; };
  const f = (v) => (Number.isFinite(v) && v > -Infinity ? (v / 1000).toFixed(2).replace('.', ',') : '–');
  const net = () => { const c = navigator.connection; return c ? `${c.effectiveType ?? ''}${c.downlink ? ' · ' + c.downlink + ' Mb/s' : ''}${c.rtt ? ' · rtt ' + c.rtt + ' ms' : ''}` : 'không rõ'; };
  function summary() {
    const mins = (Date.now() - t0) / 60_000;
    return [`Đo đường truyền Berthing Pilot – ${new Date().toLocaleString('vi-VN', { hour12: false })}`,
      `Thiết bị: ${navigator.userAgent.slice(0, 90)}`, `Mạng: ${net()} · lệch đồng hồ ${Math.round(offset)} ms (RTT ${rtt ?? '–'} ms)`,
      `Thời gian đo: ${mins.toFixed(1)} phút · khung ${frames} · nối lại ${reconnects} · lặng khi có tàu tối đa ${(stall / 1000).toFixed(1).replace('.', ',')} s`,
      `Tổng   p50/p95/max: ${f(q(S.tot, 0.5))} / ${f(q(S.tot, 0.95))} / ${f(S.tot.reduce((m, x) => Math.max(m, x), -Infinity))} s`,
      `Lên    p50/p95: ${f(q(S.up, 0.5))} / ${f(q(S.up, 0.95))} s (gateway → máy chủ)`,
      `Xử lý  p50/p95: ${f(q(S.srv, 0.5))} / ${f(q(S.srv, 0.95))} s`,
      `Xuống  p50/p95: ${f(q(S.down, 0.5))} / ${f(q(S.down, 0.95))} s (máy chủ → thiết bị này)`].join('\n');
  }
  function render() {
    if (hidden) { box.innerHTML = '<button class="btn sm" data-a="show">Đo đường truyền</button>'; return; }
    const mins = (Date.now() - t0) / 60_000;
    box.innerHTML = `<h3>Đo đường truyền <span class="muted">${mins.toFixed(1)} phút</span></h3>
      <table><tbody>
        <tr><th></th><th>p50</th><th>p95</th></tr>
        <tr><td>Tổng</td><td>${f(q(S.tot, 0.5))}</td><td>${f(q(S.tot, 0.95))}</td></tr>
        <tr><td>Lên</td><td>${f(q(S.up, 0.5))}</td><td>${f(q(S.up, 0.95))}</td></tr>
        <tr><td>Xử lý</td><td>${f(q(S.srv, 0.5))}</td><td>${f(q(S.srv, 0.95))}</td></tr>
        <tr><td>Xuống</td><td>${f(q(S.down, 0.5))}</td><td>${f(q(S.down, 0.95))}</td></tr></tbody></table>
      <p>Khung ${frames} · nối lại ${reconnects} · lặng tối đa ${(stall / 1000).toFixed(1).replace('.', ',')} s<br>Mạng ${net()} · lệch giờ ${Math.round(offset)} ms</p>
      <div class="row"><button class="btn sm" data-a="copy">Sao chép kết quả</button><button class="btn sm" data-a="reset">Đặt lại</button>
        <button class="btn sm" data-a="wake">${wake ? 'Cho tắt màn hình' : 'Giữ màn hình sáng'}</button><button class="btn sm" data-a="hide">Ẩn</button></div>`;
  }
  box.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'copy') { try { await navigator.clipboard.writeText(summary()); e.target.textContent = 'Đã sao chép'; } catch { prompt('Sao chép kết quả:', summary()); } return; }
    if (a === 'reset') { for (const k of Object.keys(S)) S[k] = []; t0 = Date.now(); frames = 0; reconnects = 0; stall = 0; prev = null; }
    if (a === 'hide') hidden = true;
    if (a === 'show') hidden = false;
    if (a === 'wake') {
      if (wake) { await wake.release().catch(() => {}); wake = null; }
      else { try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; render(); }); } catch { alert('Trình duyệt này không cho giữ màn hình sáng; hãy tắt khoá màn hình tự động trong cài đặt máy.'); } }
    }
    render();
  });
  setInterval(render, 2000); render();

  return {
    frame(d) {
      const now = Date.now(), srvNow = now + offset, ts = Date.parse(d.ts);
      frames++;
      S.tot.push(srvNow - ts);
      if (d.rx) S.up.push(d.rx - ts);
      if (d.rx && d.sx) S.srv.push(d.sx - d.rx);
      if (d.sx) S.down.push(srvNow - d.sx);
      if (prev && ts > prev.ts && ts - prev.ts <= 2000) stall = Math.max(stall, now - prev.at);
      prev = { ts, at: now };
      if (S.tot.length > 20000) for (const k of Object.keys(S)) S[k].splice(0, 5000);
    },
    // chỉ đếm nối lại sau khi mất kết nối (retry → on), không đếm khi giao diện chủ động mở luồng mới (đổi bến, đổi nguồn)
    state(s) { if (s === 'on' && wasOn === 'retry') reconnects++; wasOn = s; },
  };
}

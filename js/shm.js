// Tab "Port-SHM" (kỹ sư): trạng thái tích hợp, mã công trình và cảm biến ảo của bến, kiểm tra kết nối,
// hàng đợi gửi (dự báo, kết quả chạm, cảm biến ảo), gửi lại bản tin lỗi.
import { num } from './plan.js';
import { esc } from './views.js';

const KIND_VN = { forecast: 'Dự báo', contact: 'Kết quả chạm', ingest: 'Cảm biến ảo' };
const ST_VN = { pending: 'Chờ gửi', sent: 'Đã gửi', failed: 'Lỗi' };
const ENV_VN = { wind_speed_ms: ['Gió', 'm/s'], wind_dir_deg: ['Hướng gió (thổi từ)', '°'], current_speed_ms: ['Dòng chảy', 'm/s'], current_dir_deg: ['Hướng dòng (chảy tới)', '°'],
  hs_m: ['Sóng Hs', 'm'], tp_s: ['Chu kỳ Tp', 's'], wave_dir_deg: ['Hướng sóng', '°'], water_level_m: ['Mực nước', 'm'] };

export function shmTab({ api, store, root }) {
  let st = null, timer = null, msg = '', bad = false, test = null;
  const tl = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour12: false }) : '–');
  const ago = (iso) => { if (!iso) return ''; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `${Math.round(s)} s trước` : s < 5400 ? `${Math.round(s / 60)} phút trước` : `${num(s / 3600, 1)} giờ trước`; };
  const say = (m, b = false) => { msg = m; bad = b; render(); };

  async function load() { st = await api.get('/v1/integrations/shm'); }
  /** Lỗi gần nhất: sau lỗi đã gửi được và mọi bến đọc được thì ghi "đã khắc phục" (màu xám) thay vì đỏ. */
  function lastErr(st) {
    const e = st.stats?.last_error, at = st.stats?.last_error_at;
    if (!e) return 'không có';
    const t = (x) => (x ? Date.parse(x) : 0);
    const reads = (st.berths ?? []).filter((b) => b.shm_structure_code && b.reading);
    const fixed = t(st.stats?.last_ok_at) > t(at) && reads.every((b) => b.reading.ok && t(b.reading.at) > t(at));
    return fixed ? `<span class="muted">${esc(e)} (${ago(at)}) – <b>đã khắc phục</b>: sau đó đã gửi và đọc được bình thường</span>`
      : `<span class="bad">${esc(e)}</span> <span class="muted">(${ago(at)})</span>`;
  }
  function reading(r) {
    if (!r) return '<span class="muted">chưa đọc</span>';
    if (!r.ok) return `<span class="bad">Lỗi: ${esc(r.error)}</span> <span class="muted">(${ago(r.at)})</span>`;
    const s = r.summary ?? {}, keys = Object.keys(ENV_VN).filter((k) => s[k] !== undefined);
    const env = keys.length ? keys.map((k) => `${ENV_VN[k][0]} <b>${num(s[k], k.endsWith('deg') ? 0 : 2)}</b> ${ENV_VN[k][1]}`).join(' · ') + ` <span class="muted">(số đo ${ago(s.ts)})</span>` : '<span class="warn-t">Port-SHM chưa có số liệu môi trường mới (≤ 6 giờ)</span>';
    const sx = (r.structural ?? []).map((x) => `${esc(x.sensor)}/${esc(x.channel)} <b>${num(x.value, 2)}</b> ${esc(x.unit)} <span class="muted">(${ago(x.ts)})</span>`).join(' · ');
    return `<div>${env}</div><div class="muted">Kết cấu: ${sx || 'chưa có cảm biến lực đệm (fender_force), chuyển vị (displacement) có số liệu'}</div><div class="muted">Đọc lúc ${tl(r.at)}</div>`;
  }
  function render() {
    if (!st) { root.innerHTML = '<p class="muted pad">Đang tải…</p>'; return; }
    const cnt = (k, s) => st.outbox?.find((x) => x.kind === k && x.status === s)?.n ?? 0;
    const pending = ['forecast', 'contact', 'ingest'].reduce((a, k) => a + cnt(k, 'pending'), 0), failed = ['forecast', 'contact', 'ingest'].reduce((a, k) => a + cnt(k, 'failed'), 0);
    root.innerHTML = `
      <div class="toolbar"><h2 class="evtitle">Tích hợp Port-SHM <span class="pill ${st.enabled ? 'on' : ''}">${st.enabled ? 'Đang bật' : 'Đang tắt'}</span></h2><span class="sp"></span>
        ${st.enabled ? `<button class="btn" id="sh-retry" ${failed ? '' : 'disabled'}>Gửi lại ${failed} bản tin lỗi</button>` : ''}<button class="btn" id="sh-reload">Làm mới</button></div>
      <p id="sh-msg" class="msg ${bad ? 'bad' : 'ok'}" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      <div class="grid2">
        <section class="panel"><h2>Kết nối</h2><dl class="kv">
          <dt>Địa chỉ Port-SHM</dt><dd>${esc(st.url ?? 'chưa đặt (SHM_URL)')}</dd>
          <dt>Khoá gateway</dt><dd>${st.key_set ? 'đã đặt (SHM_GATEWAY_KEY)' : '<span class="bad">chưa đặt (SHM_GATEWAY_KEY)</span>'}</dd>
          ${st.enabled ? `<dt>Gửi dự báo</dt><dd>mỗi ${st.forecast_every_s} s thời gian lượt cập, ngay khi đổi mức cảnh báo</dd>
          <dt>Đọc môi trường, FND, DSP</dt><dd>mỗi ${st.env_every_s} s khi có lượt cập thật; 5 phút/lần khi rảnh</dd>
          <dt>Chờ FND/DSP sau khi đóng</dt><dd>tối đa ${st.summary_wait_s} s</dd>
          <dt>Lượt cập giả lập</dt><dd>${st.send_sim ? 'gửi, Port-SHM ghi là "mô phỏng"' : 'không gửi'}; phát lại không gửi</dd>
          <dt>Gửi được gần nhất</dt><dd>${tl(st.stats?.last_ok_at)} ${st.stats?.last_ok_at ? `<span class="muted">(${ago(st.stats.last_ok_at)})</span>` : ''}</dd>
          <dt>Lỗi gần nhất</dt><dd>${lastErr(st)}</dd>`
          : `<dt>Lý do tắt</dt><dd class="bad">${esc(st.reason ?? '')}</dd>`}</dl></section>
        <section class="panel"><h2>Hàng đợi gửi đi</h2>
          <table class="tbl sm"><thead><tr><th>Loại</th><th class="r">Chờ gửi</th><th class="r">Đã gửi</th><th class="r">Lỗi</th></tr></thead><tbody>
          ${['forecast', 'contact', 'ingest'].map((k) => `<tr><td>${KIND_VN[k]}</td><td class="r">${cnt(k, 'pending')}</td><td class="r">${cnt(k, 'sent')}</td><td class="r ${cnt(k, 'failed') ? 'bad' : ''}">${cnt(k, 'failed')}</td></tr>`).join('')}</tbody></table>
          <p class="note">${pending ? `Bản tin chờ lâu nhất tạo ${ago(st.oldest_pending)}. Tồn quá 10 phút sẽ mở cảnh báo hệ thống.` : 'Không có bản tin tồn.'}
          Port-SHM lỗi hoặc mất mạng không làm chậm dự báo: bản tin được giữ lại và gửi lại sau.</p></section>
      </div>
      <section class="panel"><h2>Bến và mã trong Port-SHM</h2>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Bến</th><th>Mã công trình Port-SHM</th><th>Mã cảm biến ảo (Kết quả cập tàu)</th><th></th><th>Lần đọc gần nhất</th></tr></thead><tbody>
        ${(st.berths ?? []).map((b) => `<tr data-berth="${esc(b.code)}"><td><b>${esc(b.code)}</b><br><span class="muted">${esc(b.name)}</span></td>
          <td><input name="shm_structure_code" value="${esc(b.shm_structure_code ?? '')}" placeholder="ví dụ WH-P1" maxlength="60" size="12"></td>
          <td><input name="shm_sensor_code" value="${b.sensor_default === false ? esc(b.shm_sensor_code ?? '') : ''}" placeholder="${esc(b.shm_structure_code ? b.shm_structure_code + '-BERTHING' : '<công trình>-BERTHING')}" maxlength="60" size="18"></td>
          <td class="acts"><button class="btn sm" data-save>Lưu</button>${st.enabled ? '<button class="btn sm" data-test>Kiểm tra kết nối</button>' : ''}</td>
          <td class="wrap">${reading(test?.berth === b.code ? test.r : b.reading)}</td></tr>`).join('')}</tbody></table></div>
        <p class="note">Bến chưa có mã công trình thì không gửi gì sang Port-SHM. Cảm biến ảo nhận kết quả mỗi lượt cập <b>thật</b> (vận tốc, góc, năng lượng, % năng lượng định mức,
          phản lực, chuyển vị tính, chuyển vị P90, xác suất vượt, thời gian báo trước, mức cao nhất) để Port-SHM áp ngưỡng, quy tắc như cảm biến thường.</p></section>
      ${st.recent?.length ? `<section class="panel"><h2>Bản tin gần đây (kết quả chạm, cảm biến ảo, bản tin lỗi)</h2><div class="tblwrap"><table class="tbl sm">
        <thead><tr><th>#</th><th>Loại</th><th>Lượt cập</th><th>Chế độ</th><th>Trạng thái</th><th class="r">Lần gửi</th><th>Tạo lúc</th><th>Lỗi</th></tr></thead><tbody>
        ${st.recent.map((r) => `<tr><td>${r.id}</td><td>${KIND_VN[r.kind] ?? r.kind}</td><td>${esc(r.event ?? '–')}</td><td>${r.mode === 'live' ? 'thật' : r.mode === 'simulation' ? 'mô phỏng' : '–'}</td>
          <td class="${r.status === 'failed' ? 'bad' : ''}">${ST_VN[r.status] ?? r.status}</td><td class="r">${r.attempts}</td><td>${tl(r.created_at)}</td><td class="wrap">${esc(r.last_error ?? '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <section class="panel"><h2>Cài đặt lần đầu</h2><ol class="steps">
        <li>Trên máy chạy Port-SHM 0.4.2: <code>docker exec -it port-shm-backend python scripts/setup_berthing_pilot.py --email &lt;admin Port-SHM&gt; --structure &lt;mã công trình&gt;</code>
          (tạo gateway "Berthing Pilot 4.0" có quyền đọc, cảm biến ảo &lt;mã công trình&gt;-BERTHING, ngưỡng minh hoạ; khoá ghi vào <code>/tmp/pilot-shm.key</code> trong container, không hiện ra màn hình),
          rồi <code>docker cp port-shm-backend:/tmp/pilot-shm.key .</code> và <code>docker exec port-shm-backend rm /tmp/pilot-shm.key</code>.</li>
        <li>Chép khoá vào <code>SHM_GATEWAY_KEY</code> và địa chỉ vào <code>SHM_URL</code> trong <code>secrets/pilot.env</code> của Berthing Pilot; xoá tệp khoá; khởi động lại backend.</li>
        <li>Nhập mã công trình ở bảng trên, bấm "Kiểm tra kết nối".</li></ol>
        <p class="note">Không dán khoá vào tin nhắn hay ảnh chụp màn hình. Máy dự phòng (READ_ONLY) không gửi, không đọc Port-SHM.</p></section>`;
    bind();
  }
  function bind() {
    root.querySelector('#sh-reload').onclick = async () => { msg = ''; await refresh(); };
    const rt = root.querySelector('#sh-retry');
    if (rt) rt.onclick = async () => { try { const r = await api.post('/v1/integrations/shm/retry', {}); await load(); say(`Đã đưa ${r.requeued} bản tin về hàng chờ gửi.`); } catch (e) { say(e.message, true); } };
    root.querySelectorAll('tr[data-berth]').forEach((tr) => {
      const code = tr.dataset.berth;
      tr.querySelector('[data-save]').onclick = async () => {
        const body = { shm_structure_code: tr.querySelector('[name=shm_structure_code]').value.trim(), shm_sensor_code: tr.querySelector('[name=shm_sensor_code]').value.trim() };
        try { await api.req('PATCH', `/v1/berths/${encodeURIComponent(code)}`, body); await load(); say(`Đã lưu mã Port-SHM của bến ${code}.`); } catch (e) { say(e.message, true); }
      };
      const tb = tr.querySelector('[data-test]');
      if (tb) tb.onclick = async () => {
        tb.disabled = true;
        try { const r = await api.post('/v1/integrations/shm/test', { berth: code }); test = { berth: code, r }; say(r.ok ? `Kết nối Port-SHM được, đọc số liệu của công trình ${tr.querySelector('[name=shm_structure_code]').value}.` : `Không đọc được: ${r.error}`, !r.ok); }
        catch (e) { say(e.message, true); } finally { tb.disabled = false; }
      };
    });
  }
  async function refresh() {
    try { await load(); } catch (e) { msg = e.message; bad = true; }
    // không vẽ lại khi người dùng đang gõ trong ô nhập
    if (!root.contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') render();
  }
  return {
    async show() { await refresh(); clearInterval(timer); timer = setInterval(() => { if (!root.closest('[hidden]')) refresh(); }, 5000); },
    hide() { clearInterval(timer); timer = null; },
    reset() { test = null; },
  };
}

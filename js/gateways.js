// Tab "Gateway" (kỹ sư xem, quản trị thao tác): trạng thái từng gateway theo nhịp sống, thiết bị, hàng đợi, đồng hồ, LED;
// tạo gateway, đổi khoá, bật/tắt, chế độ LED (tắt / cục bộ / theo máy chủ – M7), cấp khoá ký lệnh LED.
// Khoá chỉ hiện MỘT lần ngay sau khi cấp: tải về thành tệp để chép sang máy gateway, không dán vào tin nhắn.
import { num } from './plan.js';
import { esc } from './views.js';

const KIND_VN = { live: 'Thật', sim: 'Giả lập', replay: 'Phát lại' };
const LED_VN = { off: 'Tắt', local: 'Cục bộ (biên dạng vận tốc)', server: 'Theo máy chủ (dự báo)' };
const LVL_VN = { off: 'tắt', green: 'xanh', yellow: 'vàng', red: 'đỏ', white: 'trắng' };
const ROLES = ['viewer', 'pilot', 'operator', 'engineer', 'admin'];

export function gatewaysTab({ api, store, root }) {
  let list = null, timer = null, msg = '', bad = false, secret = null, open = null, detail = null, armed = null, creating = false;
  const isAdmin = () => ROLES.indexOf(store.user?.role) >= ROLES.indexOf('admin');
  const tl = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour12: false }) : '–');
  const ago = (iso) => { if (!iso) return 'chưa có'; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `${Math.round(s)} s trước` : s < 5400 ? `${Math.round(s / 60)} phút trước` : s < 172800 ? `${num(s / 3600, 1)} giờ trước` : `${Math.round(s / 86400)} ngày trước`; };
  const say = (m, b = false) => { msg = m; bad = b; render(); };

  async function load() {
    list = await api.get('/v1/gateways');
    if (open) {
      const [hb, rj] = await Promise.all([api.get(`/v1/gateways/${encodeURIComponent(open)}/heartbeats?limit=1`), api.get(`/v1/gateways/${encodeURIComponent(open)}/rejects?limit=20`)]);
      detail = { code: open, hb: hb[0]?.payload ?? null, rejects: rj };
    }
  }
  const devs = (g) => {
    const d = g.devices ?? [];
    if (!d.length) return '<span class="muted">–</span>';
    return d.map((x) => `<span class="gdev ${x.online ? (x.faults?.length ? 'warn' : 'ok') : 'bad'}" title="${esc((x.faults ?? []).join(', ') || (x.online ? 'trực tuyến' : 'mất kết nối'))}">${esc(x.code.replace(/^B\d+-/, ''))}</span>`).join(' ');
  };
  const led = (g) => {
    const lv = g.led?.level;
    return `${esc(LED_VN[g.led_mode] ?? g.led_mode)}${g.led_mode === 'server' ? (g.led_key_set ? '' : ' <span class="bad">· chưa có khoá ký</span>') : ''}`
      + (lv ? `<br><span class="muted">bảng đang ${LVL_VN[lv] ?? lv}${g.led?.downlink ? ' · đang nhận lệnh' : ''}</span>` : '');
  };
  function secretBox() {
    if (!secret) return '';
    return `<section class="panel secret" role="alert"><h2>${esc(secret.title)}</h2>
      <p>Khoá chỉ hiện <b>một lần</b>. Bấm <b>Tải tệp khoá</b>, chép tệp sang máy gateway (${esc(secret.where)}), rồi xoá tệp trên máy này.
        Không dán khoá vào tin nhắn, email hay ảnh chụp màn hình.</p>
      <div class="row"><button class="btn primary" id="gw-dl">Tải tệp khoá (${esc(secret.file)})</button><button class="btn" id="gw-show">${secret.shown ? 'Ẩn' : 'Hiện khoá'}</button><button class="btn" id="gw-done">Đã lưu xong – đóng</button></div>
      ${secret.shown ? `<pre class="key">${esc(secret.value)}</pre>` : ''}</section>`;
  }
  function render() {
    if (!list) { root.innerHTML = '<p class="muted pad">Đang tải…</p>'; return; }
    const adm = isAdmin();
    root.innerHTML = `
      <div class="toolbar"><h2 class="evtitle">Gateway tại bến</h2><span class="sp"></span>
        ${adm ? `<button class="btn" id="gw-new">${creating ? 'Đóng' : '+ Tạo gateway'}</button>` : ''}<button class="btn" id="gw-reload">Làm mới</button></div>
      <p class="msg ${bad ? 'bad' : 'ok'}" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      ${secretBox()}
      ${creating ? `<section class="panel"><h2>Tạo gateway</h2><form id="gw-form" class="formrow">
        <label>Mã <input name="code" required pattern="GW-B\\d{2,3}-\\d{1,2}" placeholder="GW-B01-2" size="10"></label>
        <label>Loại <select name="kind"><option value="live">Thật (BRT tại bến)</option><option value="sim">Giả lập (bàn thử)</option></select></label>
        <label>Bến <input name="berths" required value="${esc(store.berth ?? '')}" size="10" placeholder="B01"></label>
        <label>Ghi chú <input name="note" maxlength="120" size="24"></label>
        <button class="btn primary" type="submit">Tạo và cấp khoá</button></form>
        <p class="note">Gateway "Giả lập" chỉ gửi được nguồn sim (hiện ở chế độ "Giả lập"); gateway "Thật" chỉ gửi nguồn live. Mã cuối 9x (ví dụ GW-B01-90) dành cho bàn thử.</p></section>` : ''}
      <div class="tblwrap"><table class="tbl gw"><thead><tr><th>Gateway</th><th>Trạng thái</th><th>Thiết bị</th><th>Hàng đợi</th><th>Đồng hồ</th><th>LED</th><th class="r">Từ chối 24 h</th>${adm ? '<th>Thao tác</th>' : ''}</tr></thead><tbody>
      ${list.map((g) => `<tr data-gw="${esc(g.code)}" class="${g.active ? '' : 'off'} ${open === g.code ? 'sel' : ''}">
        <td><button class="link" data-open><b>${esc(g.code)}</b></button><br><span class="muted">${KIND_VN[g.kind] ?? g.kind} · ${esc((g.berths ?? []).join(', '))}${g.agent_version ? ` · agent ${esc(g.agent_version)}` : ''}</span>${g.note ? `<br><span class="muted">${esc(g.note)}</span>` : ''}</td>
        <td>${!g.active ? '<span class="pill">Đã tắt</span>' : g.online ? '<span class="pill on">Trực tuyến</span>' : g.last_seen_at ? '<span class="pill bad">Mất liên lạc</span>' : '<span class="pill">Chưa kết nối</span>'}<br><span class="muted">nhịp sống ${ago(g.last_seen_at)}</span></td>
        <td>${devs(g)}</td>
        <td>${g.queue ? `${g.queue.pending} khung${g.queue.pending && g.queue.oldest_ts ? `<br><span class="muted">cũ nhất ${ago(g.queue.oldest_ts)}</span>` : ''}` : '–'}</td>
        <td>${g.clock ? (g.clock.gnss_lock ? `khoá GNSS<br><span class="muted">lệch ${num(g.clock.offset_ms, 1)} ms</span>` : '<span class="bad">chưa khoá GNSS</span>') : '–'}</td>
        <td>${led(g)}</td>
        <td class="r ${g.rejects_24h ? 'bad' : ''}">${g.rejects_24h}</td>
        ${adm ? `<td class="acts">
          <select data-led aria-label="Chế độ LED của ${esc(g.code)}">${['local', 'server', 'off'].map((m) => `<option value="${m}" ${g.led_mode === m ? 'selected' : ''}>LED: ${LED_VN[m]}</option>`).join('')}</select>
          <button class="btn sm" data-ledkey>${g.led_key_set ? 'Đổi khoá ký LED' : 'Cấp khoá ký LED'}</button>
          <button class="btn sm" data-rotate>${armed === 'rot:' + g.code ? 'Bấm lần nữa để đổi khoá' : 'Đổi khoá gateway'}</button>
          <button class="btn sm" data-active>${g.active ? (armed === 'off:' + g.code ? 'Bấm lần nữa để tắt' : 'Tắt') : 'Bật'}</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>
      ${detail ? detailBox() : '<p class="note">Bấm vào mã gateway để xem nhịp sống gần nhất (nhật ký LED, mạng, nguồn, máy) và các khung bị từ chối.</p>'}
      <section class="panel"><h2>LED theo máy chủ (M7)</h2><p class="note">
        Mặc định LED tại bến chạy <b>cục bộ</b> theo biên dạng vận tốc, không phụ thuộc mạng. Chế độ <b>theo máy chủ</b> thêm mức cảnh báo <b>dự báo</b>
        (Chú ý → vàng, Cảnh báo/Nguy hiểm → đỏ): gateway mở kênh lệnh có chữ ký HMAC, mỗi lệnh chỉ có hạn 2,5 s, bảng hiển thị mức <b>cao hơn</b> giữa cục bộ và lệnh
        (máy chủ không thể hạ đỏ cục bộ); mất mạng thì tự về cục bộ sau 3 s. Các bước: cấp khoá ký → chép tệp vào máy gateway, khai <code>led_hmac_key_file</code> trong agent.json
        → chọn "LED: Theo máy chủ". Agent áp dụng trong vòng 5 phút (lần tải cấu hình kế tiếp).</p></section>`;
    bind();
  }
  function detailBox() {
    const h = detail.hb;
    const log = (h?.led_log ?? []).slice(-12).reverse();
    return `<section class="panel"><h2>${esc(detail.code)} – nhịp sống gần nhất ${h ? `<span class="muted">${tl(h.ts)}</span>` : ''}</h2>
      ${h ? `<dl class="kv">
        <dt>Mạng</dt><dd>${esc(h.net?.link ?? '–')}${h.net?.rtt_ms != null ? ` · RTT ${num(h.net.rtt_ms, 0)} ms` : ''}</dd>
        <dt>Nguồn</dt><dd>${h.ups ? `${h.ups.on_battery ? '<span class="bad">đang chạy pin</span>' : 'điện lưới'}${h.ups.charge_pct != null ? ` · pin ${num(h.ups.charge_pct, 0)} %` : ''}` : 'không khai UPS'}</dd>
        <dt>Máy</dt><dd>${h.host ? `CPU ${h.host.cpu_temp_c != null ? num(h.host.cpu_temp_c, 0) + ' °C' : '–'} · đĩa trống ${num(h.host.disk_free_pct, 0)} % · chạy ${num((h.host.uptime_s ?? 0) / 3600, 1)} h` : '–'}</dd>
        <dt>Thiết bị</dt><dd>${(h.devices ?? []).map((d) => `${esc(d.code)}: ${d.online ? 'trực tuyến' : '<span class="bad">mất kết nối</span>'}${d.faults?.length ? ` <span class="bad">(${esc(d.faults.join(', '))})</span>` : ''} · ${esc(d.profile)} · vận tốc ${esc(d.velocity_source)}${d.temp_c != null ? ` · ${num(d.temp_c, 1)} °C` : ''}`).join('<br>')}</dd>
      </dl>
      <h3>Nhật ký LED</h3>${log.length ? `<table class="tbl sm"><thead><tr><th>Lúc</th><th>Mức</th><th>Nguồn</th><th>Chữ</th></tr></thead><tbody>
        ${log.map((x) => `<tr><td>${tl(x.ts)}</td><td><span class="lvl ${esc(x.level)}">${LVL_VN[x.level] ?? esc(x.level)}</span></td><td>${x.origin === 'server' ? 'máy chủ' : 'cục bộ'}</td><td>${esc(x.text ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Không đổi mức trong chu kỳ vừa qua.</p>'}` : '<p class="muted">Chưa có nhịp sống.</p>'}
      <h3>Khung bị từ chối gần đây</h3>${detail.rejects.length ? `<table class="tbl sm"><thead><tr><th>Lúc</th><th>Loại</th><th class="r">seq</th><th>Lý do</th><th>Chi tiết</th></tr></thead><tbody>
        ${detail.rejects.map((r) => `<tr><td>${tl(r.ts)}</td><td>${esc(r.kind)}</td><td class="r">${r.seq ?? ''}</td><td>${esc(r.reason)}</td><td class="wrap">${esc(r.detail)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Không có.</p>'}</section>`;
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text + '\n'], { type: 'application/octet-stream' })); a.download = name;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function bind() {
    root.querySelector('#gw-reload').onclick = async () => { msg = ''; await refresh(true); };
    const nb = root.querySelector('#gw-new'); if (nb) nb.onclick = () => { creating = !creating; render(); };
    const f = root.querySelector('#gw-form');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault(); const d = new FormData(f);
      const body = { code: String(d.get('code')).trim().toUpperCase(), kind: d.get('kind'), berths: String(d.get('berths')).split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()), note: String(d.get('note') ?? '') };
      try { const r = await api.post('/v1/gateways', body); creating = false; secret = { title: `Khoá gateway ${r.code}`, value: r.key, file: `${r.code}.key`, where: 'tệp key_file trong agent.json, ví dụ secrets/gateway.key' }; await load(); say(`Đã tạo ${r.code}.`); }
      catch (err) { say(err.message, true); }
    };
    if (secret) {
      root.querySelector('#gw-dl').onclick = () => download(secret.file, secret.value);
      root.querySelector('#gw-show').onclick = () => { secret.shown = !secret.shown; render(); };
      root.querySelector('#gw-done').onclick = () => { secret = null; render(); };
    }
    root.querySelectorAll('tr[data-gw]').forEach((tr) => {
      const code = tr.dataset.gw, g = list.find((x) => x.code === code);
      tr.querySelector('[data-open]').onclick = async () => { open = open === code ? null : code; detail = null; await refresh(true); };
      const sel = tr.querySelector('[data-led]');
      if (!sel) return;
      sel.onchange = async () => {
        const m = sel.value;
        try { await api.req('PATCH', `/v1/gateways/${encodeURIComponent(code)}`, { led_mode: m, led_downlink: m === 'server' }); await load(); say(`${code}: LED ${LED_VN[m].toLowerCase()}. Agent áp dụng trong vòng 5 phút.`); }
        catch (err) { await load(); say(err.message, true); }
      };
      tr.querySelector('[data-ledkey]').onclick = async () => {
        try { const r = await api.post(`/v1/gateways/${encodeURIComponent(code)}/led-key`, {}); secret = { title: `Khoá ký lệnh LED ${code}`, value: r.led_key, file: `${code}-led.key`, where: 'tệp led_hmac_key_file trong agent.json' }; await load(); say(`Đã cấp khoá ký LED cho ${code}${g.led_key_set ? ' (khoá cũ hết hiệu lực)' : ''}.`); }
        catch (err) { say(err.message, true); }
      };
      tr.querySelector('[data-rotate]').onclick = async () => {
        if (armed !== 'rot:' + code) { armed = 'rot:' + code; render(); setTimeout(() => { if (armed === 'rot:' + code) { armed = null; render(); } }, 5000); return; }
        armed = null;
        try { const r = await api.post(`/v1/gateways/${encodeURIComponent(code)}/rotate-key`, {}); secret = { title: `Khoá mới của ${r.code}`, value: r.key, file: `${r.code}.key`, where: 'thay tệp key_file cũ, rồi khởi động lại agent' }; await load(); say(`${code}: khoá cũ đã hết hiệu lực – agent sẽ báo 401 cho tới khi thay tệp khoá.`); }
        catch (err) { say(err.message, true); }
      };
      tr.querySelector('[data-active]').onclick = async () => {
        if (g.active && armed !== 'off:' + code) { armed = 'off:' + code; render(); setTimeout(() => { if (armed === 'off:' + code) { armed = null; render(); } }, 5000); return; }
        armed = null;
        try { await api.req('PATCH', `/v1/gateways/${encodeURIComponent(code)}`, { active: !g.active }); await load(); say(`${code}: ${g.active ? 'đã tắt (máy chủ từ chối số liệu của gateway này)' : 'đã bật'}.`); }
        catch (err) { say(err.message, true); }
      };
    });
  }
  async function refresh(force = false) {
    try { await load(); } catch (e) { msg = e.message; bad = true; }
    // không vẽ lại khi đang nhập, đang chọn hoặc đang hiện khoá
    const a = document.activeElement;
    if (force || !(root.contains(a) && ['INPUT', 'SELECT'].includes(a.tagName))) { if (!secret || force) render(); }
  }
  return {
    async show() { await refresh(true); clearInterval(timer); timer = setInterval(() => { if (!root.closest('[hidden]') && !secret) refresh(); }, 10_000); },
    hide() { clearInterval(timer); timer = null; secret = null; },
  };
}

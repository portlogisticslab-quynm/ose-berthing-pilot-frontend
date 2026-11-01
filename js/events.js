// Tab "Lượt cập": danh sách, xem lại (phát lại trên trình duyệt), gắn tàu và hướng mũi, đóng/huỷ, tách, gộp,
// đánh giá sau cập, xuất hồ sơ, phát lại qua engine với mô hình khác, so sánh dự báo.
import { drawPlan, num } from './plan.js';
import { drawCharts, nearD, maxV, vAllowAt, esc, frameAt, LEVEL_VN, STATUS_VN, LED_VN, SOURCE_VN, END_VN } from './views.js';
import { drawAnim } from './anim.js';

const ROLES = ['viewer', 'pilot', 'operator', 'engineer', 'admin'];
const FINAL = ['closed', 'aborted', 'merged'];
const SPEEDS = [1, 5, 20, 60];
const pref = { get: (k, d) => { try { return localStorage.getItem('pilot.' + k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('pilot.' + k, v); } catch { /* bỏ qua */ } } };

export function eventsTab({ api, store, root }) {
  const can = (r) => ROLES.indexOf(store.user?.role) >= ROLES.indexOf(r);
  const st = { view: 'list', filter: { source: 'live', from: '', to: '' }, list: [], d: null, frames: [], idx: 0, pos: 0, playing: false, speed: 20, mode: pref.get('replayMode', 'anim'), vessels: null, models: null, msg: '' };
  let raf = 0, lastT = 0;
  const q = (sel) => root.querySelector(sel);
  const tz = () => st.d?.event?.timezone || 'Asia/Ho_Chi_Minh';
  const tLocal = (iso, withDate = false) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: tz(), hour12: false, ...(withDate ? {} : { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : '–');
  const say = (m, bad = false) => { st.msg = m; const el = q('#ev-msg'); if (el) { el.textContent = m; el.className = 'msg ' + (bad ? 'bad' : 'ok'); el.hidden = !m; } };

  // ------------------------------------------------------------------ danh sách
  async function loadList() {
    const f = st.filter, p = new URLSearchParams({ source: f.source, berth: store.berth, limit: '200' });
    if (f.from) p.set('from', new Date(f.from + 'T00:00:00').toISOString());
    if (f.to) p.set('to', new Date(f.to + 'T23:59:59').toISOString());
    st.list = await api.get('/v1/events?' + p);
  }
  function renderList() {
    const f = st.filter;
    root.innerHTML = `
      <div class="toolbar">
        <label>Nguồn <select id="ev-src">${Object.entries(SOURCE_VN).map(([k, v]) => `<option value="${k}" ${k === f.source ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Từ ngày <input id="ev-from" type="date" value="${f.from}"></label>
        <label>Đến ngày <input id="ev-to" type="date" value="${f.to}"></label>
        <button id="ev-filter" class="btn">Lọc</button>
        <span class="sp"></span><span class="muted">${st.list.length} lượt cập – bến ${esc(store.berth)}</span>
      </div>
      <div class="tblwrap"><table class="tbl" id="ev-table">
        <thead><tr><th>Mã lượt cập</th><th>Bắt đầu</th><th>Tàu</th><th>Trạng thái</th><th class="r">V chạm (cm/s)</th><th class="r">Năng lượng (kJ)</th>
          <th>Đầu chạm</th><th>LED cao nhất</th><th>Dự báo cao nhất</th><th class="r">Đủ số liệu</th><th>Đánh giá</th></tr></thead>
        <tbody>${st.list.length ? st.list.map((e) => `<tr data-id="${e.id}" tabindex="0">
          <td><b>${esc(e.code)}</b>${e.replay_of ? ' <span class="pill">phát lại</span>' : ''}</td>
          <td>${tLocal(e.opened_at, true)}</td><td>${esc(e.vessel_name ?? 'Chưa gắn tàu')}</td>
          <td><span class="st st-${e.status}">${STATUS_VN[e.status] ?? e.status}</span></td>
          <td class="r">${num(e.v_contact_cms)}</td><td class="r">${num(e.energy_knm, 0)}</td><td>${END_VN[e.contact_end] ?? '–'}</td>
          <td>${e.max_level_local ? `<span class="led ${e.max_level_local}"></span> ${LED_VN[e.max_level_local] ?? e.max_level_local}` : '–'}</td>
          <td>${e.max_level_forecast ? `<span class="lv lv-${e.max_level_forecast}">${LEVEL_VN[e.max_level_forecast]}</span>` : '–'}</td>
          <td class="r">${e.completeness_pct != null ? num(e.completeness_pct, 1) + ' %' : '–'}</td>
          <td>${e.reviewed ? (e.hard_berthing ? '<span class="lv lv-Critical">Cập mạnh</span>' : '✓') : ''}</td></tr>`).join('')
          : '<tr><td colspan="11" class="muted">Không có lượt cập nào trong khoảng đã chọn.</td></tr>'}</tbody></table></div>`;
    q('#ev-filter').onclick = async () => { st.filter = { source: q('#ev-src').value, from: q('#ev-from').value, to: q('#ev-to').value }; await loadList(); renderList(); };
    q('#ev-src').onchange = q('#ev-filter').onclick;
    q('#ev-table').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openEvent(tr.dataset.id); };
    q('#ev-table').onkeydown = (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-id]'); if (tr) openEvent(tr.dataset.id); } };
  }

  // ------------------------------------------------------------------ chi tiết
  async function openEvent(id) {
    stopPlay();
    st.view = 'detail'; st.msg = '';
    root.innerHTML = '<p class="muted pad">Đang tải lượt cập…</p>';
    const [d, frames] = await Promise.all([api.get(`/v1/events/${id}/detail`), api.get(`/v1/events/${id}/frames`)]);
    st.d = d; st.frames = frames; st.idx = Math.max(0, frames.length - 1); st.pos = st.idx;
    if (can('operator') && !st.vessels) st.vessels = await api.get('/v1/vessels').catch(() => []);
    if (can('engineer') && !st.models) st.models = await api.get('/v1/models').catch(() => []);
    renderDetail();
  }
  const berthCfg = () => (st.d?.berth_config ? { ...st.d.berth_config, timezone: tz() } : null);

  function renderDetail() {
    const { event: e, review: rv } = st.d, cfg = berthCfg(), isFinal = FINAL.includes(e.status);
    const rows = [
      ['Trạng thái', `<span class="st st-${e.status}">${STATUS_VN[e.status] ?? e.status}</span>${e.merged_into_code ? ' vào ' + esc(e.merged_into_code) : ''}`],
      ['Nguồn', SOURCE_VN[e.source] + (e.replay_of_code ? ` của ${esc(e.replay_of_code)}` : '')],
      ['Bắt đầu – kết thúc', `${tLocal(e.opened_at, true)} – ${e.closed_at ? tLocal(e.closed_at) : '…'}`],
      ['Tàu', e.vessel_name ? `${esc(e.vessel_name)}${e.loa_m ? `, LOA ${num(e.loa_m, 0)} m` : ''}` : 'Chưa gắn tàu (dự báo dùng tàu thiết kế)'],
      ['Mũi tàu hướng về', e.bow_toward ?? 'chưa khai báo (vẽ về phía N2)'],
      ['Mô hình', e.model_code ? `${esc(e.model_code)} ${esc(e.model_version)}` : '–'],
      ['Vận tốc chạm (đo)', e.v_contact_cms != null ? `${num(e.v_contact_cms)} cm/s${cfg ? ` (thiết kế ${num(cfg.v_design_cms, 0)})` : ''}` : '–'],
      ['Góc chạm, đầu chạm trước', `${num(e.angle_contact_deg, 2)}°, ${END_VN[e.contact_end] ?? '–'}`],
      ['Năng lượng', e.energy_knm != null ? `${num(e.energy_knm, 0)} kJ (${num(100 * e.energy_knm / (cfg?.fender_rated_energy_kj || 1), 0)} % định mức đệm)` : '–'],
      ['Phản lực, chuyển vị bến ước tính', e.force_est_kn != null ? `${num(e.force_est_kn, 0)} kN, ${num(e.disp_est_mm)} / ${num(cfg?.disp_limit_mm, 0)} mm` : '–'],
      ['Nén đệm lớn nhất (đo)', e.max_compression_m != null ? `${num(e.max_compression_m, 2)} m` : '–'],
      ['LED cao nhất, dự báo cao nhất', `${LED_VN[e.max_level_local] ?? '–'}, ${LEVEL_VN[e.max_level_forecast] ?? '–'}`],
      ['Cảnh báo đầu tiên', e.first_warning_d_m != null ? `tại ${num(e.first_warning_d_m, 0)} m, trước khi chạm ${num(e.first_warning_lead_s, 0)} s` : 'không có'],
      ['Số khung, đủ số liệu', `${e.frames} khung (${e.frames_bad} có cờ QC), ${num(e.completeness_pct, 1)} %`],
    ];
    root.innerHTML = `
      <div class="toolbar">
        <button id="ev-back" class="btn">← Danh sách</button>
        <h2 class="evtitle">${esc(e.code)} <span class="pill">${SOURCE_VN[e.source]}</span></h2>
        <span class="sp"></span>
        <button class="btn" data-dl="csv">Xuất CSV</button><button class="btn" data-dl="json">Xuất JSON</button>
      </div>
      <p id="ev-msg" class="msg" hidden></p>
      <div class="grid2">
        <div class="col">
          <section class="panel">
            <h2>Xem lại <span class="tag">kéo thanh thời gian hoặc bấm phát</span>
              <span class="seg mini" role="radiogroup" aria-label="Kiểu hiển thị"><button data-mode="anim" role="radio" aria-checked="${st.mode === 'anim'}">Hoạt cảnh</button><button data-mode="plan" role="radio" aria-checked="${st.mode === 'plan'}">Sơ đồ đo</button></span></h2>
            <div id="ev-animwrap" class="animwrap" ${st.mode === 'anim' ? '' : 'hidden'}><canvas id="ev-anim-o" class="anim-o" aria-label="Hoạt cảnh toàn cảnh"></canvas><canvas id="ev-anim-z" class="anim-z" aria-label="Hoạt cảnh phóng to quanh điểm chạm"></canvas></div>
            <canvas id="ev-plan" class="plan" ${st.mode === 'plan' ? '' : 'hidden'}></canvas>
            <div class="player">
              <button id="ev-play" class="btn">▶ Phát</button>
              <input id="ev-slider" type="range" min="0" max="${Math.max(0, st.frames.length - 1)}" step="any" value="${st.pos}" aria-label="Thời điểm">
              <select id="ev-speed" aria-label="Tốc độ">${SPEEDS.map((s) => `<option value="${s}" ${s === st.speed ? 'selected' : ''}>${s}×</option>`).join('')}</select>
            </div>
            <div id="ev-ro" class="readouts"></div>
          </section>
          <section class="panel"><h2>Khoảng cách theo thời gian <span class="tag">đo</span></h2><canvas id="ev-c-dist" class="chart"></canvas></section>
          <section class="panel"><h2>Vận tốc theo khoảng cách <span class="tag">đo, ước lượng, giới hạn</span></h2><canvas id="ev-c-vel" class="chart"></canvas></section>
          <section class="panel"><h2>Vận tốc khi chạm <span class="tag">dự báo P10–P90</span></h2><canvas id="ev-c-vc" class="chart"></canvas></section>
          <section class="panel"><h2>Xác suất vượt chuyển vị cho phép <span class="tag">dự báo</span></h2><canvas id="ev-c-p" class="chart"></canvas></section>
        </div>
        <div class="col">
          <section class="panel"><h2>Tóm tắt</h2><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
            ${e.notes ? `<p class="note">${esc(e.notes)}</p>` : ''}</section>
          ${can('operator') && e.status !== 'merged' ? editForm(e) : ''}
          ${isFinal && e.status !== 'merged' && can('pilot') ? reviewForm(rv) : rv ? reviewView(rv) : ''}
          ${can('operator') && e.status !== 'merged' ? actions(e) : ''}
          ${can('engineer') && e.status !== 'merged' ? replayPanel() : ''}
          <section class="panel"><h2>Mốc lượt cập</h2><ul class="list">${st.d.markers.map((m) => `<li>${tLocal(m.ts)} · ${m.from_state} → <b>${m.to_state}</b> <span class="muted">${m.reason}${m.unexpected ? ' (lạ)' : ''}</span></li>`).join('') || '<li class="muted">Không có</li>'}</ul></section>
          <section class="panel"><h2>Cảnh báo của lượt cập</h2><ul class="list">${st.d.alerts.map((a) => `<li><span class="lv lv-${a.level}">${a.layer === 'local' ? 'Tại bến' : 'Dự báo'}</span> ${esc(a.title)} <span class="muted">${tLocal(a.opened_at)}${a.closed_at ? '–' + tLocal(a.closed_at) : ''}</span></li>`).join('') || '<li class="muted">Không có</li>'}</ul></section>
        </div>
      </div>`;
    bindDetail();
    draw(true);
  }

  function editForm(e) {
    const opt = (v, cur, label) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${label}</option>`;
    return `<section class="panel"><h2>Thông tin tàu</h2><form id="ev-edit" class="form">
      <label>Tàu <select name="vessel_id">${opt('', e.vessel_id, '– chọn tàu –')}${(st.vessels ?? []).map((v) => opt(v.id, e.vessel_id, esc(v.name + (v.vessel_type ? ' – ' + v.vessel_type : '')))).join('')}</select></label>
      <label>Mũi tàu hướng về <select name="bow_toward">${opt('', e.bow_toward, '– chưa khai báo –')}${opt('N1', e.bow_toward, 'N1')}${opt('N2', e.bow_toward, 'N2')}</select></label>
      <label>Mạn cập <select name="side">${opt('', e.side, '–')}${opt('port', e.side, 'Mạn trái')}${opt('starboard', e.side, 'Mạn phải')}</select></label>
      <label>Có hàng <select name="laden">${opt('', e.laden, '–')}${opt('true', e.laden, 'Có hàng')}${opt('false', e.laden, 'Không hàng')}</select></label>
      <label>Mớn nước thực tế (m) <input name="draft_actual_m" type="number" step="0.1" min="1" max="25" value="${e.draft_actual_m ?? ''}"></label>
      <label>Số tàu lai <input name="tugs" type="number" min="0" max="8" value="${e.tugs ?? ''}"></label>
      <label>Mã hoa tiêu <input name="pilot_code" maxlength="40" value="${esc(e.pilot_code ?? '')}"></label>
      <div class="row"><button class="btn primary" type="submit">Lưu</button>
      ${can('engineer') ? '<button class="btn" type="button" id="ev-recompute">Tính lại dự báo</button>' : ''}</div>
      <p class="note">Đổi tàu, mớn nước hay hướng mũi không tự tính lại các dự báo đã có. Kỹ sư bấm "Tính lại dự báo" nếu cần.</p></form></section>`;
  }
  function reviewForm(rv) {
    const pilotOnly = !can('operator'), dis = pilotOnly ? 'disabled' : '';
    const tri = (name, label) => `<label>${label} <select name="${name}" ${dis}><option value="">–</option><option value="true" ${rv?.[name] === true ? 'selected' : ''}>Có</option><option value="false" ${rv?.[name] === false ? 'selected' : ''}>Không</option></select></label>`;
    return `<section class="panel"><h2>Đánh giá sau lượt cập ${rv ? `<span class="tag">${esc(rv.reviewer ?? '')}, ${tLocal(rv.reviewed_at, true)}</span>` : ''}</h2><form id="ev-review" class="form">
      ${tri('hard_berthing', 'Cập mạnh')}${tri('fender_damage', 'Hư hỏng đệm')}${tri('false_alarm', 'Cảnh báo nhầm')}${tri('missed_alarm', 'Bỏ sót cảnh báo')}
      <label class="wide">Điểm chạm thực tế <input name="contact_point" maxlength="200" value="${esc(rv?.contact_point ?? '')}" ${dis}></label>
      <label class="wide">Ý kiến hoa tiêu <textarea name="pilot_feedback" rows="2" maxlength="2000">${esc(rv?.pilot_feedback ?? '')}</textarea></label>
      <label class="wide">Ghi chú kỹ sư, điều độ <textarea name="notes" rows="2" maxlength="2000" ${dis}>${esc(rv?.notes ?? '')}</textarea></label>
      <div class="row"><button class="btn primary" type="submit">Lưu đánh giá</button></div></form></section>`;
  }
  function reviewView(rv) {
    const yn = (x) => (x === true ? 'Có' : x === false ? 'Không' : '–');
    return `<section class="panel"><h2>Đánh giá sau lượt cập</h2><dl class="kv"><dt>Cập mạnh</dt><dd>${yn(rv.hard_berthing)}</dd><dt>Hư hỏng đệm</dt><dd>${yn(rv.fender_damage)}</dd>
      <dt>Ý kiến hoa tiêu</dt><dd>${esc(rv.pilot_feedback) || '–'}</dd><dt>Ghi chú</dt><dd>${esc(rv.notes) || '–'}</dd></dl></section>`;
  }
  function actions(e) {
    const others = st.list.filter((x) => x.id !== e.id && x.status !== 'merged' && Math.abs(Date.parse(x.opened_at) - Date.parse(e.opened_at)) < 6 * 3600_000);
    return `<section class="panel"><h2>Thao tác của điều độ</h2><div class="acts">
      ${!FINAL.includes(e.status) ? '<button class="btn" data-confirm="close">Đóng lượt cập</button><button class="btn" data-confirm="abort">Huỷ lượt cập (bỏ dở)</button>' : ''}
      <button class="btn" data-confirm="split">Tách tại thời điểm đang xem</button>
      <label>Gộp lượt này vào <select id="ev-merge-into"><option value="">– chọn –</option>${others.map((x) => `<option value="${x.id}">${esc(x.code)} (${STATUS_VN[x.status]})</option>`).join('')}</select></label>
      <button class="btn" data-confirm="merge">Gộp</button></div>
      <p class="note">Thao tác cần bấm hai lần để xác nhận. Mọi thao tác được ghi nhật ký.</p></section>`;
  }
  function replayPanel() {
    const models = st.models ?? [];
    return `<section class="panel"><h2>Phát lại qua engine <span class="tag">tạo lượt cập nguồn "Phát lại"</span></h2><div class="acts">
      <label>Tốc độ <select id="rp-speed"><option value="0">Nhanh nhất</option><option value="1">1×</option><option value="5">5×</option><option value="20">20×</option></select></label>
      <label>Mô hình <select id="rp-model"><option value="">Mô hình đang áp dụng của bến</option>${models.map((m) => `<option value="${m.id}">${esc(m.version)} (${m.status})</option>`).join('')}</select></label>
      <button class="btn primary" id="rp-go">Phát lại</button></div>
      ${st.d.replays.length ? `<ul class="list">${st.d.replays.map((r) => `<li><b>${esc(r.code)}</b> · ${esc(r.model_version ?? '')} · ${STATUS_VN[r.status] ?? r.status}
        <button class="btn sm" data-compare="${r.id}">So sánh</button> <button class="btn sm" data-open="${r.id}">Mở</button></li>`).join('')}</ul>` : ''}
      <div id="rp-compare"></div></section>`;
  }

  function bindDetail() {
    const e = st.d.event;
    q('#ev-back').onclick = async () => { stopPlay(); st.view = 'list'; await loadList(); renderList(); };
    root.querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => download(b.dataset.dl)));
    const slider = q('#ev-slider');
    slider.oninput = () => { st.pos = Number(slider.value); st.idx = Math.floor(st.pos); draw(false); };
    root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { st.mode = b.dataset.mode; pref.set('replayMode', st.mode);
      root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); q('#ev-animwrap').hidden = st.mode !== 'anim'; q('#ev-plan').hidden = st.mode !== 'plan'; draw(true); }));
    q('#ev-play').onclick = () => (st.playing ? stopPlay() : startPlay());
    q('#ev-speed').onchange = (x) => { st.speed = Number(x.target.value); };
    q('#ev-edit')?.addEventListener('submit', async (x) => {
      x.preventDefault();
      const fd = new FormData(x.target), body = {};
      const v = (k) => fd.get(k);
      if (v('vessel_id')) body.vessel_id = Number(v('vessel_id'));
      if (v('bow_toward')) body.bow_toward = v('bow_toward');
      if (v('side')) body.side = v('side');
      if (v('laden')) body.laden = v('laden') === 'true';
      if (v('draft_actual_m')) body.draft_actual_m = Number(v('draft_actual_m'));
      if (v('tugs') !== '' && v('tugs') !== null) body.tugs = Number(v('tugs'));
      if (v('pilot_code')) body.pilot_code = String(v('pilot_code'));
      try { await api.req('PATCH', `/v1/events/${e.id}`, body); say('Đã lưu thông tin tàu.'); await openEvent(e.id); say('Đã lưu thông tin tàu.'); } catch (er) { say(er.message, true); }
    });
    q('#ev-recompute')?.addEventListener('click', async () => {
      try { await api.post(`/v1/events/${e.id}/recompute`, {}); say('Đã xếp lịch tính lại dự báo. Mở lại lượt cập sau vài giây để xem kết quả.'); } catch (er) { say(er.message, true); }
    });
    q('#ev-review')?.addEventListener('submit', async (x) => {
      x.preventDefault();
      const fd = new FormData(x.target), body = {};
      for (const k of ['hard_berthing', 'fender_damage', 'false_alarm', 'missed_alarm']) { const val = fd.get(k); if (val) body[k] = val === 'true'; }
      for (const k of ['contact_point', 'pilot_feedback', 'notes']) { const val = fd.get(k); if (val !== null && (val !== '' || k === 'pilot_feedback')) body[k] = String(val); }
      if (!can('operator')) for (const k of Object.keys(body)) if (k !== 'pilot_feedback') delete body[k];
      try { await api.post(`/v1/events/${e.id}/review`, body); await openEvent(e.id); say('Đã lưu đánh giá.'); } catch (er) { say(er.message, true); }
    });
    // thao tác cần bấm hai lần
    root.querySelectorAll('[data-confirm]').forEach((b) => (b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.dataset.label = b.textContent; b.textContent = 'Bấm lần nữa để xác nhận'; b.classList.add('warn'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = b.dataset.label; b.classList.remove('warn'); } }, 4000); return; }
      const act = b.dataset.confirm;
      try {
        if (act === 'close' || act === 'abort') await api.post(`/v1/events/${e.id}/close`, { status: act === 'close' ? 'closed' : 'aborted' });
        if (act === 'split') { const r = await api.post(`/v1/events/${e.id}/split`, { at: st.frames[st.idx].ts }); say(`Đã tách phần sau thành ${r.created}.`); }
        if (act === 'merge') { const into = q('#ev-merge-into').value; if (!into) { say('Chọn lượt cập để gộp vào.', true); return; } await api.post(`/v1/events/${e.id}/merge`, { into }); await openEvent(into); say('Đã gộp. Dự báo đang được tính lại.'); return; }
        const m = st.msg; await openEvent(e.id); if (m) say(m);
      } catch (er) { say(er.message, true); }
    }));
    q('#rp-go')?.addEventListener('click', async () => {
      const body = { speed: Number(q('#rp-speed').value) }, mid = q('#rp-model').value;
      if (mid) body.model_version_id = Number(mid);
      try { const r = await api.post(`/v1/events/${e.id}/replay`, body); say(`Đang phát lại thành ${r.code} (${r.frames} khung). Mở lại lượt cập này sau ít phút để so sánh.`); } catch (er) { say(er.message, true); }
    });
    root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openEvent(b.dataset.open)));
    root.querySelectorAll('[data-compare]').forEach((b) => (b.onclick = async () => {
      try {
        const c = await api.get(`/v1/events/${e.id}/compare?with=${b.dataset.compare}`);
        q('#rp-compare').innerHTML = `<table class="tbl sm"><thead><tr><th class="r">Mốc (m)</th><th class="r">V chạm P50 – gốc</th><th class="r">– phát lại</th><th class="r">P(vượt) gốc</th><th class="r">– phát lại</th><th>Mức gốc</th><th>– phát lại</th></tr></thead><tbody>
          ${c.checkpoints.map((x) => `<tr><td class="r">${x.D}</td><td class="r">${num(x.a.vc_p50, 2)}</td><td class="r">${num(x.b.vc_p50, 2)}</td><td class="r">${num(x.a.p_exceed * 100, 0)} %</td><td class="r">${num(x.b.p_exceed * 100, 0)} %</td><td>${LEVEL_VN[x.a.level] ?? '–'}</td><td>${LEVEL_VN[x.b.level] ?? '–'}</td></tr>`).join('')}</tbody></table>
          <p class="note">Gốc: ${esc(c.a.model_version ?? '–')}; phát lại: ${esc(c.b.model_version ?? '–')}. Dự báo cao nhất: ${LEVEL_VN[c.a.max_level_forecast] ?? '–'} → ${LEVEL_VN[c.b.max_level_forecast] ?? '–'}.</p>`;
      } catch (er) { say(er.message, true); }
    }));
    window.addEventListener('resize', onResize);
  }
  const onResize = () => { if (st.view === 'detail' && root.isConnected && !root.closest('[hidden]')) draw(true); };

  async function download(fmt) {
    try {
      const res = await fetch(`${api.base}/v1/events/${st.d.event.id}/export?format=${fmt}`, { headers: { Authorization: 'Bearer ' + api.token } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob(), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${st.d.event.code}${st.d.event.source !== 'live' ? '-' + st.d.event.source : ''}.${fmt}`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (er) { say('Không xuất được hồ sơ: ' + er.message, true); }
  }

  // ------------------------------------------------------------------ phát lại trên trình duyệt
  let lastCharts = 0, lastRo = -1;
  function draw(full) {
    if (!st.d || !q('#ev-plan')) return;
    const e = st.d.event, cfg = berthCfg(), fr = st.frames;
    st.idx = Math.max(0, Math.min(fr.length - 1, Math.floor(st.pos)));
    const f = fr[st.idx];
    if (st.mode === 'anim') drawAnim(q('#ev-anim-o'), q('#ev-anim-z'), { frames: fr, pos: st.pos, event: e, cfg, env: st.d.env });
    else {
      const upto = fr.slice(0, st.idx + 1), fi = frameAt(fr, st.pos); if (fi && upto.length) upto[upto.length - 1] = fi;   // khung nội suy: tàu trượt mượt
      drawPlan(q('#ev-plan'), { spacing: cfg?.brt_spacing_m, fenderDepth: cfg?.fender_depth_m, loa: e.loa_m, beam: e.beam_m ?? (e.loa_m ? e.loa_m / 6.5 : null), frames: upto,
        bowToward: e.bow_toward, contact: e.contact_end ? { end: e.contact_end, angle: e.angle_contact_deg, compression: e.max_compression_m } : null,
        vesselLabel: e.vessel_name ?? 'Chưa gắn tàu' });
    }
    const s = q('#ev-slider'); if (s && document.activeElement !== s) s.value = String(st.pos);
    if (!full && st.idx === lastRo) return;   // số đọc và đồ thị chỉ đổi khi sang khung mới
    lastRo = st.idx;
    const d = nearD(f), va = vAllowAt(cfg, d);
    const ro = (l, v, u, s2 = '', attrs = '') => `<div class="ro" ${attrs}><span class="l">${l}</span><span><span class="v">${v}</span><span class="u">${u}</span></span><span class="s">${s2}</span></div>`;
    q('#ev-ro').innerHTML = f ? ro('Thời điểm', tLocal(f.ts), '', `${st.idx + 1}/${fr.length} · ${f.state}`) + ro('Khoảng cách N1, N2 (đo)', `${num(f.d1)} / ${num(f.d2)}`, 'm')
      + ro('Vận tốc (đo)', num(maxV(f)), 'cm/s', va !== null ? `cho phép ${num(va)} cm/s` : '', `data-led="${f.led ?? ''}"`) + ro('Góc (tính)', num(f.angle, 2), '°')
      + ro('V chạm dự báo P50', f.fc ? num(f.fc.vc[1]) : '–', 'cm/s', f.fc ? `P10–P90 ${num(f.fc.vc[0])}–${num(f.fc.vc[2])}` : 'không dự báo ở khung này')
      + `<div class="ro forecast" data-level="${f.fc?.level ?? ''}"><span class="l">Mức dự báo</span><span><span class="v">${f.fc ? LEVEL_VN[f.fc.level] : '–'}</span></span><span class="s">${f.fc ? `P(vượt) ${num(f.fc.p * 100, 0)} %` : ''}</span></div>`
      : '<p class="muted">Lượt cập không có khung số liệu.</p>';
    const now = performance.now();
    if (full || now - lastCharts > 250) {
      lastCharts = now;
      drawCharts({ dist: q('#ev-c-dist'), vel: q('#ev-c-vel'), vc: q('#ev-c-vc'), p: q('#ev-c-p') }, fr, cfg, f ? Date.parse(f.ts) : null);
    }
  }
  // phát: vị trí tăng liên tục theo thời gian thực × tốc độ, vẽ mỗi khung hình (requestAnimationFrame) nên tàu trượt mượt
  function startPlay() {
    if (st.pos >= st.frames.length - 1) st.pos = 0;
    st.playing = true; q('#ev-play').textContent = '❚❚ Dừng'; lastT = performance.now();
    const step = (t) => {
      if (!st.playing) return;
      st.pos = Math.min(st.frames.length - 1, st.pos + (st.speed * Math.min(250, t - lastT)) / 1000); lastT = t;
      if (root.isConnected && !root.closest('[hidden]')) draw(false);
      if (st.pos >= st.frames.length - 1) { stopPlay(); draw(true); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stopPlay() { cancelAnimationFrame(raf); raf = 0; st.playing = false; const b = q('#ev-play'); if (b) b.textContent = '▶ Phát'; }

  return {
    async show() {
      try { if (st.view === 'list') { await loadList(); renderList(); } else if (st.d) await openEvent(st.d.event.id); }
      catch (er) { root.innerHTML = `<p class="msg bad">${esc(er.message)}</p>`; }
    },
    hide() { stopPlay(); },
    reset() { stopPlay(); st.view = 'list'; st.d = null; },
    open: openEvent,
  };
}

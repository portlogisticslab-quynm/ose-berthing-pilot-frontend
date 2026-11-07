// Tab "Mô hình" (kỹ sư): kho mô hình, chỉ số kiểm định theo mốc khoảng cách, phê duyệt, áp dụng cho bến;
// M8: huấn luyện trên lượt cập đã ghi (thật, hoặc giả lập để thử quy trình), xuất bộ số liệu, nhập / xuất mô hình.
import { num } from './plan.js';
import { esc } from './views.js';

const ST_VN = { draft: 'Nháp', validated: 'Đã kiểm định', approved: 'Đã phê duyệt', active: 'Đang dùng', retired: 'Ngừng dùng' };
const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : num(x * 100, d) + ' %');

export function modelsTab({ api, store, root }) {
  let list = [], sel = null, msg = '', bad = false;
  const tr = { source: 'live', from: '', to: '', data: null, picked: new Set(), testPct: 30, seed: 99, synth: '', synthSeed: 20261101, notes: '', result: null, busy: false };
  const say = (m, b = false) => { msg = m; bad = b; const el = root.querySelector('#md-msg'); if (el) { el.textContent = m; el.className = 'msg ' + (b ? 'bad' : 'ok'); el.hidden = !m; } };
  async function load() { list = await api.get('/v1/models'); if (sel) sel = await api.get(`/v1/models/${sel.id}`).catch(() => null); }
  const tLocal = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }) : '–');

  async function download(path, body, fallback) {
    const res = await fetch(`${api.base}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + api.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { let m = `Lỗi ${res.status}`; try { m = (await res.json()).error?.message ?? m; } catch { /* */ } throw new Error(m); }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------------------------------------------------------------- huấn luyện trên lượt cập đã ghi
  function trainPanel() {
    const d = tr.data, evs = d?.events ?? [], okN = evs.filter((e) => e.check.ok).length, n = tr.picked.size;
    const autoSynth = n < 30 ? 150 : 0;
    return `<section class="panel pad-s" id="md-trainp"><h2>Huấn luyện trên số liệu đã ghi <span class="tag">bến ${esc(store.berth)}</span></h2>
      <div class="toolbar wrap">
        <label>Nguồn <select id="tr-src"><option value="live" ${tr.source === 'live' ? 'selected' : ''}>Lượt cập thật</option>
          <option value="sim" ${tr.source === 'sim' ? 'selected' : ''}>Lượt giả lập đã ghi (thử quy trình)</option></select></label>
        <label>Từ ngày <input id="tr-from" type="date" value="${tr.from}"></label><label>Đến ngày <input id="tr-to" type="date" value="${tr.to}"></label>
        <button class="btn" id="tr-load">Tải danh sách lượt cập</button></div>
      ${tr.source === 'sim' ? '<p class="note">Lượt giả lập đã ghi đi qua đúng đường gateway → engine như lượt thật, nên dùng được để thử quy trình huấn luyện; mô hình tạo ra ghi rõ nguồn và <b>không dùng cho bến thật</b>.</p>' : ''}
      ${d ? `<p class="muted">${evs.length} lượt cập đã đóng · <b>${okN}</b> dùng được · đã chọn <b>${n}</b>.
          Mỗi mốc khoảng cách cần ít nhất ${d.min_per_checkpoint} lượt trong tập huấn luyện.</p>
        <div class="tblwrap tr-list"><table class="tbl sm"><thead><tr><th><input type="checkbox" id="tr-all" aria-label="Chọn tất cả lượt dùng được" ${n && n === okN ? 'checked' : ''}></th>
          <th>Lượt cập</th><th>Chạm lúc</th><th>Tàu</th><th class="r">V chạm (cm/s)</th><th class="r">Góc (°)</th><th class="r">Môi trường</th><th class="r">Đủ khung</th><th>Đánh giá</th><th>Ghi chú</th></tr></thead>
          <tbody>${evs.map((e) => `<tr class="${e.check.ok ? '' : 'off'}"><td><input type="checkbox" data-pick="${e.id}" aria-label="Chọn ${esc(e.code)}" ${e.check.ok ? '' : 'disabled'} ${tr.picked.has(e.id) ? 'checked' : ''}></td>
            <td><b>${esc(e.code)}</b></td><td>${tLocal(e.contact_at)}</td><td>${esc(e.vessel ?? '–')}</td><td class="r">${num(e.v_contact_cms, 1)}</td><td class="r">${num(e.angle_contact_deg, 1)}</td>
            <td class="r">${e.env_rows || '<span class="warn-t">0</span>'}</td><td class="r">${e.completeness_pct == null ? '–' : num(e.completeness_pct, 0) + ' %'}</td><td>${e.reviewed ? 'có' : '–'}</td>
            <td class="small">${e.check.reasons.map((r) => `<span class="bad-t">${esc(r)}</span>`).join('; ')}${e.check.reasons.length && e.check.warnings.length ? '; ' : ''}${e.check.warnings.map(esc).join('; ')}</td></tr>`).join('')
            || '<tr><td colspan="10" class="muted">Chưa có lượt cập đã đóng nào ở bến này với nguồn đã chọn.</td></tr>'}</tbody></table></div>
        <div class="toolbar wrap">
          <label>Tỉ lệ kiểm định (%) <input id="tr-test" type="number" min="10" max="50" value="${tr.testPct}"></label>
          <label>Seed chia tập <input id="tr-seed" type="number" value="${tr.seed}"></label>
          <label>Trộn lượt mô phỏng <input id="tr-synth" type="number" min="0" max="1000" placeholder="${autoSynth}" value="${tr.synth}"></label>
          <label>Seed mô phỏng <input id="tr-sseed" type="number" value="${tr.synthSeed}"></label>
          <label class="grow">Ghi chú <input id="tr-notes" maxlength="300" value="${esc(tr.notes)}" placeholder="ví dụ đợt thử tháng 12, sau khi thay đệm"></label></div>
        <p class="note">Lượt mô phỏng (sinh theo cấu hình bến) chỉ vào tập huấn luyện để đủ ${d.min_per_checkpoint} lượt mỗi mốc khi lượt đã ghi còn ít; để trống thì dùng ${autoSynth || 'không trộn'}${autoSynth ? ' lượt' : ''} (gợi ý: trộn khi dưới 30 lượt). Kiểm định chỉ trên lượt đã chọn, so với mô hình đang dùng ở bến; chấm ở các mốc 30–100 m.
          Huấn luyện mất vài giây đến vài chục giây và không chạy khi có lượt cập thật đang mở.</p>
        <div class="row"><button class="btn" id="tr-json" ${n ? '' : 'disabled'}>Xuất bộ số liệu (JSON)</button><button class="btn" id="tr-csv" ${n ? '' : 'disabled'}>Xuất tóm tắt (CSV)</button>
          <button class="btn primary" id="tr-run" ${n >= 5 && !tr.busy ? '' : 'disabled'}>${tr.busy ? 'Đang huấn luyện…' : `Huấn luyện từ ${n} lượt`}</button></div>
        ${tr.result ? resultBox(tr.result) : ''}` : '<p class="muted">Bấm “Tải danh sách lượt cập” để xem các lượt cập đã đóng và điều kiện dùng để huấn luyện.</p>'}
    </section>`;
  }
  function resultBox(r) {
    const s = r.summary, cm = (o) => (o?.maeVelocity == null ? '–' : num(o.maeVelocity * 100, 2) + ' cm/s');
    return `<div class="panel ${s.pass ? 'okbox' : 'warnbox'}"><h3>${s.pass ? 'Đạt tiêu chí – mô hình ở trạng thái Đã kiểm định' : 'Chưa đạt tiêu chí – mô hình ở trạng thái Nháp'}: ${esc(r.version)}</h3>
      <p>${r.train} lượt huấn luyện, ${r.test} lượt kiểm định${r.skipped?.length ? `, bỏ ${r.skipped.length} lượt (${r.skipped.slice(0, 3).map((x) => esc(x.code + ': ' + x.reasons[0])).join('; ')})` : ''}.</p>
      <table class="tbl sm"><thead><tr><th>Mốc ${s.band[0]}–${s.band[1]} m (2 BRT)</th><th class="r">Số lượt × mốc</th><th class="r">Sai số V chạm</th><th class="r">Độ phủ P10–P90</th><th class="r">Sai số góc</th></tr></thead><tbody>
        <tr><td>Mô hình mới</td><td class="r">${s.new.n}</td><td class="r">${cm(s.new)}</td><td class="r">${pct(s.new.coverage80)}</td><td class="r">${s.new.maeAngle == null ? '–' : num(s.new.maeAngle, 2) + '°'}</td></tr>
        ${s.current ? `<tr><td>Mô hình đang dùng</td><td class="r">${s.current.n}</td><td class="r">${cm(s.current)}</td><td class="r">${pct(s.current.coverage80)}</td><td class="r">${s.current.maeAngle == null ? '–' : num(s.current.maeAngle, 2) + '°'}</td></tr>` : '<tr><td colspan="5" class="muted">Bến chưa có mô hình đang dùng để so sánh.</td></tr>'}
      </tbody></table>
      ${s.checks.length ? `<ul>${s.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <p class="note">Tiếp theo: xem chỉ số từng mốc bên dưới, dùng <b>Phát lại qua engine</b> và <b>So sánh dự báo</b> (tab Lượt cập) trên vài lượt điển hình, rồi người có quyền phê duyệt <b>Phê duyệt</b> và <b>Áp dụng</b>.</p></div>`;
  }
  function bindTrain() {
    const q = (s) => root.querySelector(s);
    q('#tr-src').onchange = (e) => { tr.source = e.target.value; tr.data = null; tr.picked.clear(); tr.result = null; render(); };
    q('#tr-from').onchange = (e) => { tr.from = e.target.value; };
    q('#tr-to').onchange = (e) => { tr.to = e.target.value; };
    q('#tr-load').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const p = new URLSearchParams({ berth: store.berth, source: tr.source });
        if (tr.from) p.set('from', tr.from + 'T00:00:00+07:00');
        if (tr.to) p.set('to', tr.to + 'T23:59:59+07:00');
        tr.data = await api.get('/v1/training/candidates?' + p);
        tr.picked = new Set(tr.data.events.filter((x) => x.check.ok).map((x) => x.id)); tr.result = null; say(''); render();
      } catch (er) { say(er.message, true); e.target.disabled = false; }
    };
    if (!tr.data) return;
    const keep = () => { tr.testPct = Number(q('#tr-test').value); tr.seed = Number(q('#tr-seed').value); tr.synth = q('#tr-synth').value; tr.synthSeed = Number(q('#tr-sseed').value); tr.notes = q('#tr-notes').value; };
    ['#tr-test', '#tr-seed', '#tr-synth', '#tr-sseed', '#tr-notes'].forEach((s) => { q(s).onchange = keep; });
    q('#tr-all').onchange = (e) => { tr.picked = new Set(e.target.checked ? tr.data.events.filter((x) => x.check.ok).map((x) => x.id) : []); keep(); render(); };
    root.querySelectorAll('[data-pick]').forEach((b) => { b.onchange = () => { if (b.checked) tr.picked.add(b.dataset.pick); else tr.picked.delete(b.dataset.pick); keep(); render(); }; });
    const body = () => ({ berth: store.berth, source: tr.source, event_ids: [...tr.picked] });
    q('#tr-json').onclick = async () => { try { await download('/v1/training/dataset', { ...body(), format: 'json' }, 'training.json'); } catch (er) { say(er.message, true); } };
    q('#tr-csv').onclick = async () => { try { await download('/v1/training/dataset', { ...body(), format: 'csv' }, 'training.csv'); } catch (er) { say(er.message, true); } };
    q('#tr-run').onclick = async () => {
      keep(); tr.busy = true; tr.result = null; render(); say('Đang huấn luyện và kiểm định…');
      try {
        const synth = tr.synth === '' ? (tr.picked.size < 30 ? 150 : 0) : Number(tr.synth);
        const r = await api.post('/v1/models/train', { ...body(), test_share: tr.testPct / 100, seed: tr.seed, synth_count: synth, synth_seed: tr.synthSeed, ...(tr.notes ? { notes: tr.notes } : {}) });
        tr.result = r; sel = await api.get(`/v1/models/${r.id}`); await load(); say(`Đã tạo mô hình ${r.version}.`);
      } catch (er) { say(er.message, true); }
      finally { tr.busy = false; render(); }
    };
  }

  // ---------------------------------------------------------------- kho mô hình
  function trainSetText(m) {
    const t = m.train_set ?? {};
    if (t.synthetic) return `mô phỏng, seed ${t.seed}, ${t.train}/${t.test} lượt`;
    if (t.source) return `${t.source === 'live' ? 'lượt thật' : 'lượt giả lập đã ghi'} ${esc(t.berth ?? '')}, ${t.train}/${t.test} lượt${t.synth ? ` + ${t.synth.count} mô phỏng` : ''}`;
    if (t.imported) return 'nhập từ tệp';
    return esc(JSON.stringify(t)).slice(0, 80);
  }
  function render() {
    const canApprove = store.user?.can_approve;
    root.innerHTML = `
      <div class="toolbar"><h2 class="evtitle">Kho mô hình dự báo</h2><span class="sp"></span>
        <label class="btn" for="md-import">Nhập mô hình (JSON)</label><input id="md-import" type="file" accept="application/json,.json" hidden></div>
      <p id="md-msg" class="msg ${bad ? 'bad' : 'ok'}" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      ${trainPanel()}
      <div class="tblwrap"><table class="tbl" id="md-table"><thead><tr><th>#</th><th>Phiên bản</th><th>Trạng thái</th><th>Tập huấn luyện</th><th>Đang dùng tại</th><th>Ngày tạo</th><th></th></tr></thead>
        <tbody>${list.map((m) => `<tr data-id="${m.id}" class="${sel?.id === m.id ? 'sel' : ''}"><td>${m.id}</td><td><b>${esc(m.code)}</b> ${esc(m.version)}</td><td>${ST_VN[m.status] ?? m.status}</td>
          <td>${trainSetText(m)}</td>
          <td>${(m.active_on ?? []).join(', ') || '–'}</td><td>${new Date(m.created_at).toLocaleDateString('vi-VN')}</td>
          <td class="acts"><button class="btn sm" data-export="${m.id}" title="Tải tham số mô hình (JSON)">Xuất</button>
            ${canApprove && ['draft', 'validated'].includes(m.status) ? `<button class="btn sm" data-approve="${m.id}">Phê duyệt</button>` : ''}
            ${canApprove && ['approved', 'active'].includes(m.status) && !(m.active_on ?? []).includes(store.berth) ? `<button class="btn sm" data-activate="${m.id}">Áp dụng cho ${esc(store.berth)}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${sel ? metrics(sel) : '<p class="muted pad">Chọn một mô hình để xem chỉ số kiểm định.</p>'}
      <details class="pad"><summary>Mô hình cơ sở huấn luyện trên số liệu mô phỏng</summary>
        <div class="toolbar wrap"><label>Số lượt mô phỏng <input id="md-count" type="number" min="30" max="1000" value="150"></label>
          <label>Seed <input id="md-seed" type="number" value="20261101"></label>
          <button class="btn" id="md-train">Huấn luyện mô hình cơ sở</button></div>
        <p class="note">Chỉ dùng số liệu mô phỏng của lõi 3.6 (tàu mẫu, cấu hình mặc định): để có mô hình xuất phát và kiểm thử quy trình. Mô hình cho bến thật huấn luyện ở khung phía trên.</p></details>
      <p class="note pad">Áp dụng mô hình cho bến cần quyền phê duyệt và không thực hiện được khi bến đang có lượt cập mở. Mô hình nhập từ tệp vào trạng thái Nháp.</p>`;
    bindTrain();
    root.querySelector('#md-table').onclick = async (e) => {
      const b = e.target.closest('button');
      try {
        if (b?.dataset.export) { await download(`/v1/models/${b.dataset.export}/export`, null, 'model.json'); return; }
        if (b?.dataset.approve) { await api.post(`/v1/models/${b.dataset.approve}/approve`, {}); say('Đã phê duyệt.'); }
        else if (b?.dataset.activate) { await api.post(`/v1/berths/${encodeURIComponent(store.berth)}/models/${b.dataset.activate}/activate`, {}); say(`Đã áp dụng cho bến ${store.berth}.`); }
        else { const tr2 = e.target.closest('tr[data-id]'); if (!tr2) return; sel = await api.get(`/v1/models/${tr2.dataset.id}`); }
        await load(); render();
      } catch (er) { say(er.message, true); }
    };
    root.querySelector('#md-import').onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        const version = prompt('Tên phiên bản cho mô hình nhập', (j.version ?? f.name.replace(/\.json$/, '')) + (j.version ? '-imp' : ''));
        if (!version) return;
        const body = { version, params: j.params ?? j, notes: j.notes ? `Nhập từ tệp ${f.name}: ${j.notes}` : `Nhập từ tệp ${f.name}`, ...(j.train_set ? { train_set: j.train_set } : {}), ...(j.metrics ? { metrics: j.metrics } : {}) };
        const r = await api.post('/v1/models/import', body);
        sel = await api.get(`/v1/models/${r.id}`); await load(); render(); say(`Đã nhập mô hình ${r.version} (Nháp).`);
      } catch (er) { say(er instanceof SyntaxError ? 'Tệp không phải JSON hợp lệ' : er.message, true); }
      finally { e.target.value = ''; }
    };
    root.querySelector('#md-train').onclick = async (e) => {
      e.target.disabled = true; say('Đang huấn luyện…');
      try {
        const r = await api.post('/v1/models/baseline', { count: Number(root.querySelector('#md-count').value), seed: Number(root.querySelector('#md-seed').value) });
        sel = await api.get(`/v1/models/${r.id}`); await load(); render(); say(`Đã tạo mô hình ${r.version} (đã kiểm định, chờ phê duyệt).`);
      } catch (er) { say(er.message, true); } finally { e.target.disabled = false; }
    };
  }
  function metrics(m) {
    const rows = (k) => (m.metrics?.[k] ?? []).map((r) => `<tr><td class="r">${r.D}</td><td class="r">${r.n}</td><td class="r">${num(r.maeVelocity * 100, 2)}</td><td class="r">${pct(r.coverage80)}</td>
      <td class="r">${num(r.maeAngle, 2)}</td><td class="r">${pct(r.detection)}</td><td class="r">${pct(r.falseAlarm)}</td></tr>`).join('');
    const head = '<thead><tr><th class="r">Mốc (m)</th><th class="r">Số lượt</th><th class="r">Sai số V chạm (cm/s)</th><th class="r">Độ phủ P10–P90</th><th class="r">Sai số góc (°)</th><th class="r">Phát hiện</th><th class="r">Báo nhầm</th></tr></thead>';
    const cmp = m.metrics?.compare;
    const cmpRows = cmp ? (m.metrics.twoSensors ?? []).map((r) => { const c = (cmp.twoSensors ?? []).find((x) => x.D === r.D) ?? {};
      return `<tr><td class="r">${r.D}</td><td class="r">${r.n}</td><td class="r">${num(r.maeVelocity * 100, 2)} / ${num(c.maeVelocity * 100, 2)}</td><td class="r">${pct(r.coverage80)} / ${pct(c.coverage80)}</td><td class="r">${pct(r.detection)} / ${pct(c.detection)}</td></tr>`; }).join('') : '';
    const t = m.train_set ?? {};
    return `${t.events_test ? `<p class="note pad">Lượt kiểm định: ${t.events_test.map(esc).join(', ')}${t.synth ? ` · trộn ${t.synth.count} lượt mô phỏng (seed ${t.synth.seed}) vào tập huấn luyện` : ''} · chia ${Math.round((t.split?.testShare ?? 0) * 100)} %, seed ${t.split?.seed}.</p>` : ''}
      <div class="grid2 pad"><section class="panel"><h2>Kiểm định – 2 BRT <span class="tag">${esc(m.version)}</span></h2><table class="tbl sm">${head}<tbody>${rows('twoSensors')}</tbody></table></section>
      <section class="panel"><h2>Kiểm định – 1 BRT</h2><table class="tbl sm">${head}<tbody>${rows('oneSensor')}</tbody></table></section></div>
      ${cmp ? `<section class="panel pad-s"><h2>So với mô hình đang dùng lúc huấn luyện <span class="tag">${esc(cmp.version)}</span></h2>
        <p class="muted">Cùng tập kiểm định, 2 BRT; mỗi ô: mô hình này / mô hình đang dùng.</p>
        <table class="tbl sm"><thead><tr><th class="r">Mốc (m)</th><th class="r">Số lượt</th><th class="r">Sai số V chạm (cm/s)</th><th class="r">Độ phủ P10–P90</th><th class="r">Phát hiện</th></tr></thead><tbody>${cmpRows}</tbody></table></section>` : ''}
      ${m.metrics?.summary?.checks?.length ? `<p class="note pad">Chưa đạt: ${m.metrics.summary.checks.map(esc).join('; ')}.</p>` : ''}
      <p class="note pad">${esc(m.notes ?? '')}</p>`;
  }
  return { async show() { try { await load(); render(); } catch (er) { root.innerHTML = `<p class="msg bad">${esc(er.message)}</p>`; } }, hide() {}, reset() { sel = null; } };
}

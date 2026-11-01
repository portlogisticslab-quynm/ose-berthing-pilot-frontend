// Tab "Mô hình" (kỹ sư): danh sách phiên bản, chỉ số kiểm định theo mốc khoảng cách, huấn luyện mô hình cơ sở, phê duyệt, áp dụng cho bến.
import { num } from './plan.js';
import { esc } from './views.js';

const ST_VN = { draft: 'Nháp', validated: 'Đã kiểm định', approved: 'Đã phê duyệt', active: 'Đang dùng', retired: 'Ngừng dùng' };

export function modelsTab({ api, store, root }) {
  let list = [], sel = null, msg = '';
  const say = (m, bad = false) => { msg = m; const el = root.querySelector('#md-msg'); if (el) { el.textContent = m; el.className = 'msg ' + (bad ? 'bad' : 'ok'); el.hidden = !m; } };
  async function load() { list = await api.get('/v1/models'); if (sel) sel = await api.get(`/v1/models/${sel.id}`).catch(() => null); }
  function render() {
    const canApprove = store.user?.can_approve;
    root.innerHTML = `
      <div class="toolbar"><h2 class="evtitle">Kho mô hình dự báo</h2><span class="sp"></span>
        <label>Số lượt mô phỏng <input id="md-count" type="number" min="30" max="1000" value="150"></label>
        <label>Seed <input id="md-seed" type="number" value="20261101"></label>
        <button class="btn" id="md-train">Huấn luyện mô hình cơ sở</button></div>
      <p id="md-msg" class="msg" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      <div class="tblwrap"><table class="tbl" id="md-table"><thead><tr><th>#</th><th>Phiên bản</th><th>Trạng thái</th><th>Tập huấn luyện</th><th>Đang dùng tại</th><th>Ngày tạo</th><th></th></tr></thead>
        <tbody>${list.map((m) => `<tr data-id="${m.id}" class="${sel?.id === m.id ? 'sel' : ''}"><td>${m.id}</td><td><b>${esc(m.code)}</b> ${esc(m.version)}</td><td>${ST_VN[m.status] ?? m.status}</td>
          <td>${m.train_set?.synthetic ? `mô phỏng, seed ${m.train_set.seed}, ${m.train_set.train}/${m.train_set.test} lượt` : esc(JSON.stringify(m.train_set ?? {}))}</td>
          <td>${(m.active_on ?? []).join(', ') || '–'}</td><td>${new Date(m.created_at).toLocaleDateString('vi-VN')}</td>
          <td class="acts">${canApprove && ['draft', 'validated'].includes(m.status) ? `<button class="btn sm" data-approve="${m.id}">Phê duyệt</button>` : ''}
            ${canApprove && ['approved', 'active'].includes(m.status) && !(m.active_on ?? []).includes(store.berth) ? `<button class="btn sm" data-activate="${m.id}">Áp dụng cho ${esc(store.berth)}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${sel ? metrics(sel) : '<p class="muted pad">Chọn một mô hình để xem chỉ số kiểm định.</p>'}
      <p class="note pad">Mô hình huấn luyện trên số liệu mô phỏng chỉ dùng để chạy thử. Từ GĐ2, mô hình được huấn luyện trên lượt cập thật đã đánh giá sau cập.
        Áp dụng mô hình cho bến cần quyền phê duyệt và không thực hiện được khi bến đang có lượt cập mở.</p>`;
    root.querySelector('#md-table').onclick = async (e) => {
      const b = e.target.closest('button');
      try {
        if (b?.dataset.approve) { await api.post(`/v1/models/${b.dataset.approve}/approve`, {}); say('Đã phê duyệt.'); }
        else if (b?.dataset.activate) { await api.post(`/v1/berths/${encodeURIComponent(store.berth)}/models/${b.dataset.activate}/activate`, {}); say(`Đã áp dụng cho bến ${store.berth}.`); }
        else { const tr = e.target.closest('tr[data-id]'); if (!tr) return; sel = await api.get(`/v1/models/${tr.dataset.id}`); }
        await load(); render();
      } catch (er) { say(er.message, true); }
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
    const rows = (k) => (m.metrics?.[k] ?? []).map((r) => `<tr><td class="r">${r.D}</td><td class="r">${r.n}</td><td class="r">${num(r.maeVelocity * 100, 2)}</td><td class="r">${num(r.coverage80 * 100, 0)} %</td>
      <td class="r">${num(r.maeAngle, 2)}</td><td class="r">${r.detection == null || Number.isNaN(r.detection) ? '–' : num(r.detection * 100, 0) + ' %'}</td>
      <td class="r">${r.falseAlarm == null || Number.isNaN(r.falseAlarm) ? '–' : num(r.falseAlarm * 100, 0) + ' %'}</td></tr>`).join('');
    const head = '<thead><tr><th class="r">Mốc (m)</th><th class="r">Số lượt</th><th class="r">Sai số V chạm (cm/s)</th><th class="r">Độ phủ P10–P90</th><th class="r">Sai số góc (°)</th><th class="r">Phát hiện</th><th class="r">Báo nhầm</th></tr></thead>';
    return `<div class="grid2 pad"><section class="panel"><h2>Kiểm định – 2 BRT <span class="tag">${esc(m.version)}</span></h2><table class="tbl sm">${head}<tbody>${rows('twoSensors')}</tbody></table></section>
      <section class="panel"><h2>Kiểm định – 1 BRT</h2><table class="tbl sm">${head}<tbody>${rows('oneSensor')}</tbody></table></section></div>
      <p class="note pad">${esc(m.notes ?? '')}</p>`;
  }
  return { async show() { try { await load(); render(); } catch (er) { root.innerHTML = `<p class="msg bad">${esc(er.message)}</p>`; } }, hide() {}, reset() { sel = null; } };
}

// Tab "Cấu hình bến" (kỹ sư): sửa biên dạng vận tốc cho phép v = v_d + 100·β·d^γ, ngưỡng vàng, số khung đỏ;
// xem trước đường cong so với bản đang áp dụng, bảng giá trị theo khoảng cách, thử trên số đo của một lượt cập đã có;
// lưu bản nháp (sao chép mọi thông số khác từ bản đang áp dụng) → phê duyệt → áp dụng. Gateway nhận trong ≤ 5 phút.
import { num } from './plan.js';
import { esc } from './views.js';

const ST_VN = { draft: 'Nháp', approved: 'Đã phê duyệt', active: 'Đang áp dụng', retired: 'Đã thay' };
const DISTS = [0, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 500];
const FIELDS = [
  ['v_design_cms', 'v_d – vận tốc cập thiết kế', 'cm/s', 0.5, 'Giới hạn tại mặt đệm (d = 0)'],
  ['envelope_beta', 'β', '1/s', 0.001, 'Độ mở biên dạng theo khoảng cách'],
  ['envelope_gamma', 'γ', '', 0.05, '1 = tuyến tính; < 1 chặt ở xa, mở ở gần; > 1 ngược lại'],
  ['yellow_pct', 'Ngưỡng vàng', '% v cho phép', 1, 'LED vàng khi vận tốc ≥ ngưỡng này'],
  ['envelope_red_frames', 'Số khung đỏ', 'khung liên tiếp', 1, 'LED đỏ khi vượt v cho phép liên tiếp ngần ấy giây'],
];

export function berthCfgTab({ api, store, root }) {
  let list = null, form = null, msg = '', bad = false, events = [], evSel = '', frames = null, busy = false, timer = null;
  const say = (m, b = false) => { msg = m; bad = b; render(); };
  const active = () => list?.find((x) => x.status === 'active') ?? null;
  const tl = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour12: false }) : '–');
  const canApprove = () => !!store.user?.can_approve;
  const fromCfg = (c) => ({ v_design_cms: c.v_design_cms, envelope_beta: c.envelope_beta, envelope_gamma: c.envelope_gamma, yellow_pct: Math.round(c.envelope_yellow_ratio * 100), envelope_red_frames: c.envelope_red_frames, notes: '', loadedFrom: c.version });
  const vA = (c, d) => c.v_design_cms + 100 * c.envelope_beta * Math.max(0, d) ** c.envelope_gamma;
  const asCfg = (f) => ({ v_design_cms: +f.v_design_cms, envelope_beta: +f.envelope_beta, envelope_gamma: +f.envelope_gamma, envelope_yellow_ratio: +f.yellow_pct / 100, envelope_red_frames: Math.round(+f.envelope_red_frames) });
  const dOpen = () => active()?.d_open_m ?? 400;

  async function load() {
    list = await api.get(`/v1/berths/${encodeURIComponent(store.berth)}/configs`);
    if (!form && active()) form = fromCfg(active());
    if (!events.length) {
      const [lv, sm] = await Promise.all([
        api.get(`/v1/events?berth=${encodeURIComponent(store.berth)}&source=live&limit=10`).catch(() => []),
        api.get(`/v1/events?berth=${encodeURIComponent(store.berth)}&source=sim&limit=10`).catch(() => [])]);
      // ưu tiên lượt đã chạm bến (có vận tốc chạm), lượt thật trước lượt giả lập, mới trước cũ
      events = [...lv, ...sm].filter((e) => ['closed', 'aborted'].includes(e.status) && (e.frames ?? 1) > 30)
        .sort((a, b) => (b.v_contact_cms != null) - (a.v_contact_cms != null) || (a.source === 'live' ? 0 : 1) - (b.source === 'live' ? 0 : 1) || Date.parse(b.opened_at) - Date.parse(a.opened_at)).slice(0, 12);
      if (!evSel && events[0]) { evSel = events[0].id; await loadFrames(); }
    }
  }
  async function loadFrames() {
    frames = null; if (!evSel) return;
    const fr = await api.get(`/v1/events/${evSel}/frames?limit=20000`);
    // theo hợp đồng: vận tốc lớn hơn trong hai BRT, tại khoảng cách nhỏ hơn
    frames = fr.map((f) => { const ds = [f.d1, f.d2].filter((x) => x !== null && x !== undefined), vs = [f.v1, f.v2].filter((x) => x !== null && x !== undefined);
      return ds.length && vs.length ? { d: Math.min(...ds), v: Math.max(...vs) } : null; });
  }
  /** Phân loại từng khung theo biên dạng (gồm luật số khung đỏ liên tiếp); trả số khung vàng/đỏ và khoảng cách đỏ đầu tiên. */
  function classify(c) {
    if (!frames) return null;
    let run = 0, y = 0, r = 0, firstRed = null; const lv = [];
    for (const f of frames) {
      if (!f) { run = 0; lv.push(null); continue; }
      const va = vA(c, f.d); let L;
      if (f.v > va) { run++; L = run >= c.envelope_red_frames ? 'red' : 'yellow'; } else { run = 0; L = f.v >= c.envelope_yellow_ratio * va ? 'yellow' : 'green'; }
      if (L === 'yellow') y++; if (L === 'red') { r++; if (firstRed === null) firstRed = f.d; }
      lv.push(L);
    }
    return { y, r, firstRed, lv, n: frames.filter(Boolean).length };
  }
  function chart(cur, nw, cls) {
    const W = 760, H = 300, L = 48, R = 12, T = 12, B = 34, dmax = Math.min(dOpen(), 500);
    const vMeas = frames ? Math.max(0, ...frames.filter(Boolean).map((f) => f.v)) : 0;
    const vmax = Math.max(40, Math.ceil((Math.max(vMeas * 1.3, vA(nw, 30), cur ? vA(cur, 30) : 0)) / 10) * 10);
    const X = (d) => L + ((dmax - d) / dmax) * (W - L - R), Y = (v) => T + (1 - Math.min(v, vmax * 1.05) / vmax) * (H - T - B);
    const path = (f) => { let p = ''; for (let i = 0; i <= 200; i++) { const d = (dmax * i) / 200; p += `${i ? 'L' : 'M'}${X(d).toFixed(1)},${Y(f(d)).toFixed(1)}`; } return p; };
    const yT = []; for (let v = 0; v <= vmax; v += vmax > 100 ? 25 : 10) yT.push(v);
    const xT = [0, 50, 100, 200, 300, 400, 500].filter((d) => d <= dmax);
    const pts = frames && cls ? frames.map((f, i) => (f && f.d <= dmax ? `<circle cx="${X(f.d).toFixed(1)}" cy="${Y(f.v).toFixed(1)}" r="1.6" class="pt ${cls.lv[i]}"/>` : '')).join('') : '';
    const clip = (c) => (c && vA(c, dmax) > vmax ? `<text x="${L + 4}" y="${T + 10}" class="clip">↑ ${num(vA(c, dmax), 0)} cm/s tại ${dmax} m (ngoài khung)</text>` : '');
    return `<svg viewBox="0 0 ${W} ${H}" class="bcchart" role="img" aria-label="Biên dạng vận tốc cho phép theo khoảng cách">
      ${yT.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 6}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('')}
      ${xT.map((d) => `<text x="${X(d)}" y="${H - 14}" class="ax" text-anchor="middle">${d}</text>`).join('')}
      <text x="${(W + L) / 2}" y="${H - 1}" class="ax" text-anchor="middle">khoảng cách tới mặt đệm (m)</text>
      <text x="12" y="${T + (H - T - B) / 2}" class="ax" transform="rotate(-90 12 ${T + (H - T - B) / 2})" text-anchor="middle">cm/s</text>
      ${pts}
      ${cur ? `<path d="${path((d) => vA(cur, d))}" class="cur"/>` : ''}
      <path d="${path((d) => nw.envelope_yellow_ratio * vA(nw, d))}" class="yel"/>
      <path d="${path((d) => vA(nw, d))}" class="new"/>
      ${clip(nw)}</svg>
      <div class="legend"><span class="lg new">Cho phép (mới)</span><span class="lg yel">Ngưỡng vàng (mới)</span>${cur ? `<span class="lg cur">Cho phép (bản v${cur.version} đang áp dụng)</span>` : ''}${frames ? '<span class="lg pts">Số đo lượt cập đã chọn, tô màu theo biên dạng mới</span>' : ''}</div>`;
  }
  const isChanged = (cur, nw) => !!cur && ['v_design_cms', 'envelope_beta', 'envelope_gamma', 'envelope_yellow_ratio', 'envelope_red_frames'].some((k) => Math.abs(nw[k] - cur[k]) > 1e-9);
  const validNw = (nw) => Object.values(nw).every((x) => Number.isFinite(x));
  function formulaHtml(nw) { return `v<sub>cho phép</sub>(d) = <b>${num(nw.v_design_cms, 1)}</b> + 100 · <b>${num(nw.envelope_beta, 4)}</b> · d<sup><b>${num(nw.envelope_gamma, 2)}</b></sup> cm/s`; }
  function previewHtml(cur, nw) {
    const cN = classify(nw), cC = cur ? classify(cur) : null;
    return chart(cur, nw, cN) + (cN ? `<div class="tblwrap"><table class="tbl sm"><thead><tr><th></th><th class="r">Khung vàng</th><th class="r">Khung đỏ</th><th class="r">Đỏ đầu tiên tại</th></tr></thead><tbody>
      ${cC ? `<tr><td>Bản v${cur.version} đang áp dụng</td><td class="r">${cC.y}</td><td class="r">${cC.r}</td><td class="r">${cC.firstRed !== null ? num(cC.firstRed, 1) + ' m' : '–'}</td></tr>` : ''}
      <tr><td><b>Tham số mới</b></td><td class="r"><b>${cN.y}</b></td><td class="r"><b>${cN.r}</b></td><td class="r"><b>${cN.firstRed !== null ? num(cN.firstRed, 1) + ' m' : '–'}</b></td></tr></tbody></table></div>
      <p class="note">Trên ${cN.n} khung có số đo. Đỏ nhiều khi tàu vẫn cập an toàn là dấu hiệu biên dạng quá chặt (hoa tiêu sẽ bỏ qua đèn); không đỏ lần nào khi tàu chạm nhanh là quá lỏng.</p>` : '<p class="note">Chưa có lượt cập đã đóng để thử.</p>');
  }
  function tableHtml(cur, nw) {
    const ds = DISTS.filter((d) => d <= dOpen());
    return `<table class="tbl sm"><thead><tr><th>d (m)</th>${ds.map((d) => `<th class="r">${d}</th>`).join('')}</tr></thead><tbody>
      ${cur ? `<tr><td>Cho phép – bản v${cur.version}</td>${ds.map((d) => `<td class="r muted">${num(vA(cur, d), 1)}</td>`).join('')}</tr>` : ''}
      <tr><td><b>Cho phép – mới</b></td>${ds.map((d) => `<td class="r"><b>${num(vA(nw, d), 1)}</b></td>`).join('')}</tr>
      <tr><td>Vàng từ – mới</td>${ds.map((d) => `<td class="r">${num(nw.envelope_yellow_ratio * vA(nw, d), 1)}</td>`).join('')}</tr></tbody></table>`;
  }
  /** Cập nhật phần xem trước khi đang gõ, không vẽ lại ô nhập. */
  function update() {
    const cur = active(), nw = asCfg(form);
    if (!validNw(nw)) return;
    root.querySelector('#bc-formula').innerHTML = formulaHtml(nw);
    root.querySelector('#bc-prev').innerHTML = previewHtml(cur, nw);
    root.querySelector('#bc-tbl').innerHTML = tableHtml(cur, nw);
    const ch = isChanged(cur, nw);
    root.querySelector('#bc-save').disabled = !ch || busy;
    root.querySelector('#bc-same').hidden = ch;
  }
  function render() {
    if (!list) { root.innerHTML = '<p class="muted pad">Đang tải…</p>'; return; }
    const cur = active();
    if (!form) { root.innerHTML = '<p class="muted pad">Bến chưa có cấu hình đang áp dụng.</p>'; return; }
    const nw = asCfg(form);
    const changed = isChanged(cur, nw);
    const evOpt = events.map((e) => `<option value="${e.id}" ${e.id === evSel ? 'selected' : ''}>${esc(e.code)} · ${e.source === 'live' ? 'thật' : 'giả lập'} · ${e.v_contact_cms != null ? num(e.v_contact_cms, 1) + ' cm/s khi chạm' : esc(e.status)}</option>`).join('');
    root.innerHTML = `
      <div class="toolbar"><h2 class="evtitle">Cấu hình bến ${esc(store.berth)} – biên dạng vận tốc cho phép</h2><span class="sp"></span><button class="btn" id="bc-reload">Làm mới</button></div>
      <p class="msg ${bad ? 'bad' : 'ok'}" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      <div class="bcgrid">
        <section class="panel"><h2>Tham số <span class="muted">(nạp từ bản v${form.loadedFrom})</span></h2>
          <p class="formula" id="bc-formula">${formulaHtml(nw)}</p>
          <form id="bc-form" class="bcform">
            ${FIELDS.map(([k, label, unit, step, hint]) => `<label><span>${label}</span><input type="number" name="${k}" value="${form[k]}" step="${step}" inputmode="decimal" required><em>${unit}</em><small>${hint}</small></label>`).join('')}
            <label class="wide"><span>Ghi chú thay đổi</span><input name="notes" maxlength="300" value="${esc(form.notes)}" placeholder="ví dụ: siết biên dạng theo ý kiến hoa tiêu"></label>
            <div class="row"><button class="btn primary" type="submit" id="bc-save" ${changed && !busy ? '' : 'disabled'}>Lưu bản nháp v${(list[0]?.version ?? 0) + 1}</button>
              <button class="btn" type="button" id="bc-revert">Nạp lại bản đang áp dụng</button></div>
            <p class="note" id="bc-same" ${changed ? 'hidden' : ''}>Chưa có thay đổi so với bản đang áp dụng.</p>
          </form>
          <p class="note">Bản nháp sao chép mọi thông số khác (vị trí BRT, đệm, độ cứng, ngưỡng cảnh báo dự báo, QC) từ bản đang áp dụng; chỉ thay các tham số trên.</p>
        </section>
        <section class="panel"><h2>Xem trước</h2>
          <label class="evpick">Thử trên số đo của lượt cập <select id="bc-ev"><option value="">(không)</option>${evOpt}</select></label>
          <div id="bc-prev">${previewHtml(cur, nw)}</div>
        </section>
      </div>
      <section class="panel"><h2>Giá trị theo khoảng cách</h2><div class="tblwrap" id="bc-tbl">${tableHtml(cur, nw)}</div><p class="note">Đơn vị cm/s. LED so sánh vận tốc lớn hơn trong hai BRT tại khoảng cách nhỏ hơn.</p></section>
      <section class="panel"><h2>Các phiên bản</h2><div class="tblwrap"><table class="tbl sm"><thead><tr><th>v</th><th>Trạng thái</th><th class="r">v_d</th><th class="r">β</th><th class="r">γ</th><th class="r">Vàng</th><th class="r">Khung đỏ</th><th>Tạo</th><th>Phê duyệt</th><th>Ghi chú</th><th></th></tr></thead><tbody>
        ${list.map((c) => `<tr data-v="${c.version}" class="${c.status === 'active' ? 'sel' : ''}"><td><b>${c.version}</b></td><td><span class="pill ${c.status === 'active' ? 'on' : ''}">${ST_VN[c.status] ?? c.status}</span>${c.effective_from && c.status === 'active' ? `<br><span class="muted">từ ${tl(c.effective_from)}</span>` : ''}</td>
          <td class="r">${num(c.v_design_cms, 1)}</td><td class="r">${num(c.envelope_beta, 4)}</td><td class="r">${num(c.envelope_gamma, 2)}</td><td class="r">${Math.round(c.envelope_yellow_ratio * 100)} %</td><td class="r">${c.envelope_red_frames}</td>
          <td>${esc(c.created_by_email ?? '')}<br><span class="muted">${tl(c.created_at)}</span></td><td>${c.approved_at ? `${esc(c.approved_by_email ?? '')}<br><span class="muted">${tl(c.approved_at)}</span>` : '–'}</td>
          <td class="wrap">${esc(c.notes ?? '')}</td>
          <td class="acts"><button class="btn sm" data-load>Nạp vào trình sửa</button>
            ${c.status === 'draft' && canApprove() ? '<button class="btn sm primary" data-approve>Phê duyệt</button>' : ''}
            ${c.status === 'approved' && canApprove() ? '<button class="btn sm primary" data-activate>Áp dụng</button>' : ''}
            ${c.status === 'draft' ? '<button class="btn sm" data-del>Xoá nháp</button>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">${canApprove() ? 'Áp dụng chỉ được khi bến không có lượt cập <b>thật</b> đang mở. Gateway nhận cấu hình mới ở lần tải cấu hình kế tiếp (≤ 5 phút); lượt cập đang chạy trên máy chủ giữ cấu hình lúc mở lượt.' : 'Phê duyệt và áp dụng cần tài khoản có quyền phê duyệt.'}</p></section>`;
    bind();
  }
  function bind() {
    root.querySelector('#bc-reload').onclick = async () => { msg = ''; events = []; await refresh(); };
    const f = root.querySelector('#bc-form');
    f.oninput = (e) => { if (!e.target.name) return; form[e.target.name] = e.target.value; clearTimeout(timer); timer = setTimeout(update, 120); };
    f.onsubmit = async (e) => {
      e.preventDefault(); const cur = active(); if (!cur) return;
      const body = { from_version: cur.version, ...asCfg(form), notes: form.notes || '' };
      busy = true;
      try { const r = await api.post(`/v1/berths/${encodeURIComponent(store.berth)}/configs`, body); busy = false; await load(); say(`Đã lưu bản nháp v${r.version}. ${canApprove() ? 'Kiểm tra lại rồi bấm "Phê duyệt", sau đó "Áp dụng".' : 'Chờ người có quyền phê duyệt.'}`); }
      catch (err) { busy = false; say(err.message + (err.details?.length ? ': ' + err.details.join('; ') : ''), true); }
    };
    root.querySelector('#bc-revert').onclick = () => { form = fromCfg(active()); msg = ''; render(); };
    root.querySelector('#bc-ev').onchange = async (e) => { evSel = e.target.value; try { await loadFrames(); } catch (err) { say(err.message, true); } render(); };
    root.querySelectorAll('tr[data-v]').forEach((tr) => {
      const v = Number(tr.dataset.v), c = list.find((x) => x.version === v), base = `/v1/berths/${encodeURIComponent(store.berth)}/configs/${v}`;
      tr.querySelector('[data-load]').onclick = () => { form = { ...fromCfg(c), notes: c.status === 'active' ? '' : (c.notes ?? '') }; say(`Đã nạp tham số của bản v${v} vào trình sửa.`); root.scrollTo?.(0, 0); window.scrollTo(0, 0); };
      const ap = tr.querySelector('[data-approve]'); if (ap) ap.onclick = async () => { try { await api.post(base + '/approve', {}); await load(); say(`Đã phê duyệt bản v${v}. Bấm "Áp dụng" khi sẵn sàng.`); } catch (err) { say(err.message, true); } };
      const ac = tr.querySelector('[data-activate]'); if (ac) ac.onclick = async () => { try { await api.post(base + '/activate', {}); form = null; await load(); say(`Bản v${v} đang áp dụng cho bến ${store.berth}. Gateway nhận trong vòng 5 phút; giao diện Live dùng biên dạng mới sau khi tải lại trang.`); } catch (err) { say(err.message, true); } };
      const dl = tr.querySelector('[data-del]'); if (dl) dl.onclick = async () => { try { await api.req('DELETE', base); await load(); say(`Đã xoá bản nháp v${v}.`); } catch (err) { say(err.message, true); } };
    });
  }
  async function refresh() { try { await load(); } catch (e) { msg = e.message; bad = true; } render(); }
  return {
    async show() { await refresh(); },
    hide() {},
    reset() { list = null; form = null; events = []; evSel = ''; frames = null; msg = ''; },
  };
}

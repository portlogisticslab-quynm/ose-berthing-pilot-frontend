// Tab "KPI": chỉ tiêu theo tháng của bến (đủ số liệu, vận tốc và năng lượng cập, cảnh báo, phát hiện, báo nhầm, độ trễ).
import { num } from './plan.js';
import { esc, SOURCE_VN } from './views.js';

export function kpiTab({ api, store, root }) {
  const f = { source: 'live', from: '', to: '' };
  async function render() {
    const p = new URLSearchParams({ berth: store.berth, source: f.source });
    if (f.from) p.set('from', new Date(f.from + 'T00:00:00').toISOString());
    if (f.to) p.set('to', new Date(f.to + 'T23:59:59').toISOString());
    let k;
    try { k = await api.get('/v1/kpi?' + p); } catch (er) { root.innerHTML = `<p class="msg bad">${esc(er.message)}</p>`; return; }
    const pct = (a, b) => (b ? `${num((100 * a) / b, 0)} %` : '–');
    const cols = [
      ['Tháng', (m) => m.month], ['Lượt cập', (m) => m.events], ['Đã đóng / bỏ dở', (m) => `${m.closed} / ${m.aborted}`],
      ['Đủ số liệu ≥ 98 %', (m) => pct(m.complete_98, m.events)], ['V chạm TB / lớn nhất (cm/s)', (m) => `${num(m.v_contact_avg)} / ${num(m.v_contact_max)}`],
      ['Quá V thiết kế', (m) => pct(m.over_design_speed, m.contacts)], ['Năng lượng TB / lớn nhất (% định mức)', (m) => `${num(m.energy_pct_avg, 0)} / ${num(m.energy_pct_max, 0)}`],
      ['LED đỏ', (m) => m.local_red], ['Dự báo ≥ Cảnh báo', (m) => m.forecast_warn], ['Đã đánh giá', (m) => pct(m.reviewed, m.events)],
      ['Cập mạnh', (m) => m.hard], ['Phát hiện', (m) => (m.hard ? `${m.detected}/${m.hard}` : '–')], ['Báo nhầm', (m) => m.false_alarms],
      ['Báo trước (trung vị, s)', (m) => num(m.lead_median_s, 0)],
    ];
    root.innerHTML = `
      <div class="toolbar"><h2 class="evtitle">KPI bến ${esc(store.berth)}</h2><span class="sp"></span>
        <label>Nguồn <select id="k-src">${Object.entries(SOURCE_VN).map(([a, b]) => `<option value="${a}" ${a === f.source ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        <label>Từ ngày <input id="k-from" type="date" value="${f.from}"></label><label>Đến ngày <input id="k-to" type="date" value="${f.to}"></label>
        <button class="btn" id="k-go">Xem</button></div>
      <div class="tblwrap"><table class="tbl"><thead><tr>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${k.months.length ? k.months.map((m) => `<tr>${cols.map(([, fn]) => `<td>${fn(m)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted">Chưa có lượt cập.</td></tr>`}</tbody></table></div>
      <div class="cards pad">
        ${f.source === 'live' ? `<div class="card"><span class="l">Độ trễ đo → máy chủ (P50)</span><span class="v">${num(k.latency?.p50_ms, 0)} ms</span></div>
        <div class="card"><span class="l">Độ trễ đo → máy chủ (P95)</span><span class="v">${num(k.latency?.p95_ms, 0)} ms</span></div>`
        : '<div class="card"><span class="l">Độ trễ đo → máy chủ</span><span class="v">–</span><span class="l">không áp dụng: giả lập, phát lại gửi khung có thời điểm lùi về quá khứ</span></div>'}
        <div class="card"><span class="l">Số khung</span><span class="v">${(k.latency?.frames ?? 0).toLocaleString('vi-VN')}</span></div>
      </div>
      <p class="note pad">${esc(k.notes)}</p>`;
    root.querySelector('#k-go').onclick = () => { f.source = root.querySelector('#k-src').value; f.from = root.querySelector('#k-from').value; f.to = root.querySelector('#k-to').value; render(); };
  }
  return { show: render, hide() {}, reset() {} };
}

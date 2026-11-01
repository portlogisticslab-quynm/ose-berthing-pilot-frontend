// Tab "Dashboard": số liệu trực tuyến theo từng kênh, dự báo tại thời điểm chạm bến, đồ thị vận tốc – khoảng cách,
// xác suất vượt theo thời gian, đường đặc trưng đệm, nhật ký cảnh báo, so sánh dự báo với thực tế, kiểm định mô hình, giả thiết.
// Dùng chung số liệu của tab Live (ảnh chụp + luồng SSE); không gọi thêm API.
import { lineChart, extent, C } from './charts.js';
import { nearD, maxV, vAllowAt, esc, fenderResponse, LEVEL_VN, LEVEL_COLOR, SOURCE_VN } from './views.js';
import { num } from './plan.js';

const FINAL = ['closed', 'aborted', 'merged'];
const CHECK_D = [200, 100, 50, 20, 5];

export function dashboardTab({ store, root }) {
  let built = false, lastHeavy = 0;
  const q = (sel) => root.querySelector(sel);
  const tz = () => store.snap?.berth?.timezone || 'Asia/Ho_Chi_Minh';
  const tl = (iso) => (iso ? new Date(iso).toLocaleTimeString('vi-VN', { timeZone: tz(), hour12: false }) : '–');

  function build() {
    root.innerHTML = `
      <div id="db-banner" class="dbanner"></div>
      <section class="panel"><h2>Kênh đo trực tuyến <span class="tag">BRT 1 Hz; môi trường theo lượt cập; FND, DSP từ Port-SHM</span></h2><div id="db-ch" class="cards"></div></section>
      <section class="panel"><h2>Dự báo tại thời điểm chạm bến <span class="tag">mô hình, khoảng P10–P90</span></h2><div id="db-fc" class="cards"></div></section>
      <div class="grid3">
        <section class="panel"><h2>Vận tốc theo khoảng cách <span class="tag">đo, dự báo khi chạm</span></h2><canvas id="db-vel" class="chart tall"></canvas>
          <div class="legend"><span class="k-ink">Đo</span><span class="k-bad">Vận tốc cho phép</span><span class="k-chart band">Dự báo P10–P90 khi chạm</span><span class="k-ok pt">Thực tế khi chạm</span></div></section>
        <section class="panel"><h2>Xác suất vượt theo thời gian <span class="tag">dự báo</span></h2><canvas id="db-prob" class="chart tall"></canvas>
          <div class="legend"><span class="k-warn">P(E ≥ 0,85 Er)</span><span class="k-bad">P(E ≥ Er)</span><span class="k-violet">P(δ bến ≥ giới hạn)</span><span class="k-chart">P(góc ≥ ngưỡng)</span><span class="k-axis dash">P*</span></div></section>
        <section class="panel"><h2>Đường đặc trưng đệm <span id="db-ftype" class="tag"></span></h2><canvas id="db-fender" class="chart tall"></canvas>
          <div class="legend"><span class="k-ink">Phản lực – độ nén</span><span class="k-warn dash">Độ nén định mức</span><span class="k-bad pt">Dự báo P50</span><span class="k-pink pt">P90</span><span class="k-ok pt">Thực tế</span><span class="k-violet dash">Nén đo được</span></div></section>
      </div>
      <div class="grid2">
        <section class="panel"><h2>Nhật ký cảnh báo <span class="tag">thay đổi mức dự báo trong lượt cập</span></h2><div id="db-log" class="tblwrap"></div></section>
        <section class="panel"><h2>So sánh dự báo – thực tế</h2><div id="db-cmp"></div></section>
        <section class="panel"><h2>Kiểm định mô hình <span id="db-mtag" class="tag"></span></h2><div id="db-model" class="tblwrap"></div></section>
        <section class="panel"><h2>Giả thiết tính toán</h2><ul id="db-assume" class="list assume"></ul></section>
      </div>`;
    built = true;
  }

  /** Mẫu môi trường tại thời điểm khung (mẫu gần nhất không sau khung); không có chuỗi thì dùng mẫu của ảnh chụp. */
  const envAt = (f) => {
    const ser = store.snap?.env_series; if (!ser?.length) return store.snap?.env ?? null;
    const t = f ? Date.parse(f.ts) + 500 : Infinity; let r = ser[0];
    for (const x of ser) { if (Date.parse(x.ts) <= t) r = x; else break; }
    return r;
  };
  const lastFc = () => { const fr = store.frames; for (let i = fr.length - 1; i >= 0; i--) if (fr[i].fc) return fr[i].fc; return null; };
  const card = (head, metric, val, unit, sub = '', cls = '') => `<div class="card ${cls}"><div class="ch"><span>${esc(head)}</span><span>${esc(metric)}</span></div>
    <div class="cv">${val}<small>${esc(unit)}</small></div><div class="cs">${sub}</div></div>`;

  function render(full = false) {
    if (!built) build();
    const b = store.snap?.berth, e = store.event, fr = store.frames, f = fr.at(-1) ?? null, fc = lastFc();
    const active = e && !FINAL.includes(e.status);
    const age = store.lastRecv ? (Date.now() - store.lastRecv) / 1000 : null;
    const live = active && age !== null && age < 3;
    // ---- dải trên
    const lvl = fc?.level ?? null, d = nearD(f);
    q('#db-banner').dataset.level = lvl ?? '';
    q('#db-banner').innerHTML = e
      ? `<span class="badge" style="background:${LEVEL_COLOR[lvl] ?? 'var(--panel2)'}">${lvl ? LEVEL_VN[lvl] : 'Chưa có dự báo'}</span>
         <b>${esc(e.code)}</b> · ${esc(SOURCE_VN[store.source] ?? store.source)} · ${e.vessel_name ? esc(e.vessel_name + (e.vessel_type ? ' – ' + e.vessel_type : '')) + (e.dwt ? `, ${Math.round(e.dwt).toLocaleString('vi-VN')} DWT` : '') : 'Chưa gắn tàu (dự báo dùng tàu thiết kế)'}
         ${e.laden != null ? ` · ${e.laden ? 'có hàng' : 'không hàng'}` : ''}${e.tugs != null ? ` · ${e.tugs} tàu lai` : ''} · cách bến ${num(d, 1)} m${active ? '' : ' · lượt cập đã kết thúc'}`
      : 'Không có lượt cập. Chọn nguồn "Giả lập" hoặc chạy giả lập để xem dashboard hoạt động.';
    // ---- kênh đo
    const sub = (ok, extra = '') => (f ? (ok ? `${live ? 'Trực tuyến' : 'Khung cuối'} · ${tl(f.ts)}${extra}` : '<span class="bad">mất mục tiêu</span>') : 'Chưa có số liệu');
    const st = (ok) => (!f ? 'off' : ok ? (live ? 'ok' : 'old') : 'bad');
    const env = envAt(f),  sn = b?.seaward_normal_deg ?? 0, cosd = (x) => Math.cos((x * Math.PI) / 180);
    const windOn = env?.wind_speed_ms != null && env?.wind_dir_deg != null ? env.wind_speed_ms * cosd(env.wind_dir_deg - sn) : null;
    const curOn = env?.current_speed_ms != null && env?.current_dir_deg != null ? env.current_speed_ms * cosd(env.current_dir_deg - (sn + 180)) : null;
    const esub = env ? `${env.source_ref === 'sim' ? 'Giả lập' : env.source_ref === 'port-shm' ? 'Port-SHM' : 'Theo lượt cập'} · ${tl(env.ts)}` : 'Chưa có số liệu môi trường (dự báo coi như lặng)';
    // FND, DSP: số đo mới nhất của công trình bến trên Port-SHM; lượt cập đã chạm thì lấy giá trị lớn nhất sau khi chạm
    const shm = store.snap?.shm, sx = shm?.ok ? shm.structural ?? [] : [];
    const pick = (type, chans) => sx.filter((x) => x.sensor_type === type && chans.includes(x.channel) && x.value !== null && x.ts).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
    const fnd = pick('fender_force', ['value']), dsp = pick('displacement', ['dx', 'value']);
    const shmMsg = !shm ? 'Port-SHM chưa bật hoặc bến chưa khai báo mã công trình' : !shm.ok ? `Lỗi đọc Port-SHM: ${esc(shm.error ?? '')}` : '';
    const meas = (evVal, x, unit, d) => (evVal != null ? [num(evVal, d), `Đo sau khi chạm · Port-SHM`, 'ok'] : x ? [num(x.value, d), `${esc(x.sensor)} · ${tl(x.ts)}`, 'old'] : ['–', shmMsg || 'Port-SHM chưa có số đo của cảm biến loại này', 'off']);
    const [fv, fs, fc2] = meas(e?.shm_fnd_kn, fnd, 'kN', 0), [dv, ds, dc] = meas(e?.shm_dsp_mm, dsp, 'mm', 2);
    q('#db-ch').innerHTML = [
      card('BRT-N1', 'khoảng cách', num(f?.d1, 2), ' m', sub(f?.d1 !== null), st(f?.d1 !== null)),
      card('BRT-N1', 'vận tốc', num(f?.v1, 2), ' cm/s', sub(f?.v1 !== null), st(f?.v1 !== null)),
      card('BRT-N2', 'khoảng cách', num(f?.d2, 2), ' m', sub(f?.d2 !== null), st(f?.d2 !== null)),
      card('BRT-N2', 'vận tốc', num(f?.v2, 2), ' cm/s', sub(f?.v2 !== null), st(f?.v2 !== null)),
      card('Góc tàu – bến', 'tính từ N1, N2', num(f?.angle, 2), '°', f?.est ? `ước lượng ${num(f.est.alpha, 2)}° · quay ${num(f.est.omega * 60, 2)} °/phút` : sub(f?.angle !== null), st(f?.angle !== null)),
      card('ENV gió', 'tốc độ / hướng thổi từ', env ? `${num(env.wind_speed_ms, 1)} / ${num(env.wind_dir_deg, 0)}°` : '–', ' m/s', env ? `${esub} · vào bến ${num(windOn, 1)} m/s` : esub, env ? 'ok' : 'off'),
      card('ENV dòng chảy', 'tốc độ / hướng chảy tới', env ? `${num(env.current_speed_ms, 2)} / ${num(env.current_dir_deg, 0)}°` : '–', ' m/s', env ? `${esub} · vào bến ${num(curOn, 2)} m/s` : esub, env ? 'ok' : 'off'),
      card('ENV sóng', 'Hs / Tp', env ? `${num(env.hs_m, 2)} / ${num(env.tp_s, 1)}` : '–', ' m / s', esub, env ? 'ok' : 'off'),
      card('ENV mực nước', 'triều', num(env?.water_level_m, 2), ' m', esub, env ? 'ok' : 'off'),
      card('FND đệm', 'phản lực đo', fv, ' kN', fs, fc2),
      card('DSP bến', 'chuyển vị đo', dv, ' mm', ds, dc),
    ].join('');
    // ---- dự báo khi chạm
    const F = b?.fender, Er = F?.rated_energy_kj ?? b?.fender_rated_energy_kj, Rr = F?.rated_reaction_kn ?? b?.fender_rated_reaction_kn, dl = b?.disp_limit_mm;
    const r50 = fc ? fenderResponse(F, fc.e[0]) : null, r90 = fc ? fenderResponse(F, fc.e[1]) : null;
    const pE = (x) => `${num(x, 0)} kJ <small>(${num((100 * x) / (Er || 1), 0)} % Er)</small>`;
    const pp = (x) => (x === null || x === undefined ? '–' : num(100 * x, 0) + ' %');
    q('#db-fc').innerHTML = fc ? [
      card('Vận tốc cập', 'P50 [P10–P90]', num(fc.vc[1], 1), ' cm/s', `[${num(fc.vc[0], 1)} – ${num(fc.vc[2], 1)}] · thiết kế ${num(b?.v_design_cms, 0)} cm/s`, 'fc'),
      card('Góc cập', 'P50 / P90', `${num(fc.ac[0], 1)} / ${num(fc.ac[1], 1)}`, '°', fc.two ? `P(góc ≥ ngưỡng chú ý) ${pp(fc.pr?.aC)}` : 'Một BRT: không dự báo góc', 'fc'),
      card('Năng lượng cập (PIANC)', 'P50', pE(fc.e[0]), '', `P90 ${pE(fc.e[1])} · P(≥0,85 Er) ${pp(fc.pr?.eW)} · P(≥Er) ${pp(fc.pr?.eC)}`, 'fc'),
      card('Phản lực đệm', 'P50 / P90', `${num(fc.f[0], 0)} / ${num(fc.f[1], 0)}`, ' kN', `Rr ${num(Rr, 0)} kN · độ nén P90 ${r90 ? num(100 * r90.ratio, 0) + ' %' : '–'}${r90?.bottomed ? ' (nén hết)' : ''}`, 'fc'),
      card('Chuyển vị bến', 'P50 / P90', `${num(fc.disp[0], 1)} / ${num(fc.disp[1], 1)}`, ' mm', `Giới hạn ${num(dl, 0)} mm · P(≥ giới hạn) ${pp(fc.p)}`, 'fc'),
      card('Mức cảnh báo dự báo', `mốc ${num(fc.chk, 0)} m`, `<span style="color:${LEVEL_COLOR[fc.level]}">${LEVEL_VN[fc.level]}</span>`, '', [fc.vesselAssumed && 'tàu thiết kế', fc.envMissing && 'không có gió, dòng', !fc.two && 'một BRT'].filter(Boolean).join(' · ') || 'đủ đầu vào', 'fc'),
    ].join('') : '<p class="muted">Chưa có dự báo (dự báo bắt đầu khi tàu vào vùng tiếp cận và có đủ khung số liệu).</p>';
    // phần nặng: đồ thị, bảng (tối đa 2 lần/giây)
    const now = performance.now();
    if (!full && now - lastHeavy < 500) return;
    lastHeavy = now;
    charts(b, e, fr, fc, r50, r90);
    tables(b, e, fr);
  }

  function charts(b, e, fr, fc, r50, r90) {
    // vận tốc – khoảng cách
    const ds = fr.map(nearD).filter((x) => x !== null && Number.isFinite(x)), dMax = ds.length ? Math.max(...ds) : 100;
    const env = []; for (let i = 0; i <= 60; i++) { const d = (dMax * i) / 60; env.push([d, vAllowAt(b, d)]); }
    const vs = fr.map(maxV).filter((x) => x !== null);
    const vTop = Math.max(10, ...vs.map((x) => x * 1.15), (fc?.vc[2] ?? 0) * 1.15, (e?.v_contact_cms ?? 0) * 1.15, (b?.v_design_cms ?? 0) * 1.3);
    const f = fr.at(-1), w0 = dMax * 0.015;
    lineChart(q('#db-vel'), { x: [dMax * 1.02, -w0], y: [0, vTop], yLabel: 'cm/s', empty: fr.length ? null : 'Chưa có số liệu',
      bands: fc ? [{ pts: [[w0, fc.vc[0], fc.vc[2]], [-w0, fc.vc[0], fc.vc[2]]], color: 'rgba(79,163,199,0.45)' }] : [],
      hlines: b ? [{ y: b.v_design_cms, color: C.axis, dash: [5, 4] }] : [],
      series: [{ pts: env, color: C.bad, width: 1.5 }, { pts: fr.map((x) => [nearD(x), maxV(x)]), color: C.ink },
        ...(fc && f && !FINAL.includes(e?.status) ? [{ pts: [[nearD(f), maxV(f)], [0, fc.vc[1]]], color: C.chart, dash: [3, 3], width: 1.2 }] : [])],
      dots: [...(fc ? [{ x: 0, y: fc.vc[1], color: C.chart, r: 5 }] : []), ...(e?.v_contact_cms != null ? [{ x: 0, y: e.v_contact_cms, color: C.ok, r: 5, ring: '#fff' }] : [])] });
    // xác suất theo thời gian
    const t = (x) => Date.parse(x.ts), fcs = fr.filter((x) => x.fc);
    const xt = fr.length ? [t(fr[0]), Math.max(t(fr.at(-1)), t(fr[0]) + 60_000)] : [0, 1];
    const tf = (ms) => new Date(ms).toLocaleTimeString('vi-VN', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hour12: false });
    const line = (k, col) => ({ pts: fcs.map((x) => [t(x), x.fc.pr ? 100 * x.fc.pr[k] : null]), color: col, width: 1.8 });
    lineChart(q('#db-prob'), { x: xt, y: [0, 100], xFmt: tf, yLabel: '%', empty: fcs.length ? null : 'Chưa có dự báo',
      hlines: b ? [{ y: 100 * b.p_star, color: C.axis, dash: [5, 4] }] : [],
      series: [line('eW', C.warn), line('eC', C.bad), { pts: fcs.map((x) => [t(x), 100 * x.fc.p]), color: '#b388ff', width: 1.8 }, line('aC', C.chart)] });
    // đường đặc trưng đệm
    const F = b?.fender;
    q('#db-ftype').textContent = F ? `${F.type}, Er ${num(F.rated_energy_kj, 0)} kJ, Rr ${num(F.rated_reaction_kn, 0)} kN, H ≈ ${num(F.H, 2)} m` : '';
    if (!F) { lineChart(q('#db-fender'), { x: [0, 0.9], y: [0, 1], series: [], empty: 'Chưa có cấu hình đệm' }); return; }
    const Rr = F.rated_reaction_kn, act = e?.energy_knm != null ? fenderResponse(F, e.energy_knm) : null;
    const yMax = Math.max(1.6 * Rr, ...[r90?.reaction, act?.reaction].filter(Number.isFinite).map((x) => x * 1.1));
    const meas = e?.max_compression_m != null && F.H ? e.max_compression_m / F.H : null;
    lineChart(q('#db-fender'), { x: [0, 0.9], y: [0, yMax], yLabel: 'kN', xFmt: (x) => num(100 * x, 0) + ' %',
      vlines: [{ x: F.rated_deflection, color: C.warn, dash: [4, 4] }, ...(meas !== null ? [{ x: Math.min(0.9, meas), color: '#b388ff', dash: [2, 3] }] : [])],
      hlines: [{ y: Rr, color: C.axis, dash: [2, 4] }],
      series: [{ pts: F.curve.map(([x, y]) => [x, y * Rr]), color: C.ink, width: 2 }],
      dots: [...(r90 ? [{ x: Math.min(0.9, r90.ratio), y: r90.reaction, color: 'rgba(229,72,77,0.45)', r: 7 }] : []),
        ...(r50 ? [{ x: Math.min(0.9, r50.ratio), y: r50.reaction, color: C.bad, r: 4.5 }] : []),
        ...(act ? [{ x: Math.min(0.9, act.ratio), y: act.reaction, color: C.ok, r: 5, ring: '#fff' }] : [])],
      labels: [{ text: 'độ nén δ/H', px: q('#db-fender').getBoundingClientRect().width - 12, py: 18, align: 'right' }] });
  }

  function tables(b, e, fr) {
    // nhật ký đổi mức dự báo
    const log = []; let prev = null;
    for (const x of fr) if (x.fc && x.fc.level !== prev) { log.push(x); prev = x.fc.level; }
    const open = store.alerts ?? [];
    q('#db-log').innerHTML = (log.length ? `<table class="tbl sm"><thead><tr><th>Giờ</th><th class="r">d (m)</th><th>Mức</th><th class="r">P(E≥0,85Er)</th><th class="r">P(E≥Er)</th><th class="r">P(δ≥lim)</th></tr></thead><tbody>
      ${log.slice(-40).map((x) => `<tr><td>${tl(x.ts)}</td><td class="r">${num(nearD(x), 0)}</td><td><span class="lv lv-${x.fc.level}">${LEVEL_VN[x.fc.level]}</span></td>
        <td class="r">${x.fc.pr ? num(100 * x.fc.pr.eW, 0) + ' %' : '–'}</td><td class="r">${x.fc.pr ? num(100 * x.fc.pr.eC, 0) + ' %' : '–'}</td><td class="r">${num(100 * x.fc.p, 0)} %</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Chưa có cảnh báo.</p>')
      + (open.length ? `<p class="note">Đang mở: ${open.map((a) => `<span class="lv lv-${a.level}">${esc(a.title)}</span>`).join(' ')}</p>` : '');
    // dự báo – thực tế
    if (!e || e.v_contact_cms == null) q('#db-cmp').innerHTML = '<p class="muted">Kết quả sẽ hiện khi tàu chạm bến.</p>';
    else {
      const rows = [];
      for (const D of CHECK_D) {
        const k = fr.findIndex((x) => { const d = nearD(x); return d !== null && d <= D; }); if (k < 0) continue;
        const x = fr.slice(k, k + 30).find((y) => y.fc); if (x) rows.push([D, x]);
      }
      const Er = b?.fender?.rated_energy_kj ?? b?.fender_rated_energy_kj ?? 1;
      q('#db-cmp').innerHTML = `<dl class="kv"><dt>Vận tốc chạm (đo)</dt><dd>${num(e.v_contact_cms, 2)} cm/s</dd><dt>Góc chạm</dt><dd>${num(e.angle_contact_deg, 2)}°</dd>
        <dt>Năng lượng</dt><dd>${num(e.energy_knm, 0)} kJ (${num((100 * e.energy_knm) / Er, 0)} % Er)</dd><dt>Phản lực, chuyển vị bến</dt><dd>${num(e.force_est_kn, 0)} kN, ${num(e.disp_est_mm, 1)} mm</dd>
        <dt>Nén đệm đo được</dt><dd>${e.max_compression_m != null ? num(e.max_compression_m, 2) + ' m' : '–'}</dd></dl>
        ${rows.length ? `<table class="tbl sm"><thead><tr><th class="r">Tại (m)</th><th class="r">V P50 [P10–P90]</th><th class="r">Sai số P50</th><th>Trong khoảng</th><th class="r">E P90 (kJ)</th><th>Mức</th></tr></thead><tbody>
        ${rows.map(([D, x]) => { const c = x.fc, inside = e.v_contact_cms >= c.vc[0] && e.v_contact_cms <= c.vc[2];
          return `<tr><td class="r">${D}</td><td class="r">${num(c.vc[1], 1)} [${num(c.vc[0], 1)}–${num(c.vc[2], 1)}]</td><td class="r">${num(c.vc[1] - e.v_contact_cms, 1)}</td><td>${inside ? '✓' : '<span class="bad">ngoài</span>'}</td><td class="r">${num(c.e[1], 0)}</td><td><span class="lv lv-${c.level}">${LEVEL_VN[c.level]}</span></td></tr>`; }).join('')}</tbody></table>` : ''}
        ${e.shm_fnd_kn != null || e.shm_dsp_mm != null ? `<dl class="kv"><dt>Phản lực đo (FND, Port-SHM)</dt><dd>${num(e.shm_fnd_kn, 0)} kN · tính ${num(e.force_est_kn, 0)} kN</dd>
          <dt>Chuyển vị đo (DSP, Port-SHM)</dt><dd>${num(e.shm_dsp_mm, 2)} mm · tính ${num(e.disp_est_mm, 1)} mm</dd></dl>` : ''}
        <p class="note">Phản lực, chuyển vị "tính" suy từ năng lượng cập; giá trị "đo" lấy từ cảm biến FND, DSP của công trình trên Port-SHM (lớn nhất sau khi chạm).</p>`;
    }
    // kiểm định mô hình
    const m = store.snap?.model, two = fr.at(-1)?.fc?.two ?? true, met = m?.metrics?.[two ? 'twoSensors' : 'oneSensor'] ?? [];
    q('#db-mtag').textContent = m ? `${m.code} ${m.version} (${m.status}) · ${two ? 'hai BRT' : 'một BRT'}` : '';
    q('#db-model').innerHTML = met.length ? `<table class="tbl sm"><thead><tr><th class="r">Mốc (m)</th><th class="r">Số lượt</th><th class="r">MAE vận tốc (cm/s)</th><th class="r">MAE góc (°)</th><th class="r">Phủ P10–P90</th><th class="r">Phát hiện</th><th class="r">Báo nhầm</th></tr></thead><tbody>
      ${met.map((x) => `<tr><td class="r">${x.D}</td><td class="r">${x.n}</td><td class="r">${num(100 * x.maeVelocity, 2)}</td><td class="r">${num(x.maeAngle, 2)}</td><td class="r">${num(100 * x.coverage80, 0)} %</td><td class="r">${num(100 * x.detection, 0)} %</td><td class="r">${num(100 * x.falseAlarm, 0)} %</td></tr>`).join('')}</tbody></table>
      <p class="note">${trainNote(m.train_set)}</p>`
      : '<p class="muted">Chưa có chỉ số kiểm định của mô hình.</p>';
    // giả thiết
    const F = b?.fender, ap = b?.alert_params ?? {};
    q('#db-assume').innerHTML = b ? [
      `Vận tốc cho phép theo biên dạng: v = ${num(b.v_design_cms, 0)} + 100·${num(b.envelope_beta, 4)}·d<sup>${num(b.envelope_gamma, 2)}</sup> cm/s; vàng khi ≥ ${num(100 * b.envelope_yellow_ratio, 0)} %, đỏ sau ${b.red_frames ?? b.envelope_red_frames} khung vượt liên tiếp.`,
      `Năng lượng theo PIANC 2002: E = ½·M·v²·Cm·Ce·Cs·Cc; khối lượng nước kèm, hệ số lệch tâm từ thông số tàu và góc cập.`,
      F ? `Đệm ${esc(F.type)}: Er ${num(F.rated_energy_kj, 0)} kJ, Rr ${num(F.rated_reaction_kn, 0)} kN, độ nén định mức ${num(100 * F.rated_deflection, 0)} %; chiều cao tương đương H ≈ ${num(F.H, 2)} m suy từ đường đặc tính chuẩn hoá.` : '',
      `Chuyển vị bến = phản lực / độ cứng ${num(b.k_kn_per_mm, 0)} kN/mm; giới hạn ${num(b.disp_limit_mm, 0)} mm.`,
      `Ngưỡng: năng lượng ${num(100 * (ap.energyCaution ?? 0.6), 0)} / ${num(100 * (ap.energyWarning ?? 0.85), 0)} / ${num(100 * (ap.energyCritical ?? 1), 0)} % Er; chuyển vị ${num(100 * (ap.dispWarning ?? 0.8), 0)} / ${num(100 * (ap.dispCritical ?? 1), 0)} % giới hạn; góc ${num(ap.angleCaution ?? 10, 0)}° / ${num(ap.angleWarning ?? 15, 0)}°; cảnh báo khi xác suất vượt ≥ P* = ${num(100 * b.p_star, 0)} %.`,
      `Khoảng cách đo từ tuyến mặt đệm; góc tính từ hai BRT cách nhau ${num(b.brt_spacing_m, 0)} m; vận tốc dương khi tàu tiến vào bến.`,
      'Lượt cập chưa gắn tàu: dự báo dùng tàu thiết kế. Thiếu gió, dòng chảy: coi như lặng.',
      'Lượt cập thật: gió, dòng chảy, sóng, mực nước đọc từ Port-SHM mỗi 60 s (S1); FND, DSP đo lấy từ Port-SHM sau khi chạm để đối chiếu với giá trị tính.',
      'Dự báo gửi sang Port-SHM mỗi 5 s (ngay khi đổi mức); kết quả lượt cập thật vào cảm biến ảo của bến để Port-SHM áp ngưỡng, quy tắc.',
    ].filter(Boolean).map((x) => `<li>${x}</li>`).join('') : '';
  }

  const trainNote = (t) => (t && typeof t === 'object'
    ? `Kiểm định trên ${t.test ?? '?'} lượt cập (huấn luyện ${t.train ?? '?'})${t.synthetic ? ' do bộ mô phỏng sinh ra – chưa phải số liệu thật' : ''}. Sẽ kiểm định lại trên lượt cập thật ở giai đoạn 2.`
    : 'Sẽ kiểm định lại trên lượt cập thật ở giai đoạn 2.');

  return {
    show() { render(true); },
    hide() {},
    reset() { built = false; },
    render,
  };
}

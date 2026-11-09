// Berthing AI Pilot – giao diện theo dõi cập tàu.
import { Api, apiBase } from './api.js';
import { drawCharts, lerpFrame } from './views.js';
import { dashboardTab } from './dashboard.js';
import { simPanel } from './sim.js';
import { eventsTab } from './events.js';
import { modelsTab } from './models.js';
import { shmTab } from './shm.js';
import { gatewaysTab } from './gateways.js';
import { berthCfgTab } from './berthcfg.js';
import { createDiag } from './diag.js';
import { kpiTab } from './kpi.js';
import { usersTab } from './users.js';
import { drawPlan, num } from './plan.js';

const CFG = window.PILOT_CONFIG;
const api = new Api(apiBase());
const $ = (id) => document.getElementById(id);
const LEVEL_VN = { Normal: 'Bình thường', Caution: 'Chú ý', Warning: 'Cảnh báo', Critical: 'Nguy hiểm' };
const STATUS_VN = { open: 'Đang theo dõi', approach: 'Đang tiếp cận', contact: 'Đã chạm đệm', moored: 'Đã cập', closed: 'Đã đóng', aborted: 'Bỏ dở', merged: 'Đã gộp' };
const LAYER_VN = { local: 'Tại bến', forecast: 'Dự báo', system: 'Hệ thống' };
const ROLES = ['viewer', 'pilot', 'operator', 'engineer', 'admin'];
const ROLE_VN = { viewer: 'Xem', pilot: 'Hoa tiêu', operator: 'Vận hành', engineer: 'Kỹ sư', admin: 'Quản trị' };
const FINAL = ['closed', 'aborted', 'merged'];
const MAX_FRAMES = 3600, STALE_MS = 3000;

const store = { user: null, berth: null, source: 'live', tab: 'live', snap: null, event: null, frames: [], alerts: [], gateways: [], lastRecv: 0 };
const pref = { get: (k, d) => { try { return localStorage.getItem('pilot.' + k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('pilot.' + k, v); } catch { /* bỏ qua */ } } };

// ------------------------------------------------------------------ khởi động
api.onUnauthorized = () => { if (!store.user?.guest) showLogin('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.'); };
// M8.2: máy chính tạm không trả lời, Worker chuyển sang máy dự phòng (không biết phiên tạo trong ngày) – giữ phiên, báo và chờ
api.onBackup = (on) => {
  let el = document.getElementById('backup-banner');
  if (!on) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'backup-banner'; el.className = 'backup-banner'; el.setAttribute('role', 'status');
    el.textContent = 'Máy chủ chính tạm thời không trả lời, đang dùng máy dự phòng (chỉ xem). Phiên đăng nhập vẫn giữ; app tự kết nối lại khi máy chính trả lời.';
    document.body.prepend(el);
  }
  el.hidden = false;
};
let publicView = false;   // máy chủ cho xem không cần tài khoản (PUBLIC_VIEW)
let started = false;
document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') queueMicrotask(init);   // chạy sau khi toàn bộ mô-đun đã khởi tạo
async function init() {
  if (started) return; started = true;
  bindUi();
  if (api.token) {
    try { store.user = await api.get('/v1/auth/me'); return await enterApp(); } catch { api.setToken(null); }
  }
  // không có phiên đăng nhập: máy chủ bật chế độ xem công khai thì vào thẳng với tư cách khách
  if (await enterAsGuest()) return;
  showLogin();
}

async function enterAsGuest() {
  try {
    const g = await api.get('/v1/auth/me');
    publicView = !!g?.guest;
    if (!publicView) return false;
    store.user = g; await enterApp(); return true;
  } catch { return false; }
}

function showLogin(msg) {
  stopStream(); api.setToken(null);
  $('app').hidden = true; $('sim-banner').hidden = true; $('login').hidden = false;
  const e = $('login-error'); e.hidden = !msg; e.textContent = msg ?? '';
  $('guest-enter').hidden = !publicView;
}

async function enterApp() {
  $('login').hidden = true; $('app').hidden = false;
  const guest = !!store.user.guest;
  // tên + vai trò (chỉ để hiển thị, không phải nút); khách: "Khách · chỉ xem"
  const roleVn = ROLE_VN[store.user.role] ?? store.user.role;
  const name = store.user.full_name && store.user.full_name !== roleVn ? store.user.full_name : store.user.email;   // tài khoản đầu tiên có tên "Quản trị" → hiện email
  $('who').textContent = guest ? 'Khách · chỉ xem' : `${name} · ${roleVn}`;
  $('who').title = guest ? 'Đang xem không cần tài khoản: xem số liệu và chạy giả lập ở bến công khai, không thay đổi được số liệu' : store.user.email;
  $('logout').hidden = guest; $('login-open').hidden = !guest; $('pw-open').hidden = guest;
  $('sim-open').hidden = !(ROLES.indexOf(store.user.role) >= ROLES.indexOf('engineer') && !guest) && !(store.user.public_sim_berths ?? []).length;
  const berths = await api.get('/v1/berths');
  const sel = $('berth'); sel.innerHTML = '';
  for (const b of berths) sel.append(new Option(`${b.code} – ${b.name}`, b.code));
  store.berth = berths.find((b) => b.code === pref.get('berth', CFG.defaultBerth ?? ''))?.code ?? berths[0]?.code;
  sel.value = store.berth;
  const ctx = (id) => ({ api, store, root: $(id) });
  pages.dashboard = dashboardTab(ctx('tab-dashboard')); pages.events = eventsTab(ctx('tab-events')); pages.models = modelsTab(ctx('tab-models')); pages.shm = shmTab(ctx('tab-shm')); pages.gateways = gatewaysTab(ctx('tab-gateways')); pages.config = berthCfgTab(ctx('tab-config')); pages.kpi = kpiTab(ctx('tab-kpi')); pages.users = usersTab(ctx('tab-users'));
  document.querySelectorAll('[data-role]').forEach((b) => { b.hidden = ROLES.indexOf(store.user?.role) < ROLES.indexOf(b.dataset.role); });
  sim ??= simPanel({ api, store, onStarted: () => { if (store.source !== 'sim') setSource('sim', true); if (!['live', 'dashboard', 'pilot'].includes(store.tab)) setTab('live'); } });
  setSource(pref.get('source', 'live'), false);
  setTab(new URLSearchParams(location.search).get('tab') ?? pref.get('tab', 'live'));
  diag ??= createDiag();
  if (store.user.must_change_pw) openPw(true);   // mật khẩu tạm: mời đổi ngay
  await connect();
}

// ------------------------------------------------------------------ đổi mật khẩu (M7.8)
function openPw(force = false) {
  const d = $('pw-dlg'), f = $('pw-form');
  f.reset(); $('pw-err').hidden = true;
  $('pw-force').hidden = !force;
  f.elements.username.value = store.user?.email ?? '';
  if (!d.open) d.showModal();
  f.elements.current_password.focus();
}

function bindUi() {
  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target), btn = ev.target.querySelector('button');
    btn.disabled = true; $('login-error').hidden = true;
    try { await api.login(fd.get('email'), fd.get('password')); store.user = await api.get('/v1/auth/me'); ev.target.reset(); await enterApp(); }
    catch (e) { const el = $('login-error'); el.hidden = false; el.textContent = e.status === 401 ? 'Sai email hoặc mật khẩu.' : e.message; }
    finally { btn.disabled = false; }
  });
  $('logout').addEventListener('click', async () => { stopStream(); sim?.close(); if ($('pw-dlg').open) $('pw-dlg').close(); await api.logout(); store.user = null; showLogin(); });
  $('pw-open').addEventListener('click', () => openPw(!!store.user?.must_change_pw));
  $('pw-cancel').addEventListener('click', () => $('pw-dlg').close());
  $('pw-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target, err = $('pw-err'), btn = f.querySelector('button[type=submit]');
    const cur = f.elements.current_password.value, nw = f.elements.new_password.value;
    err.hidden = true;
    if (nw !== f.elements.confirm.value) { err.textContent = 'Hai lần nhập mật khẩu mới không khớp.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await api.post('/v1/auth/password', { current_password: cur, new_password: nw });
      const was = store.user.must_change_pw;
      store.user = await api.get('/v1/auth/me');
      $('pw-dlg').close(); f.reset();
      flash('Đã đổi mật khẩu.' + (was ? ' Bạn đã dùng được đầy đủ quyền của tài khoản.' : ''));
      if (was) await enterApp();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  $('login-open').addEventListener('click', () => { sim?.close(); store.user = null; showLogin(); });
  $('guest-enter').addEventListener('click', async () => { $('login-error').hidden = true; if (!(await enterAsGuest())) showLogin('Máy chủ chưa bật chế độ xem không cần tài khoản.'); });
  // cấu hình bến vừa áp dụng ở tab Cấu hình bến → tải lại ảnh chụp (biên dạng vận tốc cho Live, Dashboard)
  window.addEventListener('pilot:config-activated', (e) => { if (e.detail?.berth === store.berth) loadSnapshot(); });
  $('berth').addEventListener('change', (e) => { store.berth = e.target.value; pref.set('berth', store.berth); for (const p of Object.values(pages)) p.reset?.(); connect(); if (pages[store.tab]) pages[store.tab].show(); });
  document.querySelectorAll('[data-source]').forEach((b) => b.addEventListener('click', () => setSource(b.dataset.source, true)));
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('p-sound').addEventListener('click', toggleSound);
  $('p-full').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : $('tab-pilot').requestFullscreen?.()));
  $('alerts').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-ack]'); if (!b) return;
    b.disabled = true;
    try { await api.post(`/v1/alerts/${b.dataset.ack}/ack`, {}); await refreshAlerts(); } catch (er) { b.disabled = false; b.title = er.message; }
  });
  window.addEventListener('resize', () => schedule(true));
  setInterval(tick, 1000);
}

function flash(text) {
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = text;
  document.body.append(el); setTimeout(() => el.remove(), 5000);
}

function setSource(src, reconnect) {
  store.source = src === 'sim' ? 'sim' : 'live'; pref.set('source', store.source);
  document.querySelectorAll('[data-source]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.source === store.source)));
  $('sim-banner').hidden = store.source !== 'sim';
  if (reconnect) connect();
}
const TABS = ['live', 'dashboard', 'pilot', 'events', 'models', 'shm', 'config', 'gateways', 'kpi', 'users'];
let sim = null;
let diag = null;   // ?diag=1: đo đường truyền trên thiết bị này
const pages = {};
function setTab(t) {
  const lvl = ROLES.indexOf(store.user?.role);
  const allowed = (x) => (x === 'users' ? lvl >= ROLES.indexOf('admin') : !['models', 'shm', 'config', 'gateways'].includes(x) || lvl >= ROLES.indexOf('engineer'));
  const prev = store.tab;
  store.tab = TABS.includes(t) && allowed(t) ? t : 'live'; pref.set('tab', store.tab);
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === store.tab)));
  for (const x of TABS) { const el = $('tab-' + x); if (el) el.hidden = store.tab !== x; }
  if (prev !== store.tab) pages[prev]?.hide?.();
  if (pages[store.tab]) pages[store.tab].show();
  schedule(true);
}

// ------------------------------------------------------------------ số liệu
let stopFn = null, snapTimer = null;
function stopStream() { stopFn?.(); stopFn = null; }

async function connect() {
  stopStream();
  await loadSnapshot();
  stopFn = api.stream(`/v1/stream/berths/${encodeURIComponent(store.berth)}?source=${store.source}`, {
    state: (s, info) => { diag?.state(s); const c = $('conn'); c.dataset.state = s; c.textContent = s === 'on' ? 'Đang nhận số liệu' : s === 'retry' ? (info ?? 'Đang nối lại') : (info ?? 'Ngắt kết nối'); },
    message: onMessage,
  });
}

async function loadSnapshot() {
  try {
    const s = await api.get(`/v1/berths/${encodeURIComponent(store.berth)}/live?source=${store.source}&frames=${MAX_FRAMES}`);
    tw.to = null;
    store.snap = s; store.event = s.event; store.modelAsked = false; store.frames = s.frames; store.alerts = s.alerts; store.gateways = s.gateways;
    if (s.frames.length) store.lastRecv = Date.now();
    schedule(true);
  } catch (e) { console.error(e); }
}
/** Gom nhiều yêu cầu tải lại ảnh chụp thành một (ví dụ khi lượt cập mới bắt đầu). Giới hạn tần suất chứ không hoãn mãi:
 *  khi giả lập nhanh, khung đến mỗi 50 ms, nếu cứ hoãn thì không bao giờ tải lại được. */
function reloadSoon(ms = 800) { if (snapTimer) return; snapTimer = setTimeout(() => { snapTimer = null; loadSnapshot(); }, ms); }

function onMessage(ev, d) {
  if (ev === 'frame') {
    store.lastRecv = Date.now(); diag?.frame(d);
    if (!store.event || d.eventId !== store.event.id) { reloadSoon(300); return; }
    const last = store.frames.at(-1);
    if (last && d.ts <= last.ts) return;
    startTween(shownFrame() ?? last, d);
    store.frames.push(d);
    if (d.fc && !store.event.model_code && !store.modelAsked) { store.modelAsked = true; reloadSoon(1500); }   // mô hình được ghi vào lượt cập sau khung dự báo đầu tiên
    if (store.frames.length > MAX_FRAMES) store.frames.splice(0, store.frames.length - MAX_FRAMES);
    if (d.state === 'Contact' && store.event.status !== 'contact' && !FINAL.includes(store.event.status)) reloadSoon();
    schedule();
  } else if (ev === 'event') {
    if (d.to === 'Tracking') setTimeout(refreshAux, 3000);
    if (store.event && d.code === store.event.code) { store.event.status = { Tracking: 'open', Approach: 'approach', Contact: 'contact', Moored: 'moored', Closed: 'closed', Aborted: 'aborted' }[d.to] ?? store.event.status; }
    reloadSoon(); schedule();
  } else if (ev === 'event-updated') {
    if (store.event && d.id === store.event.id) { Object.assign(store.event, d); schedule(true); }
  } else if (ev === 'alert') { refreshAlerts();
  } else if (ev === 'gateway') {
    const i = store.gateways.findIndex((g) => g.code === d.code); if (i >= 0) store.gateways[i] = d; else store.gateways.push(d); schedule(true);
  } else if (ev === 'server' && d.error === 'SESSION_EXPIRED') { showLogin('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.'); }
}
/** Số liệu phụ (môi trường, Port-SHM, mô hình, FND/DSP đo) đổi chậm: làm mới 20 s/lần khi đang xem Live hoặc Dashboard. */
async function refreshAux() {
  if (!store.snap || !['live', 'dashboard'].includes(store.tab) || document.hidden) return;
  try {
    const s = await api.get(`/v1/berths/${encodeURIComponent(store.berth)}/live?source=${store.source}&frames=1`);
    if (!store.event || s.event?.id !== store.event.id) { if (s.event?.id !== store.event?.id) reloadSoon(100); return; }
    Object.assign(store.snap, { env: s.env, env_series: s.env_series, shm: s.shm, model: s.model });
    for (const k of ['shm_fnd_kn', 'shm_dsp_mm', 'shm_measured_at', 'vessel_name', 'vessel_type', 'loa_m', 'beam_m', 'dwt', 'laden', 'tugs', 'model_code', 'model_version']) store.event[k] = s.event[k];
    store.alerts = s.alerts; schedule(true);
  } catch { /* bỏ qua: lần sau thử lại */ }
}
setInterval(refreshAux, 20_000);

async function refreshAlerts() {
  try { const s = await api.get(`/v1/berths/${encodeURIComponent(store.berth)}/live?source=${store.source}&frames=1`); store.alerts = s.alerts; schedule(true); } catch { /* bỏ qua */ }
}

// ------------------------------------------------------------------ vẽ (gộp theo khung hình, đồ thị tối đa 2 lần/giây)
let dirty = false, heavy = false, lastHeavy = 0;
function schedule(full = false) { heavy ||= full; if (dirty) return; dirty = true; requestAnimationFrame(render); }
function render() {
  dirty = false;
  const now = performance.now(), doHeavy = heavy || now - lastHeavy > 500;
  if (store.tab === 'live') { renderReadouts(); if (doHeavy) { renderPlan(); renderCharts(); renderSide(); lastHeavy = now; heavy = false; } }
  else if (store.tab === 'dashboard') { pages.dashboard?.render(heavy); heavy = false; }
  else if (store.tab === 'pilot') renderPilot();
}
function tick() {   // tuổi số liệu, cảnh báo "số liệu cũ"
  const active = store.event && !FINAL.includes(store.event.status);
  $('stale').hidden = !(active && ['live', 'pilot'].includes(store.tab) && Date.now() - store.lastRecv > STALE_MS);
  if (store.tab === 'pilot') renderPilot();
}

const lastFrame = () => store.frames.at(-1) ?? null;
const lastFc = () => { for (let i = store.frames.length - 1; i >= 0 && i > store.frames.length - 30; i--) if (store.frames[i].fc) return store.frames[i].fc; return null; };
const nearD = (f) => (f ? Math.min(...[f.d1, f.d2].filter((x) => x !== null)) : null);
const maxV = (f) => { const v = f ? [f.v1, f.v2].filter((x) => x !== null) : []; return v.length ? Math.max(...v) : null; };
const vAllow = (d) => { const b = store.snap?.berth; return b && d !== null && Number.isFinite(d) ? b.v_design_cms + 100 * b.envelope_beta * Math.max(0, d) ** b.envelope_gamma : null; };
const tLocal = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { timeZone: store.snap?.berth?.timezone || 'Asia/Ho_Chi_Minh', hour12: false });

function renderReadouts() {
  const f = lastFrame(), fc = lastFc(), d = nearD(f), va = vAllow(d);
  const ro = (l, v, u, s = '', attrs = '') => `<div class="ro" ${attrs}><span class="l">${l}</span><span><span class="v">${v}</span><span class="u">${u}</span></span><span class="s">${s}</span></div>`;
  $('readouts').innerHTML =
    ro('Khoảng cách N1 (đo)', num(f?.d1), 'm', f && f.d1 === null ? 'mất mục tiêu' : '') +
    ro('Khoảng cách N2 (đo)', num(f?.d2), 'm', f && f.d2 === null ? 'mất mục tiêu' : '') +
    ro('Vận tốc tiến vào (đo)', num(maxV(f)), 'cm/s', f?.est ? `ước lượng ${num(f.est.v)} cm/s` : '', `data-led="${f?.led ?? ''}"`) +
    ro('Góc (tính từ N1, N2)', num(f?.angle ?? null, 2), '°', f?.est ? `tốc độ quay ${num(f.est.omega * 60, 2)} °/phút` : '') +
    ro('Vận tốc cho phép', num(va), 'cm/s', 'theo biên dạng tại khoảng cách này') +
    `<div class="ro forecast" data-level="${fc?.level ?? ''}"><span class="l">Mức cảnh báo dự báo</span><span><span class="v">${fc ? LEVEL_VN[fc.level] : '–'}</span></span>` +
    `<span class="s">${fc ? `chạm ${num(fc.vc[1])} cm/s (P10–P90: ${num(fc.vc[0])}–${num(fc.vc[2])})` : 'chưa có dự báo'}</span></div>`;
}

// Tàu trượt mượt: khi có khung mới, sơ đồ chuyển dần từ vị trí đang hiển thị tới khung mới trong khoảng bằng nhịp nhận khung (≈1 s).
const tw = { from: null, to: null, t0: 0, dur: 1000, lastArr: 0, raf: 0 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function startTween(from, to) {
  const now = performance.now();
  tw.dur = tw.lastArr ? Math.min(1500, Math.max(300, now - tw.lastArr)) : 1000; tw.lastArr = now;
  tw.from = from; tw.to = to; tw.t0 = now;
  if (!tw.raf && !reduceMotion.matches) tw.raf = requestAnimationFrame(tweenStep);
}
function shownFrame() {
  if (!tw.to || tw.to !== store.frames.at(-1) || reduceMotion.matches) return store.frames.at(-1) ?? null;
  return lerpFrame(tw.from, tw.to, (performance.now() - tw.t0) / tw.dur);
}
function tweenStep() {
  tw.raf = 0;
  if (store.tab === 'live' && !document.hidden) renderPlan();
  if (tw.to && performance.now() - tw.t0 < tw.dur) tw.raf = requestAnimationFrame(tweenStep);
}

function renderPlan() {
  const e = store.event, b = store.snap?.berth;
  $('empty').hidden = !!(e && store.frames.length);
  const fr = store.frames.slice(-61), sf = shownFrame();
  if (sf && fr.length) fr[fr.length - 1] = sf;
  drawPlan($('plan'), { spacing: b?.brt_spacing_m, fenderDepth: b?.fender_depth_m, loa: e?.loa_m, beam: e?.beam_m ?? (e?.loa_m ? e.loa_m / 6.5 : null), frames: fr,
    bowToward: e?.bow_toward ?? null,
    contact: e?.contact_end ? { end: e.contact_end, angle: e.angle_contact_deg, compression: e.max_compression_m } : null,
    vesselLabel: e ? (e.vessel_name ? `${e.vessel_name}${e.vessel_type ? ' – ' + e.vessel_type : ''}` : 'Chưa gắn tàu') : '' });
}

function renderCharts() {
  drawCharts({ dist: $('c-dist'), vel: $('c-vel'), vc: $('c-vc'), p: $('c-p') }, store.frames, store.snap?.berth ? { ...store.snap.berth } : null);
}

function renderSide() {
  const e = store.event, fc = lastFc(), b = store.snap?.berth;
  if (!e) $('event').innerHTML = '<h2>Không có lượt cập</h2><p class="muted" style="margin:0">Lượt cập mới sẽ hiện ở đây khi BRT bắt được tàu.</p>';
  else {
    const rows = [['Trạng thái', STATUS_VN[e.status] ?? e.status], ['Bắt đầu', tLocal(e.opened_at)],
      ['Tàu', e.vessel_name ? `${e.vessel_name}${e.loa_m ? `, LOA ${num(e.loa_m, 0)} m` : ''}` : 'Chưa gắn tàu'],
      ['Mô hình', e.model_code ? `${e.model_code} ${e.model_version}` : '–']];
    if (e.energy_knm != null) rows.push(['Vận tốc chạm (đo)', `${num(e.v_contact_cms)} cm/s`], ['Năng lượng', `${num(e.energy_knm, 0)} kJ (${num((100 * e.energy_knm) / (b?.fender_rated_energy_kj || 1), 0)} % định mức đệm)`],
      ['Chuyển vị bến ước tính', `${num(e.disp_est_mm)} / ${num(b?.disp_limit_mm, 0)} mm`]);
    else if (fc) rows.push(['Năng lượng dự báo P90', `${num(fc.e[1], 0)} kJ`], ['Chuyển vị dự báo P90', `${num(fc.disp[1])} / ${num(b?.disp_limit_mm, 0)} mm`]);
    const flags = [fc?.vesselAssumed && 'Dự báo đang dùng tàu thiết kế vì lượt cập chưa gắn tàu.', fc?.envMissing && 'Chưa có số liệu gió, dòng chảy; dự báo coi như lặng.',
      fc && !fc.two && 'Chỉ có một BRT: dự báo không dùng góc.'].filter(Boolean);
    $('event').innerHTML = `<h2>${e.code}</h2><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${flags.map((x) => `<div class="flag">${x}</div>`).join('')}`;
  }
  const canAck = ROLES.indexOf(store.user?.role) >= ROLES.indexOf('pilot');
  $('alerts').innerHTML = store.alerts.length ? store.alerts.map((a) => `<li data-level="${a.level}"><span class="t">${LAYER_VN[a.layer] ?? a.layer}: ${esc(a.title)}</span>` +
    `<span class="m">${tLocal(a.opened_at)}${a.ack_at ? ', đã xác nhận' : ''}</span>${canAck && !a.ack_at && a.layer !== 'system' ? `<button data-ack="${a.id}">Xác nhận</button>` : ''}</li>`).join('')
    : '<li class="none">Không có cảnh báo</li>';
  $('gateways').innerHTML = store.gateways.length ? store.gateways.map((g) => {
    const devs = (g.devices ?? []).map((d) => `<span class="dev ${d.online && !d.faults?.length ? '' : 'fault'}">${d.code}${!d.online ? ' mất kết nối' : d.faults?.length ? ' ' + d.faults.join(', ').toLowerCase() : ''}</span>`).join('');
    return `<li><span class="dot ${g.online ? 'on' : ''}"></span><b>${g.code}</b><span class="dev">${g.online ? 'trực tuyến' : 'mất liên lạc'}${g.clock && !g.clock.gnss_lock ? ', đồng hồ chưa khoá GNSS' : ''}</span>${devs}</li>`;
  }).join('') : '<li class="dev">Chưa có gateway</li>';
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ------------------------------------------------------------------ màn hình hoa tiêu
const MSG = { green: 'Trong giới hạn', yellow: 'Gần giới hạn – giảm vận tốc', red: 'Vượt vận tốc cho phép – hãm ngay', white: 'Mất tín hiệu BRT', none: 'Chưa có tàu' };
let audio = null, lastBeep = 0;
function renderPilot() {
  const f = lastFrame(), active = store.event && !FINAL.includes(store.event.status) && f, fc = lastFc();
  const age = store.lastRecv ? Math.round((Date.now() - store.lastRecv) / 1000) : null;
  let level = active ? (f.led ?? 'none') : 'none';
  if (active && store.snap?.berth?.pilot_show_forecast && fc) { const fl = { Caution: 'yellow', Warning: 'red', Critical: 'red' }[fc.level]; if (fl === 'red' || (fl === 'yellow' && level === 'green')) level = fl; }
  if (active && age > 5) level = 'white';
  $('pilot-screen').dataset.level = level;
  const d = active ? nearD(f) : null, va = vAllow(d);
  $('p-d').textContent = num(d); $('p-v').textContent = num(active ? maxV(f) : null); $('p-a').textContent = num(active ? f.angle : null);
  $('p-allow').textContent = va !== null ? `Cho phép ≤ ${num(va)} cm/s tại khoảng cách này` : '';
  $('p-msg').textContent = MSG[level] ?? '';
  $('p-event').textContent = store.event ? `${store.berth} – ${store.event.code}` : store.berth ?? '';
  $('p-age').textContent = active ? (age <= 1 ? 'Đang cập nhật' : `Cập nhật ${age} s trước`) : '';
  if (audio && level === 'red' && Date.now() - lastBeep > 2000) { beep(); lastBeep = Date.now(); }
}
function toggleSound() {
  const b = $('p-sound');
  if (audio) { audio.close(); audio = null; b.setAttribute('aria-pressed', 'false'); b.textContent = 'Bật âm báo'; return; }
  audio = new (window.AudioContext || window.webkitAudioContext)(); beep();
  b.setAttribute('aria-pressed', 'true'); b.textContent = 'Tắt âm báo';
}
function beep() {
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = 880; g.gain.value = 0.2; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.25);
}

// Bộ nhớ đệm khung giao diện (mở được trang khi mạng yếu). Chỉ đăng ký trên HTTPS hoặc máy cục bộ.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* bỏ qua */ });
}

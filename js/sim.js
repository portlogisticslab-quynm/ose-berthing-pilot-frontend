// Nút "Chạy giả lập" (kỹ sư: mọi bến; khách và tài khoản dưới kỹ sư: bến công khai, có giới hạn): chọn số lượt cập, tốc độ; theo dõi tiến độ, dừng. Không cần PowerShell.
import { esc } from './views.js';

const SPEED_VN = { 0: 'nhanh nhất', 1: '1×', 5: '5×', 20: '20×' };

export function simPanel({ api, store, onStarted }) {
  const $ = (id) => document.getElementById(id);
  const pop = $('sim-pop'), btn = $('sim-open');
  let poll = null;

  const ROLES = ['viewer', 'pilot', 'operator', 'engineer', 'admin'];
  const full = () => !store.user?.guest && ROLES.indexOf(store.user?.role) >= ROLES.indexOf('engineer');
  // khách / tài khoản dưới kỹ sư: chỉ bến công khai, tối đa 2 lượt, tốc độ 0/5/20
  function limits() {
    const f = full(), pub = store.user?.public_sim_berths ?? [], form = $('sim-form'), note = $('sim-public');
    form.querySelectorAll('option[data-full]').forEach((o) => { o.hidden = !f; o.disabled = !f; });
    if (!f && Number(form.events.value) > 2) form.events.value = '1';
    if (!f && form.speed.value === '1') form.speed.value = '5';
    const ok = f || pub.includes(store.berth);
    form.querySelector('button[type=submit]').disabled = !ok;
    note.hidden = f;
    note.innerHTML = f ? '' : ok
      ? 'Chế độ không cần tài khoản: tối đa 2 lượt cập, mỗi lúc một lần chạy. Số liệu giả lập không ảnh hưởng số liệu thật.'
      : `Không cần tài khoản thì chạy giả lập ở bến ${pub.map((b) => `<button type="button" class="link" data-goto="${esc(b)}">${esc(b)}</button>`).join(', ')}.`;
  }
  $('sim-public').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    const sel = $('berth'); sel.value = b.dataset.goto; sel.dispatchEvent(new Event('change'));
    $('sim-berth').textContent = store.berth ?? ''; limits(); render();
  });
  const open = () => { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); $('sim-berth').textContent = store.berth ?? ''; limits(); refresh(); };
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (!running) stopPoll(); };
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  $('sim-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) close(); });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close(); });

  $('sim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), b = e.target.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      const j = await api.post('/v1/sim/start', { berth: store.berth, events: Number(fd.get('events')), speed: Number(fd.get('speed')), dropout: fd.get('dropout') ? 1 : 0 });
      msg(`Đã bắt đầu ${j.id}: ${j.refs.join(', ')}.`);
      onStarted?.(j);
      await refresh();
    } catch (er) { msg(er.message, true); }
    finally { b.disabled = false; }
  });
  $('sim-jobs').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-stop]'); if (!b) return;
    b.disabled = true;
    try { await api.post(`/v1/sim/jobs/${encodeURIComponent(b.dataset.stop)}/stop`, {}); await refresh(); } catch (er) { msg(er.message, true); }
  });

  let running = false, note = '';
  function msg(t, bad = false) { note = `<p class="msg ${bad ? "bad" : "ok"}">${esc(t)}</p>`; render(); }
  let last = [];
  function render(jobs = last) {
    last = jobs;
    const mine = jobs.filter((j) => j.berth === store.berth).slice(0, 5);
    $('sim-jobs').innerHTML = note + (mine.length ? `<ul class="list">${mine.map((j) => {
      const pct = j.total ? Math.round((100 * j.sent) / j.total) : 0;
      const st = j.error ? `<span class="bad">lỗi: ${esc(j.error)}</span>` : j.stopped ? 'đã dừng' : j.done ? 'xong' : `đang chạy ${pct} %`;
      return `<li><b>${esc(j.id)}</b> · ${j.events} lượt, ${SPEED_VN[j.speed] ?? j.speed + '×'} · ${st}
        <div class="bar"><i style="width:${pct}%"></i></div><span class="muted">${esc(j.refs.join(', '))}</span>
        ${!j.done && (full() || j.public) ? ` <button class="btn sm" data-stop="${esc(j.id)}">Dừng</button>` : ''}</li>`;
    }).join('')}</ul>` : '');
  }
  async function refresh() {
    try {
      const jobs = await api.get('/v1/sim/jobs');
      running = jobs.some((j) => !j.done);
      render(jobs);
      btn.classList.toggle('on', running);
      btn.textContent = running ? '● Đang giả lập' : '▶ Chạy giả lập';
      if (running || !pop.hidden) startPoll(); else stopPoll();
    } catch { /* bỏ qua: mất mạng tạm thời */ }
  }
  function startPoll() { if (!poll) poll = setInterval(refresh, 2000); }
  function stopPoll() { clearInterval(poll); poll = null; }

  if (!btn.hidden) refresh();
  return { close() { close(); stopPoll(); }, refresh };
}

// Tab "Người dùng" (M7.8, chỉ admin): tạo tài khoản, đổi vai trò / quyền phê duyệt, khoá–mở, đặt lại mật khẩu, đăng xuất mọi phiên.
// Mật khẩu tạm (tạo mới / đặt lại) hiện MỘT lần để admin chuyển cho người dùng qua kênh riêng; người dùng phải đổi ở lần đăng nhập đầu.
import { esc } from './views.js';

const ROLES = ['viewer', 'pilot', 'operator', 'engineer', 'admin'];
const ROLE_VN = { viewer: 'Xem', pilot: 'Hoa tiêu', operator: 'Vận hành', engineer: 'Kỹ sư', admin: 'Quản trị' };
const ROLE_NOTE = {
  viewer: 'xem mọi màn hình công khai',
  pilot: '+ màn hình Hoa tiêu, ý kiến sau lượt cập',
  operator: '+ xác nhận cảnh báo, gắn tàu, đánh giá lượt cập',
  engineer: '+ Mô hình, Port-SHM, Cấu hình bến, Gateway, giả lập mọi bến',
  admin: 'toàn quyền, quản lý người dùng',
};

/** Mật khẩu tạm 16 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/l/I). */
export function tempPassword(n = 16) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-.';
  const r = crypto.getRandomValues(new Uint32Array(n));
  let s = ''; for (const x of r) s += abc[x % abc.length];
  return s;
}

export function usersTab({ api, store, root }) {
  let list = null, msg = '', bad = false, creating = false, secret = null, armed = null;
  const tl = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour12: false }) : '–');
  const say = (m, b = false) => { msg = m; bad = b; render(); };
  const arm = (k) => { armed = k; render(); setTimeout(() => { if (armed === k) { armed = null; render(); } }, 5000); };

  async function load() { list = await api.get('/v1/users'); }

  function secretBox() {
    if (!secret) return '';
    return `<section class="panel secret" role="alert"><h2>Mật khẩu tạm của ${esc(secret.email)}</h2>
      <p class="note">Chỉ hiện <b>một lần</b>. Gửi email đăng nhập và mật khẩu tạm qua <b>hai kênh khác nhau</b> (ví dụ email và Zalo), không gửi chung một tin.
        Người dùng phải đổi mật khẩu ở lần đăng nhập đầu; trước khi đổi chỉ xem được.</p>
      <pre class="key">${esc(secret.pw)}</pre>
      <div class="row"><button class="btn" id="us-copy">Sao chép mật khẩu</button><button class="btn primary" id="us-done">Đã chuyển xong – đóng</button></div></section>`;
  }

  function render() {
    if (!list) { root.innerHTML = '<p class="muted pad">Đang tải…</p>'; return; }
    const me = store.user?.id;
    const nAdmin = list.filter((u) => u.role === 'admin' && u.active).length;
    root.innerHTML = `
      <div class="toolbar"><h2 class="evtitle">Người dùng</h2><span class="muted">${list.filter((u) => u.active).length} đang hoạt động · ${list.length} tài khoản</span><span class="sp"></span>
        <button class="btn" id="us-new">${creating ? 'Đóng' : '+ Thêm người dùng'}</button><button class="btn" id="us-reload">Làm mới</button></div>
      <p class="msg ${bad ? 'bad' : 'ok'}" ${msg ? '' : 'hidden'} role="status">${esc(msg)}</p>
      ${secretBox()}
      ${creating ? `<section class="panel"><h2>Thêm người dùng</h2><form id="us-form" class="formrow" autocomplete="off">
        <label>Email <input name="email" type="email" required size="26" autocomplete="off"></label>
        <label>Họ tên <input name="full_name" size="20" maxlength="80"></label>
        <label>Vai trò <select name="role">${ROLES.map((r) => `<option value="${r}" ${r === 'viewer' ? 'selected' : ''}>${ROLE_VN[r]}</option>`).join('')}</select></label>
        <label class="chk"><span><input type="checkbox" name="can_approve"> Được phê duyệt cấu hình / mô hình</span></label>
        <button class="btn primary" type="submit">Tạo tài khoản</button></form>
        <p class="note" id="us-rolenote">Xem: ${ROLE_NOTE.viewer}.</p>
        <p class="note">Máy chủ tạo mật khẩu tạm ngẫu nhiên và hiện một lần sau khi tạo. Người dùng đổi mật khẩu ở lần đăng nhập đầu.</p></section>` : ''}
      <div class="tblwrap"><table class="tbl gw users"><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Phê duyệt</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th class="r">Phiên</th><th>Thao tác</th></tr></thead><tbody>
      ${list.map((u) => {
        const self = u.id === me, lastAdmin = u.role === 'admin' && u.active && nAdmin <= 1;
        return `<tr data-uid="${u.id}" class="${u.active ? '' : 'off'}">
        <td><b>${esc(u.full_name || '–')}</b>${self ? ' <span class="pill on">bạn</span>' : ''}<br><span class="muted">${esc(u.email)}</span></td>
        <td><select data-role aria-label="Vai trò của ${esc(u.email)}" ${self || lastAdmin ? 'disabled title="Không tự hạ quyền; luôn phải còn một admin"' : ''}>
          ${ROLES.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_VN[r]}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-approve aria-label="Quyền phê duyệt của ${esc(u.email)}" ${u.can_approve ? 'checked' : ''}></td>
        <td>${!u.active ? '<span class="pill bad">Đã khoá</span>' : u.must_change_pw ? '<span class="pill">Chờ đổi mật khẩu tạm</span>' : '<span class="pill on">Hoạt động</span>'}
          ${u.pw_changed_at ? `<br><span class="muted">đổi mật khẩu ${tl(u.pw_changed_at)}</span>` : ''}</td>
        <td>${tl(u.last_login_at)}</td>
        <td class="r">${u.sessions ?? 0}</td>
        <td class="acts">${self ? '<span class="muted">đổi mật khẩu ở nút "Đổi mật khẩu" phía trên</span>' : `
          <button class="btn sm" data-reset>${armed === 'rs:' + u.id ? 'Bấm lần nữa để đặt lại' : 'Đặt lại mật khẩu'}</button>
          <button class="btn sm" data-kick ${u.sessions ? '' : 'disabled'}>Đăng xuất mọi phiên</button>
          <button class="btn sm ${u.active ? 'warn' : ''}" data-active ${lastAdmin ? 'disabled' : ''}>${u.active ? (armed === 'off:' + u.id ? 'Bấm lần nữa để khoá' : 'Khoá') : 'Mở khoá'}</button>`}</td></tr>`;
      }).join('')}
      </tbody></table></div>
      <section class="panel"><h2>Vai trò</h2><dl class="kv">${ROLES.map((r) => `<dt>${ROLE_VN[r]}</dt><dd>${ROLE_NOTE[r]}</dd>`).join('')}</dl>
        <p class="note">Đổi vai trò có hiệu lực ngay ở lần thao tác kế tiếp của người đó. Khoá tài khoản đăng xuất mọi phiên ngay. Mọi thay đổi được ghi nhật ký kiểm toán.
          Không tự hạ quyền hay tự khoá tài khoản đang dùng; hệ thống luôn giữ ít nhất một admin.</p></section>`;
    bind();
  }

  function bind() {
    root.querySelector('#us-reload').onclick = () => refresh(true);
    root.querySelector('#us-new').onclick = () => { creating = !creating; msg = ''; render(); if (creating) root.querySelector('#us-form [name=email]')?.focus(); };
    const f = root.querySelector('#us-form');
    if (f) {
      const rs = f.querySelector('[name=role]'), note = root.querySelector('#us-rolenote');
      rs.onchange = () => { note.textContent = `${ROLE_VN[rs.value]}: ${ROLE_NOTE[rs.value]}.`; };
      f.onsubmit = async (e) => {
        e.preventDefault(); const d = new FormData(f), pw = tempPassword();
        const body = { email: String(d.get('email')).trim(), full_name: String(d.get('full_name') ?? '').trim(), role: d.get('role'), can_approve: d.get('can_approve') === 'on', password: pw };
        f.querySelector('button[type=submit]').disabled = true;
        try { const u = await api.post('/v1/users', body); creating = false; secret = { email: u.email, pw }; await load(); say(`Đã tạo ${u.email} (${ROLE_VN[u.role]}).`); }
        catch (err) { f.querySelector('button[type=submit]').disabled = false; say(err.message, true); }
      };
    }
    if (secret) {
      root.querySelector('#us-copy').onclick = async (e) => { try { await navigator.clipboard.writeText(secret.pw); e.target.textContent = 'Đã sao chép'; } catch { e.target.textContent = 'Không sao chép được – chọn và chép tay'; } };
      root.querySelector('#us-done').onclick = () => { secret = null; render(); };
    }
    root.querySelectorAll('tr[data-uid]').forEach((tr) => {
      const id = Number(tr.dataset.uid), u = list.find((x) => x.id === id);
      const patch = async (body, ok) => {
        try { await api.req('PATCH', `/v1/users/${id}`, body); await load(); say(ok); }
        catch (err) { await load(); say(err.message, true); }
      };
      tr.querySelector('[data-role]').onchange = (e) => patch({ role: e.target.value }, `${u.email}: vai trò ${ROLE_VN[e.target.value]}.`);
      tr.querySelector('[data-approve]').onchange = (e) => patch({ can_approve: e.target.checked }, `${u.email}: ${e.target.checked ? 'được' : 'không còn'} quyền phê duyệt.`);
      const act = tr.querySelector('[data-active]');
      if (act) act.onclick = () => {
        if (u.active && armed !== 'off:' + id) return arm('off:' + id);
        armed = null;
        patch({ active: !u.active }, `${u.email}: ${u.active ? 'đã khoá, mọi phiên đăng nhập bị huỷ' : 'đã mở khoá'}.`);
      };
      const rs = tr.querySelector('[data-reset]');
      if (rs) rs.onclick = async () => {
        if (armed !== 'rs:' + id) return arm('rs:' + id);
        armed = null; const pw = tempPassword();
        try { await api.post(`/v1/users/${id}/password`, { password: pw }); secret = { email: u.email, pw }; await load(); say(`${u.email}: đã đặt lại mật khẩu, mọi phiên bị huỷ.`); }
        catch (err) { say(err.message, true); }
      };
      const kick = tr.querySelector('[data-kick]');
      if (kick) kick.onclick = async () => {
        try { const r = await api.post(`/v1/users/${id}/logout`, {}); await load(); say(`${u.email}: đã huỷ ${r.sessions} phiên đăng nhập.`); }
        catch (err) { say(err.message, true); }
      };
    });
  }

  async function refresh(force = false) {
    try { await load(); } catch (e) { msg = e.message; bad = true; }
    const a = document.activeElement;
    if (force || !(root.contains(a) && ['INPUT', 'SELECT'].includes(a.tagName))) { if (!secret || force) render(); }
  }
  return {
    async show() { await refresh(true); },
    hide() { secret = null; creating = false; msg = ''; },
  };
}

// Gọi API và đọc luồng SSE bằng fetch() (để gửi được header Authorization; EventSource không gửi được header).

/** Địa chỉ API: lấy từ config.js. Chỉ khi chạy trên máy (localhost) mới cho phép đổi bằng ?api=… để thử. */
export function apiBase() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const q = new URLSearchParams(location.search).get('api');
  return (local && q ? q : window.PILOT_CONFIG.apiBase).replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(status, body) { super(body?.error?.message ?? `HTTP ${status}`); this.status = status; this.code = body?.error?.code; this.details = body?.error?.details ?? []; }
}

export class Api {
  constructor(base) {
    this.base = base;
    try { this.token = sessionStorage.getItem('pilot.token'); } catch { this.token = null; }
    this.onUnauthorized = () => {};
    this.onBackup = () => {};          // (true|false): đang / thôi dùng máy dự phòng không biết phiên này
    this.checking = null;
  }
  /**
   * Gặp 401: chưa đăng xuất ngay – có thể chỉ một yêu cầu lạc sang máy khác khi đổi máy chủ.
   * Chờ 3 s rồi hỏi lại /v1/auth/me; chỉ khi vẫn 401 mới coi là hết phiên. Trả về true nếu phiên còn.
   */
  async sessionAlive() {
    if (!this.token) return false;
    this.checking ??= (async () => {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const r = await fetch(this.base + '/v1/auth/me', { headers: { Authorization: 'Bearer ' + this.token }, cache: 'no-store' });
        if (r.status === 401) return false;
        return true;                    // 200, hoặc 503/lỗi mạng (máy chủ đang đổi) – giữ phiên
      } catch { return true; }
    })().finally(() => { setTimeout(() => { this.checking = null; }, 0); });
    return this.checking;
  }
  setToken(t) { this.token = t; try { t ? sessionStorage.setItem('pilot.token', t) : sessionStorage.removeItem('pilot.token'); } catch { /* bỏ qua */ } }

  async req(method, path, body, retried = false) {
    const h = {};
    if (this.token) h.Authorization = 'Bearer ' + this.token;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    let res;
    try { res = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new ApiError(0, { error: { message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' } }); }
    const j = await res.json().catch(() => null);
    if (res.status === 503 && j?.error?.code === 'BACKUP_SESSION') { this.onBackup(true); throw new ApiError(res.status, j); }
    if (res.status === 401 && path !== '/v1/auth/login' && this.token) {
      if (!retried && await this.sessionAlive()) return this.req(method, path, body, true);
      this.onUnauthorized();
    }
    if (!res.ok) throw new ApiError(res.status, j);
    this.onBackup(false);
    return j;
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }

  async login(email, password) { const r = await this.post('/v1/auth/login', { email, password }); this.setToken(r.token); return r; }
  async logout() { try { await this.post('/v1/auth/logout'); } catch { /* bỏ qua */ } this.setToken(null); }

  /**
   * Mở luồng SSE; tự nối lại sau 3 s (hoặc theo "retry:" của máy chủ), gửi Last-Event-ID để nhận bù khung bị lỡ.
   * handlers: { message(event, data, id), state('on'|'retry'|'off', info) }. Trả về hàm dừng.
   */
  stream(path, handlers) {
    let stopped = false, ac = null, lastId = null, retryMs = 3000, lastRx = 0, wake = null;
    // Mất mạng (sự kiện offline) hoặc im lặng quá 45 s (máy chủ gửi ping mỗi 15 s): huỷ luồng để nối lại.
    const onOffline = () => ac?.abort();
    const onOnline = () => wake?.();
    window.addEventListener('offline', onOffline); window.addEventListener('online', onOnline);
    const watchdog = setInterval(() => { if (lastRx && Date.now() - lastRx > 45_000) { lastRx = 0; ac?.abort(); } }, 5000);
    const run = async () => {
      while (!stopped) {
        ac = new AbortController();
        try {
          const h = { Accept: 'text/event-stream' };
          if (this.token) h.Authorization = 'Bearer ' + this.token;
          if (lastId) h['Last-Event-ID'] = lastId;
          const res = await fetch(this.base + path, { headers: h, signal: ac.signal, cache: 'no-store' });
          if (res.status === 401) {
            if (this.token && await this.sessionAlive()) throw new Error('HTTP 401 tạm thời');
            handlers.state('off', 'Phiên đăng nhập hết hạn'); this.onUnauthorized(); return;
          }
          if (res.status === 503) { const j = await res.json().catch(() => null); if (j?.error?.code === 'BACKUP_SESSION') this.onBackup(true); throw new Error('HTTP 503'); }
          if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
          handlers.state('on'); lastRx = Date.now(); this.onBackup(false);
          const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
          for (;;) {
            const { value, done } = await rd.read();
            if (done) break;
            lastRx = Date.now();
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              if (block.startsWith(':')) { handlers.ping?.(); continue; }
              let ev = 'message', id = null, data = '';
              for (const line of block.split('\n')) {
                if (line.startsWith('event: ')) ev = line.slice(7);
                else if (line.startsWith('id: ')) id = line.slice(4);
                else if (line.startsWith('data: ')) data += line.slice(6);
                else if (line.startsWith('retry: ')) retryMs = Number(line.slice(7)) || retryMs;
              }
              if (id) lastId = id;
              if (data) { try { handlers.message(ev, JSON.parse(data), id); } catch (e) { console.error(e); } }
            }
          }
        } catch { if (stopped) return; }
        if (stopped) return;
        handlers.state('retry', navigator.onLine === false ? 'Mất mạng, chờ có mạng lại…' : 'Mất kết nối, đang nối lại…');
        await new Promise((r) => { const t = setTimeout(r, retryMs); wake = () => { clearTimeout(t); r(); }; });
        wake = null;
      }
    };
    run();
    return () => {
      stopped = true; ac?.abort(); clearInterval(watchdog);
      window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline);
      handlers.state('off');
    };
  }
}

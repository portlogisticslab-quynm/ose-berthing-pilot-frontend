// Bộ nhớ đệm khung giao diện để trang mở được khi mạng yếu. KHÔNG lưu số liệu hay phản hồi API.
const CACHE = 'pilot-shell-v4.0.0-m7';
const SHELL = ['./', 'index.html', 'config.js', 'css/app.css', 'js/app.js', 'js/api.js', 'js/charts.js', 'js/plan.js', 'js/views.js', 'js/events.js', 'js/models.js', 'js/kpi.js', 'js/dashboard.js', 'js/anim.js', 'js/sim.js', 'js/shm.js', 'js/gateways.js', 'icons/icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;          // API đi thẳng mạng
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

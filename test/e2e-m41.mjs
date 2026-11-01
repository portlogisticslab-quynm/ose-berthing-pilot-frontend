// Kiểm thử giao diện M4.1 (Playwright): nút "Chạy giả lập" (chỉ kỹ sư), Live trượt mượt, tab Dashboard, hoạt cảnh khung Xem lại.
// Database có thể trống. Dùng: API=… WEB=… EMAIL=… PASSWORD=… OUT=… node test/e2e-m41.mjs
import { chromium } from 'playwright';

const API = process.env.API, WEB = process.env.WEB, OUT = process.env.OUT ?? '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = []; const check = (ok, msg) => { console.log((ok ? 'ĐẠT  ' : 'LỖI  ') + msg); if (!ok) fails.push(msg); };
const api = async (method, p, token, body) => { const r = await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
await page.goto(`${WEB}/?api=${encodeURIComponent(API)}`);
await page.fill('input[name=email]', process.env.EMAIL); await page.fill('input[name=password]', process.env.PASSWORD);
await page.click('button[type=submit]'); await page.waitForSelector('#app:not([hidden])');
const token = await page.evaluate(() => sessionStorage.getItem('pilot.token'));

// ---- tài khoản vận hành không thấy nút giả lập
const email2 = `op${Date.now()}@pilot.test`;
await api('POST', '/v1/users', token, { email: email2, full_name: 'Điều độ', role: 'operator', password: 'Operator-pilot-2026' });
const p2 = await browser.newPage();
await p2.goto(`${WEB}/?api=${encodeURIComponent(API)}`);
await p2.fill('input[name=email]', email2); await p2.fill('input[name=password]', 'Operator-pilot-2026'); await p2.click('button[type=submit]'); await p2.waitForSelector('#app:not([hidden])');
check(await p2.$eval('#sim-open', (b) => b.hidden), 'tài khoản điều độ không thấy nút "Chạy giả lập"');
await p2.close();

// ---- chạy giả lập nhanh nhất 1 lượt (để có lượt đã đóng cho Xem lại)
check(await page.$eval('#sim-open', (b) => !b.hidden), 'tài khoản quản trị thấy nút "Chạy giả lập"');
await page.click('#sim-open');
await page.selectOption('#sim-form select[name=events]', '1'); await page.selectOption('#sim-form select[name=speed]', '0');
await page.click('#sim-form button[type=submit]');
await page.waitForFunction(() => { const el = document.querySelector('#sim-jobs'); return /Đã bắt đầu/.test(el?.textContent ?? '') && /xong/.test(el.querySelector('li')?.textContent ?? ''); }, null, { timeout: 60_000 });
check(true, 'giả lập "nhanh nhất" chạy xong, có tiến độ');
check(await page.$eval('[data-source=sim]', (b) => b.getAttribute('aria-checked')) === 'true', 'tự chuyển nguồn sang Giả lập');

// ---- chạy 20× để xem Live, Dashboard trực tuyến
await page.selectOption('#sim-form select[name=speed]', '20'); await page.click('#sim-form button[type=submit]');
await page.waitForFunction(() => /đang chạy/.test(document.querySelector('#sim-jobs')?.textContent ?? ''));
await page.keyboard.press('Escape');
check(await page.$eval('#sim-open', (b) => b.classList.contains('on')), 'nút đổi thành "Đang giả lập" khi có lần chạy');
await page.click('[data-tab=live]');
const ref = (await api('GET', '/v1/sim/jobs', token)).find((j) => !j.done).refs[0];
await page.waitForFunction((r) => document.querySelector('#event h2')?.textContent === r, ref, { timeout: 30_000 });
check(true, `Live tự chuyển sang lượt cập mới ${ref}`);
await page.waitForFunction(() => /Chú ý|Bình thường|Cảnh báo|Nguy hiểm/.test(document.querySelector('#readouts')?.textContent ?? ''), null, { timeout: 60_000 });
// trượt mượt: chụp nhiều lần sơ đồ trong 1 s, số ảnh khác nhau phải nhiều hơn số khung nhận được
const shots = await page.evaluate(async () => { const cv = document.getElementById('plan'), seen = new Set(); const t = performance.now(); while (performance.now() - t < 1000) { seen.add(cv.toDataURL().length + ':' + cv.toDataURL().slice(-40)); await new Promise((r) => requestAnimationFrame(r)); } return seen.size; });
check(shots >= 10, `sơ đồ Live vẽ lại liên tục (${shots} hình khác nhau trong 1 s)`);
await page.screenshot({ path: `${OUT}/m41-live.png` });

await page.click('[data-tab=dashboard]');
await page.waitForFunction(() => document.querySelectorAll('#db-fc .card').length >= 5, null, { timeout: 30_000 });
const dtxt = await page.textContent('#tab-dashboard');
check(/BRT-N1/.test(dtxt) && /ENV gió/.test(dtxt) && /FND đệm/.test(dtxt) && /DSP bến/.test(dtxt), 'Dashboard có kênh BRT, môi trường, FND, DSP');
check(/Năng lượng cập/.test(dtxt) && /Phản lực đệm/.test(dtxt) && /Chuyển vị bến/.test(dtxt), 'Dashboard có dự báo tại thời điểm chạm');
check(/MAE vận tốc/.test(dtxt) && /Giả thiết|PIANC/.test(dtxt), 'Dashboard có kiểm định mô hình và giả thiết');
const envOk = await page.$eval('#db-ch', (el) => !/Chưa có số liệu môi trường/.test(el.textContent));
check(envOk, 'Dashboard có số liệu gió, dòng chảy của bộ giả lập');
await sleep(1200);
await page.screenshot({ path: `${OUT}/m41-dashboard.png`, fullPage: true });

// dừng lần chạy 20×
await page.click('#sim-open'); await page.click('#sim-jobs button[data-stop]');
await page.waitForFunction(() => /đã dừng/.test(document.querySelector('#sim-jobs')?.textContent ?? ''));
check(true, 'dừng lần giả lập đang chạy');
await page.keyboard.press('Escape');

// ---- Xem lại: hoạt cảnh
await page.click('[data-tab=events]'); await page.waitForSelector('#ev-table');
await page.selectOption('#ev-src', 'sim'); await page.waitForSelector('#ev-table tr[data-id]');
await page.click('#ev-table tr[data-id]:has(.st-closed)'); await page.waitForSelector('#ev-anim-o');
check(await page.$eval('#ev-animwrap', (el) => !el.hidden), 'Xem lại mở mặc định ở chế độ hoạt cảnh');
// tới trước khi chạm ~ 40 khung
const contactIdx = await page.evaluate(() => { const s = document.getElementById('ev-slider'); return Number(s.max); });
await page.$eval('#ev-slider', (s) => { s.value = String(Math.max(0, Number(s.max) * 0.55)); s.dispatchEvent(new Event('input')); });
await sleep(200);
await page.screenshot({ path: `${OUT}/m41-replay-approach.png` });
await page.$eval('#ev-slider', (s) => { s.value = s.max; s.dispatchEvent(new Event('input')); });
await sleep(200);
await page.screenshot({ path: `${OUT}/m41-replay-contact.png` });
// phát: vị trí lẻ (trượt mượt)
await page.$eval('#ev-slider', (s) => { s.value = '10'; s.dispatchEvent(new Event('input')); });
await page.selectOption('#ev-speed', '5'); await page.click('#ev-play'); await sleep(700);
const v = Number(await page.$eval('#ev-slider', (s) => s.value)); await page.click('#ev-play');
check(v > 11 && v % 1 !== 0, `phát lại tăng vị trí liên tục (vị trí ${v.toFixed(2)})`);
await page.click('[data-mode=plan]');
check(await page.$eval('#ev-plan', (el) => !el.hidden) && await page.$eval('#ev-animwrap', (el) => el.hidden), 'chuyển sang Sơ đồ đo');
await page.click('[data-mode=anim]');
check(contactIdx > 100, 'lượt cập có đủ khung');
check(!errors.length, 'không có lỗi JavaScript' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails.length ? `\n${fails.length} phép kiểm LỖI` : '\nTất cả phép kiểm ĐẠT');
process.exit(fails.length ? 1 : 0);

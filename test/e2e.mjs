// Kiểm thử giao diện đầu-cuối bằng Playwright (Chromium):
//   1. đăng nhập; 2. bộ giả lập gửi lượt cập theo thời gian thực; 3. Live cập nhật mỗi giây, có dự báo, có cảnh báo;
//   4. màn hình hoa tiêu; 5. kết nối lại sau khi mất luồng; 6. đăng xuất.
// Dùng: API=http://127.0.0.1:8126 WEB=http://127.0.0.1:5700 EMAIL=… PASSWORD=… SIM_KEY=… node test/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const API = process.env.API, WEB = process.env.WEB, OUT = process.env.OUT ?? '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = []; const check = (ok, msg) => { console.log((ok ? 'ĐẠT  ' : 'LỖI  ') + msg); if (!ok) fails.push(msg); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && !/status of 401|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));   // 401 (thử mật khẩu sai) và mất mạng (thử nối lại) là chủ đích
await page.goto(`${WEB}/?api=${encodeURIComponent(API)}`);
await page.fill('input[name=email]', process.env.EMAIL); await page.fill('input[name=password]', 'sai-mat-khau-123');
await page.click('button[type=submit]'); await page.waitForSelector('#login-error:not([hidden])');
check((await page.textContent('#login-error')).includes('Sai email'), 'đăng nhập sai báo lỗi rõ ràng');
await page.fill('input[name=password]', process.env.PASSWORD); await page.click('button[type=submit]');
await page.waitForSelector('#app:not([hidden])');
await page.click('[data-source=sim]');
await page.waitForFunction(() => document.getElementById('conn').dataset.state === 'on', null, { timeout: 10000 });
check(await page.isVisible('#sim-banner'), 'chế độ giả lập có dải cảnh báo "Giả lập"');

// bộ giả lập thời gian thực (60 s)
const sim = spawn('node', ['sim/gateway-sim.ts', '--url', API, '--events', '1', '--speed', '1', '--seed', process.env.SEED ?? '20261101', '--state', '/tmp/claude-e2e-sim.json'],
  { cwd: process.env.BACKEND, env: { ...process.env, SIM_GATEWAY_KEY: process.env.SIM_KEY, SIM_USER_TOKEN: process.env.SIM_TOKEN }, stdio: 'inherit' });
await sleep(25000);
const a = await page.textContent('#readouts');
await sleep(3000);
const b = await page.textContent('#readouts');
check(a !== b, 'số đo cập nhật theo thời gian thực');
check(/chạm \d/.test(b), 'có dự báo vận tốc chạm P50 và P10–P90');
check(!(await page.isVisible('#empty')), 'sơ đồ mặt bằng có tàu');
check((await page.textContent('#event')).includes('Mẫu'), 'thông tin lượt cập có tàu đã gắn');
await page.screenshot({ path: `${OUT}/live.png`, fullPage: true });

// mất luồng → nối lại
await page.evaluate(() => { window.__drop = true; });
await page.context().setOffline(true); await sleep(4000);
check(['retry', 'off'].includes(await page.$eval('#conn', (e) => e.dataset.state)), 'mất mạng: trạng thái kết nối báo đang nối lại');
await page.context().setOffline(false);
await page.waitForFunction(() => document.getElementById('conn').dataset.state === 'on', null, { timeout: 15000 });
check(true, 'có mạng lại: tự nối lại');

await page.click('[data-tab=pilot]'); await sleep(2500);
const lvl = await page.$eval('#pilot-screen', (e) => e.dataset.level);
check(['green', 'yellow', 'red'].includes(lvl), `màn hình hoa tiêu có màu theo mức LED (${lvl})`);
check(/\d/.test(await page.textContent('#p-d')), 'màn hình hoa tiêu hiện khoảng cách');
await page.screenshot({ path: `${OUT}/pilot.png` });
await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-tab=live]'); await sleep(1500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!overflow, 'màn hình điện thoại không bị tràn ngang');
await page.screenshot({ path: `${OUT}/mobile.png`, fullPage: true });
await page.click('#logout'); await page.waitForSelector('#login:not([hidden])');
check(true, 'đăng xuất về màn hình đăng nhập');
sim.kill();
check(errors.length === 0, 'không có lỗi JavaScript' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails.length ? `\n${fails.length} mục không đạt` : '\nTất cả đạt');
process.exit(fails.length ? 1 : 0);

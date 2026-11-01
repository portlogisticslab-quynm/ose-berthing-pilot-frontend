// Kiểm thử giao diện M4 (Playwright): danh sách lượt cập, xem lại, gắn hướng mũi, đánh giá, xuất CSV, phát lại + so sánh, tách, mô hình, KPI.
// Cần sẵn ít nhất một lượt cập giả lập đã đóng. Dùng: API=… WEB=… EMAIL=… PASSWORD=… OUT=… node test/e2e-m4.mjs
import { chromium } from 'playwright';

const API = process.env.API, WEB = process.env.WEB, OUT = process.env.OUT ?? '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = []; const check = (ok, msg) => { console.log((ok ? 'ĐẠT  ' : 'LỖI  ') + msg); if (!ok) fails.push(msg); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
await page.goto(`${WEB}/?api=${encodeURIComponent(API)}`);
await page.fill('input[name=email]', process.env.EMAIL); await page.fill('input[name=password]', process.env.PASSWORD);
await page.click('button[type=submit]'); await page.waitForSelector('#app:not([hidden])');

await page.click('[data-tab=events]'); await page.waitForSelector('#ev-table');
await page.selectOption('#ev-src', 'sim'); await page.waitForSelector('#ev-table tr[data-id]');
const rows = await page.$$('#ev-table tr[data-id]');
check(rows.length >= 1, `danh sách lượt cập giả lập có ${rows.length} dòng`);
await page.screenshot({ path: `${OUT}/m4-list.png` });
await page.click('#ev-table tr[data-id]:has(.st-closed):not(:has(.pill))'); await page.waitForSelector('#ev-slider');   // lượt cập đã đóng, không phải bản phát lại
check((await page.textContent('#tab-events')).includes('Năng lượng'), 'trang chi tiết có tóm tắt năng lượng');

// thanh thời gian
const n = Number(await page.$eval('#ev-slider', (s) => s.max));
await page.$eval('#ev-slider', (s) => { s.value = String(Math.floor(Number(s.max) / 3)); s.dispatchEvent(new Event('input')); });
const ro1 = await page.textContent('#ev-ro');
await page.click('#ev-play'); await sleep(1500); await page.click('#ev-play');
const ro2 = await page.textContent('#ev-ro');
check(n > 100 && ro1 !== ro2, 'thanh thời gian và nút phát thay đổi thời điểm đang xem');
check(/V chạm dự báo P50/.test(ro2), 'ô số liệu tại thời điểm xem có dự báo');
await page.$eval('#ev-slider', (s) => { s.value = s.max; s.dispatchEvent(new Event('input')); });

// gắn hướng mũi tàu
await page.selectOption('#ev-edit select[name=bow_toward]', 'N1'); await page.click('#ev-edit button[type=submit]');
await page.waitForFunction(() => document.querySelector('#ev-msg')?.textContent.includes('Đã lưu thông tin tàu'));
check((await page.textContent('#tab-events')).includes('Mũi tàu hướng về') && (await page.$eval('#ev-edit select[name=bow_toward]', (s) => s.value)) === 'N1', 'lưu hướng mũi tàu N1');
await page.screenshot({ path: `${OUT}/m4-detail.png`, fullPage: true });

// đánh giá sau cập
await page.selectOption('#ev-review select[name=hard_berthing]', 'false');
await page.fill('#ev-review textarea[name=pilot_feedback]', 'Cập êm, gió nhẹ');
await page.click('#ev-review button[type=submit]');
await page.waitForFunction(() => document.querySelector('#ev-msg')?.textContent.includes('Đã lưu đánh giá'));
check(true, 'lưu đánh giá sau cập');

// xuất CSV
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-dl=csv]')]);
check(dl.suggestedFilename().endsWith('-sim.csv'), `tải hồ sơ CSV (${dl.suggestedFilename()})`);

// phát lại qua engine rồi so sánh
const evCode = (await page.textContent('.evtitle')).trim().split(' ')[0];
await page.selectOption('#rp-speed', '0'); await page.click('#rp-go');
await page.waitForFunction(() => document.querySelector('#ev-msg')?.textContent.includes('Đang phát lại'));
await sleep(9000);
await page.click('#ev-back'); await page.waitForSelector('#ev-table tr[data-id]');
await page.click(`#ev-table tr[data-id]:has-text("${evCode}")`); await page.waitForSelector('#ev-slider');
const cmpBtn = await page.$('[data-compare]');
check(!!cmpBtn, 'lượt cập có bản phát lại');
if (cmpBtn) { await cmpBtn.click(); await page.waitForSelector('#rp-compare table'); check((await page.$$('#rp-compare tbody tr')).length === 11, 'bảng so sánh 11 mốc khoảng cách'); }

// tách tại thời điểm giữa (bấm hai lần)
await page.$eval('#ev-slider', (s) => { s.value = String(Math.floor(Number(s.max) / 2)); s.dispatchEvent(new Event('input')); });
await page.click('[data-confirm=split]'); await page.click('[data-confirm=split]');
await page.waitForFunction(() => document.querySelector('#ev-msg')?.textContent.includes('Đã tách'));
check(true, 'tách lượt cập tại thời điểm đang xem');

// mô hình, KPI
await page.click('[data-tab=models]'); await page.waitForSelector('#md-table tr[data-id]');
await page.click('#md-table tr[data-id]'); await page.waitForSelector('#tab-models table.tbl.sm');
check((await page.textContent('#tab-models')).includes('Sai số V chạm'), 'xem chỉ số kiểm định của mô hình');
await page.screenshot({ path: `${OUT}/m4-models.png`, fullPage: true });
await page.click('[data-tab=kpi]'); await page.selectOption('#k-src', 'sim'); await page.click('#k-go');
check(await page.waitForFunction(() => /\d{4}-\d{2}/.test(document.querySelector('#tab-kpi tbody')?.textContent ?? ''), null, { timeout: 8000 }).then(() => true, () => false), 'bảng KPI có dòng theo tháng');
await page.screenshot({ path: `${OUT}/m4-kpi.png`, fullPage: true });

// sơ đồ Live có hàng đệm, mép bến
await page.click('[data-tab=live]'); await sleep(800);
await page.screenshot({ path: `${OUT}/m4-live.png` });
check(errors.length === 0, 'không có lỗi JavaScript' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails.length ? `\n${fails.length} mục không đạt` : '\nTất cả đạt');
process.exit(fails.length ? 1 : 0);

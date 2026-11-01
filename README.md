# ose-berthing-pilot-frontend – Berthing AI Pilot 4.0 (mốc M7)

Giao diện tĩnh (HTML, CSS, JavaScript mô-đun, không cần bước build), triển khai lên Cloudflare Pages tại `pilot-berthingai.ose.vn`.

| Màn hình | Nội dung |
|---|---|
| **Live Berthing** | Sơ đồ mặt bằng tàu – mép bến với tia đo N1, N2; số đo, góc tính ra, vận tốc ước lượng Kalman, vận tốc cho phép; đồ thị khoảng cách theo thời gian, vận tốc theo khoảng cách (kèm biên dạng), vận tốc khi chạm dự báo (P10–P90), xác suất vượt chuyển vị; thông tin lượt cập; cảnh báo (xác nhận được từ vai trò pilot); tình trạng gateway và BRT |
| **Dashboard** | Kênh đo trực tuyến (BRT-N1, N2 khoảng cách và vận tốc, góc, gió, dòng chảy, sóng, mực nước; FND, DSP đo lấy từ Port-SHM: lớn nhất sau khi chạm, hoặc số đo mới nhất của công trình); dự báo tại thời điểm chạm (vận tốc P50 [P10–P90], góc, năng lượng % Er, phản lực, chuyển vị, mức cảnh báo); đồ thị vận tốc – khoảng cách kèm dải dự báo khi chạm, xác suất vượt theo thời gian (4 tiêu chí), đường đặc trưng đệm với điểm dự báo P50/P90 và điểm thực tế; nhật ký đổi mức cảnh báo; so sánh dự báo – thực tế tại 200/100/50/20/5 m; bảng kiểm định mô hình; giả thiết tính toán |
| **Lượt cập** | Danh sách theo nguồn (thật, giả lập, phát lại) và ngày; xem lại bằng **hoạt cảnh** (chuyển từ 3.6.5: toàn cảnh + phóng to quanh điểm chạm, vị trí chạm dự báo P50/P90, vết mỗi 60 s, tàu lai, màu thân theo mức cảnh báo, đệm co lại và khung kết quả khi chạm, la bàn gió/dòng) hoặc **sơ đồ đo**; tàu trượt mượt giữa các khung; thanh thời gian và nút phát 1×–60×; sơ đồ có hàng đệm, mép bến, hướng mũi, điểm chạm đầu tiên; gắn tàu, hướng mũi, mạn cập, mớn nước, tàu lai; đóng, huỷ, tách tại thời điểm đang xem, gộp (bấm hai lần để xác nhận); đánh giá sau cập; xuất CSV, JSON; phát lại qua engine với mô hình khác và so sánh |
| **Port-SHM** (kỹ sư) | Trạng thái tích hợp Port-SHM 0.4.2 (địa chỉ, khoá đã đặt, lần gửi được và lỗi gần nhất), hàng đợi gửi đi theo loại (dự báo, kết quả chạm, cảm biến ảo) và trạng thái, mã công trình và cảm biến ảo của từng bến, nút "Kiểm tra kết nối" (đọc môi trường, FND, DSP), "Gửi lại" bản tin lỗi, hướng dẫn cài đặt lần đầu |
| **Gateway** (kỹ sư xem, quản trị thao tác) | Trạng thái từng gateway theo nhịp sống (trực tuyến, thiết bị, hàng đợi, đồng hồ GNSS, LED, khung bị từ chối 24 h); nhịp sống gần nhất (mạng, nguồn, máy, nhật ký LED nguồn cục bộ/máy chủ) và khung bị từ chối; tạo gateway, đổi khoá, bật/tắt, chế độ LED (tắt / cục bộ / theo máy chủ), cấp khoá ký lệnh LED. Khoá chỉ hiện một lần, có nút **Tải tệp khoá** để chép sang máy gateway |
| **Mô hình** (kỹ sư) | Các phiên bản, chỉ số kiểm định theo mốc khoảng cách (2 BRT, 1 BRT), huấn luyện mô hình cơ sở, phê duyệt, áp dụng cho bến |
| **KPI** | Theo tháng: lượt cập, đủ số liệu, vận tốc và năng lượng cập, LED đỏ, dự báo cảnh báo, phát hiện, báo nhầm, thời gian báo trước, độ trễ P50/P95 |
| **Hoa tiêu** | Ba số lớn (khoảng cách nhỏ nhất, vận tốc, góc), màu nền theo LED tại bến, vận tốc cho phép, âm báo khi đỏ, toàn màn hình. Chỉ hiện mức dự báo khi bến bật `pilot_show_forecast` |

**Chạy giả lập** (nút tím trên thanh trên, chỉ kỹ sư và quản trị thấy): chọn 1–5 lượt cập, tốc độ 1×, 5×, 20× hoặc nhanh nhất, có/không đoạn mất tín hiệu N2; xem tiến độ, dừng. Bắt đầu xong tự chuyển nguồn sang "Giả lập". Không cần PowerShell.

Ở Live, sơ đồ chuyển dần từ vị trí cũ sang khung mới trong khoảng bằng nhịp nhận khung, nên tàu trượt liên tục thay vì nhảy mỗi giây. Thân tàu vẽ theo dạng 3.6.5: mạn phẳng phủ cả hai BRT, mũi nhọn, đuôi vuốt cong nên không cắt tuyến mặt đệm.

Quy ước: **đo** là số đọc cảm biến; góc **tính** từ hai khoảng cách; **ước lượng** là kết quả Kalman; **dự báo** kèm khoảng P10–P90 và mã mô hình. Số liệu giả lập có dải tím "GIẢ LẬP"; quá 3 s không có khung mới thì hiện "SỐ LIỆU CŨ"; màn hình hoa tiêu chuyển xám khi quá 5 s.

## Cấu hình

`config.js`: `apiBase` – địa chỉ API (`https://api-pilot-berthingai.ose.vn`). Khi chạy trên máy (`localhost`, `127.0.0.1`) có thể đổi tạm bằng `?api=http://127.0.0.1:8026`.
Backend phải có địa chỉ trang trong `ALLOWED_ORIGINS`.

## Chạy thử trên máy

```bash
python3 -m http.server 5700 --bind 127.0.0.1        # hoặc: docker run --rm -p 5700:80 -v "$PWD":/usr/share/nginx/html:ro nginx:alpine
# mở http://127.0.0.1:5700/?api=http://127.0.0.1:8026
```

## Kiểm thử đầu-cuối (Playwright)

```bash
API=http://127.0.0.1:8026 WEB=http://127.0.0.1:5700 EMAIL=... PASSWORD=... SIM_KEY=<khoá GW-B01-9> SIM_TOKEN=<token> \
BACKEND=../ose-berthing-pilot-backend node test/e2e.mjs
```

`test/e2e.mjs` – 13 phép kiểm: đăng nhập sai/đúng, dải giả lập, số đo cập nhật mỗi giây, có dự báo, sơ đồ có tàu, tàu đã gắn, mất mạng → báo nối lại → tự nối lại, màn hình hoa tiêu, điện thoại không tràn ngang, đăng xuất, không lỗi JavaScript.

## Bảo mật

- Token đăng nhập giữ trong `sessionStorage` (mất khi đóng thẻ). Không lưu khoá gateway hay mật khẩu.
- `_headers` đặt CSP chỉ cho phép script của chính trang và kết nối tới API pilot.
- Service worker chỉ lưu khung giao diện, không lưu phản hồi API.

`test/e2e-m4.mjs` – 13 phép kiểm cho tab Lượt cập, Mô hình, KPI (cần sẵn ít nhất một lượt cập giả lập đã đóng):

```bash
API=http://127.0.0.1:8026 WEB=http://127.0.0.1:5700 EMAIL=... PASSWORD=... node test/e2e-m4.mjs
```

`test/e2e-m41.mjs` – 17 phép kiểm: nút giả lập chỉ hiện với kỹ sư, chạy nhanh nhất và 20×, Live tự chuyển lượt cập mới, sơ đồ vẽ liên tục, Dashboard đủ các phần, dừng giả lập, hoạt cảnh Xem lại, phát với vị trí lẻ, đổi Sơ đồ đo, không lỗi JavaScript. Database có thể trống:

```bash
API=http://127.0.0.1:8026 WEB=http://127.0.0.1:5700 EMAIL=... PASSWORD=... node test/e2e-m41.mjs
```

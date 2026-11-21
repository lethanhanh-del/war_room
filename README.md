# CTGwarroom — Dashboard War Room

Dashboard điều hành War Room của CT Group, chạy trên **Cloudflare Workers**. Mỗi lần push lên `main`, Cloudflare tự build và deploy.

| Trang | Nội dung |
|---|---|
| `/` | **Tiến độ dòng tiền**: đọc từ dự án WAR ROOM trên CT Worksuite và từ file Excel "Nhập task" đã nạp, gồm PIC, % tiến độ và task của từng người. Có giao diện tối/sáng và màn hình TV (`/?tv=1`). |
| `/war-room` | Bảng War Room cũ, nạp dữ liệu từ file Excel |
| `/lich` | Đặt lịch họp với Chủ tịch (D1) |
| `/admin` | Quản trị tài khoản và nhật ký (chỉ tài khoản `admin`) |

Mọi trang đều phải đăng nhập. Mỗi người có một tài khoản trong D1; tài khoản `admin` dùng mật khẩu `ACCESS_PASSWORD`.

## Dữ liệu từ CT Worksuite

Code nằm ở `src/worksuite/`. API `GET /api/streams` giữ kết quả 60 giây. Nếu Worksuite lỗi, dashboard giữ số liệu lần đọc trước và hiện thông báo lỗi. `/?demo=1` hiển thị dữ liệu mẫu, có ghi rõ là số liệu giả định.

| Trên Worksuite (dự án **WAR ROOM**, `PROJ-0536`) | Trên dashboard |
|---|---|
| Task cấp cao nhất có tiêu đề `Dòng tiền …` | 1 dòng tiền (thẻ) |
| Người thực hiện của task đó | PIC |
| Task con (mọi cấp) bên dưới | Task của từng người, gom theo người thực hiện |
| Open / In Progress / Pending / In Review / Overdue / Completed | Chưa bắt đầu / Đang làm / Đang chờ (kèm lý do) / Chờ duyệt / Quá hạn / Hoàn thành |
| Task cấp cao khác (vd "Nhóm hỗ trợ") | Liệt kê riêng ở cuối trang |

## Nạp task từ file Excel

Nút **Nạp task Excel** ở góc trên trang `/` cho phép đưa task từ file mẫu "Nhập task & theo dõi" của từng dòng tiền lên dashboard (vd `DONG_TIEN_2_BANKING_Template….xlsx`, sheet `01_NHAP_TASK`). Mọi tài khoản đã đăng nhập đều dùng được. Mỗi lần nạp hoặc gỡ được ghi vào nhật ký.

1. Chọn file `.xlsx` (tối đa 5 MB). Dashboard hiện bản xem trước: số task theo trạng thái, các task chưa đạt nguyên tắc War Room, và dòng tiền sẽ gắn vào.
2. Dòng tiền được tự nhận theo tiêu đề file (`DÒNG TIỀN 2: BANKING` ↔ task "Dòng tiền Banking" trên Worksuite). Có thể chọn lại, hoặc để thành thẻ dòng tiền riêng.
3. Bấm **Đưa lên dashboard**. Nạp lại file của cùng dòng tiền sẽ thay toàn bộ task Excel cũ của dòng tiền đó. Có thể gỡ trong cùng hộp thoại.

Cách đọc file (`src/excel/`):
- Cột được nhận theo **tiêu đề**, không theo vị trí: Mã task, Dòng tiền (nhóm con), Nội dung nhiệm vụ (bắt buộc), Người phụ trách, Deadline, Trạng thái, % thực hiện, Sản phẩm / bằng chứng, Điểm nghẽn, Bước tiếp theo, Ưu tiên, Link hồ sơ, Hiển thị LED, Ghi chú. Dòng không có nội dung, hoặc "Hiển thị LED" = Không, được bỏ qua.
- Trạng thái: Hoàn thành → Hoàn thành; Đang xử lý → Đang làm; Vướng mắc / Chờ hồ sơ / Chờ hoàn thiện → Đang chờ; Chờ duyệt → Chờ duyệt; Chưa cập nhật → Chưa bắt đầu. Quá deadline mà chưa xong → Quá hạn. Dashboard vẫn hiện đúng chữ trong file.
- Người phụ trách được tra trong danh sách tài khoản (bảng `users`, đồng bộ từ file nhân sự War Room) để lấy họ tên đầy đủ và chức danh: "Chị Thúy Hiền" → "Mạc Thị Thúy Hiền · Trưởng Phòng Đối ngoại". Người trùng với PIC trên Worksuite được gộp làm một.
- Task được đánh dấu khi chưa đạt nguyên tắc War Room (văn bản chỉ đạo của Chủ tịch): chưa có **1 người** chịu trách nhiệm (ghi phòng ban hoặc nhiều người), thiếu deadline, hạn **vượt thời hạn War Room**, chưa có tiêu chí đầu ra, đang chờ mà chưa có bước xử lý tiếp, hoàn thành mà chưa có link bằng chứng. Vẫn nạp được, chỉ đánh dấu để PIC chuẩn hoá.

Task Excel lưu trong D1 (bảng `excel_imports`), không ghi ngược lên Worksuite. Tính năng chỉ có trên Worker, không có trên bản Express.

## Cấu hình trên Cloudflare

Vào Worker **ctgwarroom** › **Settings** › **Variables and Secrets** › **Add**. Chọn loại **Secret**, không chọn Text: biến loại Text có thể bị xoá mỗi lần deploy.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `ACCESS_PASSWORD` | ✔ | Mật khẩu tài khoản `admin` |
| `WORKSUITE_USERNAME`, `WORKSUITE_PASSWORD` | ✔ (hoặc API key) | Tài khoản Worksuite chỉ có quyền xem, không bật OTP. Sai mật khẩu thì hệ thống ngừng thử 10 phút để tài khoản không bị khoá. |
| `WORKSUITE_API_KEY`, `WORKSUITE_API_SECRET` | | Dùng thay tài khoản nếu có. Nếu có cả hai, ưu tiên API key. |
| `WORKSUITE_PROJECT` | | Mặc định tự tìm dự án tên "WAR ROOM". Có thể cố định bằng `PROJ-0536`. |
| `WORKSUITE_URL` | | Mặc định `https://cterp.ctgrouphitech.com/worksuite` |
| `WARROOM_START`, `WARROOM_END` | | Thời hạn War Room (`YYYY-MM-DD`), dùng để đánh dấu task có hạn vượt thời hạn. Mặc định `2026-11-21` → `2026-11-25` (theo lịch trực trong file nhân sự). |

Cũng có thể đặt bằng lệnh: `npx wrangler secret put WORKSUITE_PASSWORD`.

Sau khi deploy, góc trên trang chủ cho biết trạng thái kết nối:
- "Đã đồng bộ Worksuite": kết nối được.
- "Chưa kết nối": thiếu Secret.
- "Đăng nhập Worksuite thất bại": sai email hoặc mật khẩu.
- "Không kết nối được Worksuite": máy chủ Worksuite chặn Cloudflare.

## Chạy thử trên máy

```bash
npm install
cp .dev.vars.example .dev.vars   # rồi điền ACCESS_PASSWORD và tài khoản Worksuite
npm run dev                      # http://127.0.0.1:8787, đăng nhập: admin / ACCESS_PASSWORD
npm test
```

`npm run dev` chạy đúng Worker như trên Cloudflare, gồm cả D1 và trang đăng nhập, nhưng dữ liệu D1 chỉ nằm trên máy (`.wrangler/`). Lệnh dùng `--compatibility-date=2026-11-11` vì bản wrangler cố định trong dự án chưa hỗ trợ ngày `2026-11-21` ghi trong `wrangler.jsonc`.

**Không commit** `.dev.vars` và `.env`; cả hai đã có trong `.gitignore`.

## Cấu trúc

- `src/index.js`: Worker (đăng nhập, định tuyến, chèn nút "Đặt lịch Chủ tịch")
- `src/auth.js`, `src/db.js`, `src/admin.js`, `src/pages.js`: tài khoản, D1, quản trị
- `src/bookings.js`: lịch Chủ tịch
- `src/worksuite/`: `client.js` gọi API Worksuite, `model.js` tính số liệu dashboard, `demo.js` dữ liệu mẫu
- `src/excel/`: `xlsx.js` đọc file .xlsx (không cần thư viện), `tasks.js` đọc bảng task, `merge.js` gắn task vào dòng tiền và kiểm nguyên tắc War Room, `index.js` API `/api/excel` + D1
- `public/index.html`, `dong-tien.css`, `dong-tien.js`: trang Tiến độ dòng tiền
- `public/war-room.html`, `lich.html`, `admin.html`: các trang còn lại
- `test/`: `node --test`

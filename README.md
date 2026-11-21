# CTGwarroom — Dashboard War Room

Dashboard điều hành War Room của CT Group, chạy trên **Cloudflare Workers**. Mỗi lần push lên `main`, Cloudflare tự build và deploy.

| Trang | Nội dung |
|---|---|
| `/` | **Tiến độ dòng tiền**: mỗi dòng tiền hiện sẵn 4 chỉ số (task hiện có · đang thực hiện · đã hoàn thành · quá hạn), bảng nhóm (PIC, nhiệm vụ chính, nhiệm vụ từng thành viên) và bảng task (Nhóm · Nhiệm vụ · PIC · Tiến độ · Trạng thái). Task tự đồng bộ từ Google Sheet **WR - MASTER TASK**; nhóm lấy từ file phân chia nhiệm vụ. Có giao diện tối/sáng và màn hình TV (`/?tv=1`). |
| `/war-room` | Bảng War Room live: dữ liệu chung trên máy chủ, cập nhật thời gian thực, ai đang online (`src/live.js`) |
| `/lich` | Hẹn lịch BOD (D1) |
| `/admin` | Quản trị tài khoản và nhật ký (chỉ tài khoản `admin`) |

Mọi trang đều phải đăng nhập. Mỗi người có một tài khoản trong D1; tài khoản `admin` dùng mật khẩu `ACCESS_PASSWORD`.

## Không còn kết nối CT Worksuite

Từ 21/11/2026 dashboard **không kết nối CT Worksuite** nữa (kể cả khi có đặt tài khoản): `GET /api/streams` dựng thẻ dòng tiền và task chỉ từ Google Sheet WR - MASTER TASK, file Excel và file phân chia nhóm đã nạp (`sheetOnlyBase()` trong `src/excel/index.js`). `src/worksuite/model.js` vẫn được dùng để tính trạng thái, % và tổng hợp; `client.js`, `index.js`, `demo.js` trong `src/worksuite/` không còn được gọi.

## Nạp file Excel: phân chia nhóm, hoặc task nạp tay

Task chính lấy từ Google Sheet WR - MASTER TASK (tự đồng bộ, xem mục dưới). Nút **Nạp task Excel** ở góc trên trang `/` dùng để:

- **Nạp file phân chia nhiệm vụ** (vd `WarRoom_CTHomes_Final_20.11.2026.xlsx`, sheet “DS nhân sự War-Room”: Dòng tiền · Thành viên · Chức danh · Phòng ban · Đội trưởng/Đội phó · Nhiệm vụ thực hiện). Dashboard tự nhận ra đây là file phân chia. Trong mỗi dòng tiền, mỗi “Đội trưởng / Trưởng nhóm” mở 1 nhóm và là PIC của nhóm; nhiệm vụ chính = “Nhiệm vụ thực hiện” các thành viên cùng làm (mỗi người một việc thì ghi “Mỗi người một nhiệm vụ” và hiện việc của từng người). Cùng dòng tiền ở sheet khác (vd “Nhóm hỗ trợ”) được gộp vào. Nạp lại sẽ thay toàn bộ phân chia cũ (bảng `excel_teams`); dòng tiền chưa có thẻ thì tạo thẻ mới; “Cố vấn, chỉ đạo” và các nhóm hỗ trợ (IT, hậu cần…) không tạo thẻ. Gỡ trong cùng hộp thoại.
- **Nạp tay file task** `.xlsx` khi cần: file tổng WR - MASTER TASK, hoặc file "Nhập task & theo dõi" của 1 dòng tiền (vd `DONG_TIEN_2_BANKING_Template….xlsx`, sheet `01_NHAP_TASK`). Xem trước rồi bấm **Đưa lên dashboard**.

Mọi tài khoản đã đăng nhập đều dùng được, mỗi thao tác được ghi vào nhật ký.

Cách đọc file (`src/excel/`):
- Cột được nhận theo **tiêu đề**, không theo vị trí. File tổng: STT, Dòng tiền, Nhóm công việc, Task / Đầu việc, Người phụ trách, Người phối hợp, Hạn hoàn thành, Trạng thái, Ưu tiên, Đầu ra cần có, Điểm nghẽn / Cần hỗ trợ. File 1 dòng tiền có thêm: Mã task, % thực hiện, Bước tiếp theo, Link hồ sơ, Hiển thị LED, Ghi chú. Chỉ cột nhiệm vụ là bắt buộc; dòng không có nội dung, hoặc "Hiển thị LED" = Không, được bỏ qua. Sheet ẩn (vd `DataValidation`) không được đọc.
- Sheet “Dòng tiền …” bị đổi tên vài ô tiêu đề (vd Google Sheets tự đặt “Cột 4”) nhưng các cột vẫn đúng thứ tự file mẫu A–K: vẫn đọc theo thứ tự đó và cảnh báo để sửa. Số dòng tiền lấy từ cột “Dòng tiền” (“Dòng tiền 2: Banking” → DT02).
- Worker gói Free chỉ có ~10 ms CPU mỗi request, nên bộ đọc .xlsx giải nén từng đoạn và dừng sớm (bỏ qua sheet ẩn, dừng sau 300 dòng trống liên tiếp, chỉ đọc phần bảng chữ cần dùng): file WR - MASTER TASK tải về đọc mất khoảng 3–5 ms.
- Trạng thái: Hoàn thành → Hoàn thành; Đang xử lý → Đang làm; Vướng mắc / Chờ hồ sơ / Chờ hoàn thiện → Đang chờ; Chờ duyệt → Chờ duyệt; Chưa cập nhật → Chưa bắt đầu. Quá deadline mà chưa xong → Quá hạn. Dashboard vẫn hiện đúng chữ trong file.
- Người phụ trách được tra trong danh sách tài khoản (bảng `users`, đồng bộ từ file nhân sự War Room) để lấy họ tên đầy đủ và chức danh: "Chị Thúy Hiền" → "Mạc Thị Thúy Hiền · Trưởng Phòng Đối ngoại". Người trùng với PIC của dòng tiền được gộp làm một.
- Task được đánh dấu khi chưa đạt nguyên tắc War Room (văn bản chỉ đạo của Chủ tịch): chưa có **1 người** chịu trách nhiệm (ghi phòng ban hoặc nhiều người), thiếu deadline, hạn **vượt thời hạn War Room**, chưa có tiêu chí đầu ra; với file có cột tương ứng: đang chờ mà chưa có bước xử lý tiếp, hoàn thành mà chưa có link bằng chứng. Vẫn nạp được, chỉ đánh dấu để PIC chuẩn hoá.

Task lưu trong D1 (bảng `excel_imports`), nhóm trong `excel_teams`; không ghi ngược lên sheet. Tính năng chỉ có trên Worker, không có trên bản Express.

### Tự đồng bộ từ Google Sheet "WR - MASTER TASK"

Không cần nạp tay: Worker tự đọc Google Sheet [WR - MASTER TASK](https://docs.google.com/spreadsheets/d/1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0/edit) mỗi phút (Cron Trigger) và mỗi 20 giây khi có người đang xem trang `/`. Sửa trên Sheet → dashboard cập nhật sau khoảng 20–60 giây, mọi màn hình tự tải lại.

- Sheet phải chia sẻ **"Bất kỳ ai có đường liên kết" – Người xem** (Worker đọc không cần tài khoản Google). Mỗi sheet tên "Dòng tiền …" là 1 thẻ dòng tiền (kể cả sheet chưa có task), đọc theo đúng quy tắc của Nạp task Excel ở trên. Số dòng tiền lấy từ cột "Dòng tiền" (`Dòng tiền 2: Banking` → thẻ **DT02**), thẻ xếp theo số.
- Sheet là nguồn chính (không dùng Worksuite): task nạp tay từ file tổng của cùng dòng tiền bị thay bằng dữ liệu Sheet; sheet trống hoặc hỏng dòng tiêu đề → thẻ 0 task kèm cảnh báo. File riêng của dòng tiền khác không bị đụng tới.
- PIC của dòng tiền: ghi 1 ô `PIC phụ trách: Họ tên` phía trên dòng tiêu đề của sheet (chèn thêm 1 dòng trên bảng).
- Trạng thái (lần đọc gần nhất, lỗi, cảnh báo như "sheet không có dòng tiêu đề hợp lệ") có trong trường `sheetSync` của `/api/streams`; `POST /api/excel/sync` đồng bộ ngay.
- Đổi sang Sheet khác: biến `EXCEL_SHEET_URL` (link hoặc ID); `off` để tắt. Mã nguồn: `src/excel/gsheet.js` (đọc Sheet), `src/excel/sheet-sync.js` (đồng bộ).

## Cấu hình trên Cloudflare

Vào Worker **ctgwarroom** › **Settings** › **Variables and Secrets** › **Add**. Chọn loại **Secret**, không chọn Text: biến loại Text có thể bị xoá mỗi lần deploy.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `ACCESS_PASSWORD` | ✔ | Mật khẩu tài khoản `admin` |
| `WARROOM_START`, `WARROOM_END` | | Thời hạn War Room (`YYYY-MM-DD`), dùng để đánh dấu task có hạn vượt thời hạn. Mặc định `2026-11-21` → `2026-11-25` (theo lịch trực trong file nhân sự). |

Cũng có thể đặt bằng lệnh: `npx wrangler secret put ACCESS_PASSWORD`. Các biến `WORKSUITE_*` không còn dùng; có thể xoá khỏi Cloudflare nếu đã đặt.

Sau khi deploy, góc trên trang chủ cho biết lần đọc Google Sheet gần nhất ("Google Sheet WR - MASTER TASK · cập nhật HH:MM"); đọc lỗi thì có cảnh báo ở đầu trang.

## Chạy thử trên máy

```bash
npm install
cp .dev.vars.example .dev.vars   # rồi điền ACCESS_PASSWORD
npm run dev                      # http://127.0.0.1:8787, đăng nhập: admin / ACCESS_PASSWORD
npm test
```

`npm run dev` chạy đúng Worker như trên Cloudflare, gồm cả D1 và trang đăng nhập, nhưng dữ liệu D1 chỉ nằm trên máy (`.wrangler/`). Lệnh dùng `--compatibility-date=2026-11-11` vì bản wrangler cố định trong dự án chưa hỗ trợ ngày `2026-11-21` ghi trong `wrangler.jsonc`.

**Không commit** `.dev.vars` và `.env`; cả hai đã có trong `.gitignore`.

## Cấu trúc

- `src/index.js`: Worker (đăng nhập, định tuyến, chèn nút "Hẹn lịch BOD")
- `src/auth.js`, `src/db.js`, `src/admin.js`, `src/pages.js`: tài khoản, D1, quản trị
- `src/bookings.js`: lịch Chủ tịch
- `src/worksuite/model.js`: tính trạng thái, % và số liệu dashboard (phần gọi API Worksuite không còn dùng)
- `src/excel/`: `xlsx.js` đọc file .xlsx (không cần thư viện, dừng sớm cho vừa giới hạn CPU), `tasks.js` đọc bảng task, `merge.js` gắn task vào dòng tiền và kiểm nguyên tắc War Room, `roster.js` đọc file phân chia nhiệm vụ (nhóm, PIC), `gsheet.js` + `sheet-sync.js` tự đồng bộ Google Sheet, `index.js` API `/api/excel` + D1
- `public/index.html`, `dong-tien.css`, `dong-tien.js`: trang Tiến độ dòng tiền
- `public/war-room.html`, `lich.html`, `admin.html`: các trang còn lại
- `test/`: `node --test`

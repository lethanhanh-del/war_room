# Chốt sổ KPI lúc 05:00 (KPI-CLOSE)

**Mục đích:** đúng hạn 05:00, hệ thống ghi lại task nào đã tick, task nào chưa, rồi lưu cố định. Trạng thái trên `/kpi` lấy từ bản ghi đó, nên sửa Sheet sau 05:00 (tick, bỏ tick, xóa dòng, server ngừng một lúc) không làm sai kết quả "đúng hạn hay không", và đối chiếu lại được.

## Quy tắc

KPI ngày D hết hạn lúc **05:00 ngày D+1** (giờ VN, **không ân hạn**).

| Lúc 05:00 (bản chốt) | Hiện tại | Hiển thị |
|---|---|---|
| Đã tick | Đã tick | **Hoàn thành** |
| Chưa tick | Chưa tick | **Tồn đọng** (Không đạt) |
| Chưa tick | Đã tick | **Hoàn thành trễ hạn** |

- Task thêm vào Sheet **sau khi đã chốt**: coi như lúc 05:00 chưa tick. Nếu đã tick thì là trễ hạn.
- Tick rồi bỏ tick sau hạn: tạm thời hiển thị theo ô hiện tại (Tồn đọng). Điểm này đang chờ quyết định.

## Cách chốt

- Mỗi lượt đồng bộ (cron 1 phút), Worker đã đọc toàn bộ Sheet. Hệ thống lưu lại **trạng thái tick của mọi ô kèm giờ đọc**.
- Lượt đầu tiên sau 05:00 sẽ chốt ngày hôm trước, bằng cách so **lượt đọc trước 05:00** với lượt hiện tại. **Không gọi Google thêm lần nào.**
- Độ chính xác ±1 lượt đọc (~1 phút), vì Google không cho biết giờ tick.
- **Căn cứ** của mỗi bản chốt:

  | Căn cứ | Ý nghĩa | Kết luận |
  |---|---|---|
  | `exact` | Trạng thái tick không đổi giữa lượt đọc trước và sau 05:00 | Biết chính xác |
  | `window` | Có ô đổi giữa 2 lượt, lượt trước cách 05:00 ≤ 2 phút | Tính theo lượt trước: tick trong phút cuối có thể tính là chưa tick (sai số ±1 phút) |
  | `gap` | Server ngừng chạy quanh 05:00 | Tính theo lượt đọc cuối trước hạn. Ô chỉ tick ở lượt sau → **không xác định**, tính là đã tick, có ghi nhật ký |
  | `none` | Mới bật, chưa có quan sát nào trước hạn | Ô đã tick → tính là đã tick. Riêng ô có giờ tick (do `ticks.js` ghi trước đó) **sau hạn** → tính chưa tick, nên vẫn là **Hoàn thành trễ hạn** như trước khi có chốt sổ |

## Xác nhận lại (lỡ bỏ tick trước hạn)

- Ô bị chốt **chưa tick**, nhưng lịch sử cho thấy **đã từng tick trước hạn** (ví dụ tick 20:00, lỡ bỏ tick 04:58), sẽ tự vào danh sách **"KPI cần xác nhận"** ở trang **Quản trị** (`/admin`, chỉ admin). Danh sách kèm lịch sử ô và trạng thái hiện tại.
- Admin bấm **"Xác nhận đúng hạn"** và **bắt buộc ghi lý do** → ô được tính như lúc 05:00 đã tick, tức **Hoàn thành**. Có thể **hủy xác nhận**.
- Không tự động, để tránh lách (tick sớm rồi bỏ tick khi chưa làm).
- Mỗi lần xác nhận / hủy được ghi vào `kpi_confirm`, `kpi_audit_log` và **Nhật ký thao tác** của trang Quản trị.
- **Bỏ tick sau hạn** (ô đã chốt "đã tick"): hiện **Tồn đọng** để cảnh báo; **tick lại → Hoàn thành**, không bị tính trễ.

## Tải Excel đối soát

Trang **Quản trị** (`/admin`, chỉ admin) có khung **"Chốt sổ KPI"**: danh sách các ngày đã chốt (giờ chốt, căn cứ, số ô đã tick / chưa tick / không xác định) và nút **Tải Excel** từng ngày (`GET /api/admin/kpi-close?day=YYYY-MM-DD`, file `chot-so-KPI-YYYY-MM-DD.xlsx`). Mỗi lần tải được ghi vào Nhật ký thao tác (`kpi_close_export`).

| Tab | Nội dung |
|---|---|
| Chốt sổ | Đầu file: ngày KPI, hạn, giờ chốt, căn cứ, giờ lượt đọc trước / sau hạn, link Sheet, lần đọc Sheet gần nhất, người xuất. Sau đó từng task: Dòng tiền, Nhóm, Người thực hiện, KPI, **Lúc chốt sổ** (đã tick / chưa tick / không xác định / chưa có), **Hiện tại trên Sheet**, **Kết quả** (Hoàn thành / Hoàn thành trễ hạn / Tồn đọng), giờ tick (nếu trễ hạn), lịch sử tick / bỏ tick, ghi chú (thêm sau khi chốt, bỏ tick sau hạn, admin xác nhận) |
| Tổng hợp | Đếm theo dòng tiền: tổng, Hoàn thành, Trễ hạn, Tồn đọng, Không còn trên Sheet |
| Nhật ký | Nhật ký chốt sổ / lỗi / xác nhận của ngày đó |

- Task có trong bản chốt nhưng đã bị xoá khỏi Sheet vẫn được liệt kê ("Không còn trên Sheet"), tên lấy từ bản chốt.
- File Excel tạo ngay trên Worker, không cần thư viện (`src/kpi/xlsx-write.js`).

**Dòng trùng:** nhiều dòng giống hệt nhau (cùng dòng tiền, nhóm, người, nội dung KPI) được đánh số theo thứ tự trên Sheet (`…#2`, `…#3`) để mỗi dòng có kết quả chốt riêng. Trước đây các dòng này bị gộp làm một (phát hiện nhờ file đối soát ngày 22/11 trên Sheet test). Bản chốt tạo trước khi sửa vẫn giữ nguyên: các dòng trùng thứ 2 trở đi hiện "Chưa có lúc chốt".

## Lưu ở đâu

Cột `rev_a` / `rev_b` của `kpi_close` lưu giờ (ms) lượt đọc trước / sau hạn.

Cơ sở dữ liệu **D1** hiện có (`ctgwarroom`). Bảng tự tạo, không đụng bảng cũ:

| Bảng | Nội dung |
|---|---|
| `kpi_close_obs` | Lượt đọc gần nhất: trạng thái tick mọi ô kèm giờ đọc |
| `kpi_close` | Bản chốt từng ngày, theo Sheet. **Ghi một lần, không sửa** |
| `kpi_audit_log` | Nhật ký: chốt sổ, lỗi, xác nhận. Chỉ thêm |
| `kpi_cell_log` | Lịch sử từng ô: mỗi lần tick hoặc bỏ tick, kèm giờ |
| `kpi_confirm` | Các lần admin xác nhận đúng hạn: ai, lúc nào, lý do, hủy lúc nào |

Trên máy ảo, các bảng này nằm trong D1 cục bộ (`.wrangler/state/`).

Xem lại bằng **`GET /api/kpi/audit`** (phải đăng nhập, chỉ đọc): các quan sát gần nhất, bản chốt từng ngày, nhật ký.

## Thay đổi trong code

**File mới:**
- `src/kpi/close.js`: chốt sổ (quan sát, chốt, gắn kết quả, API audit, xác nhận lại).
- `src/kpi/close-export.js`: tải Excel chốt sổ theo ngày (API admin).
- `src/kpi/xlsx-write.js`: ghi file .xlsx tối giản.
- `test/kpi-close.test.js`: 9 test.
- `docs/KPI_CLOSE.md`: ghi chú này.

**Code cũ: chỉ thêm điểm nối** (tìm nhanh: `grep -rn KPI-CLOSE src public test`):

| File | Thay đổi |
|---|---|
| `src/kpi/index.js` | Import `close.js`. Trong `syncKpi`: gọi `closeKpi(...)` sau mỗi lượt đọc Sheet. Trong `kpiData`: gọi `applyCloses(...)` để gắn `cell.closed`. Trong `handleKpi`: thêm route `/api/kpi/audit` |
| `src/index.js` | Chuyển `/api/kpi/audit` vào `handleKpi`; import và route `/api/admin/kpi-review`, `/api/admin/kpi-close` (trong khối Quản trị, đã chặn người không phải admin) |
| `public/admin.html` | Thêm khung **"KPI cần xác nhận"** và **"Chốt sổ KPI"** (khối HTML và script riêng, không sửa phần có sẵn) |
| `public/kpi-model.js` | Trong `statusOf`: ngày đã chốt thì dùng `cell.closed` (D/L/K). `LATE_GRACE_MS` = 0 (bỏ ân hạn 10 phút) |
| `test/kpi.test.js` | Dòng kiểm "tick lúc 05:09 vẫn đúng hạn" đổi thành **trễ hạn**, vì đã bỏ ân hạn |

**Không đổi:** UI (`public/kpi.js`, `kpi.css`), `ticks.js` (vẫn dùng để hiện giờ tick của task trễ hạn), màn hình `/` (React).

**Hoàn tác:** xóa `src/kpi/close.js`, `src/kpi/close-export.js`, `src/kpi/xlsx-write.js`, `test/kpi-close.test.js`, `docs/KPI_CLOSE.md`, rồi `git checkout -- src/kpi/index.js src/index.js public/kpi-model.js public/admin.html test/kpi.test.js`.

## Kiểm thử

- `npm test`: **100/100**: 90 test cũ + 10 test chốt sổ (căn cứ, xác nhận, tải Excel, dòng trùng, lần đầu bật, không gọi Google).
- Chạy thật trên máy ảo, **chỉ dùng Sheet test** `1tHc30…`. Kết quả ở mục "Kết quả test thật" bên dưới.

## Kết quả test thật (22/11/2026, Sheet test `1tHc30…`, tab "Dòng tiền bán 4 dự án", ngày 21/11)

Để không phải chờ tới 05:00, giờ chốt được dời sớm bằng `KPI_DUE_SHIFT_MIN` (**chỉ dùng khi thử**, không đặt trên server thật). Giờ chốt thử là 04:23.

| Thao tác trên Sheet test | Kết quả trên /kpi |
|---|---|
| 7 ô đã tick sẵn | **Hoàn thành** |
| Tick E23 lúc 04:12 (trước giờ chốt) | **Hoàn thành** |
| Bản chốt lúc 04:23:01 | căn cứ `exact`, phiên bản 2: 8 đã tick, 73 chưa tick (mọi dòng tiền) |
| Tick E24 lúc 04:24 (sau giờ chốt) | **Hoàn thành trễ hạn** (tick lúc 04:24:03) |
| Các ô còn lại | **Tồn đọng** (38 ô ở tab Bán 4 dự án) |

**Xác nhận lại** (ngày 22/11, ô G23; giờ chốt thử 04:51):

| Bước | Kết quả |
|---|---|
| Tick G23 lúc 04:44:55, lỡ bỏ tick lúc 04:45:06 | Lịch sử ô ghi đủ 2 lần |
| Chốt sổ 22/11 lúc 04:51 (`exact`) | G23 chưa tick → tự vào **"KPI cần xác nhận"** |
| Tick lại lúc 04:52 | **Hoàn thành trễ hạn** |
| Admin xác nhận (có lý do) | **Hoàn thành**; có dòng `kpi_confirm` trong Nhật ký thao tác |
| Hủy xác nhận | Quay lại **Hoàn thành trễ hạn**, vẫn ở danh sách cần xác nhận |

**Tải Excel** (22/11, máy ảo, Sheet test): danh sách có 2 ngày đã chốt. File 21/11 có 81 task (8 Hoàn thành, 1 Hoàn thành trễ hạn — E24 tick 04:24:03, 72 Tồn đọng), khớp bản chốt (8 đã tick / 73 chưa tick). File 22/11 có lịch sử ô G23 (tick 04:44:55, bỏ tick 04:45:06, tick lại 04:52:01) và nhật ký xác nhận / huỷ xác nhận. File mở được bằng trình đọc .xlsx của dự án và thư viện zip / XML chuẩn của Python.

**Chạy lại theo giờ thật 05:00** (22/11, sau khi bỏ `KPI_DUE_SHIFT_MIN`, xoá 2 bản chốt thử trong D1 cục bộ): ngày 21/11 chốt lúc 05:09:41, hạn 05:00:00, căn cứ `exact`, phiên bản 10: 9 đã tick, 72 chưa tick. E24 (tick 04:24) nay là **Hoàn thành**. Ngày 22/11 chưa chốt (hạn 05:00 ngày 23/11). Tải Excel ngày 22/11 trả 404 "chưa chốt sổ".

## Khi deploy lên server thật

- **Không** đặt `KPI_DUE_SHIFT_MIN` trên Cloudflare.
- Bảng D1 tự tạo ở lượt đồng bộ đầu tiên, không cần migration.
- Lượt đầu tiên chốt luôn các ngày cũ đã qua hạn với căn cứ `none` (xem bảng trên). Từ ngày kế tiếp trở đi là `exact`.

## Đổi phương pháp (22/11/2026, sau lần deploy đầu)

**Lý do:** bản đầu dò số phiên bản Google (`…/export?…&revision=N`) mỗi lượt. Trên production, Sheet tổng có khoảng 1.500 phiên bản, lần dò đầu cần khoảng 30 lần gọi, cộng phần đồng bộ vượt giới hạn **50 lần gọi ra ngoài / lượt** của gói Free → lỗi "Too many subrequests" mỗi phút, chưa chốt được ngày nào. Lịch sử phiên bản cũng không cho thêm thông tin, vì nội dung phiên bản cuối trước hạn trùng với lượt Worker đã đọc.

**Bây giờ:** chốt bằng lượt đọc trước / sau hạn đã có sẵn. Không gọi Google thêm, không phụ thuộc tham số `revision` không chính thức. Quy tắc, kết quả, xác nhận lại, tải Excel giữ nguyên.

**Mất:** không còn số phiên bản Google trong bản chốt (đối chiếu bằng Nhật ký phiên bản của Google theo giờ), và không thấy tick rồi bỏ tick trong cùng một phút (không ảnh hưởng kết luận chốt).

**Test thật trên máy ảo** (Sheet test, ngày 22/11, giờ chốt thử 05:44):

| Thao tác | Kết quả |
|---|---|
| Tick G24 lúc 05:39 | **Hoàn thành** |
| Tick G26 lúc 05:39, bỏ tick 05:40 | **Tồn đọng**, vào **"KPI cần xác nhận"** (lịch sử tick / bỏ tick) |
| Chốt 05:44:35, lượt đọc trước 05:43:54 | căn cứ `exact`: 2 đã tick, 32 chưa tick (34 task, 4 dòng trùng tách riêng) |
| Tick G25 lúc 05:44:56 (sau hạn) | **Hoàn thành trễ hạn** |
| Tải Excel | Khớp: 2 Hoàn thành, 1 trễ hạn, 31 Tồn đọng |

Sau test: bỏ `KPI_DUE_SHIFT_MIN`, xoá bản chốt thử ngày 22/11 trong D1 cục bộ.

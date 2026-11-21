# Hướng dẫn deploy War Room — Dashboard dòng tiền

Kiến trúc:

```
Màn hình trình chiếu (trình duyệt) ──> Vercel (React tĩnh + API /api/dashboard) ──> Google Sheets API (chỉ đọc) ──> Google Sheet KPI
```

- **FE/**: toàn bộ thư mục là 1 project Vercel. `FE/api` là Serverless Function đọc Google Sheet.
- **Google Sheet** là nguồn dữ liệu. Ứng dụng **chỉ đọc**, không ghi gì vào Sheet. Người dùng vẫn nhập KPI / Kết quả trực tiếp trên Sheet như hiện nay.
- Khoá service account **chỉ nằm trong biến môi trường Vercel**, không bao giờ gửi xuống trình duyệt.

---

## Bước 1 — Service Account đọc được Google Sheet

1. Vào <https://console.cloud.google.com> → tạo (hoặc chọn) 1 project.
2. **APIs & Services → Library** → tìm **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** (ví dụ `war-room-reader`). Không cần gán role.
4. Mở service account → **Keys → Add key → Create new key → JSON** → tải file JSON.
   > ⚠ File này là bí mật. **Không commit lên Git** (`.gitignore` đã chặn các tên `*service-account*.json`, `sa*.json`, `credentials*.json`).
5. Mở Google Sheet KPI → **Share** → thêm email service account (`xxx@<project>.iam.gserviceaccount.com`) với quyền **Viewer**.
   > Nếu Google Workspace của công ty chặn share ra ngoài domain, cần IT cho phép hoặc tạo service account trong project Google Cloud của công ty.
6. Kiểm tra:

   ```bash
   cd FE && npm install && cd ..
   node deploy/check-sheet.mjs --key path/to/service-account.json --sheet <GOOGLE_SHEET_ID>
   ```

   Kết quả đúng: 5 dòng ✔ (mỗi dòng tiền), liệt kê các ngày và số dòng PIC.

### Cấu trúc sheet mà ứng dụng đọc

Mỗi sheet dòng tiền (`DÒNG TIỀN BÁN 4 DỰ ÁN`, `DÒNG TIỀN NỢ KHÓ ĐÒI`, `DÒNG TIỀN BANKING`, `Dòng tiền tài chính`, `Dòng tiền thu trước hạn quá hạn`):

| Dòng | Nội dung |
|---|---|
| 1 | Tiêu đề (có khoảng ngày, ví dụ `(21/11/2026 - 25/11/2026)`) |
| 3 | `Stt` · `Nhóm` · `PIC` · các cột **ngày** (gộp 2 ô) · `Tổng kết` · `Ghi chú / Vướng mắc` · `Thư mục dữ liệu lưu trữ` |
| 4 | Dưới mỗi ngày: `KPI` · `Kết quả` |
| 5+ | Mỗi dòng 1 PIC / 1 đầu việc |

- Ứng dụng **tự dò vị trí cột theo tiêu đề**, nên thêm/bớt ngày hoặc đổi sang tuần mới vẫn chạy, miễn giữ đúng tên tiêu đề `Nhóm`, `PIC`, `KPI`, `Kết quả`.
- Dòng không có PIC và không có số (dòng nhóm màu vàng) được bỏ qua. Dòng KPI chèn bên dưới (không ghi PIC) sẽ dùng PIC của dòng phía trên.
- Ô số có thể nhập `1500000`, `1.500.000` hoặc `1,500,000`.

### Quy tắc trạng thái (task = KPI của 1 PIC trong 1 ngày)

| Trạng thái | Điều kiện |
|---|---|
| Hoàn thành | Kết quả ngày đó ≥ KPI ngày đó |
| Hoàn thành trễ hạn | Trong ngày chưa đạt, nhưng một ngày sau đó lũy kế Kết quả ≥ lũy kế KPI tính đến ngày đó |
| Trễ hạn | Ngày đã qua, lũy kế vẫn chưa bù đủ |
| Đang thực hiện | Là hôm nay, chưa đạt |
| Chưa đến hạn | Ngày trong tương lai |
| (không tính) | Ô KPI trống hoặc 0 |

Tỷ lệ hoàn thành = (Hoàn thành + Hoàn thành trễ hạn) / số task đến hạn. Task "đến hạn" là task của ngày đã qua, hoặc đã hoàn thành.

---

## Bước 2 — Deploy lên Vercel

### Cách A (khuyến nghị): Vercel tự deploy từ GitHub

1. <https://vercel.com/new> → **Import Git Repository** → chọn repo `war_room`.
2. **Root Directory**: **`FE`** (quan trọng).
3. Framework Preset: **Vite** (tự nhận từ `FE/vercel.json`). Node.js Version: **22.x** trở lên.
4. **Environment Variables**:

   | Name | Value |
   |---|---|
   | `GOOGLE_SHEET_ID` | ID Google Sheet KPI |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` trong file JSON |
   | `GOOGLE_PRIVATE_KEY` | `private_key` trong file JSON (dán nguyên, gồm `-----BEGIN…` và `\n`) |
   | `APP_ACCESS_KEY` | Chuỗi bí mật tự đặt để chặn người ngoài xem dữ liệu |
   | `CASHFLOW_SHEETS` | *(tuỳ chọn)* đổi danh sách / thứ tự 5 sheet, phân cách bằng `\|` |

5. **Deploy**. Từ đó mỗi lần push lên `main` → Vercel tự deploy Production.

### Cách B: Vercel CLI từ máy

```bash
npm i -g vercel
vercel login
cd FE && vercel link && cd ..
node deploy/vercel-env.mjs --key path/to/service-account.json --sheet <GOOGLE_SHEET_ID> --access-key <CHUOI_BI_MAT>
./deploy/deploy.sh --prod          # macOS / Linux / Git Bash
.\deploy\deploy.ps1 -Prod          # Windows PowerShell
```

Script deploy chạy `npm ci` → `npm test` → `npm run build` → `vercel --prod`.

---

## Bước 3 — Cài đặt màn hình trình chiếu (4m × 2m)

1. Mở `https://<ten-project>.vercel.app/?key=<APP_ACCESS_KEY>` **một lần**. Key được lưu trong trình duyệt và tự xoá khỏi thanh địa chỉ.
2. Bật toàn màn hình: **F11** (hoặc chạy Chrome kiosk: `chrome --kiosk https://<ten-project>.vercel.app`).
3. Giao diện tự co giãn vừa đúng 1 màn hình (tối ưu tỷ lệ 2:1, chạy tốt cả 16:9). Dữ liệu tự làm mới mỗi 60 giây. Ô nào nhiều dòng hơn chiều cao sẽ tự cuộn chậm.
4. Có thể đặt sẵn bộ lọc bằng URL, ví dụ:
   - `?status=late`: chỉ hiện Trễ hạn
   - `?date=2026-11-23`: xem 1 ngày
   - `?pic=<Tên PIC>`: lọc theo người
   - `?refresh=30`: làm mới mỗi 30 giây

## Kiểm tra sau deploy

- `https://<ten-project>.vercel.app/api/health` → `"mode": "google-sheets"`, các mục `config` đều `true`.
- Màn hình hiện đủ 6 ô. Ô nào báo `Không tìm thấy sheet ...` thì kiểm tra lại tên sheet hoặc `CASHFLOW_SHEETS`.

## Lỗi thường gặp

| Hiện tượng | Xử lý |
|---|---|
| `Thiếu cấu hình GOOGLE_...` | Chưa khai báo env trên Vercel, hoặc khai báo xong chưa **Redeploy** |
| `Google Sheets API lỗi (403)` | Chưa bật Google Sheets API, hoặc chưa share Sheet cho email service account |
| `Google Sheets API lỗi (404)` | Sai `GOOGLE_SHEET_ID` |
| `invalid_grant` / lỗi key | `GOOGLE_PRIVATE_KEY` dán thiếu hoặc mất ký tự `\n` |
| Ô báo `Không tìm thấy cột ngày` | Dòng tiêu đề ngày bị đổi định dạng; ô ngày phải là kiểu Ngày hoặc chữ `dd/mm` |

## Giới hạn

- Google Sheets API có quota. Server cache 30 giây (`CACHE_SECONDS`) nên nhiều màn hình mở cùng lúc vẫn an toàn.
- `APP_ACCESS_KEY` là khoá dùng chung, không phải đăng nhập theo từng người, và chưa có audit log. Dữ liệu dòng tiền là thông tin nội bộ: nên đặt key mạnh, chỉ chia sẻ trong nhóm War Room, và cân nhắc bật **Vercel Deployment Protection** hoặc SSO nếu cần kiểm soát chặt hơn.

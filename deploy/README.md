# Hướng dẫn deploy War Room

Kiến trúc:

```
Trình duyệt ──> Vercel (FE tĩnh React + Serverless API /api/*) ──> Google Sheets API ──> Google Sheet (DB)
```

- **FE/**: React (Vite) + thư mục `FE/api` là các Vercel Serverless Function. Toàn bộ thư mục `FE` là 1 project Vercel.
- **Google Sheet**: đóng vai trò database, mỗi dòng của tab `Tasks` là 1 task.
- Khoá service account **chỉ nằm ở biến môi trường của Vercel**, không bao giờ gửi xuống trình duyệt.

---

## Bước 1 — Chuẩn bị Google Sheet & Service Account

1. Vào <https://console.cloud.google.com> → tạo (hoặc chọn) 1 project.
2. **APIs & Services → Library** → tìm **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** (ví dụ tên `war-room-sheets`). Không cần gán role.
4. Mở service account vừa tạo → tab **Keys → Add key → Create new key → JSON** → tải file JSON về.
   > ⚠ File này là bí mật. **Không commit lên Git** (đã chặn sẵn trong `.gitignore` với tên `*service-account*.json`, `sa*.json`).
5. Tạo 1 Google Sheet mới. Copy **Sheet ID** trong URL:
   `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`
6. Bấm **Share** trên Google Sheet → thêm email service account (dạng `xxx@<project>.iam.gserviceaccount.com`) với quyền **Editor**.
7. Khởi tạo cấu trúc sheet (tạo tab `Tasks` + dòng tiêu đề):

   ```bash
   cd FE && npm install && cd ..
   node deploy/init-sheet.mjs --key path/to/service-account.json --sheet <SHEET_ID>
   ```

   Hoặc làm tay: tạo tab tên `Tasks`, dán dòng tiêu đề trong `deploy/sheet-template.csv` vào dòng 1.

Cấu trúc cột (không đổi thứ tự):

| Cột | Tên | Ghi chú |
|---|---|---|
| A | id | UUID do hệ thống sinh |
| B | title | Bắt buộc, ≤ 200 ký tự |
| C | description | ≤ 5000 ký tự |
| D | assignee | Người phụ trách |
| E | status | `Todo` / `In Progress` / `Blocked` / `Done` |
| F | priority | `Low` / `Medium` / `High` / `Critical` |
| G | due_date | `YYYY-MM-DD` |
| H | created_at | ISO time |
| I | updated_at | ISO time |

---

## Bước 2 — Deploy lên Vercel

### Cách A (khuyến nghị): Vercel tự deploy từ GitHub

1. Vào <https://vercel.com/new> → **Import Git Repository** → chọn repo `war_room`.
2. **Root Directory**: chọn **`FE`** (quan trọng).
3. Framework Preset: **Vite** (Vercel tự nhận từ `FE/vercel.json`).
4. Mở **Environment Variables**, thêm:

   | Name | Value |
   |---|---|
   | `GOOGLE_SHEET_ID` | Sheet ID ở bước 1 |
   | `GOOGLE_SHEET_TAB` | `Tasks` |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` trong file JSON |
   | `GOOGLE_PRIVATE_KEY` | `private_key` trong file JSON (dán nguyên, gồm cả `-----BEGIN…` và `\n`) |
   | `APP_ACCESS_KEY` | Chuỗi bí mật tự đặt — người dùng phải nhập khoá này để vào app |

5. **Deploy**. Từ đó mỗi lần push lên nhánh `main` → Vercel tự deploy Production; push nhánh khác → bản Preview.

### Cách B: Dùng Vercel CLI từ máy

```bash
npm i -g vercel
vercel login
cd FE && vercel link && cd ..

# Đẩy biến môi trường từ file JSON (khỏi copy/paste private key)
node deploy/vercel-env.mjs --key path/to/service-account.json --sheet <SHEET_ID> --access-key <CHUOI_BI_MAT>

# Deploy
./deploy/deploy.sh --prod          # macOS / Linux / Git Bash
.\deploy\deploy.ps1 -Prod          # Windows PowerShell
```

Script deploy sẽ: `npm ci` → `npm test` → `npm run build` → `vercel --prod`. Bỏ `--prod` / `-Prod` để deploy bản Preview.

---

## Bước 3 — Kiểm tra sau deploy

1. Mở `https://<ten-project>.vercel.app/api/health` → phải thấy `"mode": "google-sheets"` và các mục trong `config` đều `true`.
2. Mở `https://<ten-project>.vercel.app` → nhập access key → tạo thử 1 task → kiểm tra dòng mới xuất hiện trên Google Sheet.

## Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân / Cách xử lý |
|---|---|
| `Thiếu cấu hình GOOGLE_...` | Chưa khai báo env trên Vercel, hoặc khai báo xong chưa **Redeploy** |
| `Google Sheets API lỗi (403)` | Chưa bật Google Sheets API, hoặc chưa share sheet cho email service account (Editor) |
| `Google Sheets API lỗi (404)` | Sai `GOOGLE_SHEET_ID` |
| `Google Sheets API lỗi (400) Unable to parse range` | Sai tên tab — kiểm tra `GOOGLE_SHEET_TAB` |
| `invalid_grant` / lỗi key | `GOOGLE_PRIVATE_KEY` bị dán thiếu, hoặc mất ký tự `\n` |
| Màn hình yêu cầu access key liên tục | `APP_ACCESS_KEY` trên Vercel khác với khoá đang nhập |

## Giới hạn cần biết

- Google Sheets API có quota (mặc định ~60 request đọc/phút/user). Phù hợp nhóm nhỏ, vài trăm–vài nghìn task.
- Không có transaction: 2 người sửa cùng 1 task cùng lúc thì bản lưu sau ghi đè bản trước.
- `APP_ACCESS_KEY` là 1 khoá dùng chung, không phải đăng nhập theo từng người. Nếu cần phân quyền theo người dùng (SSO, audit log), nên bổ sung lớp xác thực riêng trước khi dùng cho dữ liệu nhạy cảm.

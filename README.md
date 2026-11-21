# War Room — Theo dõi task / issue dự án

Ứng dụng web theo dõi task dự án: bảng Kanban kéo-thả, danh sách, bộ lọc, thống kê (tổng, theo trạng thái, quá hạn).

- **Frontend**: React 19 + Vite 8 (yêu cầu Node.js ≥ 22)
- **Backend**: Vercel Serverless Functions (`FE/api`)
- **Database**: Google Sheet (qua Google Sheets API + Service Account)
- **Deploy**: Vercel

## Cấu trúc thư mục

```
war_room/
├── FE/                      # 1 project Vercel (Root Directory = FE)
│   ├── api/                 # Serverless API
│   │   ├── tasks.js         # GET/POST/PUT/DELETE /api/tasks
│   │   ├── health.js        # GET /api/health
│   │   └── _lib/            # sheets.js (truy cập Google Sheet), schema.js, http.js
│   ├── src/                 # Giao diện React
│   ├── scripts/             # dev-api.mjs (chạy API local) + test
│   ├── vercel.json
│   └── .env.example
└── deploy/                  # Hướng dẫn & script triển khai
    ├── README.md            # Hướng dẫn chi tiết từng bước
    ├── init-sheet.mjs       # Khởi tạo tab + header trên Google Sheet
    ├── vercel-env.mjs       # Đẩy biến môi trường lên Vercel từ file JSON key
    ├── deploy.ps1 / deploy.sh
    └── sheet-template.csv
```

## Chạy local

```bash
cd FE
npm install
cp .env.example .env       # Windows: copy .env.example .env
```

- Chạy thử **không cần Google Sheet**: trong `.env` đặt `MOCK_SHEETS=true`.
- Chạy với Google Sheet thật: điền `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (xem `deploy/README.md`).

```bash
npm run dev      # Web: http://localhost:5173  ·  API: http://localhost:3001/api
npm test         # Chạy test API (không cần Google Sheet)
npm run build    # Build production
```

## API

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái & cấu hình (không lộ secret) |
| GET | `/api/tasks` | Danh sách task |
| POST | `/api/tasks` | Tạo task `{ title, description?, assignee?, status?, priority?, due_date? }` |
| PUT | `/api/tasks?id=<id>` | Cập nhật một phần task |
| DELETE | `/api/tasks?id=<id>` | Xoá task |

Nếu cấu hình `APP_ACCESS_KEY`, mọi request `/api/tasks` phải có header `x-access-key`.

## Deploy

Xem chi tiết tại [`deploy/README.md`](deploy/README.md).

# War Room CT Homes — Dashboard dòng tiền

Màn hình dashboard **1 trang duy nhất** để trình chiếu trên màn hình lớn (4m × 2m), đọc dữ liệu KPI trực tiếp từ Google Sheet.

```
┌───────────────┬───────────────┬───────────────┐
│ 1. Tổng quan  │ 2. Bán 4 dự án│ 3. Nợ khó đòi │
│    + bộ lọc   │               │               │
├───────────────┼───────────────┼───────────────┤
│ 4. Banking    │ 5. Tài chính  │ 6. Thu trước  │
│               │               │  hạn/quá hạn  │
└───────────────┴───────────────┴───────────────┘
```

- **Ô 1**: đồng hồ, kỳ báo cáo, bộ lọc **Ngày / Trạng thái / PIC**, tỷ lệ hoàn thành, số task theo trạng thái (Hoàn thành, Hoàn thành trễ hạn, Trễ hạn, Đang thực hiện, Chưa đến hạn), số vướng mắc và tiến độ 5 dòng tiền.
- **Ô 2–6**: mỗi dòng tiền là 1 bảng PIC × ngày (Kết quả / KPI, tô màu theo trạng thái), lũy kế, % đạt và ghi chú vướng mắc.

## Công nghệ

- **Frontend**: React 19 + Vite 8, font Be Vietnam Pro / JetBrains Mono (đóng gói sẵn, không cần internet ngoài). Yêu cầu Node.js ≥ 22.
- **Backend**: Vercel Serverless Function (`FE/api/dashboard.js`), **chỉ đọc** Google Sheet qua Service Account.
- **Dữ liệu**: Google Sheet KPI (5 sheet dòng tiền).
- **Deploy**: Vercel.

## Cấu trúc thư mục

```
war_room/
├── FE/                          # 1 project Vercel (Root Directory = FE)
│   ├── api/
│   │   ├── dashboard.js         # GET /api/dashboard: dữ liệu 5 dòng tiền
│   │   ├── health.js            # GET /api/health
│   │   └── _lib/                # sheets.js (đọc Sheet + cache), parse.js (đọc cấu trúc sheet), mock.js, http.js
│   ├── src/
│   │   ├── App.jsx              # lưới 3×2, bộ lọc, tự làm mới
│   │   ├── components/          # OverviewPanel (ô 1), FlowPanel (ô 2–6)
│   │   └── lib/status.js        # quy tắc tính trạng thái
│   ├── scripts/                 # dev-api.mjs (chạy API local) + test
│   └── vercel.json
└── deploy/                      # Hướng dẫn & script triển khai
    ├── README.md                # hướng dẫn chi tiết, quy tắc trạng thái
    ├── check-sheet.mjs          # kiểm tra service account đọc đúng 5 sheet
    ├── vercel-env.mjs           # đẩy biến môi trường lên Vercel
    └── deploy.ps1 / deploy.sh
```

## Chạy local

```bash
cd FE
npm install
cp .env.example .env       # Windows: copy .env.example .env
npm run dev                # Web: http://localhost:5173  ·  API: http://localhost:3001/api
```

- Chạy thử **không cần Google Sheet**: đặt `MOCK_SHEETS=true` trong `.env`.
- Chạy với Sheet thật: điền `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (xem `deploy/README.md`).

```bash
npm test         # 20 test: parser, quy tắc trạng thái, API, lớp Google Sheet
npm run build    # build production
```

## Deploy

Xem [`deploy/README.md`](deploy/README.md).

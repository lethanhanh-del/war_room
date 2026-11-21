# data/ — Dữ liệu nghiên cứu cho dashboard

Đặt vào đây các file dữ liệu cần nghiên cứu để đưa lên dashboard: Excel (.xlsx), CSV, PDF, ảnh chụp, ghi chú…

- Thư mục này **không được deploy lên web**. Chỉ `public/` được phục vụ trên Cloudflare.
- Mỗi file nên kèm một dòng mô tả trong bảng bên dưới: nguồn dữ liệu, ai cung cấp, muốn hiển thị gì trên dashboard.
- Không đặt mật khẩu hoặc token vào đây.

| File | Nguồn / người cung cấp | Muốn hiển thị gì trên dashboard |
|------|------------------------|---------------------------------|
| `DONG_TIEN_2_BANKING_Template_Da_Chuan_Hoa_Task.xlsx` (không lưu ở đây) | War Room, kiểm soát 21/11/2026 | Mẫu "Nhập task & theo dõi" của từng dòng tiền. Nạp bằng nút **Nạp task Excel** trên trang `/` |
| `WarRoom_CTHomes_Final_20.11.xlsx` (không lưu ở đây) | Văn phòng Chủ tịch | Danh sách nhân sự và lịch trực War Room 21–25/11. Đã dùng cho bảng `/war-room` và tạo tài khoản; là nguồn tra chức danh người phụ trách |

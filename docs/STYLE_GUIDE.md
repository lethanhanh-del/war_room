# War Room · Style Guide v5 "Night Ops"

Tài liệu này mô tả **phong cách giao diện** của dashboard War Room. Dev khác dùng nó để làm màn hình mới với **bố cục khác** mà vẫn giữ đúng phong cách. Mọi giá trị đều lấy từ code thật:

| File | Vai trò |
|---|---|
| `FE/src/styles/tokens.css` | **Token gốc**: màu, font, khoảng cách, bo góc, thang co giãn. Copy nguyên file. |
| `FE/src/styles.css` | Style các component: panel, chip, tile, bảng, ô ngày, % đạt, nhãn kết luận… |
| `FE/src/components/bits.jsx` | Component React nhỏ dùng lại: `DayCell`, `Pct`, `StatusTag` |
| `FE/src/lib/status.js` | Nhãn + biểu tượng trạng thái (`STATUS`) — dùng đúng các key này để màu khớp |

Ảnh tham chiếu (dữ liệu giả): `docs/images/`

| Ảnh | Nội dung |
|---|---|
| `01-bo-cuc-3x2.png` | 5 dòng tiền, lưới 3×2 |
| `02-bo-cuc-B-8-dong-tien.png` | 8 dòng tiền, tổng quan cột trái |
| `03-loc-1-ngay.png` | Lọc 1 ngày, ô dạng gọn |
| `04-chi-tiet-khong-dat.png` | Chế độ chi tiết từng task, lọc Không đạt |
| `05-chi-tiet-dong-tien-nhom.png` | Chi tiết 1 dòng tiền + 1 nhóm |

---

## 1. Tinh thần thiết kế

1. **Một màn hình, không cuộn trang.** Toàn bộ nội dung luôn vừa khung hình. Nội dung dài thì *ô đó* tự cuộn chậm, trang không bao giờ có thanh cuộn.
2. **Đọc được từ xa (màn 4m × 2m).** Nền gần đen, chữ sáng, độ tương phản cao. Số dùng font mono cho thẳng cột. Nhãn phụ viết HOA nhỏ, giãn chữ.
3. **Màu = trạng thái.** 5 màu trạng thái có nghĩa cố định, không dùng để trang trí. Màu nhấn duy nhất là **xanh lime** cho "đang chọn / hôm nay / số thứ tự ô".
4. **Ít khung, nhiều lớp nền.** Phân tầng bằng 3 lớp nền (`--bg` → `--panel` → `--panel-2`) và viền mảnh 1px. Không đổ bóng, không gradient trong component.
5. **Thông tin quan trọng nhất to nhất:** % task đạt, số task không đạt, ô ✔ ✖ theo ngày.

---

## 2. Thang co giãn (bắt buộc)

```css
html { font-size: min(0.84vw, 1.6vh); }   /* tokens.css */
```

- **Mọi kích thước dùng `rem`**, kể cả padding, gap, cỡ chữ, chiều rộng cột. Chỉ viền dùng `1px`.
- Nhờ vậy giao diện co giãn tuyến tính theo màn hình:

  | Màn hình | 1rem ≈ |
  |---|---|
  | 1366×768 | 11.5px |
  | 1920×960 (tỷ lệ 2:1, như màn 4m×2m) | 15.4px |
  | 3840×1920 | 30.7px |

- Hệ số `0.84vw / 1.6vh` đã tinh chỉnh để lưới 3×2 và bố cục B vừa khít ở tỷ lệ 2:1 và 16:9. Nếu bố cục mới chứa nhiều dòng hơn theo chiều dọc, **giảm hệ số `vh`** (ví dụ `1.5vh`) chứ đừng giảm từng cỡ chữ.
- Khung gốc: `.wall { height: 100vh; width: 100vw; overflow: hidden }`. Mọi ô có `min-height: 0; min-width: 0; overflow: hidden`, và vùng nội dung bên trong là `flex: 1; overflow-y: auto` (ẩn thanh cuộn).
- Khi làm bố cục mới: test ít nhất ở **1920×960, 1920×1080, 1366×768**. Điều kiện đạt là `scrollHeight - clientHeight = 0` ở mọi `.panel`.

---

## 3. Màu

### 3.1 Bề mặt & chữ

| Token | Hex | Dùng cho |
|---|---|---|
| `--bg` | `#07090D` | Nền màn hình (thêm 1 vầng sáng lime 5% ở góc trên trái) |
| `--panel` | `#0E1218` | Nền ô (panel), nền header bảng (sticky) |
| `--panel-2` | `#151A23` | Nền nổi: chip, tile, select, dòng "Cần xử lý" |
| `--inset` | `#0A0D12` | Nền chìm (ít dùng) |
| `--line` | `#1C232E` | Viền panel, đường kẻ bảng, viền chip |
| `--line-strong` | `#2A3442` | Track thanh %, viền nút đóng, viền nét đứt |
| `--text` | `#F3F6FA` | Chữ chính, số liệu |
| `--muted` | `#8994A6` | Nhãn, chữ phụ, tên người |
| `--dim` | `#6E7A8C` | Giá trị 0, thứ trong tuần ở header ngày |

### 3.2 Nhấn

| Token | Hex | Dùng cho |
|---|---|---|
| `--accent` | `#C8FF4D` (lime) | Chip đang chọn, cột / chip "Hôm nay", số thứ tự ô, tên nhóm nhỏ, hover tiêu đề |
| `--on-accent` | `#0A0D12` | Chữ đặt trên nền lime |

**Quy tắc:** lime chỉ dùng cho *trạng thái giao diện* (đang chọn, hôm nay, điều hướng), **không** dùng cho dữ liệu tốt hay xấu.

### 3.3 Trạng thái task (ngữ nghĩa cố định)

Một **task** là nội dung ô KPI của 1 dòng trong 1 ngày, ô Kết quả là checkbox.

| Key | Nhãn | Biểu tượng | Token | Hex | Khi nào |
|---|---|---|---|---|---|
| `done` | Đạt | ✔ | `--done` | `#2EE6A6` | Đã tick |
| `late` | Không đạt | ✖ | `--late` | `#FF4D6D` | Ngày đã qua, chưa tick |
| `in_progress` | Đang làm (hôm nay) | ● | `--in_progress` | `#3DA9FC` | Hôm nay, chưa tick |
| `upcoming` | Chưa đến hạn | ○ | `--upcoming` | `#8A94A8` | Ngày tương lai |
| `none` | Không có task | — | `--none` | `#2A3442` | Ô KPI trống, chưa tick |
| — | Cảnh báo mức giữa | — | `--warn` | `#FFB020` | Chỉ dùng cho % đạt 70–99% |
| — | Vướng mắc (ghi chú) | ⚠ | `--blocker` | `#FF8A3D` | Cột "Ghi chú / Vướng mắc" có nội dung |

**Cách gán màu:** thêm class `st-<key>` lên phần tử. Class này đặt biến `--c`, và mọi component đọc `var(--c)`:

```html
<span class="badge st-late">Không đạt</span>
<span class="dot st-done"></span>
<button class="tile st-in_progress">…</button>
<span class="tag st-late"><i>✖</i>Không đạt</span>
```

**Độ đậm nhạt dùng `color-mix` từ `--c`:**

| Mức trộn | Dùng cho |
|---|---|
| 22% | Nền ô ngày (đầy đủ) |
| 70% | Viền ô ngày |
| 16% / 60% | Nền / viền nhãn kết quả (`.tag`) |
| 6% | Nền dòng "Không đạt" trong bảng chi tiết |

**Ngưỡng màu % đạt:**

| % đạt | Màu chữ | Màu thanh |
|---|---|---|
| ≥ 100% | `#86EFAC` | `--done` |
| ≥ 70% | `#FDE047` | `--warn` |
| < 70% | `#FCA5A5` | `--late` |

---

## 4. Chữ

| Font | Dùng cho | Nguồn |
|---|---|---|
| **Be Vietnam Pro** (`--font`) | Toàn bộ chữ | `@fontsource/be-vietnam-pro` (400–800, đóng gói sẵn, hỗ trợ tiếng Việt đầy đủ) |
| **JetBrains Mono** (`--mono`) | **Mọi con số**: đồng hồ, %, số đếm, Đạt x/y, ngày trong danh sách | `@fontsource/jetbrains-mono` (400, 700) |

Thang chữ (rem):

| Vai trò | Cỡ | Đậm | Font | Kiểu |
|---|---|---|---|---|
| Tiêu đề thương hiệu "WAR ROOM **CT HOMES**" | 1.75 | 800 | text | HOA, giãn 0.04em. Phần "CT HOMES" màu lime |
| Tiêu đề màn chi tiết | 1.45 | 800 | text | HOA |
| Tiêu đề ô (tên dòng tiền) | 1.3 (gọn: 1.0) | 700 | text | HOA, giãn 0.02em, cắt "…" 1 dòng |
| Số lớn trong vòng tròn % | 1.75 (cột cao: 2.2) | 700 | mono | — |
| % của ô dòng tiền | 2.0 (gọn: 1.55) | 700 | mono | màu `--done` |
| Đồng hồ | 1.9 | 700 | mono | — |
| Số trong tile / tóm tắt chi tiết | 1.35 / 1.5 | 700 | mono | — |
| Tên KPI / tên dòng | 0.9 | 600 | text | cắt "…" |
| Tên người / chữ phụ | 0.78 | 400 | text | `--muted` |
| Chip, select | 0.8 | 500 (on: 700) | text | — |
| Nhãn bộ lọc, header bảng, tên nhóm | 0.72 | 600–700 | text | HOA, giãn 0.03–0.05em |
| Biểu tượng trong ô ngày ✔ ✖ ● ○ | 0.95 (gọn: 0.62) | 800 | text | màu trạng thái (gọn: chữ tối trên nền đặc) |

**Quy tắc:**
- Mọi số liệu dùng `--mono`. Danh sách selector đang áp dụng nằm ở cuối `styles.css`.
- Chữ dài luôn 1 dòng, cắt bằng `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` và có `title` để xem đủ.
- Không dùng cỡ < 0.62rem.

---

## 5. Khoảng cách & bo góc

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--gap-wall` | 0.7rem | Khoảng cách giữa các ô và lề màn hình |
| `--pad-panel` | 0.8rem 0.9rem | Đệm trong ô (dạng gọn: 0.7rem 0.75rem) |
| `--r-panel` | 0.8rem | Bo góc ô |
| `--r-ctrl` | 0.5rem | Tile, select, số thứ tự ô |
| `--r-cell` | 0.35rem | Ô ngày |
| `--r-pill` | 999px | Chip, badge, nhãn kết luận, thanh % |

Khoảng cách nội bộ hay dùng:

| Khoảng cách | Dùng cho |
|---|---|
| 0.3rem | Giữa các chip |
| 0.4rem | Giữa các tile |
| 0.55rem | Giữa các khối trong ô |
| 0.7rem | Giữa số thứ tự ô và tiêu đề |

---

## 6. Component

Mỗi mục ghi: **class**, cấu tạo, quy tắc.

### 6.1 Panel (ô)
`section.panel`: nền `--panel`, viền 1px `--line`, bo `--r-panel`, flex dọc, `overflow: hidden`. Biến thể: `.overview` (tổng quan), `.flow` (dòng tiền), `.detail` (chi tiết). Thêm `.compact` cho ô hẹp, `.tall` cho tổng quan dạng cột cao.

### 6.2 Header ô dòng tiền
`header.fl-head` gồm 3 phần:

1. `em.num`: ô vuông 2.2rem nền lime, số thứ tự ô (2, 3, …) đậm 800.
2. `.fl-title`: tiêu đề HOA, bên dưới là dãy `.cnt` (chấm màu + nhãn + số). Số 0 thì mờ 55%. Số Không đạt > 0 thì chữ đỏ.
3. `.fl-rate`: % lớn màu `--done` và dòng "x/y task".

Header bấm được (`.clickable`): hover thì tiêu đề chuyển lime.

### 6.3 Chip & bộ lọc
- `.filters > .frow`: nhãn `.flabel` rộng cố định (HOA, 0.72rem), sau đó là các `.chip`.
- `.chip`: pill, nền `--panel-2`, viền `--line`.
  - `.on` → nền lime, chữ tối, đậm 700.
  - `.st-<key>.on` → nền là màu trạng thái.
  - `.today` (chưa chọn) → viền và chữ lime.
  - Chip trạng thái có `i.dot` màu trạng thái phía trước.
- `.select`: cùng nền và viền với chip, bo `--r-ctrl`.

### 6.4 Tile số đếm
`button.tile.st-<key>`:
- Nền `--panel-2`, **viền trái 0.3rem màu trạng thái**, nhãn 0.7rem `--muted`, số mono 1.35rem.
- `.on`: nền trộn 22% màu trạng thái.
- `.zero`: số màu `--dim`.
- Tile "Vướng mắc": `.warn` (màu `--blocker`).

### 6.5 Vòng tròn % (ring)
`.ring` dùng `conic-gradient(var(--done) calc(var(--p) * 360deg), var(--line) 0)` với `--p` từ 0 đến 1. Bên trong là `.ring-in`: nền `--panel`, gồm số %, nhãn và "x/y task".

### 6.6 Thanh phân bố trạng thái (stacked bar)
`.stack`: cao 0.85rem, bo pill, các `i.st-<key>` có `flex-grow` = số task, khe 2px. Hàng `.ovf` gồm tên, thanh và %. Hàng bấm được.

### 6.7 Bảng
`table.grid` (`.week` | `.day`, thêm `.compact` nếu hẹp), `table-layout: fixed`.

- **Header:** sticky, nền `--panel`, chữ HOA 0.72rem `--muted`.
  - Cột ngày có 2 dòng: thứ (`.wd`, `--dim`) và ngày.
  - Cột hôm nay: chữ lime, dòng thứ ghi "Hôm nay".
- **Dòng dữ liệu** `tr.row.st-<status>`: **sọc trái 0.22rem màu trạng thái** (inset box-shadow ở ô đầu). Đường kẻ dưới `#1A2541`.
- **Dòng nhóm** `tr.grp`: chữ HOA lime 0.72rem, badge số Stt (nền lime, chữ tối, mono), sau đó là tên nhóm và "· trưởng nhóm" màu `--muted`.
- **Ô tên** gồm 3 dòng:

  | Class | Nội dung | Kiểu |
  |---|---|---|
  | `.nm` | Tên KPI | đậm 600 |
  | `.pic` | Người làm | `--muted` |
  | `.note` | ⚠ vướng mắc | `--blocker`, ẩn ở dạng gọn |

- **Cột số** `.c-num`: canh phải, mono, phần "/ KPI" màu `--muted`.

### 6.8 Ô ngày (`DayCell`)
Mỗi ô là 1 task, chỉ hiện **biểu tượng**. Nội dung task xem bằng tooltip (`title`), ở chế độ lọc 1 ngày, hoặc ở màn chi tiết.

| Dạng | Cách hiển thị |
|---|---|
| Đầy đủ | Ô cao 1.75rem, bo `--r-cell`, nền màu trạng thái 22%, viền 70%, biểu tượng ✔ ✖ ● ○ màu trạng thái. "Chưa đến hạn" không có nền |
| Gọn (`mini`) | Ô vuông 1.15rem **tô đặc**, biểu tượng tối 0.62rem. "Chưa đến hạn" là ô viền |
| Không có task | Viền nét đứt, không nền, không biểu tượng |
| Hôm nay | Viền ngoài 1px lime (gọn: vòng lime cách 2px) |

### 6.9 % đạt (`Pct`)
% = task Đạt / task đến hạn của dòng. Số mono canh phải, bên dưới là track 0.25rem (`--line-strong`) có thanh màu theo ngưỡng ở mục 3.3. Chưa có task đến hạn thì hiện "–" màu `--muted`.

### 6.10 Nhãn kết quả (`StatusTag`)
`.tag.st-<key>`: pill gồm biểu tượng và nhãn, **chữ màu trạng thái**, nền 16%, viền 60%, cỡ 0.8rem đậm 700. "Chưa đến hạn" không có nền. Dùng ở cột Kết quả (lọc 1 ngày) và màn chi tiết.

### 6.11 Màn chi tiết (từng task)
- **Header:**
  - Nhãn `.dt-kicker` "CHI TIẾT TASK" (nền lime) phía trên tiêu đề.
  - Tiêu đề HOA, phần phạm vi lọc (`.dt-scope`) chữ thường màu `--muted`.
  - 4 nút tóm tắt `.vsum.st-*` (Không đạt, Đang làm, Chưa đến hạn, Đạt): viền trái màu, số mono, bấm để lọc.
  - Nút `.btn-close` "✕ Về tổng quan".
- **Bộ lọc lồng nhau:** Dòng tiền → Nhóm (chỉ hiện khi có) → Người làm, kèm dòng gợi ý nhỏ.
- **Bảng `.dgrid`:** mỗi dòng là 1 task, gồm các cột Ngày (mono, hôm nay màu lime) · Dòng tiền · Nhóm · Người làm (kèm "TN: trưởng nhóm") · KPI (`--muted`) · **Task phải làm** (đậm, cột rộng nhất) · Kết quả (`StatusTag`) · Vướng mắc.
- Dòng Không đạt có nền đỏ 6%. Sắp xếp: Không đạt → Đang làm → Chưa đến hạn → Đạt, cùng nhóm thì ngày cũ hơn lên trước.

### 6.12 "Cần xử lý ngay"
`.hot` chỉ có ở tổng quan dạng cột cao, liệt kê các task Không đạt (cũ nhất lên trước) và tự cuộn.
- Tiêu đề HOA màu `--late`, kèm "Xem tất cả ›".
- Mỗi `.hot-item`: nền trộn đỏ 8%, viền trái đỏ, gồm nội dung task, dòng "người · KPI · dòng tiền" và ngày (mono, đỏ nhạt).

### 6.13 Trạng thái rỗng / lỗi
`.fl-empty`: chữ `--muted`, căn giữa.
- Lỗi thêm `.err` (`#FCA5A5`) và "⚠".
- Dữ liệu giả có `.badge-mock` (nền `#713F12`, chữ `#FDE68A`).

---

## 7. Bố cục

| Tình huống | Lưới |
|---|---|
| ≤ 5 dòng tiền | `.wall.grid3`: 3 cột × 2 hàng. Ô 1 là tổng quan |
| ≥ 6 dòng tiền (bố cục B) | `.wall.side`: cột tổng quan `24fr` cao 2 hàng + `ceil(n/2)` cột × 2 hàng, mỗi cột `76fr / cols`. Ô dòng tiền dùng **dạng gọn** |
| Chế độ chi tiết | `.wall.detail`: tổng quan `24fr` + chi tiết `76fr`, 1 hàng |

**Quy tắc khi làm bố cục khác:**
- Ô hẹp hơn khoảng **24rem** (≈ 370px ở 1920) thì chuyển sang dạng gọn: ô ngày chỉ còn ô màu, bỏ cột lũy kế, header chỉ còn chấm màu và số.
- Ô tổng quan dạng cột cao (`.tall`): header xếp dọc, vòng tròn ở giữa, tile 3 cột, có thêm "Cần xử lý ngay", thanh phân bố dòng tiền đặt dưới cùng (`margin-top: auto`).
- Thứ tự đọc của ô tổng quan, giữ cố định: Thương hiệu + đồng hồ → Bộ lọc → % task đạt → Số đếm → (Cần xử lý ngay) → Tiến độ từng dòng tiền → Chân trang (cập nhật lúc, nút).

---

## 8. Tương tác & chuyển động

| Hành vi | Quy tắc |
|---|---|
| Hover | Viền chip sáng lên (`#3B4D76`). Tiêu đề ô và nút đóng chuyển lime. Hàng `.ovf` có nền `--panel-2`. Không phóng to, không đổ bóng |
| Bấm trạng thái (chip/tile) | Lọc theo trạng thái **và mở chế độ chi tiết**. Bấm lần nữa thì bỏ lọc |
| Bấm tiêu đề ô / hàng dòng tiền | Mở chi tiết của riêng dòng tiền đó |
| Tự về tổng quan | Sau **120 giây** không thao tác (`?idle=`), hoặc phím **Esc** |
| Tự cuộn (`useAutoScroll`) | Chỉ khi nội dung tràn ô: ~25px/s, dừng 4s ở đầu và cuối, tạm dừng khi rê chuột vào. Ẩn thanh cuộn |
| Làm mới dữ liệu | 60 giây (`?refresh=`). Lỗi thì giữ dữ liệu cũ và báo ở chân ô tổng quan |
| Đồng hồ | Cập nhật mỗi giây, giờ `Asia/Ho_Chi_Minh` |

Không dùng animation trang trí. Chuyển động duy nhất là tự cuộn và đồng hồ.

---

## 9. Nên / Không nên

| Nên | Không nên |
|---|---|
| Lấy màu từ token, gán trạng thái bằng `st-*` | Dùng màu trạng thái cho trang trí, hoặc lime cho dữ liệu tốt/xấu |
| Dùng `rem` cho mọi kích thước | Dùng `px` cố định (trừ viền 1px) |
| Số liệu dùng `--mono` | Trộn font khác, dùng font hệ thống mặc định |
| Cắt chữ 1 dòng + `title` | Để chữ xuống dòng làm vỡ chiều cao hàng |
| Nội dung dài thì để ô tự cuộn | Để trang có thanh cuộn |
| Đặt số 0 màu `--dim` | Tô đỏ hay xanh số 0 |
| Viền mảnh, phân lớp bằng nền | Đổ bóng, gradient, bo góc lớn hơn 0.8rem |

---

## 10. Checklist khi dùng lại cho bố cục khác

1. Copy `FE/src/styles/tokens.css`, phần component trong `FE/src/styles.css`, `FE/src/components/bits.jsx`, `STATUS` / `VERDICT` trong `FE/src/lib/status.js`, và cài 2 font `@fontsource`.
2. Dựng khung bằng `.wall` + CSS grid của riêng bạn. Giữ `height: 100vh; overflow: hidden`.
3. Mỗi ô là `.panel`. Vùng nội dung dài bọc trong `div` có `flex: 1; min-height: 0; overflow-y: auto` và gắn `useAutoScroll`.
4. Gán trạng thái bằng class `st-<key>`. Không tự đặt màu.
5. Test ở 1920×960, 1920×1080, 1366×768. Không ô nào được tràn (`scrollHeight - clientHeight = 0`).
6. Đối chiếu với các ảnh trong `docs/images/`.

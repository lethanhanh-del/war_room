// Dữ liệu giả (MOCK_SHEETS=true) có cùng cấu trúc với sheet thật (quy ước "cách 1"):
//   dòng có Stt = nhóm nhỏ (tên nhóm + trưởng nhóm), dòng KPI chèn dưới, bỏ trống Stt.
// Tên nhóm / người là tên giả, không dùng dữ liệu thật.
import { todayVN } from './time.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function isoToSerial(iso) {
  return Date.parse(`${iso}T00:00:00Z`) / 86400000 + 25569;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const GROUPS = [
  ['Networking', ['Số KH tiếp cận mới', 'Lịch hẹn gặp KH', 'Giới thiệu từ đối tác']],
  ['Phụ trách đại lý', ['Đại lý hoạt động', 'Booking từ đại lý']],
  ['Data', ['Data KH mới làm sạch', 'Cuộc gọi telesale']],
  ['Viral marketing', ['Tin nhắn gửi đi', 'Lead phát sinh']],
  ['Hồ sơ, giấy tờ', ['Hồ sơ hoàn thiện', 'Hồ sơ nộp ngân hàng']],
  ['Pháp lý', ['Sổ hồng bàn giao', 'Hồ sơ pháp lý xử lý']],
  ['Banking', ['Hồ sơ vay giải ngân', 'Ngân hàng làm việc']],
];
const TASKS = [
  'Gọi lại 20 KH cũ', 'Gặp đối tác ngân hàng', 'Chốt danh sách KH tiềm năng', 'Gửi báo giá cho 5 KH',
  'Cập nhật data lên CRM', 'Hoàn thiện hồ sơ vay', 'Họp với đại lý', 'Đăng 3 bài truyền thông',
  'Đối soát công nợ', 'Nộp hồ sơ pháp lý', 'Hẹn lịch xem nhà mẫu', 'Báo cáo tiến độ tuần',
];
const NOTES = ['', '', '', 'Chờ phản hồi từ đối tác', '', 'Thiếu hồ sơ pháp lý, cần hỗ trợ', '', ''];

export function buildMockSheets(flows, today = todayVN()) {
  const days = [-2, -1, 0, 1, 2].map((n) => addDays(today, n));
  const out = {};
  flows.forEach((f, fi) => {
    const rand = rng(fi * 97 + 13);
    const head = ['Stt', 'Nhóm', 'PIC'];
    const sub = ['', '', ''];
    for (const d of days) {
      head.push(isoToSerial(d), '');
      sub.push('KPI', 'Kết quả');
    }
    head.push('Tổng kết', '', '', 'Ghi chú / Vướng mắc', 'Thư mục dữ liệu lưu trữ');
    sub.push('Lũy kế đạt', '% đạt KPI', 'Đánh giá', '', '');
    const rows = [[`BẢNG KPI ${f.label.toUpperCase()} (DỮ LIỆU GIẢ)`], ['Dữ liệu demo'], head, sub];

    const nGroups = 3 + Math.floor(rand() * 2);
    for (let g = 0; g < nGroups; g++) {
      const [gName, kpis] = GROUPS[(g + fi) % GROUPS.length];
      const lead = `Trưởng nhóm ${String.fromCharCode(65 + fi)}${g + 1}`;
      rows.push([g + 1, gName, lead]); // dòng nhóm (nền vàng trên sheet)
      const noKpi = fi === 1 && g === nGroups - 1; // 1 nhóm chưa được giao KPI
      if (noKpi) continue;
      kpis.forEach((k, ki) => {
        const pic = ki === 0 ? '' : `Nhân sự ${String.fromCharCode(65 + fi)}${g + 1}.${ki}`;
        const row = ['', k, pic];
        for (const d of days) {
          // Ô KPI = nội dung task (chữ), ô Kết quả = checkbox
          const task = rand() < 0.1 ? '' : TASKS[Math.floor(rand() * TASKS.length)];
          let done = false;
          if (task && d < today) done = rand() < 0.72;
          else if (task && d === today) done = rand() < 0.35;
          row.push(task, done);
        }
        row.push('', '', '', NOTES[(g * 3 + ki + fi) % NOTES.length], '');
        rows.push(row);
      });
    }
    out[f.sheet] = rows;
  });
  return out;
}

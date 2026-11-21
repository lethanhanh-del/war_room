// Dữ liệu giả (MOCK_SHEETS=true) có cùng cấu trúc với sheet thật, để chạy thử dashboard
// khi chưa cấu hình Google Sheet. Tên nhóm / PIC là tên giả, không dùng dữ liệu thật.
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
  'Networking',
  'Phụ trách đại lý',
  'Data',
  'Marketing',
  'Hồ sơ, giấy tờ',
  'Pháp lý',
  'Chăm sóc khách hàng',
];
const NOTES = ['', '', '', 'Chờ phản hồi từ đối tác', '', 'Thiếu hồ sơ pháp lý, cần hỗ trợ', ''];

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
    const rows = [
      [`BẢNG KPI ${f.label.toUpperCase()} (DỮ LIỆU GIẢ)`],
      ['Dữ liệu demo'],
      head,
      sub,
    ];
    const n = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const row = [i + 1, GROUPS[(i + fi) % GROUPS.length], `Nhân sự ${String.fromCharCode(65 + fi)}${i + 1}`];
      for (const d of days) {
        const kpi = rand() < 0.1 ? '' : 5 + Math.floor(rand() * 16);
        let res = '';
        if (kpi !== '' && d <= today) {
          const r = rand();
          res = d === today ? Math.floor(kpi * r) : Math.round(kpi * (0.5 + r * 0.8));
        }
        row.push(kpi, res);
      }
      row.push('', '', '', NOTES[(i * 3 + fi) % NOTES.length], '');
      rows.push(row);
    }
    out[f.sheet] = rows;
  });
  return out;
}

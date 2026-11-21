// Kiểm thử parser với dữ liệu có cùng cấu trúc sheet thật (tên người đã thay bằng tên giả).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCashflowSheet, toBool, toTask, serialToISO, normalize } from '../api/_lib/parse.js';

// Đúng bố cục sheet "DÒNG TIỀN BANKING" (21/11–25/11/2026): ô gộp ngày ở dòng 3, KPI / Kết quả ở dòng 4.
// Quy ước: dòng có Stt = nhóm nhỏ; dòng KPI chèn dưới, bỏ trống Stt.
// Mỗi ngày: ô KPI = nội dung task (chữ), ô Kết quả = checkbox (TRUE/FALSE).
const SHEET = [
  ['BẢNG KPI VÀ KẾT QUẢ ĐẠT ĐƯỢC WAR ROOM CT HOMES (21/11/2026 - 25/11/2026)'],
  ['Ô nền xanh nhạt là ô nhập ...'],
  ['Stt', 'Nhóm', 'PIC', 46347, '', 46348, '', 46349, '', 46350, '', 46351, '', 'Tổng kết', '', '', 'Ghi chú / Vướng mắc', 'Thư mục dữ liệu lưu trữ'],
  ['', '', '', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'Lũy kế đạt', '% đạt KPI', 'Đánh giá'],
  [1, 'Networking', 'Người A', '', false, '', false, '', false, '', false, '', false, '', '', '', '', 'https://drive/x'],
  ['', 'Khách hàng mới', '', 'Gọi 20 KH cũ', true, 'Gặp đối tác NH', false, 'Chốt danh sách', '', '', '', '', '', '', '', '', 'Chờ đối tác'],
  ['', 'Lịch hẹn', 'Người A2', 'Hẹn 3 KH xem nhà', 'TRUE'],
  [2, 'Phụ trách đại lý', 'Người B', 'Họp đại lý', 1],
  [],
  [3, 'Data', 'Người C'],
];

test('normalize bỏ dấu tiếng Việt', () => {
  assert.equal(normalize('  Dòng tiền   tài chính '), 'dong tien tai chinh');
  assert.equal(normalize('DÒNG TIỀN NỢ KHÓ ĐÒI'), 'dong tien no kho doi');
});

test('serial ngày -> ISO', () => {
  assert.equal(serialToISO(46347), '2026-11-21');
  assert.equal(serialToISO(46351), '2026-11-25');
});

test('đọc ô checkbox Kết quả', () => {
  for (const v of [true, 'TRUE', 'true', 1, '1', 'x', '✓', '✔', 'Đạt', 'xong']) assert.equal(toBool(v), true, String(v));
  for (const v of [false, 'FALSE', 0, '0', 'Không', 'chưa']) assert.equal(toBool(v), false, String(v));
  for (const v of ['', null, undefined, 'abc']) assert.equal(toBool(v), null, String(v));
});

test('đọc ô KPI (nội dung task)', () => {
  assert.equal(toTask('  Gọi 20 KH  '), 'Gọi 20 KH');
  assert.equal(toTask(15), '15');
  assert.equal(toTask(''), null);
  assert.equal(toTask(false), null);
  assert.equal(toTask(null), null);
});

test('parse đúng cấu trúc sheet dòng tiền (nhóm nhỏ + dòng KPI + task theo ngày)', () => {
  const r = parseCashflowSheet(SHEET);
  assert.match(r.title, /WAR ROOM CT HOMES/);
  assert.deepEqual(r.days, ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  assert.deepEqual(r.groups.map((g) => [g.stt, g.name, g.lead]), [
    ['1', 'Networking', 'Người A'],
    ['2', 'Phụ trách đại lý', 'Người B'],
    ['3', 'Data', 'Người C'],
  ]);
  assert.equal(r.items.length, 4);

  // Dòng nhóm có checkbox FALSE nhưng không có task -> không tính là dòng KPI
  const a = r.items[0];
  assert.equal(a.row, 6);
  assert.equal(a.group, 'Networking');
  assert.equal(a.kpi, 'Khách hàng mới');
  assert.equal(a.pic, 'Người A'); // bỏ trống PIC -> trưởng nhóm
  assert.equal(a.note, 'Chờ đối tác');
  assert.equal(a.folder, 'https://drive/x');
  assert.deepEqual(a.days[0], { date: '2026-11-21', task: 'Gọi 20 KH cũ', done: true });
  assert.deepEqual(a.days[1], { date: '2026-11-22', task: 'Gặp đối tác NH', done: false });
  assert.deepEqual(a.days[2], { date: '2026-11-23', task: 'Chốt danh sách', done: null });
  assert.deepEqual(a.days[3], { date: '2026-11-24', task: null, done: null });

  assert.equal(r.items[1].pic, 'Người A2');
  assert.equal(r.items[1].days[0].done, true);

  // Dòng nhóm tự ghi task -> coi là 1 dòng KPI
  assert.equal(r.items[2].group, 'Phụ trách đại lý');
  assert.equal(r.items[2].kpi, '');
  assert.deepEqual(r.items[2].days[0], { date: '2026-11-21', task: 'Họp đại lý', done: true });

  // Nhóm chưa có dòng KPI -> dòng giữ chỗ
  const c = r.items[3];
  assert.equal(c.placeholder, true);
  assert.equal(c.pic, 'Người C');
  assert.ok(c.days.every((d) => d.task === null && d.done === null));
});

test('ngày dạng chuỗi dd/mm và sheet sai cấu trúc', () => {
  const s = [['Tiêu đề 01/12/2026'], ['Stt', 'Nhóm', 'PIC', '01/12', '', '02/12', ''], ['', '', '', 'KPI', 'Kết quả', 'KPI', 'Kết quả'], [1, 'X', 'Y'], ['', 'K', '', 'Việc 1', true, 'Việc 2', false]];
  const r = parseCashflowSheet(s);
  assert.deepEqual(r.days, ['2026-12-01', '2026-12-02']);
  assert.equal(r.items[0].days[1].task, 'Việc 2');
  assert.equal(r.items[0].days[1].done, false);
  assert.throws(() => parseCashflowSheet([['a'], ['b']]), { status: 422 });
});

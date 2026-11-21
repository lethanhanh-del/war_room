// Kiểm thử parser với dữ liệu có cùng cấu trúc sheet thật (tên người đã thay bằng tên giả).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCashflowSheet, toNumber, serialToISO, normalize } from '../api/_lib/parse.js';

// Đúng bố cục sheet "DÒNG TIỀN BANKING" (21/11–25/11/2026): ô gộp ngày ở dòng 3, KPI / Kết quả ở dòng 4.
// Quy ước "cách 1": dòng có Stt = nhóm nhỏ; dòng KPI chèn dưới, bỏ trống Stt.
const SHEET = [
  ['BẢNG KPI VÀ KẾT QUẢ ĐẠT ĐƯỢC WAR ROOM CT HOMES (21/11/2026 - 25/11/2026)'],
  ['Ô nền xanh nhạt là ô nhập ...'],
  ['Stt', 'Nhóm', 'PIC', 46347, '', 46348, '', 46349, '', 46350, '', 46351, '', 'Tổng kết', '', '', 'Ghi chú / Vướng mắc', 'Thư mục dữ liệu lưu trữ'],
  ['', '', '', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'Lũy kế đạt', '% đạt KPI', 'Đánh giá'],
  [1, 'Networking', 'Người A', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'https://drive/x'],
  ['', 'Số KH tiếp cận', '', 10, 12, 10, 8, 10, '', 10, '', 10, '', '', '', '', 'Chờ đối tác'],
  ['', 'Lịch hẹn gặp', 'Người A2', 5, 5],
  [2, 'Phụ trách đại lý', 'Người B', '1.500.000', '1.500.000'],
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

test('toNumber nhiều định dạng', () => {
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber('1.500.000'), 1500000);
  assert.equal(toNumber('1,500,000'), 1500000);
  assert.equal(toNumber('2,5'), 2.5);
  assert.equal(toNumber('80%'), 0.8);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(undefined), null);
});

test('parse đúng cấu trúc sheet dòng tiền (nhóm nhỏ + dòng KPI)', () => {
  const r = parseCashflowSheet(SHEET);
  assert.match(r.title, /WAR ROOM CT HOMES/);
  assert.deepEqual(r.days, ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  assert.deepEqual(r.groups.map((g) => [g.stt, g.name, g.lead]), [
    ['1', 'Networking', 'Người A'],
    ['2', 'Phụ trách đại lý', 'Người B'],
    ['3', 'Data', 'Người C'],
  ]);
  assert.equal(r.items.length, 4);

  // KPI bỏ trống PIC -> người làm là trưởng nhóm
  const a = r.items[0];
  assert.equal(a.row, 6);
  assert.equal(a.group, 'Networking');
  assert.equal(a.kpi, 'Số KH tiếp cận');
  assert.equal(a.pic, 'Người A');
  assert.equal(a.lead, 'Người A');
  assert.equal(a.note, 'Chờ đối tác');
  assert.equal(a.folder, 'https://drive/x'); // kế thừa thư mục của nhóm
  assert.deepEqual(a.days[0], { date: '2026-11-21', kpi: 10, result: 12 });
  assert.deepEqual(a.days[2], { date: '2026-11-23', kpi: 10, result: null });

  // KPI có PIC riêng
  assert.equal(r.items[1].kpi, 'Lịch hẹn gặp');
  assert.equal(r.items[1].pic, 'Người A2');

  // Dữ liệu cũ: dòng nhóm tự nhập số -> coi là 1 task
  assert.equal(r.items[2].group, 'Phụ trách đại lý');
  assert.equal(r.items[2].kpi, '');
  assert.equal(r.items[2].days[0].kpi, 1500000);

  // Nhóm chưa có KPI -> dòng giữ chỗ để thấy ai chưa được giao
  const c = r.items[3];
  assert.equal(c.placeholder, true);
  assert.equal(c.pic, 'Người C');
  assert.ok(c.days.every((d) => d.kpi === null && d.result === null));
});

test('ngày dạng chuỗi dd/mm và sheet sai cấu trúc', () => {
  const s = [['Tiêu đề 01/12/2026'], ['Stt', 'Nhóm', 'PIC', '01/12', '', '02/12', ''], ['', '', '', 'KPI', 'Kết quả', 'KPI', 'Kết quả'], [1, 'X', 'Y', 3, 3, 3, 0]];
  const r = parseCashflowSheet(s);
  assert.deepEqual(r.days, ['2026-12-01', '2026-12-02']);
  assert.equal(r.items[0].days[1].result, 0);
  assert.throws(() => parseCashflowSheet([['a'], ['b']]), { status: 422 });
});

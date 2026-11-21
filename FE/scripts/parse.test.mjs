// Kiểm thử parser với dữ liệu có cùng cấu trúc sheet thật (tên người đã thay bằng tên giả).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCashflowSheet, toNumber, serialToISO, normalize } from '../api/_lib/parse.js';

// Đúng bố cục sheet "DÒNG TIỀN BANKING" (21/11–25/11/2026): ô gộp ngày ở dòng 3, KPI / Kết quả ở dòng 4.
const SHEET = [
  ['BẢNG KPI VÀ KẾT QUẢ ĐẠT ĐƯỢC WAR ROOM CT HOMES (21/11/2026 - 25/11/2026)'],
  ['Ô nền xanh nhạt là ô nhập ...'],
  ['Stt', 'Nhóm', 'PIC', 46347, '', 46348, '', 46349, '', 46350, '', 46351, '', 'Tổng kết', '', '', 'Ghi chú / Vướng mắc', 'Thư mục dữ liệu lưu trữ'],
  ['', '', '', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'Lũy kế đạt', '% đạt KPI', 'Đánh giá'],
  [1, 'Networking', 'Người A', 10, 12, 10, 8, 10, '', 10, '', 10, '', '', '', '', 'Chờ đối tác', 'https://drive/x'],
  [2, 'Phụ trách đại lý', 'Người B', '1.500.000', '1.500.000'],
  [],
  ['', 'NHÓM PHỤ (dòng vàng)', '', '', ''],
  ['', 'KPI phụ', '', 5, 1],
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

test('parse đúng cấu trúc sheet dòng tiền', () => {
  const r = parseCashflowSheet(SHEET);
  assert.match(r.title, /WAR ROOM CT HOMES/);
  assert.deepEqual(r.days, ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  assert.equal(r.items.length, 4);

  const a = r.items[0];
  assert.equal(a.row, 5);
  assert.equal(a.stt, '1');
  assert.equal(a.group, 'Networking');
  assert.equal(a.pic, 'Người A');
  assert.equal(a.note, 'Chờ đối tác');
  assert.equal(a.folder, 'https://drive/x');
  assert.deepEqual(a.days[0], { date: '2026-11-21', kpi: 10, result: 12 });
  assert.deepEqual(a.days[2], { date: '2026-11-23', kpi: 10, result: null });

  assert.equal(r.items[1].days[0].kpi, 1500000);

  // Dòng KPI chèn dưới dòng nhóm (không có PIC) -> kế thừa PIC phía trên, lấy tên KPI ở cột Nhóm
  const sub = r.items[2];
  assert.equal(sub.group, 'KPI phụ');
  assert.equal(sub.pic, 'Người B');
  assert.equal(sub.days[0].kpi, 5);

  // PIC chưa nhập số liệu vẫn xuất hiện (để thấy ai chưa có KPI)
  assert.equal(r.items[3].pic, 'Người C');
  assert.ok(r.items[3].days.every((d) => d.kpi === null && d.result === null));
});

test('ngày dạng chuỗi dd/mm và sheet sai cấu trúc', () => {
  const s = [['Tiêu đề 01/12/2026'], ['Stt', 'Nhóm', 'PIC', '01/12', '', '02/12', ''], ['', '', '', 'KPI', 'Kết quả', 'KPI', 'Kết quả'], [1, 'X', 'Y', 3, 3, 3, 0]];
  const r = parseCashflowSheet(s);
  assert.deepEqual(r.days, ['2026-12-01', '2026-12-02']);
  assert.equal(r.items[0].days[1].result, 0);
  assert.throws(() => parseCashflowSheet([['a'], ['b']]), { status: 422 });
});

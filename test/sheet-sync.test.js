import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvSheet, NOT_PUBLIC, parseCsv, parseSheetList, readSheet, sheetId, streamSections } from '../src/excel/gsheet.js';
import { extractWorkbook } from '../src/excel/tasks.js';

const NOW = Date.UTC(2026, 10, 21, 8, 0, 0); // 21/11/2026 15:00 giờ VN
const MASTER = '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0';

test('sheetId: mặc định WR - MASTER TASK, nhận link hoặc ID, "off" để tắt', () => {
  assert.equal(sheetId({}), MASTER);
  assert.equal(sheetId({ EXCEL_SHEET_URL: '  ' }), MASTER);
  assert.equal(sheetId({ EXCEL_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1O8xR_5SPxF2U5rl5d11_hKeqybF2cItWBER1ijsoCsE/edit?gid=0#gid=0' }), '1O8xR_5SPxF2U5rl5d11_hKeqybF2cItWBER1ijsoCsE');
  assert.equal(sheetId({ EXCEL_SHEET_URL: MASTER }), MASTER);
  assert.equal(sheetId({ EXCEL_SHEET_URL: 'off' }), '');
  assert.equal(sheetId({ EXCEL_SHEET_URL: 'không phải link' }), '');
});

test('parseSheetList: tên + gid các sheet đang hiện, giải mã ký tự thoát, bỏ trùng', () => {
  const html = `var x = [{name: "Dòng tiền Banking", pageUrl: "https:\\/\\/docs.google.com\\/spreadsheets\\/d\\/X\\/htmlview\\/sheet?headers\\x3dtrue&gid=1129897630", gid: "1129897630"},`
    + `{name: "Dòng tiền R\\x26D \\"mới\\"", pageUrl: "https:\\/\\/x", gid: "42"},`
    + `{name: "Dòng tiền Banking", pageUrl: "https:\\/\\/x", gid: "1129897630"}];`;
  assert.deepEqual(parseSheetList(html), [
    { name: 'Dòng tiền Banking', gid: '1129897630' },
    { name: 'Dòng tiền R&D "mới"', gid: '42' },
  ]);
  assert.deepEqual(parseSheetList('<html>Đăng nhập Google</html>'), []);
});

test('parseCsv: ô trong ngoặc kép, "" là dấu ", xuống dòng trong ô, CRLF, BOM', () => {
  const csv = '﻿STT,Task\r\n1,"Sắp xếp lịch với THA/Coop, mời HDBank\ncùng tham gia"\r\n2,"Ghi chú ""gấp"""\r\n,\n3,cuối';
  assert.deepEqual(parseCsv(csv), [
    ['STT', 'Task'],
    ['1', 'Sắp xếp lịch với THA/Coop, mời HDBank\ncùng tham gia'],
    ['2', 'Ghi chú "gấp"'],
    ['', ''],
    ['3', 'cuối'],
  ]);
  assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]);
});

test('csvSheet: số dòng giữ đúng như trong Sheet, bỏ dòng trống, bỏ phần giây của ngày giờ', () => {
  const sheet = csvSheet('Dòng tiền Banking', [['STT', 'Task'], ['', ''], ['1', 'Việc A'], ['2', '25/11/2026 14:00:00']]);
  assert.equal(sheet.name, 'Dòng tiền Banking');
  assert.equal(sheet.hidden, false);
  assert.deepEqual(sheet.rows.map((r) => r.r), [1, 3, 4]);
  assert.equal(sheet.rows[2].cells[1].v, '25/11/2026 14:00');
  assert.equal(csvSheet('x', [['a', ' ', 'b']]).rows[0].cells[1], undefined);
});

test('CSV từ Google Sheet đọc bằng đúng quy tắc của "Nạp task Excel" (file tổng)', () => {
  const header = ['STT', 'Dòng tiền', 'Nhóm công việc', 'Task / Đầu việc', 'Người phụ trách', 'Người phối hợp', 'Hạn hoàn thành', 'Trạng thái', 'Ưu tiên', 'Đầu ra cần có', 'Điểm nghẽn / Cần hỗ trợ'];
  const banking = csvSheet('Dòng tiền Banking', parseCsv([
    header.join(','),
    '1,Dòng tiền 2: Banking,H300 – DELTA,Lấy phán quyết của Tòa Cái Mép,Chị Thúy Hiền,,25/11/2026,Vướng mắc,P0,Phán quyết của Tòa,Chưa có phán quyết',
    '2,Dòng tiền 2: Banking,H300 – DELTA,"Sắp xếp lịch với THA/Coop, mời HDBank",Nguyễn Thế Nhiên,"Ban PTDA, Pháp chế",24/11/2026 09:30:00,Đang thực hiện,P1,Lịch làm việc,',
  ].join('\n')));
  const empty = csvSheet('Dòng tiền Tài chính', parseCsv(header.join(',')));
  const book = extractWorkbook({ sheets: [empty, banking] }, { fileName: 'Google Sheet WR - MASTER TASK', now: NOW });
  assert.equal(book.format, 'master');
  assert.deepEqual(book.sections.map((s) => [s.sheet, s.name, s.tasks.length]), [['Dòng tiền Tài chính', 'Tài chính', 0], ['Dòng tiền Banking', 'Banking', 2]]);
  const [a, b] = book.sections[1].tasks;
  assert.equal(a.subject, 'Lấy phán quyết của Tòa Cái Mép');
  assert.equal(a.owner, 'Thúy Hiền');
  assert.equal(a.due, '2026-11-25');
  assert.equal(b.subject, 'Sắp xếp lịch với THA/Coop, mời HDBank');
  assert.equal(b.support, 'Ban PTDA, Pháp chế');
  assert.equal(b.due, '2026-11-24 09:30');
  assert.match(book.warnings.join(' '), /Tài chính/);
});

/** Giả lập Google: url -> [nội dung, Content-Type]. */
function fakeGoogle(routes) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const hit = Object.entries(routes).find(([k]) => String(url).endsWith(k));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit[1][0], { headers: { 'Content-Type': hit[1][1] } });
  };
  return () => { globalThis.fetch = real; };
}

const HEADER = 'STT,Dòng tiền,Nhóm công việc,Task / Đầu việc,Người phụ trách,Người phối hợp,Hạn hoàn thành,Trạng thái,Ưu tiên,Đầu ra cần có,Điểm nghẽn / Cần hỗ trợ';
const sheetOf = (name, csv) => csvSheet(name, parseCsv(csv));

test('readSheet: mỗi sheet "Dòng tiền …" là 1 thẻ theo thứ tự file, kể cả sheet trống / hỏng tiêu đề (kèm cảnh báo)', async () => {
  const restore = fakeGoogle({
    '/htmlview': ['items.push({name: "Dòng tiền Tài chính", pageUrl: "x", gid: "33"}); items.push({name: "Dòng tiền Banking", pageUrl: "x", gid: "11"}); items.push({name: "Dòng tiền nợ khó đòi", pageUrl: "x", gid: "22"});', 'text/html'],
    'gid=33': [HEADER, 'text/csv; charset=utf-8'],
    'gid=11': [`${HEADER}\n1,Dòng tiền 2: Banking,SS1,Chốt hạn mức,Nguyễn Thế Nhiên,,25/11/2026,Đang thực hiện,P0,Biên bản,`, 'text/csv; charset=utf-8'],
    'gid=22': ['STT,Cột 2,Cột 3,Cột 4,Cột 5,Người phối hợp,Hạn hoàn thành,Trạng thái,Ưu tiên,Đầu ra cần có,Điểm nghẽn / Cần hỗ trợ', 'text/csv; charset=utf-8'],
  });
  try {
    const book = await readSheet('X', { now: NOW });
    assert.deepEqual(book.sections.map((s) => [s.sheet, s.code, s.title, s.tasks.length]), [
      ['Dòng tiền Tài chính', '', 'Dòng tiền: Tài chính', 0],
      ['Dòng tiền Banking', 'DT02', 'Dòng tiền 2: Banking', 1],
      ['Dòng tiền nợ khó đòi', '', 'Dòng tiền: Nợ khó đòi', 0],
    ]);
    assert.match(book.warnings.join('\n'), /Sheet “Dòng tiền nợ khó đòi” không có dòng tiêu đề hợp lệ/);
  } finally {
    restore();
  }
});

test('streamSections: số dòng tiền lấy từ cột "Dòng tiền" (khớp tên, bỏ qua dấu câu); mọi sheet trống -> đủ thẻ 0 task', () => {
  const thu = sheetOf('Dòng tiền thu trước hạn quá hạn', `${HEADER}\n1,Dòng tiền 4: Thu trước hạn/quá hạn,,Thu hồi công nợ,Nguyễn Thế Nhiên,,,Chưa cập nhật,,,`);
  const other = sheetOf('Dòng tiền Banking', `${HEADER}\n1,Dòng tiền 9: Tài chính,,Việc lạc sheet,Nguyễn Thế Nhiên,,,Chưa cập nhật,,,`);
  const book = streamSections([thu, other, sheetOf('Hướng dẫn', 'Ghi chú')], { now: NOW });
  assert.deepEqual(book.sections.map((s) => [s.code, s.name]), [['DT04', 'Thu trước hạn quá hạn'], ['', 'Banking']]);

  const empty = streamSections([sheetOf('Dòng tiền Tài chính', HEADER), sheetOf('Dòng tiền Banking', '')], { now: NOW });
  assert.deepEqual(empty.sections.map((s) => [s.name, s.tasks.length]), [['Tài chính', 0], ['Banking', 0]]);
  assert.match(empty.warnings.join('\n'), /chưa có task nào/);

  assert.throws(() => streamSections([sheetOf('Trang tính1', HEADER)]), /không có sheet nào tên “Dòng tiền …”/);
});

test('streamSections: PIC ghi ở 1 ô phía trên dòng tiêu đề ("PIC phụ trách: …")', () => {
  const banking = sheetOf('Dòng tiền Banking', `PIC phụ trách: Chị Nguyễn Thị Mai Thu,,\n${HEADER}\n1,Dòng tiền 2: Banking,SS1,Chốt hạn mức,Nguyễn Thế Nhiên,,25/11/2026,Đang xử lý,P0,Biên bản,`);
  const [sec] = streamSections([banking], { now: NOW }).sections;
  assert.equal(sec.pic, 'Nguyễn Thị Mai Thu');
  assert.equal(sec.code, 'DT02');
  assert.equal(sec.tasks.length, 1);
});

test('readSheet: Sheet chưa chia sẻ công khai -> lỗi hướng dẫn chia sẻ', async () => {
  const restore = fakeGoogle({
    '/htmlview': ['<html>Đăng nhập — Tài khoản Google</html>', 'text/html'],
    'format=xlsx': ['<html>Đăng nhập</html>', 'text/html'],
  });
  try {
    await assert.rejects(readSheet('X'), { message: NOT_PUBLIC });
  } finally {
    restore();
  }
});

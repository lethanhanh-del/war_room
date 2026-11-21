import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readXlsx, XlsxError } from '../src/excel/xlsx.js';
import { cleanOwner, dueFromCell, excelStatus, extractWorkbook, isGroupOwner, parseStreamTitle, parseWorkbookFile, progressFromCell } from '../src/excel/tasks.js';
import { makeDirectory, matchStream, mergeExcelImports, previewImport } from '../src/excel/merge.js';
import { buildStreamsModel } from '../src/worksuite/model.js';

const NOW = Date.UTC(2026, 10, 21, 8, 0, 0); // 21/11/2026 15:00 giờ VN
const PERIOD = { start: '2026-11-21', end: '2026-11-25' };

// ---------- dựng file .xlsx giả giống file mẫu "DONG_TIEN_2_BANKING" ----------

const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP tối giản (không tính CRC — bộ đọc không kiểm CRC). */
async function makeZip(files, { deflate = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(content);
    const data = deflate ? await deflateRaw(raw) : raw;
    const method = deflate ? 8 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, method, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, Object.keys(files).length, true);
  eocd.setUint16(10, Object.keys(files).length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

const col = (i) => String.fromCharCode(65 + i);
/** Ô: chuỗi -> inlineStr; {s: n} -> shared string; {n, s} -> số có style; null -> bỏ trống. */
function cellXml(ref, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return `<x:c r="${ref}" t="inlineStr"><x:is><x:t>${xmlEsc(v)}</x:t></x:is></x:c>`;
  if (typeof v === 'number') return `<x:c r="${ref}" t="n"><x:v>${v}</x:v></x:c>`;
  if ('shared' in v) return `<x:c r="${ref}" t="s"><x:v>${v.shared}</x:v></x:c>`;
  return `<x:c r="${ref}" s="${v.style}" t="n"><x:v>${v.n}</x:v></x:c>`;
}
function sheetXml(rows) {
  const body = rows.map(([r, cells]) => `<x:row r="${r}">${cells.map((v, i) => cellXml(`${col(i)}${r}`, v)).join('')}</x:row>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${body}</x:sheetData></x:worksheet>`;
}

const HEADER = ['STT', 'Mã task', 'Dòng tiền', 'Nội dung nhiệm vụ', 'Người phụ trách', 'Deadline', 'Trạng thái', '% thực hiện',
  'Sản phẩm / bằng chứng hoàn thành', 'Điểm nghẽn / rủi ro', 'Bước tiếp theo', 'Ưu tiên', 'Link hồ sơ', 'Hiển thị LED', 'Ghi chú kiểm soát'];
const D = (serial) => ({ n: serial, style: 1 }); // ô ngày dd/mm/yyyy
const PCT = (n) => ({ n, style: 2 }); // ô phần trăm

// 46347 = 21/11/2026 … 46351 = 25/11/2026, 46356 = 30/11/2026
const TASK_ROWS = [
  [1, 'H01', 'H300 – DELTA', 'Lấy phán quyết của Tòa Cái Mép', 'Chị Thúy Hiền', D(46351), 'Vướng mắc', null, 'Phán quyết của Tòa', 'Chưa có phán quyết', 'Thúc đẩy hồ sơ Tòa', 'P0', null, 'Có', ''],
  [2, 'H02', 'H300 – DELTA', 'Sắp xếp lịch với THA/Coop', 'Anh Lê Công Sum', D(46350), 'Đang xử lý', PCT(0.4), 'Lịch làm việc', 'Chưa có lịch', 'Liên hệ THA', 'P0', 'https://drive.example/h02', 'Có', ''],
  [3, 'S01', 'SS1 – HẠN MỨC', 'Hồ sơ xây dựng', 'Anh Võ Trường Sơn', D(46347), 'Chờ hồ sơ', null, 'Bộ hồ sơ', 'BXD chưa bàn giao', '', 'P0', null, 'Có', ''],
  [4, 'S02', 'SS1 – HẠN MỨC', 'Chủ trương đầu tư DA SS1', 'Ban PTDA', D(46356), 'Chờ hồ sơ', null, 'Bộ pháp lý', 'Chưa đủ hồ sơ', 'Cập nhật văn bản', 'P0', null, 'Có', ''],
  [5, 'S05', 'SS1 – HẠN MỨC', 'Hoàn thiện hồ sơ trình HDBank', 'Chị Nguyễn Thị Mai Thu', D(46351), 'Chưa cập nhật', null, 'Hồ sơ tổng hợp', '', '', 'P0', null, 'Có', ''],
  [6, 'S09', 'SS1 – HẠN MỨC', 'Đã xong việc nhỏ', 'Anh Nguyễn Thế Nhiên', '24/11/2026', 'Hoàn thành', null, 'Biên bản', '', '', 'P1', null, 'Có', ''],
  [7, 'S10', 'SS1 – HẠN MỨC', 'Dòng ẩn khỏi LED', 'Anh Nguyễn Thế Nhiên', D(46351), 'Đang xử lý', null, '', '', '', '', null, 'Không', ''],
  [8, 'S11', 'SS1 – HẠN MỨC', '', 'Anh Nguyễn Thế Nhiên', null, '', null, '', '', '', '', null, 'Có', ''], // không có nội dung -> bỏ
];

async function bankingFile({ deflate = false } = {}) {
  const sheet1 = sheetXml([
    [1, ['DÒNG TIỀN 2: BANKING  |  NHẬP TASK & THEO DÕI']],
    [4, ['Thời điểm kiểm soát: 21/11/2026  •  Hạn do War Room đề xuất']],
    [7, HEADER.map((h, i) => (i === 3 ? { shared: 0 } : h))],
    ...TASK_ROWS.map((r, i) => [8 + i, r]),
  ]);
  const sheet2 = sheetXml([
    [1, ['DÒNG TIỀN 2: BANKING']],
    [3, ['Phụ trách: Nguyễn Thị Mai Thu  |  Ngày kiểm soát: 21/11/2026']],
    [10, ['MÃ', 'NHIỆM VỤ', 'PHỤ TRÁCH', 'HẠN', 'TRẠNG THÁI']],
  ]);
  return makeZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets>'
      + '<x:sheet name="02_DASHBOARD_LED" sheetId="2" r:id="R2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" />'
      + '<x:sheet name="01_NHAP_TASK" sheetId="1" r:id="R1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" />'
      + '</x:sheets></x:workbook>',
    'xl/_rels/workbook.xml.rels': '﻿<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Type="…/styles" Target="/xl/styles.xml" Id="RS" />'
      + '<Relationship Type="…/sharedStrings" Target="sharedStrings.xml" Id="RSS" />'
      + '<Relationship Type="…/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R1" />'
      + '<Relationship Type="…/worksheet" Target="worksheets/sheet2.xml" Id="R2" /></Relationships>',
    'xl/styles.xml': '<x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:numFmts count="1"><x:numFmt numFmtId="200" formatCode="dd/mm/yyyy" /></x:numFmts>'
      + '<x:cellXfs count="3"><x:xf numFmtId="0" /><x:xf numFmtId="200" applyNumberFormat="1" /><x:xf numFmtId="9" /></x:cellXfs></x:styleSheet>',
    'xl/sharedStrings.xml': '<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:r><x:t>Nội dung </x:t></x:r><x:r><x:t>nhiệm vụ</x:t></x:r></x:si></x:sst>',
    'xl/worksheets/sheet1.xml': sheet1,
    'xl/worksheets/sheet2.xml': sheet2,
  }, { deflate });
}

/** File 1 dòng tiền -> phần duy nhất. */
async function parseOne(bytes, opts) {
  const book = await parseWorkbookFile(bytes, opts);
  assert.equal(book.sections.length, 1);
  return book.sections[0];
}

const USERS = [
  { full_name: 'Mạc Thị Thúy Hiền', title: 'Trưởng Phòng Đối ngoại', department: 'Ban Đối ngoại' },
  { full_name: 'Lê Thị Thảo Hiền', title: 'Nhân viên truyền thông', department: 'Ban Kinh doanh' },
  { full_name: 'Võ Trường Sơn', title: 'Giám đốc BXD', department: 'Ban XD' },
  { full_name: 'Lê Công Sum', title: 'Giám đốc HTC', department: 'HTC' },
];

// ---------- xlsx.js ----------

test('readXlsx: đọc sheet, chuỗi inline/shared, ô ngày và ô phần trăm (ZIP không nén và nén deflate)', async () => {
  for (const deflate of [false, true]) {
    const book = await readXlsx(await bankingFile({ deflate }));
    assert.deepEqual(book.sheets.map((s) => s.name), ['02_DASHBOARD_LED', '01_NHAP_TASK']);
    const rows = book.sheets[1].rows;
    assert.equal(rows[0].cells[0].v, 'DÒNG TIỀN 2: BANKING  |  NHẬP TASK & THEO DÕI');
    const header = rows.find((r) => r.r === 7);
    assert.equal(header.cells[3].v, 'Nội dung nhiệm vụ'); // shared string ghép từ nhiều <t>
    const h01 = rows.find((r) => r.r === 8);
    assert.deepEqual(h01.cells[5], { v: 46351, kind: 'date' });
    const h02 = rows.find((r) => r.r === 9);
    assert.deepEqual(h02.cells[7], { v: 0.4, kind: 'pct' });
  }
});

test('readXlsx: file không phải .xlsx -> lỗi dễ hiểu', async () => {
  await assert.rejects(readXlsx(enc.encode('not a zip file at all')), XlsxError);
  await assert.rejects(readXlsx(await makeZip({ 'a.txt': 'x' })), /thiếu xl\/workbook\.xml/);
});

// ---------- tasks.js ----------

test('excelStatus: trạng thái tiếng Việt trong file -> trạng thái Worksuite', () => {
  assert.equal(excelStatus('Vướng mắc'), 'Pending');
  assert.equal(excelStatus('Chờ hồ sơ'), 'Pending');
  assert.equal(excelStatus('Chờ hoàn thiện'), 'Pending');
  assert.equal(excelStatus('Đang xử lý'), 'In Progress');
  assert.equal(excelStatus('Chưa cập nhật'), 'Open');
  assert.equal(excelStatus(''), 'Open');
  assert.equal(excelStatus('Hoàn thành'), 'Completed');
  assert.equal(excelStatus('Chờ duyệt'), 'In Review');
  assert.equal(excelStatus('Quá hạn'), 'Overdue');
  assert.equal(excelStatus('Đã huỷ'), 'Cancelled');
  assert.equal(excelStatus('???'), null);
});

test('người phụ trách, deadline, % và tiêu đề dòng tiền', () => {
  assert.equal(cleanOwner('Chị Nguyễn Thị Mai Thu'), 'Nguyễn Thị Mai Thu');
  assert.equal(cleanOwner('  Anh   Lê Công Sum '), 'Lê Công Sum');
  assert.equal(cleanOwner('Ban PTDA'), 'Ban PTDA');
  assert.equal(isGroupOwner('Ban PTDA'), true);
  assert.equal(isGroupOwner('Ban Kinh doanh / MarCom'), true);
  assert.equal(isGroupOwner('Anh A và chị B'), true);
  assert.equal(isGroupOwner('Nguyễn Thế Nhiên'), false);

  assert.equal(dueFromCell({ v: 46351, kind: 'date' }, 2026), '2026-11-25');
  assert.equal(dueFromCell({ v: 46351.5 }, 2026), '2026-11-25 12:00');
  assert.equal(dueFromCell({ v: '25/11/2026' }, 2026), '2026-11-25');
  assert.equal(dueFromCell({ v: '25/11' }, 2026), '2026-11-25');
  assert.equal(dueFromCell({ v: '2026-11-25' }, 2026), '2026-11-25');
  assert.equal(dueFromCell({ v: 'tuần sau' }, 2026), '');
  assert.equal(dueFromCell(undefined, 2026), '');

  assert.equal(progressFromCell({ v: 0.4, kind: 'pct' }), 40);
  assert.equal(progressFromCell({ v: 1, kind: 'pct' }), 100);
  assert.equal(progressFromCell({ v: 60 }), 60);
  assert.equal(progressFromCell({ v: '75%' }), 75);
  assert.equal(progressFromCell({ v: 140 }), 100);
  assert.equal(progressFromCell(undefined), null);

  assert.deepEqual(parseStreamTitle('DÒNG TIỀN 2: BANKING  |  NHẬP TASK & THEO DÕI'), { no: 2, name: 'Banking' });
  assert.deepEqual(parseStreamTitle('Dòng tiền nợ khó đòi'), { no: null, name: 'Nợ khó đòi' });
  assert.equal(parseStreamTitle('Thời điểm kiểm soát'), null);
});

test('extractTasks: đọc đúng file mẫu Banking', async () => {
  const r = await parseOne(await bankingFile(), { fileName: 'DONG_TIEN_2_BANKING.xlsx', now: NOW });
  assert.equal(r.title, 'Dòng tiền 2: Banking');
  assert.equal(r.code, 'DT02');
  assert.equal(r.name, 'Banking');
  assert.equal(r.pic, 'Nguyễn Thị Mai Thu');
  assert.equal(r.asOf, '21/11/2026');
  assert.equal(r.sheet, '01_NHAP_TASK'); // bỏ qua sheet dashboard đứng trước
  assert.deepEqual(r.tasks.map((t) => t.code), ['H01', 'H02', 'S01', 'S02', 'S05', 'S09']); // bỏ dòng "Không" và dòng trống
  const h02 = r.tasks[1];
  assert.equal(h02.owner, 'Lê Công Sum');
  assert.equal(h02.due, '2026-11-24');
  assert.equal(h02.progress, 40);
  assert.equal(h02.link, 'https://drive.example/h02');
  assert.equal(h02.group, 'H300 – DELTA');
  assert.equal(r.tasks[5].due, '2026-11-24'); // deadline ghi bằng chữ
  assert.ok(r.warnings.some((w) => /Hiển thị LED/.test(w)));
});

// File tổng "WR - MASTER TASK": mỗi sheet "Dòng tiền …" là 1 dòng tiền, có sheet danh mục ẩn.
const MASTER_HEADER = ['STT', 'Dòng tiền', 'Nhóm công việc', 'Task / Đầu việc', 'Người phụ trách', 'Người phối hợp', 'Hạn hoàn thành', 'Trạng thái', 'Ưu tiên', 'Đầu ra cần có', 'Điểm nghẽn / Cần hỗ trợ'];
async function masterFile() {
  const sheets = {
    'Dòng tiền Banking': [
      [1, MASTER_HEADER],
      [2, [1, 'Banking', 'SS1 – Hạn mức', 'Hoàn thiện hồ sơ trình HDBank', 'Nguyễn Thị Mai Thu', 'Huỳnh Ngọc Nhật Tài, Ban PTDA', D(46351), 'Đang thực hiện', 'P0', 'Hồ sơ tổng hợp', 'Chờ FS']],
      [3, [2, 'Banking', 'SS1 – Hạn mức', 'Chốt điều kiện hạn mức', 'Nguyễn Thế Nhiên', '', D(46352), 'Cần hỗ trợ', 'P0', 'Biên bản làm việc', 'Phụ thuộc HDBank']],
      ...Array.from({ length: 50 }, (_, i) => [4 + i, []]), // dòng trống có định dạng
    ],
    'Dòng tiền Tài chính': [[1, MASTER_HEADER], [2, [1, 'Tài chính', 'Kế hoạch', 'Tổng hợp 10 dòng tiền', 'Phạm Thanh Hùng', '', '24/11/2026', 'Hoàn tất', '', 'Báo cáo', '']]],
    'Dòng tiền nợ khó đòi': [[1, MASTER_HEADER]],
    'DataValidation': [[1, ['Company', 'Department']], [2, ['CTM', 'Ban Tài chính']]],
  };
  const names = Object.keys(sheets);
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}"${n === 'DataValidation' ? ' state="veryHidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map((n, i) => `<Relationship Id="rId${i + 1}" Type="…/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rS" Type="…/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="9"/></cellXfs></styleSheet>',
  };
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n]).replace(/<x:row r="(\d+)"><\/x:row>/g, '<x:row r="$1"><x:c r="G$1" s="1"/></x:row>');
  });
  return makeZip(files, { deflate: true });
}

test('extractWorkbook: file tổng — mỗi sheet "Dòng tiền …" là 1 dòng tiền, bỏ qua sheet ẩn và dòng trống', async () => {
  const book = await parseWorkbookFile(await masterFile(), { now: NOW });
  assert.equal(book.format, 'master');
  assert.deepEqual(book.sections.map((s) => s.name), ['Banking', 'Tài chính', 'Nợ khó đòi']);
  const [banking, taichinh, nokhodoi] = book.sections;
  assert.equal(banking.tasks.length, 2);
  const t = banking.tasks[0];
  assert.equal(t.subject, 'Hoàn thiện hồ sơ trình HDBank');
  assert.equal(t.group, 'SS1 – Hạn mức'); // "Nhóm công việc", không phải cột "Dòng tiền"
  assert.equal(t.owner, 'Nguyễn Thị Mai Thu');
  assert.equal(t.support, 'Huỳnh Ngọc Nhật Tài, Ban PTDA');
  assert.equal(t.due, '2026-11-25');
  assert.equal(t.output, 'Hồ sơ tổng hợp');
  assert.equal(t.blocker, 'Chờ FS');
  assert.equal(excelStatus(banking.tasks[1].status), 'Pending'); // "Cần hỗ trợ"
  assert.equal(excelStatus(taichinh.tasks[0].status), 'Completed'); // "Hoàn tất"
  assert.equal(taichinh.tasks[0].due, '2026-11-24');
  assert.equal(nokhodoi.tasks.length, 0);
  assert.ok(book.warnings.some((w) => /chưa có task: Nợ khó đòi/.test(w)));
});

test('extractWorkbook: file tổng chưa có task nào -> báo lỗi rõ ràng', () => {
  const header = { r: 1, cells: MASTER_HEADER.map((v) => ({ v })) };
  const book = { sheets: ['Dòng tiền Banking', 'Dòng tiền Tài chính'].map((name) => ({ name, hidden: false, rows: [header] })) };
  assert.throws(() => extractWorkbook(book), /File chưa có task nào/);
});

test('extractTasks: file không có bảng task -> báo lỗi', async () => {
  const book = { sheets: [{ name: 'DS nhân sự', hidden: false, rows: [{ r: 2, cells: [{ v: 'STT' }, { v: 'Thành viên tham gia' }, { v: 'Nhiệm vụ thực hiện' }] }] }] };
  assert.throws(() => extractWorkbook(book), /Không tìm thấy bảng task/);
});

// ---------- merge.js ----------

function wsModel() {
  return buildStreamsModel({
    project: { name: 'PROJ-0536', project_name: 'WAR ROOM' },
    tasks: [
      { name: 'T1', subject: 'Dòng tiền Banking', status: 'Open', custom_assignee: 'EMP-THU', creation: '1' },
      { name: 'T2', subject: 'Dòng tiền nợ khó đòi', status: 'Open', custom_assignee: 'EMP-HIEN', creation: '2' },
      { name: 'T3', subject: 'Gửi thông báo', status: 'In Progress', parent_task: 'T2', custom_assignee: 'EMP-HIEN', progress: 50, creation: '3' },
    ],
    employees: [
      { name: 'EMP-THU', employee_name: 'Nguyễn Thị Mai Thu', designation: 'Giám đốc Ban Kế toán 1' },
      { name: 'EMP-HIEN', employee_name: 'Mạc Thị Thúy Hiền' },
    ],
  }, { now: NOW, worksuiteUrl: 'https://ws.example/worksuite' });
}

test('makeDirectory / matchStream', () => {
  const lookup = makeDirectory(USERS);
  assert.equal(lookup('Thúy Hiền').name, 'Mạc Thị Thúy Hiền'); // khớp phần cuối, duy nhất
  assert.equal(lookup('Hiền'), null); // 1 chữ: không đoán
  assert.equal(lookup('Võ Trường Sơn').title, 'Giám đốc BXD');
  const ws = wsModel();
  assert.equal(matchStream(ws.streams, { name: 'Banking' }).id, 'T1');
  assert.equal(matchStream(ws.streams, { name: 'Nợ khó đòi' }).id, 'T2');
  assert.equal(matchStream(ws.streams, { name: 'Trái phiếu' }), null);
  // Tên sheet trong file tổng ngắn hơn / khác dấu câu so với Worksuite
  const live = [
    { id: 'A', name: 'Tài chính phụ trách triển khai và chịu trách nhiệm 10 dòng tiền', fullName: 'Dòng tiền Tài chính phụ trách triển khai và chịu trách nhiệm 10 dòng tiền' },
    { id: 'B', name: 'Kiểm soát kỷ luật War-Room', fullName: 'Dòng tiền kiểm soát kỷ luật War-Room' },
    { id: 'C', name: 'Thu trước hạn/quá hạn', fullName: 'Dòng tiền thu trước hạn/quá hạn' },
  ];
  assert.equal(matchStream(live, { name: 'Tài chính' }).id, 'A');
  assert.equal(matchStream(live, { name: 'Kiểm soát kỷ luật' }).id, 'B');
  assert.equal(matchStream(live, { name: 'Thu trước hạn quá hạn' }).id, 'C');
});

test('mergeExcelImports: gắn task Excel vào thẻ Worksuite, gộp PIC, kiểm nguyên tắc War Room, không sửa dữ liệu gốc', async () => {
  const ws = wsModel();
  const before = JSON.stringify(ws);
  const parsed = await parseOne(await bankingFile(), { fileName: 'banking.xlsx', now: NOW });
  const imp = { key: 'T1', ...parsed, fileName: 'banking.xlsx', uploadedAt: '2026-11-21T08:00:00.000Z', uploadedBy: 'ntmthu', uploadedByName: 'Nguyễn Thị Mai Thu' };
  const out = mergeExcelImports(ws, [imp], { now: NOW, period: PERIOD, users: USERS });

  assert.equal(JSON.stringify(ws), before);
  const s = out.streams.find((x) => x.id === 'T1');
  assert.equal(s.code, 'DT02');
  assert.equal(s.counts.total, 6);
  assert.equal(s.counts.waiting, 3); // Vướng mắc + 2 Chờ hồ sơ
  assert.equal(s.counts.doing, 1);
  assert.equal(s.counts.todo, 1);
  assert.equal(s.counts.done, 1);
  assert.equal(s.percent, Math.round((0 + 40 + 0 + 0 + 0 + 100) / 6));
  assert.equal(s.excel.count, 6);
  assert.equal(s.excel.uploadedBy, 'Nguyễn Thị Mai Thu');

  // "Chị Nguyễn Thị Mai Thu" là PIC trên Worksuite -> cùng 1 người, không tạo trùng.
  const thu = s.people.filter((p) => p.name === 'Nguyễn Thị Mai Thu');
  assert.equal(thu.length, 1);
  assert.equal(thu[0].isPic, true);
  assert.deepEqual(thu[0].tasks.map((t) => t.code), ['S05']);
  // "Chị Thúy Hiền" -> họ tên đầy đủ + chức danh từ danh sách thành viên.
  const hien = s.people.find((p) => p.name === 'Mạc Thị Thúy Hiền');
  assert.equal(hien.title, 'Trưởng Phòng Đối ngoại · Ban Đối ngoại');

  const task = (code) => s.people.flatMap((p) => p.tasks).find((t) => t.code === code);
  assert.equal(task('H01').statusLabel, 'Vướng mắc');
  assert.equal(task('H01').blocker, 'Chưa có phán quyết');
  assert.equal(task('H01').blockerLabel, 'Điểm nghẽn');
  assert.equal(task('H02').url, 'https://drive.example/h02');
  assert.deepEqual(task('S02').flags.map((f) => f.key), ['owner', 'timebox']); // Ban PTDA, hạn 30/11 > 25/11
  assert.match(task('S02').flags[1].label, /30\/11.*25\/11/);
  assert.deepEqual(task('S01').flags.map((f) => f.key), ['waiting']); // đang chờ, không có bước tiếp theo
  assert.deepEqual(task('S09').flags.map((f) => f.key), ['proof']); // hoàn thành nhưng không có link
  assert.deepEqual(task('H02').flags, []);
  assert.equal(s.excel.flagged, 3);
  assert.deepEqual(s.excel.issues, { owner: 1, timebox: 1, waiting: 1, proof: 1 });

  // Tổng quan tính lại cả task Worksuite lẫn Excel.
  assert.equal(out.summary.total, 7);
  assert.equal(out.excelImports[0].attached, true);
});

test('mergeExcelImports: không có thẻ Worksuite tương ứng -> thẻ dòng tiền riêng; quá hạn theo deadline', async () => {
  const parsed = await parseOne(await bankingFile(), { now: NOW });
  const imp = { key: 'xl:DT02', ...parsed, fileName: 'b.xlsx', uploadedAt: '2026-11-21T08:00:00.000Z', uploadedBy: 'admin' };
  const empty = { mode: 'unconfigured', streams: [], summary: null, otherGroups: [] };
  const later = Date.UTC(2026, 10, 22, 3, 0, 0); // 22/11 10:00 -> S01 (hạn 21/11) đã quá hạn
  const out = mergeExcelImports(empty, [imp], { now: later, period: PERIOD, users: USERS });
  assert.equal(out.streams.length, 1);
  const s = out.streams[0];
  assert.equal(s.id, 'xl:DT02');
  assert.equal(s.name, 'Banking');
  assert.equal(s.pic.name, 'Nguyễn Thị Mai Thu'); // lấy từ "Phụ trách:" trong file
  assert.equal(s.counts.overdue, 1);
  const s01 = s.people.flatMap((p) => p.tasks).find((t) => t.code === 'S01');
  assert.equal(s01.statusLabel, 'Quá hạn');
  assert.equal(s01.excelStatus, 'Chờ hồ sơ');
  assert.equal(out.summary.streams, 1);
  assert.equal(out.excelImports[0].attached, false);
});

test('previewImport: số task theo trạng thái và lỗi theo nguyên tắc War Room', async () => {
  const parsed = await parseOne(await bankingFile(), { now: NOW });
  const p = previewImport(parsed, { now: NOW, period: PERIOD, users: USERS });
  assert.equal(p.counts.total, 6);
  assert.deepEqual(p.issues, { owner: 1, timebox: 1, waiting: 1, proof: 1 });
  assert.equal(p.tasks.find((t) => t.code === 'H01').ownerName, 'Mạc Thị Thúy Hiền');
});

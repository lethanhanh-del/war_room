import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvSheet, DEFAULT_SHEETS, NOT_PUBLIC, parseCsv, parseSheetList, readSheet, readSheets, sheetId, sheetIds, streamSections } from '../src/excel/gsheet.js';
import { extractWorkbook } from '../src/excel/tasks.js';
import { DatabaseSync, fakeD1 } from './fixtures/d1.js';

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

test('sheetIds: mặc định WR - MASTER TASK + sheet thứ 2; nhiều link / ID cách nhau bởi dấu phẩy, chấm phẩy, xuống dòng; bỏ trùng', () => {
  assert.deepEqual(sheetIds({}), DEFAULT_SHEETS);
  assert.equal(DEFAULT_SHEETS[0], MASTER);
  const second = '1APLf2zn0gk62bRfmD85ZpxtALv2wGjsFQ--RQDhaGNY';
  assert.deepEqual(sheetIds({ EXCEL_SHEET_URL: `https://docs.google.com/spreadsheets/d/${second}/edit?gid=562479862#gid=562479862,\n ${MASTER} ; ${second}` }), [second, MASTER]);
  assert.deepEqual(sheetIds({ EXCEL_SHEET_URL: 'off' }), []);
  assert.deepEqual(sheetIds({ EXCEL_SHEET_URL: 'không phải link' }), []);
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

/** Giả lập Google: url -> [nội dung, Content-Type, mã HTTP (mặc định 200)]. */
function fakeGoogle(routes) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const hit = Object.entries(routes).find(([k]) => String(url).endsWith(k));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit[1][0], { status: hit[1][2] || 200, headers: { 'Content-Type': hit[1][1] } });
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
    // Tiêu đề B–E bị đổi thành "Cột 2…5" nhưng các cột còn lại đúng file mẫu: đọc theo thứ tự cột A–K và cảnh báo để sửa.
    assert.match(book.warnings.join('\n'), /Sheet “Dòng tiền nợ khó đòi”: dòng tiêu đề bị đổi \(B “Cột 2”/);
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

// ---------- nhiều Google Sheet (EXCEL_SHEET_URL có nhiều link) ----------

const A = 'SHEET_A_000000000000000001';
const B = 'SHEET_B_000000000000000002';
/** Google Sheet công khai: tabs = [[tên sheet, CSV]]. */
const publicSheet = (id, tabs) => Object.fromEntries([
  [`/d/${id}/htmlview`, [tabs.map(([name], i) => `items.push({name: "${name}", pageUrl: "x", gid: "${i + 1}"});`).join(' '), 'text/html']],
  ...tabs.map(([, csv], i) => [`${id}/export?format=csv&gid=${i + 1}`, [csv, 'text/csv; charset=utf-8']]),
]);
const privateSheet = (id) => ({ [`/d/${id}/htmlview`]: ['', 'text/html', 401] });

// D1 giả lập dùng chung trong file: các module chỉ tạo bảng 1 lần mỗi tiến trình (biến ready), nên test sau dọn dữ liệu
// thay vì tạo database mới.
let sharedDb = null;
async function freshEnv(vars) {
  sharedDb ??= fakeD1();
  for (const t of ['excel_imports', 'excel_teams', 'excel_sync', 'excel_sheet_cache']) await sharedDb.prepare(`DELETE FROM ${t}`).run().catch(() => {});
  return { DB: sharedDb, ...vars };
}
const row = (stt, stream, group, task, owner, status = 'Đang thực hiện', blocker = '') => `${stt},${stream},${group},${task},${owner},,25/11/2026,${status},P0,Biên bản,${blocker}`;
const TABS_A = [['Dòng tiền Banking', `${HEADER}\n${row(1, 'Dòng tiền 2: Banking', 'SS1', 'Chốt hạn mức', 'Nguyễn Thế Nhiên')}`]];
const TABS_B = [
  ['Dòng tiền banking', `${HEADER}\n${row(1, 'Dòng tiền 2: Banking', 'H300', 'Làm việc với Delta', 'Trần Văn An', 'Vướng mắc', 'Chờ phán quyết')}`],
  ['Dòng tiền Nợ khó đòi', `${HEADER}\n${row(1, 'Dòng tiền 3: Nợ khó đòi', 'Thu hồi', 'Gửi thông báo nợ', 'Lê Thị Bình')}`],
];

test('readSheets: gộp nhiều Google Sheet — cùng dòng tiền thì nối task (STT trùng thêm hậu tố ·S2), dòng tiền mới thêm thẻ', async () => {
  const restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...publicSheet(B, TABS_B) });
  try {
    const book = await readSheets([A, B], { now: NOW });
    assert.deepEqual(book.sections.map((s) => [s.code, s.name, s.tasks.map((t) => t.subject)]), [
      ['DT02', 'Banking', ['Chốt hạn mức', 'Làm việc với Delta']],
      ['DT03', 'Nợ khó đòi', ['Gửi thông báo nợ']],
    ]);
    // Sheet tổng không có cột "Mã task": id task trên dashboard theo số dòng -> dòng của sheet 2 đánh số tiếp, không trùng.
    const [first, second] = book.sections[0].tasks;
    assert.ok(second.row > first.row + 99999, `${first.row} / ${second.row}`);
    assert.deepEqual([...book.fresh.keys()], [A, B]);
    assert.deepEqual(book.warnings, []);
  } finally {
    restore();
  }

  // Có cột "Mã task" và 2 sheet trùng mã trong cùng dòng tiền: mã của sheet sau thêm hậu tố ·S2.
  const withCode = (tabs) => tabs.map(([name, csv]) => [name, csv.replace(/^STT,/, 'Mã task,').replace(/\n1,/g, '\nT1,')]);
  const again = fakeGoogle({ ...publicSheet(A, withCode(TABS_A)), ...publicSheet(B, withCode(TABS_B)) });
  try {
    const book = await readSheets([A, B], { now: NOW });
    assert.deepEqual(book.sections.map((s) => s.tasks.map((t) => t.code)), [['T1', 'T1·S2'], ['T1']]);
  } finally {
    again();
  }
});

test('readSheets: 1 sheet đọc lỗi — có bản trước thì dùng tạm, chưa có thì bỏ qua (sheet đầu tiên: dừng); lỗi hết thì báo lỗi', async () => {
  let restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...publicSheet(B, TABS_B) });
  try {
    const before = await readSheets([A, B], { now: NOW });
    restore();
    restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...privateSheet(B) });

    const skipped = await readSheets([A, B], { now: NOW });
    assert.deepEqual(skipped.sections.map((s) => [s.name, s.tasks.length]), [['Banking', 1]]);
    assert.deepEqual(skipped.warnings, [`Google Sheet 2 (…000002): ${NOT_PUBLIC}`]);
    assert.deepEqual([...skipped.fresh.keys()], [A]);

    const kept = await readSheets([A, B], { now: NOW, previous: new Map([[B, before.fresh.get(B)]]) });
    assert.deepEqual(kept.sections.map((s) => [s.name, s.tasks.length]), [['Banking', 2], ['Nợ khó đòi', 1]]);
    assert.deepEqual(kept.warnings, [`Google Sheet 2 (…000002): ${NOT_PUBLIC} Đang giữ dữ liệu lần đọc trước.`]);
    assert.deepEqual([...kept.fresh.keys()], [A]);

    // Sheet đầu tiên chưa từng đọc được: không đồng bộ lượt này, dashboard giữ nguyên.
    await assert.rejects(readSheets([B, A], { now: NOW }), { message: `Google Sheet 1 (…000002): ${NOT_PUBLIC}` });
    // Chỉ 1 sheet: lỗi như trước.
    await assert.rejects(readSheets([B], { now: NOW }), { message: NOT_PUBLIC });

    restore();
    restore = fakeGoogle({ ...privateSheet(A), ...privateSheet(B) });
    const previous = new Map([[A, before.fresh.get(A)], [B, before.fresh.get(B)]]);
    await assert.rejects(readSheets([A, B], { now: NOW, previous }), /^Error: Google Sheet 1 \(…000001\): .* · Google Sheet 2 \(…000002\): /);
  } finally {
    restore();
  }
});

test('syncSheet: nhiều Google Sheet — sheet đọc lỗi giữ task lần trước; bỏ sheet khỏi EXCEL_SHEET_URL thì gỡ dòng tiền của nó', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { sheetSyncStatus, syncSheet } = await import('../src/excel/sheet-sync.js');
  const { sheetOnlyBase, withExcel } = await import('../src/excel/index.js');
  const env = await freshEnv({ EXCEL_SHEET_URL: `https://docs.google.com/spreadsheets/d/${A}/edit, ${B}` });
  await ensureSchema(env);
  const streams = async () => (await withExcel(env, sheetOnlyBase(NOW))).streams.map((s) => [s.name, s.counts.total]);
  let restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...publicSheet(B, TABS_B) });
  try {
    let r = await syncSheet(env, { force: true, now: NOW });
    assert.deepEqual(r, { changed: true, total: 3 });
    assert.deepEqual(await streams(), [['Banking', 2], ['Nợ khó đòi', 1]]);
    assert.equal((await sheetSyncStatus(env)).sheetUrls.length, 2);

    // Sheet 2 bị tắt chia sẻ: task của sheet 2 vẫn hiện (bản lần trước), kèm cảnh báo; sheet 1 vẫn đồng bộ.
    restore();
    restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...privateSheet(B) });
    r = await syncSheet(env, { force: true, now: NOW + 60000 });
    assert.deepEqual(r, { changed: false, total: 3 });
    assert.deepEqual(await streams(), [['Banking', 2], ['Nợ khó đòi', 1]]);
    assert.match((await sheetSyncStatus(env)).warnings[0], /^Google Sheet 2 \(…000002\): .*Đang giữ dữ liệu lần đọc trước\.$/);

    // Bỏ sheet 2 khỏi cấu hình: dòng tiền chỉ có ở sheet 2 bị gỡ, Banking còn task của sheet 1.
    env.EXCEL_SHEET_URL = A;
    r = await syncSheet(env, { force: true, now: NOW + 120000 });
    assert.deepEqual(r, { changed: true, total: 1 });
    assert.deepEqual(await streams(), [['Banking', 1]]);
  } finally {
    restore();
  }
});

// ---------- Google Sheet phân chia nhiệm vụ (WarRoom_CTHomes_Final: DS nhân sự War-Room) ----------

const R = 'SHEET_R_000000000000000003';
const rosterTabs = (extra = '') => [['DS nhân sự War-Room', [
  ',,,,,,,,Ngày 21/11/2026',
  'STT,STT dòng tiền,Dòng tiền,Thành viên,Chức danh,Phòng ban,Đội trưởng/Đội phó,Nhiệm vụ thực hiện,Ngày',
  '1,,"Cố vấn, chỉ đạo",Trần Kim Chung,Chủ tịch,,,,',
  '2,2,Dòng tiền Banking,Nguyễn Thị Mai Thu,Giám đốc Ban Kế toán 1,Ban Tài chính - Kế toán,Đội trưởng,Làm việc với ngân hàng,X',
  '3,,,Võ Trường Sơn,Chuyên viên,Ban Tài chính - Kế toán,,Làm việc với ngân hàng,X',
  extra,
  '4,3,Dòng tiền nợ khó đòi,Mạc Thị Thúy Hiền,Trưởng phòng Đối ngoại,Ban Đối ngoại,Đội trưởng,Thu hồi nợ,X',
].filter(Boolean).join('\n')]];

test('readSheets: Google Sheet phân chia nhiệm vụ -> roster (nhóm, PIC, nhiệm vụ từng người), không phải task', async () => {
  const restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...publicSheet(R, rosterTabs()) });
  try {
    const book = await readSheets([A, R], { now: NOW });
    assert.equal(book.taskSheets, 1);
    assert.deepEqual(book.sections.map((s) => s.name), ['Banking']);
    assert.deepEqual(book.roster.sections.map((s) => [s.raw, s.code, s.groups.length, s.memberCount, s.groups[0].lead?.name ?? null]), [
      ['Cố vấn, chỉ đạo', '', 1, 1, null],
      ['Dòng tiền Banking', 'DT02', 1, 2, 'Nguyễn Thị Mai Thu'],
      ['Dòng tiền nợ khó đòi', 'DT03', 1, 1, 'Mạc Thị Thúy Hiền'],
    ]);
    assert.deepEqual([...book.fresh.keys()], [A]); // bản dự phòng chỉ dành cho sheet task
    assert.deepEqual(book.warnings, []);
  } finally {
    restore();
  }
});

test('syncSheet: sheet phân chia nhiệm vụ -> bảng nhóm tự cập nhật; đọc lỗi thì giữ nguyên; chỉ còn sheet phân chia thì không đụng task', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { sheetSyncStatus, syncSheet } = await import('../src/excel/sheet-sync.js');
  const { sheetOnlyBase, withExcel } = await import('../src/excel/index.js');
  const env = await freshEnv({ EXCEL_SHEET_URL: `${A}\n${R}` });
  await ensureSchema(env);
  const view = async () => (await withExcel(env, sheetOnlyBase(NOW))).streams.map((s) => [s.name, s.counts.total, s.teams?.groups.map((g) => g.members.length) ?? null]);
  let restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...publicSheet(R, rosterTabs()) });
  try {
    assert.deepEqual(await syncSheet(env, { force: true, now: NOW }), { changed: true, total: 1 });
    const first = await view();
    assert.deepEqual(first[0], ['Banking', 1, [2]]);
    assert.equal(first.length, 2); // + thẻ "Nợ khó đòi" từ phân chia nhóm; "Cố vấn, chỉ đạo" không tạo thẻ
    assert.deepEqual(first[1].slice(1), [0, [1]]);

    assert.deepEqual(await syncSheet(env, { force: true, now: NOW + 60000 }), { changed: false, total: 1 });

    // Thêm 1 thành viên trên sheet: bảng nhóm cập nhật.
    const extra = '5,,,Lê Công Sum,Chuyên viên,Ban Tài chính - Kế toán,,Làm việc với ngân hàng,X';
    restore();
    restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...publicSheet(R, rosterTabs(extra)) });
    assert.deepEqual(await syncSheet(env, { force: true, now: NOW + 120000 }), { changed: true, total: 1 });
    assert.deepEqual((await view())[0], ['Banking', 1, [3]]);

    // Sheet phân chia bị tắt chia sẻ: nhóm giữ nguyên, có cảnh báo.
    restore();
    restore = fakeGoogle({ ...publicSheet(A, TABS_A), ...privateSheet(R) });
    assert.deepEqual(await syncSheet(env, { force: true, now: NOW + 180000 }), { changed: false, total: 1 });
    assert.deepEqual((await view())[0], ['Banking', 1, [3]]);
    assert.match((await sheetSyncStatus(env)).warnings[0], /^Google Sheet 2 \(…000003\): /);

    // Chỉ còn sheet phân chia: task giữ nguyên, nhóm vẫn đồng bộ.
    env.EXCEL_SHEET_URL = R;
    restore();
    restore = fakeGoogle(publicSheet(R, rosterTabs()));
    assert.deepEqual(await syncSheet(env, { force: true, now: NOW + 240000 }), { changed: true, total: 0 });
    assert.deepEqual((await view())[0], ['Banking', 1, [2]]);
  } finally {
    restore();
  }
});

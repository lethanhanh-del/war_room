import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvSheet, parseCsv } from '../src/excel/gsheet.js';
import { approvalCode, isKpiTab, isLiquidationTab, isSupportTab, parseKpiBook, parseKpiTab, personName, resultCode, streamNameOf } from '../src/kpi/sheet.js';
import { buildModel, count, defaultDay, dueAt, dueAtOf, dueLabel, isLateTick, memberStats, noWaitingPoint, noteTargets, overdueText, parseTimeWindow, refDate, statusOf, timeLabel, weekday } from '../public/kpi-model.js';
import { stampTicks } from '../src/kpi/ticks.js';
import { DEMO } from '../public/kpi-demo.js';
import { DatabaseSync, fakeD1 } from './fixtures/d1.js';

// src/kpi/index.js dùng src/live.js (import "cloudflare:workers"): nạp động sau khi fixtures/d1.js đã thay bằng bản rỗng.
const kpi = () => import('../src/kpi/index.js');

// Bố cục tab dòng tiền như sheet thamkhao_kpi (chốt 21/11/2026): tiêu đề 2 tầng, mỗi ngày 2 cột KPI | Kết quả.
const HEAD = 'Stt,Nhóm,PIC,21/11,,22/11,,23/11,,24/11,,25/11,,Tổng kết,,,Ghi chú / Vướng mắc,Thư mục dữ liệu lưu trữ';
const SUB = ',,,KPI,Kết quả,KPI,Kết quả,KPI,Kết quả,KPI,Kết quả,KPI,Kết quả,Lũy kế đạt,% đạt KPI,Đánh giá';
const TAB_CSV = [
  'BẢNG KPI VÀ KẾT QUẢ ĐẠT ĐƯỢC WAR ROOM CT HOMES (21/11/2026 - 25/11/2026)',
  '"DÒNG TIỀN: BÁN 4 DỰ ÁN\nPIC: HOÀNG THỊ QUỲNH MAI"',
  HEAD,
  SUB,
  'I,Networking,,,,,,,,,,,,,,,,',
  '1,Networking,Mạc Thị Thúy Hiền,Gặp 5 khách VIP,Đạt,Tổ chức networking 30 khách,Đạt,Chốt 3 khách giữ chỗ,,Thu cọc 2 căn,,,,,,#REF!,,https://drive.google.com/drive/folders/abc',
  '2,,TRƯƠNG HUỲNH THÚY AN,Gọi 40 khách cũ,Hoàn thành,Mời 15 khách,Không đạt,,,,,,,,,,4/10 khách chưa phản hồi,Thư mục chung',
  ',,,,,,,,,,,,,,,,,',
  'II,Phụ trách đại lý,,,,,,,,,,,,,,,,',
  '3,,Nguyễn Thị Kim Cúc,,,,,Ký 2 hợp đồng F1,50%,,,,,,,,,',
  '4,Data,NVA,100 DATA,,,,,,,,,,,,,,',
  '5,Hồ sơ,Trần Ngọc Vy,,,,,,,,,,,,,,,',
  '6,Hồ sơ,Hồ sơ,,,,,,,,,,,,,,,',
].join('\n');
const tab = (name, csv) => csvSheet(name, parseCsv(csv));

test('isKpiTab / streamNameOf / personName / resultCode', () => {
  assert.equal(isKpiTab('DÒNG TIỀN BÁN 4 DỰ ÁN'), true);
  assert.equal(isKpiTab('Dòng tiền tài chính '), true);
  assert.equal(isKpiTab('KPI 21-25.11'), false);
  assert.equal(isKpiTab('Trang_tính1'), false);
  assert.equal(streamNameOf('DÒNG TIỀN BÁN 4 DỰ ÁN'), 'Dòng tiền bán 4 dự án');
  assert.equal(streamNameOf('Dòng tiền thu trước hạn quá hạn'), 'Dòng tiền thu trước hạn quá hạn');
  assert.equal(streamNameOf('DÒNG TIỀN: BANKING'), 'Dòng tiền Banking');
  assert.equal(personName('HOÀNG THỊ QUỲNH MAI'), 'Hoàng Thị Quỳnh Mai');
  assert.equal(personName('Mạc Thị Thúy Hiền'), 'Mạc Thị Thúy Hiền');
  assert.equal(personName('NVA'), 'NVA');
  for (const v of ['Đạt', 'đạt', 'ĐẠT', 'Hoàn thành', 'Xong', 'OK']) assert.equal(resultCode(v), 'D', v);
  for (const v of ['Không đạt', 'không đạt', 'Chưa đạt', 'Chưa hoàn thành', 'Không']) assert.equal(resultCode(v), 'K', v);
  assert.equal(resultCode(''), '');
  assert.equal(resultCode('   '), '');
  assert.equal(resultCode('50%'), '?');
  assert.equal(resultCode('TRUE'), 'D'); // ô tick đã tick
  assert.equal(resultCode('FALSE'), ''); // ô tick chưa tick
});

test('parseKpiTab: ngày từ dòng tiêu đề, mỗi dòng 1 người, gộp theo Nhóm, dòng mục La Mã, PIC dòng tiền phía trên bảng', () => {
  const s = parseKpiTab(tab('DÒNG TIỀN BÁN 4 DỰ ÁN', TAB_CSV), { year: 2026 });
  assert.equal(s.error, undefined);
  assert.equal(s.name, 'Dòng tiền bán 4 dự án');
  assert.equal(s.pic, 'Hoàng Thị Quỳnh Mai');
  assert.deepEqual(s.days.map((d) => d.date), ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  assert.deepEqual(s.groups.map((g) => [g.name, g.rows.map((r) => r.person)]), [
    ['Networking', ['Mạc Thị Thúy Hiền', 'Trương Huỳnh Thúy An']],
    ['Phụ trách đại lý', ['Nguyễn Thị Kim Cúc']],
    ['Data', ['NVA']],
    ['Hồ sơ', ['Trần Ngọc Vy', 'Hồ sơ']],
  ]);
  const [hien, an] = s.groups[0].rows;
  assert.deepEqual(hien.cells, {
    '2026-11-21': { kpi: 'Gặp 5 khách VIP', res: 'D' },
    '2026-11-22': { kpi: 'Tổ chức networking 30 khách', res: 'D' },
    '2026-11-23': { kpi: 'Chốt 3 khách giữ chỗ', res: '' },
    '2026-11-24': { kpi: 'Thu cọc 2 căn', res: '' },
  });
  assert.equal(hien.folder, 'https://drive.google.com/drive/folders/abc');
  assert.deepEqual([an.cells['2026-11-21'].res, an.cells['2026-11-22'].res, an.note, an.folder, an.folderText], ['D', 'K', '4/10 khách chưa phản hồi', '', 'Thư mục chung']);
  assert.deepEqual(s.groups[1].rows[0].cells, { '2026-11-23': { kpi: 'Ký 2 hợp đồng F1', res: '?' } });
  assert.deepEqual(s.groups[3].rows[0].cells, {}); // có người, chưa có KPI
  assert.match(s.warnings.join('\n'), /kết quả chưa hiểu.*“50%”/);
  assert.match(s.warnings.join('\n'), /dòng 13 cột PIC đang ghi tên nhóm “Hồ sơ”/);

  const bad = parseKpiTab(tab('Dòng tiền X', 'a,b\nc,d'));
  assert.match(bad.error, /không tìm thấy dòng tiêu đề/);
});

test('parseKpiBook: chỉ đọc tab "Dòng tiền …"; không có tab nào -> lỗi', () => {
  const book = parseKpiBook([
    tab('KPI 21-25.11', TAB_CSV),
    tab('DÒNG TIỀN BÁN 4 DỰ ÁN', TAB_CSV),
    tab('Dòng tiền tài chính ', [HEAD, SUB, '1,Kế hoạch dòng tiền,Phạm Thanh Hùng,Chốt kế hoạch,Đạt'].join('\n')),
    tab('Dòng tiền hỏng', 'Stt,Việc\n1,abc'),
    tab('Trang_tính1', ''),
  ], { year: 2026 });
  assert.deepEqual(book.streams.map((s) => [s.sheet, s.name]), [['DÒNG TIỀN BÁN 4 DỰ ÁN', 'Dòng tiền bán 4 dự án'], ['Dòng tiền tài chính', 'Dòng tiền tài chính']]);
  assert.match(book.warnings.join('\n'), /Dòng tiền hỏng.*không tìm thấy dòng tiêu đề/);
  assert.throws(() => parseKpiBook([tab('Sheet1', HEAD)]), /chưa có bảng KPI/);
});

// File master WR - MASTER TASK (22/11/2026): tab task "Dòng tiền …", ngay sau là tab KPI tên tuỳ ý (vd "Trang tính6").
const TASK_HEAD = 'STT,Dòng tiền,Nhóm công việc,Task / Đầu việc,Người phụ trách,Người phối hợp,Hạn hoàn thành,Tiến độ,Trạng thái,Ưu tiên,Đầu ra cần có,Điểm nghẽn / Cần hỗ trợ';
const MASTER_KPI = [
  HEAD,
  SUB,
  '1,Networking,Hoàng Thị Quỳnh Mai,Lập kế hoạch & KPI,FALSE,,FALSE,,FALSE,,FALSE,,FALSE',
  '2,Networking,Mạc Thị Thúy Hiền,Lọc danh sách Networking,TRUE,,FALSE,,FALSE,,FALSE,,FALSE',
  '3,,,Làm việc với đại lý,FALSE,,FALSE,,FALSE,,FALSE,,FALSE',
  '4,,,,FALSE,,FALSE,,FALSE,,FALSE,,FALSE',
  '5,,,,FALSE,,FALSE,,FALSE,,TRUE,,FALSE', // tick nhầm ở dòng mẫu
].join('\n');

test('parseKpiBook: file master — tab KPI ngay sau tab task "Dòng tiền …", PIC lấy ở tab task, bỏ dòng mẫu', () => {
  const book = parseKpiBook([
    tab('Waiting Point', 'PIC phụ trách: Hoàng Thị Quỳnh Mai\nSTT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải'),
    tab('Dòng tiền bán 4 dự án', ['PIC phụ trách: Hoàng Thị Quỳnh Mai', TASK_HEAD, '1,Dòng tiền 1: Bán 4 dự án,Networking,Lập kế hoạch & KPI,Hoàng Thị Quỳnh Mai'].join('\n')),
    tab('Trang tính6', MASTER_KPI),
    tab('Dòng tiền Equity / IPO', [',,,', TASK_HEAD].join('\n')),
    tab('Trang tính12', [HEAD, SUB, '1,Equity / IPO,Anh Nguyễn Thế Nhiên,Tổng hợp lộ trình,FALSE'].join('\n')),
    tab('Nhóm hỗ trợ', 'STT,Họ và tên,Nhóm\n1,Lê Công Sum,Pháp chế'),
    tab('Trang tính lẻ', MASTER_KPI), // không đứng sau tab task: bỏ qua
  ], { year: 2026 });
  assert.deepEqual(book.streams.map((s) => [s.sheet, s.kpiSheet, s.name, s.pic]), [
    ['Dòng tiền bán 4 dự án', 'Trang tính6', 'Dòng tiền bán 4 dự án', 'Hoàng Thị Quỳnh Mai'],
    ['Dòng tiền Equity / IPO', 'Trang tính12', 'Dòng tiền Equity / IPO', ''],
  ]);
  const [net] = book.streams[0].groups;
  assert.deepEqual(book.streams[0].groups.map((g) => [g.name, g.rows.length]), [['Networking', 3]]);
  assert.deepEqual(net.rows.map((r) => [r.person, r.cells]), [
    ['Hoàng Thị Quỳnh Mai', { '2026-11-21': { kpi: 'Lập kế hoạch & KPI', res: '' } }],
    ['Mạc Thị Thúy Hiền', { '2026-11-21': { kpi: 'Lọc danh sách Networking', res: 'D' } }],
    ['', { '2026-11-21': { kpi: 'Làm việc với đại lý', res: '' } }],
  ]);
  assert.deepEqual(book.warnings, []);
});

test('attachPeople: PIC nhóm = Đội trưởng có thành viên trùng tên; mã DT từ sheet task; người thực hiện còn lại', async () => {
  const { attachPeople } = await kpi();
  const { streams } = parseKpiBook([tab('DÒNG TIỀN BÁN 4 DỰ ÁN', TAB_CSV)], { year: 2026 });
  const teams = [{
    name: 'Dòng tiền bán 4 dự án',
    groups: [
      { lead: { name: 'Hoàng Thị Quỳnh Mai', title: 'Trưởng Phòng Sales' }, mainTask: 'Networking', members: [{ name: 'Hoàng Thị Quỳnh Mai' }, { name: 'Mạc Thị Thúy Hiền' }, { name: 'Trương Huỳnh Thúy An' }] },
      { lead: { name: 'Nguyễn Thị Kim Cúc', title: '' }, mainTask: 'Phụ trách đại lý', members: [{ name: 'Nguyễn Thị Kim Cúc' }] },
    ],
  }];
  const [s] = attachPeople(streams, teams, [{ name: 'Bán 4 dự án', code: 'DT01', pic: '' }]);
  assert.equal(s.code, 'DT01');
  assert.equal(s.pic, 'Hoàng Thị Quỳnh Mai'); // ghi phía trên bảng
  const net = s.groups[0];
  assert.deepEqual([net.pic, net.members], [{ name: 'Hoàng Thị Quỳnh Mai', title: 'Trưởng Phòng Sales' }, ['Mạc Thị Thúy Hiền', 'Trương Huỳnh Thúy An']]);
  assert.deepEqual([s.groups[1].pic.name, s.groups[1].members], ['Nguyễn Thị Kim Cúc', []]);
  assert.deepEqual([s.groups[2].pic.name, s.groups[2].members], ['NVA', []]); // không có trong phân chia nhóm: người ở dòng đầu
});

test('kpiSheetId / vnDate', async () => {
  const { kpiSheetId, vnDate } = await kpi();
  assert.equal(kpiSheetId({}), '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0'); // WR - MASTER TASK
  assert.equal(kpiSheetId({ KPI_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0' }), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  assert.equal(kpiSheetId({ KPI_SHEET_URL: 'off' }), '');
  assert.equal(vnDate(Date.UTC(2026, 10, 22, 18, 30)), '2026-11-23'); // 01:30 ngày 23 giờ VN
});

test('kpi-model: trạng thái theo hôm nay, đếm, ghi chú ở KPI tồn đọng gần nhất, ngày mặc định', () => {
  assert.equal(statusOf({ kpi: 'a', res: 'D' }, '2026-11-21', '2026-11-23'), 'D');
  assert.equal(statusOf({ kpi: 'a', res: 'K' }, '2026-11-25', '2026-11-23'), 'K');
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-23', '2026-11-23'), 'N'); // hôm nay chưa tick: Đang làm
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-22', '2026-11-23'), 'K'); // đã qua ngày chưa tick: Không đạt
  assert.equal(statusOf({ kpi: 'a', res: '?' }, '2026-11-21', '2026-11-23'), 'K');
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-24', '2026-11-23'), 'S');
  // Chỉ ghi nhận trễ hạn từ 22/11 trở đi: KPI ngày 21/11 hoàn thành sau 05:00 vẫn tính là Hoàn thành (D), không trễ hạn
  assert.equal(isLateTick('2026-11-21', '2026-11-21T22:09:00.000Z'), false);
  assert.equal(isLateTick('2026-11-21', '2026-11-22T02:00:00.000Z'), false);
  assert.equal(statusOf({ kpi: 'a', res: 'D', at: '2026-11-22T02:00:00.000Z' }, '2026-11-21', '2026-11-23'), 'D');
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'K' }, '2026-11-21', '2026-11-23'), 'D');
  assert.equal(statusOf({ kpi: 'a', res: '', closed: 'K' }, '2026-11-21', '2026-11-23'), 'K'); // chưa tick ngày 21 vẫn là Tồn đọng
  // Từ ngày 22/11 trở đi: hạn của KPI ngày 22 là 05:00 sáng ngày 23 giờ VN (= 22:00 UTC ngày 22), không du di
  assert.equal(isLateTick('2026-11-22', '2026-11-22T16:59:00.000Z'), false); // 23:59 ngày 22
  assert.equal(isLateTick('2026-11-22', '2026-11-22T21:59:00.000Z'), false); // 04:59 ngày 23
  assert.equal(isLateTick('2026-11-22', '2026-11-22T22:09:00.000Z'), true); // 05:09 ngày 23: trễ (KPI-CLOSE: bỏ du di 10 phút)
  assert.equal(isLateTick('2026-11-22', '2026-11-22T22:11:00.000Z'), true); // 05:11 ngày 23
  // Chưa tick: trước 05:00 sáng hôm sau là Đang làm, từ 05:00 là Không đạt
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-21', '2026-11-22', Date.UTC(2026, 10, 21, 21, 30)), 'N'); // 04:30 ngày 22
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-21', '2026-11-22', Date.UTC(2026, 10, 21, 22, 0)), 'K'); // 05:00 ngày 22
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-22', '2026-11-22', Date.UTC(2026, 10, 21, 22, 0)), 'N');
  assert.equal(isLateTick('2026-11-22', ''), false); // không biết giờ tick
  assert.equal(statusOf({ kpi: 'a', res: 'D', at: '2026-11-23T02:00:00.000Z' }, '2026-11-22', '2026-11-23'), 'L');
  assert.equal(statusOf({ kpi: 'a', res: 'D', at: '2026-11-22T02:00:00.000Z' }, '2026-11-22', '2026-11-23'), 'D');
  assert.equal(statusOf(undefined, '2026-11-21', '2026-11-23'), null);
  assert.equal(weekday('2026-11-21'), 'T7');
  assert.equal(weekday('2026-11-22'), 'CN');

  const m = buildModel(DEMO);
  const today = m.items.filter((it) => it.date === '2026-11-23');
  assert.deepEqual(count(today), { D: 10, L: 0, K: 3, N: 6, S: 0, total: 19 });
  assert.deepEqual(count(m.items.filter((it) => it.date <= '2026-11-23')), { D: 41, L: 0, K: 10, N: 6, S: 0, total: 57 });
  const ban = m.streams[0];
  assert.deepEqual(count(ban.items), { D: 18, L: 0, K: 3, N: 3, S: 16, total: 40 });
  const net = ban.groups[0];
  assert.equal(net.items.filter((it) => it.date === '2026-11-23').length, 3); // 3 người, mỗi người 1 KPI
  const notes = noteTargets(net.items, '2026-11-23');
  assert.deepEqual([...notes].map((id) => net.items.find((it) => it.id === id).kpi), ['Chăm sóc 10 khách tiềm năng']);
  assert.equal(defaultDay(m), '2026-11-23');
  assert.equal(defaultDay({ ...m, today: '2026-12-01' }), 'all');

  // Thành viên theo nhóm: PIC đứng đầu (kể cả chưa có KPI), số KPI cộng dồn đến ngày đang xem
  assert.deepEqual(memberStats(net, '2026-11-23'), [
    { name: 'Hoàng Thị Quỳnh Mai', isPic: true, total: 0, done: 0, late: 0, backlog: 0, doing: 0 },
    { name: 'Mạc Thị Thúy Hiền', isPic: false, total: 3, done: 3, late: 0, backlog: 0, doing: 0 },
    { name: 'Trương Huỳnh Thúy An', isPic: false, total: 3, done: 2, late: 0, backlog: 0, doing: 1 },
    { name: 'Trương Ngọc Thảo', isPic: false, total: 3, done: 2, late: 0, backlog: 1, doing: 0 },
  ]);
  assert.deepEqual(memberStats(net, '2026-11-21').map((p) => [p.total, p.done]), [[0, 0], [1, 1], [1, 1], [1, 1]]);
  const nam = memberStats(ban.groups[2], '2026-11-23').find((p) => p.name === 'Nguyễn Trần Hải Nam');
  assert.deepEqual([nam.total, nam.done, nam.late, nam.backlog], [1, 1, 0, 0]); // ngày 21/11 không ghi nhận trễ hạn
  assert.equal(refDate({ ...m, today: '2026-12-01' }), '2026-11-25');
});

/** Giả lập Google: url -> [nội dung, Content-Type]. */
function fakeGoogle(routes) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const hit = Object.entries(routes).find(([k]) => String(url).endsWith(k));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit[1][0], { status: hit[1][2] || 200, headers: { 'Content-Type': hit[1][1] } });
  };
  return () => { globalThis.fetch = real; };
}

test('syncKpi + kpiData: đọc sheet lưu D1, không đổi thì không ghi, lỗi thì giữ dữ liệu cũ', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await kpi();
  const ID = 'KPI_SHEET_000000000000000001';
  const env = { DB: fakeD1(), KPI_SHEET_URL: ID, WARROOM_START: '2026-11-21' };
  await ensureSchema(env);
  const NOW = Date.UTC(2026, 10, 23, 7, 0);
  const sheet = (csv) => ({
    [`/d/${ID}/htmlview`]: ['items.push({name: "KPI 21-25.11", pageUrl: "x", gid: "1"}); items.push({name: "DÒNG TIỀN BÁN 4 DỰ ÁN", pageUrl: "x", gid: "2"});', 'text/html'],
    [`${ID}/export?format=csv&gid=1`]: [TAB_CSV, 'text/csv; charset=utf-8'],
    [`${ID}/export?format=csv&gid=2`]: [csv, 'text/csv; charset=utf-8'],
  });
  let restore = fakeGoogle(sheet(TAB_CSV));
  try {
    assert.deepEqual(await syncKpi(env, { force: true, now: NOW }), { changed: true, streams: 1 });
    let data = await kpiData(env, NOW);
    assert.equal(data.today, '2026-11-23');
    assert.deepEqual(data.days.map((d) => d.label), ['21/11', '22/11', '23/11', '24/11', '25/11']);
    assert.deepEqual(data.streams.map((s) => [s.name, s.groups.length]), [['Dòng tiền bán 4 dự án', 4]]);
    assert.equal(data.source.error, '');
    assert.match(data.source.warnings.join('\n'), /kết quả chưa hiểu/);

    assert.deepEqual(await syncKpi(env, { force: true, now: NOW + 10000 }), { changed: false, streams: 1 });
    assert.deepEqual(await syncKpi(env, { now: NOW + 12000 }), { skipped: true }); // chưa quá 20 giây
    // Ô đã Đạt ở lần đọc đầu: không biết giờ tick. Ô được tick sau đó: ghi giờ Worker thấy, lần đọc sau giữ nguyên.
    const hien = () => data.streams[0].groups[0].rows[0].cells;
    assert.equal(hien()['2026-11-21'].at, undefined);
    restore();
    restore = fakeGoogle(sheet(TAB_CSV.replace('Chốt 3 khách giữ chỗ,,', 'Chốt 3 khách giữ chỗ,Đạt,')));
    assert.deepEqual(await syncKpi(env, { force: true, now: NOW + 20000 }), { changed: true, streams: 1 });
    data = await kpiData(env, NOW + 20000);
    assert.deepEqual(hien()['2026-11-23'], { kpi: 'Chốt 3 khách giữ chỗ', res: 'D', at: new Date(NOW + 20000).toISOString() });
    assert.equal(hien()['2026-11-21'].at, undefined);
    assert.deepEqual(await syncKpi(env, { force: true, now: NOW + 30000 }), { changed: false, streams: 1 });

    restore();
    restore = fakeGoogle({ [`/d/${ID}/htmlview`]: ['', 'text/html', 401] });
    const r = await syncKpi(env, { force: true, now: NOW + 60000 });
    assert.match(r.error, /chia sẻ/);
    data = await kpiData(env, NOW + 60000);
    assert.match(data.source.error, /chia sẻ/);
    assert.equal(data.streams.length, 1); // vẫn còn dữ liệu lần đọc trước
  } finally {
    restore();
  }
});

test('toDashboard: dữ liệu /api/kpi -> định dạng app React (FE/): nhóm, dòng KPI × ngày, done = Đạt', async () => {
  const { toDashboard, flowLabel } = await import('../src/kpi/dashboard.js');
  assert.equal(flowLabel({ sheet: 'Dòng tiền bán 4 dự án', name: 'Bán 4 dự án' }), 'Dòng tiền bán 4 dự án');
  assert.equal(flowLabel({ sheet: 'DÒNG TIỀN BÁN 4 DỰ ÁN', name: 'Bán 4 dự án' }), 'Dòng tiền bán 4 dự án');
  assert.equal(flowLabel({ sheet: 'Dòng tiền Equity / IPO', name: 'Equity / IPO' }), 'Dòng tiền Equity / IPO');
  const data = {
    today: '2026-11-22',
    now: Date.UTC(2026, 10, 22),
    source: { changedAt: '2026-11-22T01:00:00.000Z' },
    streams: [{
      key: 'ban4duan', name: 'Bán 4 dự án', sheet: 'Dòng tiền bán 4 dự án', kpiSheet: 'Trang tính6',
      days: [{ date: '2026-11-21', label: '21/11' }, { date: '2026-11-22', label: '22/11' }],
      groups: [
        { key: 'networking', name: 'Networking', pic: { name: 'Hoàng Thị Quỳnh Mai', title: '' }, rows: [
          { row: 3, person: 'Hoàng Thị Quỳnh Mai', note: '', folder: '', folderText: '', cells: { '2026-11-21': { kpi: 'Lập kế hoạch', res: 'D' }, '2026-11-22': { kpi: 'Đào tạo', res: '' } } },
          { row: 4, person: '', note: 'Chờ duyệt', folder: '', folderText: 'Thư mục chung', cells: {} },
        ] },
        { key: 'data', name: 'Data', pic: null, rows: [] },
      ],
    }],
  };
  const d = toDashboard(data);
  assert.deepEqual([d.mode, d.today, d.generatedAt], ['google-sheets', '2026-11-22', '2026-11-22T01:00:00.000Z']);
  const [f] = d.flows;
  assert.deepEqual([f.key, f.label, f.sheet, f.days], ['ban4duan', 'Dòng tiền bán 4 dự án', 'Trang tính6', ['2026-11-21', '2026-11-22']]);
  assert.deepEqual(f.groups, [
    { key: 'ban4duan-1', stt: '1', name: 'Networking', lead: 'Hoàng Thị Quỳnh Mai' },
    { key: 'ban4duan-2', stt: '2', name: 'Data', lead: '' },
  ]);
  const [mai, empty, data2] = f.items;
  assert.deepEqual([mai.kpi, mai.pic, mai.groupKey, mai.days], ['Lập kế hoạch', 'Hoàng Thị Quỳnh Mai', 'ban4duan-1', [
    { date: '2026-11-21', task: 'Lập kế hoạch', done: true },
    { date: '2026-11-22', task: 'Đào tạo', done: false },
  ]]);
  assert.equal(mai.placeholder, undefined);
  assert.deepEqual([empty.pic, empty.note, empty.folder, empty.placeholder], ['Hoàng Thị Quỳnh Mai', 'Chờ duyệt', 'Thư mục chung', true]);
  assert.deepEqual([data2.group, data2.placeholder, data2.days.map((x) => x.task)], ['Data', true, [null, null]]);
});

test('noWaitingPoint: KPI đã duyệt & quá hạn chưa xong, gom theo người; bỏ dòng tiền chưa trình BOD, KPI chưa tới hạn, đã tick', () => {
  const now = Date.parse('2026-11-23T03:00:00Z'); // 10:00 23/11 giờ VN: KPI ngày 21 và 22 đã quá hạn (05:00 22/11, 05:00 23/11), ngày 23 chưa
  const days = [{ date: '2026-11-21', label: '21/11' }, { date: '2026-11-22', label: '22/11' }, { date: '2026-11-23', label: '23/11' }];
  const row = (person, cells, extra = {}) => ({ row: 1, person, cells, ...extra });
  const data = {
    today: '2026-11-23', now, days,
    streams: [
      { key: 'ban4', name: 'Dòng tiền bán 4 dự án', bodApproved: true, days, groups: [
        { key: 'g1', name: 'Networking', pic: { name: 'Mai' }, rows: [
          row('An', { '2026-11-21': { kpi: 'Gọi 10 khách', res: '' }, '2026-11-22': { kpi: 'Gặp 3 khách', res: '' }, '2026-11-23': { kpi: 'Chốt 1 deal', res: '' } }, { note: 'Khách bận' }),
          row('Bình', { '2026-11-21': { kpi: 'Đã xong', res: 'D' }, '2026-11-22': { kpi: 'Ghi không đạt', res: 'K' } }),
          row('', { '2026-11-22': { kpi: 'Không ghi người', res: '' } }),
        ] },
      ] },
      { key: 'bank', name: 'Dòng tiền Banking', bodApproved: true, days, groups: [
        { key: 'g1', name: 'Tín dụng', rows: [row('an', { '2026-11-22': { kpi: 'Nộp hồ sơ', res: '' } })] },
      ] },
      { key: 'tp', name: 'Dòng tiền trái phiếu', bodApproved: false, days, groups: [
        { key: 'g1', name: 'TP', rows: [row('Cường', { '2026-11-21': { kpi: 'Quá hạn nhưng chưa trình BOD', res: '' } })] },
      ] },
    ],
  };
  const r = noWaitingPoint(buildModel(data), now);
  assert.deepEqual(r.unapproved.map((u) => [u.stream, u.group, u.code]), [['Dòng tiền trái phiếu', 'TP', 'N']]);
  assert.equal(r.total, 5);
  // Sắp đến hạn: KPI 23/11 của An chưa tick, hạn 05:00 24/11 (còn 19 giờ)
  assert.deepEqual(r.upcoming.map((it) => [it.person, it.kpi, it.leftMs]), [['An', 'Chốt 1 deal', dueAt('2026-11-23') - now]]);
  // An (3: 21, 22 ở bán 4 dự án + 22 ở Banking, "an" gộp cùng người) > Bình (1: ghi Không đạt) = Mai (1: dòng không ghi người -> PIC nhóm)
  assert.deepEqual(r.people.map((p) => [p.name, p.count]), [['An', 3], ['Bình', 1], ['Mai', 1]]);
  const an = r.people[0];
  assert.deepEqual(an.groups, ['Dòng tiền bán 4 dự án · Networking', 'Dòng tiền Banking · Tín dụng']);
  assert.deepEqual(an.items.map((it) => [it.date, it.kpi, it.due, it.overdueMs]), [
    ['2026-11-21', 'Gọi 10 khách', dueAt('2026-11-21'), now - dueAt('2026-11-21')],
    ['2026-11-22', 'Gặp 3 khách', dueAt('2026-11-22'), now - dueAt('2026-11-22')],
    ['2026-11-22', 'Nộp hồ sơ', dueAt('2026-11-22'), now - dueAt('2026-11-22')],
  ]);
  assert.equal(an.oldestDue, dueAt('2026-11-21'));
  assert.equal(an.items[0].note, 'Khách bận');
  // Tick xong -> rời khỏi trang
  data.streams[0].groups[0].rows[0].cells['2026-11-21'].res = 'D';
  assert.equal(noWaitingPoint(buildModel(data), now).people[0].count, 2);
  // Trước 05:00 23/11 giờ VN: KPI ngày 22 chưa quá hạn
  const early = Date.parse('2026-11-22T21:30:00Z');
  const r2 = noWaitingPoint(buildModel({ ...data, today: '2026-11-22', now: early }), early);
  assert.deepEqual(r2.people, []);
  assert.equal(r2.total, 0); // KPI 21/11 của An đã tick, ngày 22 chưa tới hạn, Bình ghi Không đạt ngày 22 cũng chưa tới hạn
  // Tất cả KPI chưa xong (kể cả ghi Không đạt, kể cả ngày sau) đều ở danh sách sắp đến hạn, hạn gần nhất trước
  assert.deepEqual(r2.upcoming.map((it) => [it.person, it.date]), [['an', '2026-11-22'], ['An', '2026-11-22'], ['Bình', '2026-11-22'], ['Mai', '2026-11-22'], ['An', '2026-11-23']]);
});

test('Cột thời gian thực hiện (09:00-10:00): hạn = giờ kết thúc; sheet có cột giờ riêng từng ngày hoặc chung cả dòng', () => {
  assert.deepEqual(parseTimeWindow('09:00-10:00'), { start: '09:00', end: '10:00' });
  assert.deepEqual(parseTimeWindow('9h-10h30'), { start: '09:00', end: '10:30' });
  assert.deepEqual(parseTimeWindow('8h30 đến 9h'), { start: '08:30', end: '09:00' });
  assert.deepEqual(parseTimeWindow('trước 16:00'), { start: '', end: '16:00' });
  assert.equal(parseTimeWindow('21/11'), null);
  assert.equal(parseTimeWindow('Sáng'), null);
  assert.equal(timeLabel('09:00-10:00'), '09:00–10:00');
  assert.equal(timeLabel('16h'), 'đến 16:00');
  assert.equal(timeLabel(''), '');
  // Hạn: 10:00 ngày 22/11 giờ VN = 03:00Z; không ghi giờ -> 05:00 sáng 23/11
  assert.equal(dueAtOf({ time: '09:00-10:00' }, '2026-11-22'), Date.parse('2026-11-22T03:00:00Z'));
  assert.equal(dueAtOf({ time: 'Sáng' }, '2026-11-22'), dueAt('2026-11-22'));
  assert.equal(dueLabel('2026-11-22', dueAtOf({ time: '09:00-10:00' }, '2026-11-22')), '10:00 22/11');
  // Trạng thái theo giờ: 09:30 đang làm, 10:00 quá hạn; tick lúc 10:05 = trễ hạn, tick 09:50 = đúng hạn
  const cell = { kpi: 'Gọi khách', res: '', time: '09:00-10:00' };
  assert.equal(statusOf(cell, '2026-11-22', '2026-11-22', Date.parse('2026-11-22T02:30:00Z')), 'N');
  assert.equal(statusOf(cell, '2026-11-22', '2026-11-22', Date.parse('2026-11-22T03:00:00Z')), 'K');
  assert.equal(statusOf({ ...cell, res: 'D', at: '2026-11-22T03:05:00Z' }, '2026-11-22', '2026-11-22'), 'L');
  assert.equal(statusOf({ ...cell, res: 'D', at: '2026-11-22T02:50:00Z' }, '2026-11-22', '2026-11-22'), 'D');
  // Sheet: mỗi ngày 3 cột KPI | Thời gian | Kết quả
  const csv3 = [
    'PIC phụ trách: Hoàng Thị Quỳnh Mai,,,,,,,,,',
    'Stt,Nhóm,PIC,Người phụ trách,21/11,,,22/11,,',
    ',,,,KPI,Thời gian,Kết quả,KPI,Thời gian,Kết quả',
    '1,Networking,Mai,An,Gọi 10 khách,09:00-10:00,TRUE,Gặp khách,14h-15h,',
    '2,Networking,Mai,Bình,Soạn hợp đồng,,FALSE,,,',
  ].join('\n');
  const s3 = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', csv3), { year: 2026 });
  assert.equal(s3.error, undefined);
  assert.deepEqual(s3.warnings, []);
  assert.deepEqual(s3.days.map((d) => d.date), ['2026-11-21', '2026-11-22']);
  const [an, binh] = s3.groups[0].rows;
  assert.deepEqual(an.cells, { '2026-11-21': { kpi: 'Gọi 10 khách', res: 'D', time: '09:00-10:00' }, '2026-11-22': { kpi: 'Gặp khách', res: '', time: '14h-15h' } });
  assert.deepEqual(binh.cells, { '2026-11-21': { kpi: 'Soạn hợp đồng', res: '' } });
  // Sheet: 1 cột "Thời gian thực hiện" chung cho cả dòng, mỗi ngày vẫn 2 cột KPI | Kết quả
  const csvRow = [
    'Stt,Nhóm,PIC,Người phụ trách,Thời gian thực hiện,21/11,,22/11,',
    ',,,,,KPI,Kết quả,KPI,Kết quả',
    '1,Networking,Mai,An,08:00-09:00,Gọi 10 khách,,Gặp khách,TRUE',
  ].join('\n');
  const sr = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', csvRow), { year: 2026 });
  assert.deepEqual(sr.groups[0].rows[0].cells, { '2026-11-21': { kpi: 'Gọi 10 khách', res: '', time: '08:00-09:00' }, '2026-11-22': { kpi: 'Gặp khách', res: 'D', time: '08:00-09:00' } });
  // Không có cột giờ: không có trường time
  const s0 = parseKpiTab(tab('DÒNG TIỀN BÁN 4 DỰ ÁN', TAB_CSV), { year: 2026 });
  assert.equal(s0.groups[0].rows[0].cells['2026-11-21'].time, undefined);
});

test('dueLabel / overdueText: hạn 05:00 hôm sau giờ VN, quá hạn tính ngày / giờ / phút', () => {
  assert.equal(dueLabel('2026-11-21'), '05:00 22/11');
  assert.equal(dueLabel('2026-11-30'), '05:00 01/12');
  assert.equal(overdueText(0), 'vừa quá hạn');
  assert.equal(overdueText(15 * 60000), '15 phút');
  assert.equal(overdueText(5 * 3600000 + 20 * 60000), '5 giờ 20 phút');
  assert.equal(overdueText(3 * 3600000), '3 giờ');
  assert.equal(overdueText(2 * 86400000 + 3 * 3600000 + 59 * 60000), '2 ngày 3 giờ');
  assert.equal(overdueText(86400000), '1 ngày');
});

test('navBar: 4 trang (ẩn Dòng tiền) + tài khoản, đánh dấu trang đang mở', async () => {
  const { navBar, NAV_PAGES } = await import('../src/pages.js');
  assert.deepEqual(NAV_PAGES.map(([href]) => href), ['/kpi', '/lich-truc', '/lich', '/waiting-point', '/no-waiting-point']);
  assert.deepEqual(NAV_PAGES.slice(3).map(([, label]) => label), ['Điểm nghẽn', 'Zero Waiting Point']);
  const html = navBar({ role: 'user', fullName: 'Võ <Đào>' }, '/kpi');
  assert.match(html, /<a class="wr-link" href="\/kpi" aria-current="page">KPI & kết quả<\/a>/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /Võ &lt;Đào&gt;/);
  assert.match(html, /href="\/doi-mat-khau"/);
  assert.match(navBar({ role: 'admin', fullName: 'Quản trị viên' }, '/admin'), /href="\/admin" aria-current="page">Quản trị/);
});

test('stampTicks: ghi giờ cho ô vừa tick, giữ giờ cũ khi chèn dòng / sửa chữ KPI, bỏ tick rồi tick lại tính lần sau', () => {
  const mk = (rows) => [{ name: 'Bán 4 dự án', groups: [{ name: 'Networking', rows }] }];
  const T1 = Date.UTC(2026, 10, 22, 2, 0);
  const T2 = T1 + 60000;
  const iso = (t) => new Date(t).toISOString();
  // Lần đọc đầu: ô đã tick không có giờ
  const a = stampTicks(mk([{ row: 3, person: 'An', cells: { '2026-11-21': { kpi: 'Gọi khách', res: 'D' }, '2026-11-22': { kpi: 'Gặp khách', res: '' } } }]), null, T1);
  assert.equal(a[0].groups[0].rows[0].cells['2026-11-21'].at, undefined);
  // Tick ô ngày 22 + chèn 1 dòng phía trên (số dòng đổi 3 -> 4): ô mới tick có giờ, ô cũ vẫn không có giờ
  const b = stampTicks(mk([{ row: 4, person: 'An', cells: { '2026-11-21': { kpi: 'Gọi khách', res: 'D' }, '2026-11-22': { kpi: 'Gặp khách', res: 'D' } } }]), a, T1);
  assert.deepEqual(b[0].groups[0].rows[0].cells, { '2026-11-21': { kpi: 'Gọi khách', res: 'D' }, '2026-11-22': { kpi: 'Gặp khách', res: 'D', at: iso(T1) } });
  // Sửa chữ KPI (cùng dòng): giữ giờ cũ
  const c = stampTicks(mk([{ row: 4, person: 'An', cells: { '2026-11-22': { kpi: 'Gặp 5 khách', res: 'D' } } }]), b, T2);
  assert.equal(c[0].groups[0].rows[0].cells['2026-11-22'].at, iso(T1));
  // Bỏ tick rồi tick lại: giờ của lần tick sau
  const d = stampTicks(mk([{ row: 4, person: 'An', cells: { '2026-11-22': { kpi: 'Gặp 5 khách', res: '' } } }]), c, T2);
  const e = stampTicks(mk([{ row: 4, person: 'An', cells: { '2026-11-22': { kpi: 'Gặp 5 khách', res: 'D' } } }]), d, T2 + 60000);
  assert.equal(e[0].groups[0].rows[0].cells['2026-11-22'].at, iso(T2 + 60000));
  // Dòng tiền mới thêm vào file: ô đã tick sẵn không có giờ
  const f = stampTicks([...mk([]), { name: 'Banking', groups: [{ name: 'SS1', rows: [{ row: 3, person: 'Tài', cells: { '2026-11-21': { kpi: 'Hồ sơ', res: 'D' } } }] }] }], e, T2);
  assert.equal(f[1].groups[0].rows[0].cells['2026-11-21'].at, undefined);
});

test('plan: 8 dòng tiền đánh số trong file phân chia nhiệm vụ — xếp, đánh số, giữ đúng tên đầy đủ, ẩn tab ngoài danh sách', async () => {
  const { parsePlan, planName, applyPlan } = await import('../src/kpi/plan.js');
  assert.deepEqual(planName('Dòng tiền bán 4 dự án'), { name: 'Dòng tiền bán 4 dự án', desc: '' });
  assert.deepEqual(planName('1. Cổ phiếu – Equity 2. IPO / niêm yết'), { name: 'Dòng tiền Equity / IPO', desc: '' });
  assert.deepEqual(planName('Các gói tài trợ – Tài chính 57: Tổ chức Ban Tài chính 57.'), { name: 'Dòng tiền Tài chính 57', desc: 'Tổ chức Ban Tài chính 57.' });
  const plan = parsePlan([tab('DS nhân sự War-Room', [
    ',,,',
    'STT,STT dòng tiền,Dòng tiền,Thành viên',
    '1,,Cố vấn chỉ đạo,Trần Kim Chung',
    '2,1,Dòng tiền bán 4 dự án,Hoàng Thị Quỳnh Mai',
    '3,,,Mạc Thị Thúy Hiền',
    '4,2,Dòng tiền Banking,Nguyễn Thị Mai Thu',
    '5,5,"1. Cổ phiếu – Equity 2. IPO / niêm yết",',
    '6,8,Thanh lý,',
  ].join('\n'))]);
  assert.deepEqual(plan.map((p) => [p.no, p.name]), [[1, 'Dòng tiền bán 4 dự án'], [2, 'Dòng tiền Banking'], [5, 'Dòng tiền Equity / IPO'], [8, 'Nhóm thanh lý']]);

  // Tab task "Dòng tiền 5: Equity / IPO" -> số 5; tab "Dòng tiền Tài chính" không có trong danh sách -> ẩn
  const book = parseKpiBook([
    tab('Dòng tiền bán 4 dự án', [TASK_HEAD, '1,Dòng tiền 1: Bán 4 dự án,Networking,Lập kế hoạch,Mai'].join('\n')),
    tab('Trang tính6', MASTER_KPI),
    tab('Dòng tiền Tài chính', TASK_HEAD),
    tab('Trang tính9', [HEAD, SUB].join('\n')),
    tab('Dòng tiền Equity / IPO', [TASK_HEAD, '1,Dòng tiền 5: Equity / IPO,Equity / IPO,Lộ trình,Nhiên'].join('\n')),
    tab('Trang tính12', [HEAD, SUB, '1,Equity / IPO,Anh Nguyễn Thế Nhiên,Tổng hợp lộ trình,FALSE'].join('\n')),
  ], { year: 2026 });
  assert.deepEqual(book.streams.map((s) => [s.name, s.no ?? null]), [['Dòng tiền bán 4 dự án', 1], ['Dòng tiền Tài chính', null], ['Dòng tiền Equity / IPO', 5]]);
  const r = applyPlan(book.streams, plan);
  assert.deepEqual(r.streams.map((s) => [s.no, s.name, s.sourceName, s.groups.length]), [
    [1, 'Dòng tiền bán 4 dự án', 'Dòng tiền bán 4 dự án', 1],
    [2, 'Dòng tiền Banking', '', 0], // chưa có tab KPI: vẫn hiện
    [5, 'Dòng tiền Equity / IPO', 'Dòng tiền Equity / IPO', 1],
    [8, 'Nhóm thanh lý', '', 0],
  ]);
  assert.match(r.warnings.join('\n'), /Không hiện “Dòng tiền Tài chính”/);
  assert.deepEqual(applyPlan(book.streams, []).streams, book.streams); // chưa đọc được danh sách: giữ nguyên

  const { attachPeople } = await kpi();
  assert.deepEqual(attachPeople(r.streams).map((s) => [s.code, s.no]), [['DT01', 1], ['DT02', 2], ['DT05', 5], ['DT08', 8]]);
});

test('Nhóm hỗ trợ, Nhóm thanh lý & 9 tab đánh số (1. Dòng tiền ... -> 8. Nhóm thanh lý -> 9. Nhóm hỗ trợ)', async () => {
  const { parsePlan, applyPlan } = await import('../src/kpi/plan.js');
  const { attachPeople } = await kpi();
  const { toDashboard, flowLabel } = await import('../src/kpi/dashboard.js');

  assert.equal(isKpiTab('1. Dòng tiền bán 4 dự án'), true);
  assert.equal(isKpiTab('7. Dòng tiền Tài chính 57'), true);
  assert.equal(isKpiTab('Bản sao của 1. Dòng tiền bán 4 dự án'), false);
  assert.equal(isLiquidationTab('8. Nhóm thanh lý'), true);
  assert.equal(isLiquidationTab('Nhóm thanh lý'), true);
  assert.equal(isSupportTab('9. Nhóm hỗ trợ'), true);
  assert.equal(isSupportTab('9. Nho\u0301m ho\u0302\u0303 tro\u031b\u0323'), true);
  assert.equal(isSupportTab('Nhóm hỗ trợ'), true);
  assert.equal(streamNameOf('1. Dòng tiền bán 4 dự án'), 'Dòng tiền bán 4 dự án');
  assert.equal(streamNameOf('7. Dòng tiền Tài chính 57'), 'Dòng tiền Tài chính 57');
  assert.equal(streamNameOf('8. Nhóm thanh lý'), 'Nhóm thanh lý');
  assert.equal(streamNameOf('9. Nhóm hỗ trợ'), 'Nhóm hỗ trợ');
  assert.equal(flowLabel({ sheet: '1. Dòng tiền bán 4 dự án', name: 'Dòng tiền bán 4 dự án' }), 'Dòng tiền bán 4 dự án');
  assert.equal(flowLabel({ sheet: '8. Nhóm thanh lý', name: 'Nhóm thanh lý', kind: 'liquidation' }), 'Nhóm thanh lý');

  const book = parseKpiBook([
    tab('Waiting Point', 'STT,Dòng tiền\n1,X'),
    tab('1. Dòng tiền bán 4 dự án', MASTER_KPI),
    tab('2. Dòng tiền Banking', [HEAD, SUB, '1,H300,Hiền,Phán quyết,FALSE'].join('\n')),
    tab('3. Dòng tiền nợ khó đòi', [HEAD, SUB, '1,Tòa,Sum,Thi hành án,FALSE'].join('\n')),
    tab('4. Dòng tiền thu trước hạn quá hạn', [HEAD, SUB, '1,Dữ liệu,Thu,Tổng hợp,TRUE'].join('\n')),
    tab('5. Dòng tiền Equity / IPO', [HEAD, SUB, '1,Equity / IPO,Anh Nguyễn Thế Nhiên,Lộ trình IPO,FALSE'].join('\n')),
    tab('6. Dòng tiền trái phiếu', [HEAD, SUB, '1,Trái phiếu,Anh Nguyễn Thế Nhiên,Nhu cầu vốn,FALSE'].join('\n')),
    tab('7. Dòng tiền Tài chính 57', [HEAD, SUB].join('\n')),
    tab('8. Nhóm thanh lý', [HEAD, SUB, '1,Thanh lý đợt 2,Phạm Thị Như Thủy,Đề xuất danh mục tài sản,TRUE'].join('\n')),
    tab('9. Nho\u0301m ho\u0302\u0303 tro\u031b\u0323', [HEAD, SUB, '1,Nhóm IT,Nguyễn Thanh Phong,Chuẩn bị tài khoản AI,TRUE'].join('\n')),
  ], { year: 2026 });
  assert.deepEqual(book.streams.map((s) => [s.name, s.kind || 'cash']), [
    ['Dòng tiền bán 4 dự án', 'cash'],
    ['Dòng tiền Banking', 'cash'],
    ['Dòng tiền nợ khó đòi', 'cash'],
    ['Dòng tiền thu trước hạn quá hạn', 'cash'],
    ['Dòng tiền Equity / IPO', 'cash'],
    ['Dòng tiền trái phiếu', 'cash'],
    ['Dòng tiền Tài chính 57', 'cash'],
    ['Nhóm thanh lý', 'liquidation'],
    ['Nhóm hỗ trợ', 'support'],
  ]);
  assert.deepEqual(book.warnings, []);

  const plan = parsePlan([tab('DS nhân sự War-Room', [
    'STT,STT dòng tiền,Dòng tiền,Thành viên',
    '1,1,Dòng tiền bán 4 dự án,Mai',
    '2,2,Dòng tiền Banking,Thu',
    '3,3,Dòng tiền nợ khó đòi,Hiền',
    '4,4,Dòng tiền thu trước hạn/quá hạn,Hà Thu',
    '5,5,"1. Cổ phiếu – Equity 2. IPO / niêm yết",',
    '6,6,Trái phiếu,',
    '7,7,Các gói tài trợ – Tài chính 57: Tổ chức Ban Tài chính 57.,',
    '8,8,Thanh lý,',
  ].join('\n'))]);
  const applied = applyPlan(book.streams, plan);
  assert.deepEqual(applied.warnings, []);
  assert.deepEqual(applied.streams.map((s) => [s.no || null, s.name, s.kind || 'cash', s.groups.length]), [
    [1, 'Dòng tiền bán 4 dự án', 'cash', 1],
    [2, 'Dòng tiền Banking', 'cash', 1],
    [3, 'Dòng tiền nợ khó đòi', 'cash', 1],
    [4, 'Dòng tiền thu trước hạn quá hạn', 'cash', 1],
    [5, 'Dòng tiền Equity / IPO', 'cash', 1],
    [6, 'Dòng tiền trái phiếu', 'cash', 1],
    [7, 'Dòng tiền Tài chính 57', 'cash', 0],
    [8, 'Nhóm thanh lý', 'liquidation', 1],
    [null, 'Nhóm hỗ trợ', 'support', 1],
  ]);

  const attached = attachPeople(applied.streams);
  const sup = attached.find((s) => s.kind === 'support');
  const liq = attached.find((s) => s.kind === 'liquidation');
  assert.equal(sup.code, 'HT');
  assert.equal(sup.sheet, '9. Nho\u0301m ho\u0302\u0303 tro\u031b\u0323');
  assert.equal(sup.groups[0].rows[0].person, 'Nguyễn Thanh Phong');
  assert.equal(liq.code, 'TL');
  assert.equal(liq.sheet, '8. Nhóm thanh lý');
  assert.equal(liq.groups[0].rows[0].person, 'Phạm Thị Như Thủy');

  // Dashboard "/" giữ đủ 8 dòng tiền (1..8 gồm cả Thanh lý) với tên đầy đủ, chỉ loại Nhóm hỗ trợ (#9)
  const dash = toDashboard({ today: '2026-11-22', now: Date.UTC(2026, 10, 22), source: {}, streams: attached });
  assert.equal(dash.flows.length, 8);
  assert.deepEqual(dash.flows.map((f) => f.label), [
    'Dòng tiền bán 4 dự án',
    'Dòng tiền Banking',
    'Dòng tiền nợ khó đòi',
    'Dòng tiền thu trước hạn quá hạn',
    'Dòng tiền Equity / IPO',
    'Dòng tiền trái phiếu',
    'Dòng tiền Tài chính 57',
    'Nhóm thanh lý',
  ]);
  assert.ok(dash.flows.every((f) => f.key !== sup.key));
});

test('cột D "Người phụ trách": ưu tiên phân task theo Người phụ trách kèm PIC, bỏ trống thì dùng PIC không gắn kèm PIC', async () => {
  const { attachPeople } = await kpi();
  const { toDashboard } = await import('../src/kpi/dashboard.js');
  const { findTask, tasksOfDay } = await import('../src/kpi/close.js');

  const csv4 = [
    'Stt,Nhóm,PIC,Người phụ trách,22/11,,23/11,,Ghi chú / Vướng mắc',
    ',,,,KPI,Kết quả,KPI,Kết quả,',
    '1,Networking,Hoàng Thị Quỳnh Mai,Mạc Thị Thúy Hiền,Gặp 5 khách VIP,TRUE,Gọi 10 khách,FALSE,',
    '2,Networking,Hoàng Thị Quỳnh Mai,,Chốt kế hoạch tuần,FALSE,,,',
    '3,Networking,Hoàng Thị Quỳnh Mai,HOÀNG THỊ QUỲNH MAI,Họp nội bộ,TRUE,,,',
    '4,Networking,,Trương Huỳnh Thúy An,Lọc data khách hàng,FALSE,,,',
  ].join('\n');

  const parsed = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', csv4), { year: 2026 });
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.warnings, []);
  const rows = parsed.groups[0].rows;
  assert.deepEqual(rows.map((r) => [r.person, r.taskPic ?? null]), [
    ['Mạc Thị Thúy Hiền', 'Hoàng Thị Quỳnh Mai'],
    ['Hoàng Thị Quỳnh Mai', null],
    ['Hoàng Thị Quỳnh Mai', null],
    ['Trương Huỳnh Thúy An', null],
  ]);

  const attached = attachPeople([parsed]);
  const model = buildModel({ today: '2026-11-22', now: Date.UTC(2026, 10, 22, 8, 0), days: parsed.days, streams: attached });
  const grp = model.streams[0].groups[0];
  assert.deepEqual(grp.items.filter((it) => it.date === '2026-11-22').map((it) => [it.person, it.taskPic, it.kpi]), [
    ['Mạc Thị Thúy Hiền', 'Hoàng Thị Quỳnh Mai', 'Gặp 5 khách VIP'],
    ['Hoàng Thị Quỳnh Mai', '', 'Chốt kế hoạch tuần'],
    ['Hoàng Thị Quỳnh Mai', '', 'Họp nội bộ'],
    ['Trương Huỳnh Thúy An', '', 'Lọc data khách hàng'],
  ]);
  const stats = memberStats(grp, '2026-11-22');
  assert.deepEqual(stats.map((m) => [m.name, m.total, m.done]), [
    ['Mạc Thị Thúy Hiền', 1, 1],
    ['Hoàng Thị Quỳnh Mai', 2, 1],
    ['Trương Huỳnh Thúy An', 1, 0],
  ]);

  // Dashboard "/" cũng phân theo Người phụ trách và chỉ gắn taskPic khi khác PIC
  const dash = toDashboard({ today: '2026-11-22', now: Date.UTC(2026, 10, 22), source: {}, streams: attached });
  assert.deepEqual(dash.flows[0].items.map((it) => [it.pic, it.taskPic ?? null]), [
    ['Mạc Thị Thúy Hiền', 'Hoàng Thị Quỳnh Mai'],
    ['Hoàng Thị Quỳnh Mai', null],
    ['Hoàng Thị Quỳnh Mai', null],
    ['Trương Huỳnh Thúy An', null],
  ]);

  // Chốt sổ: bản chốt cũ lưu dưới tên PIC vẫn khớp khi sau này mới điền thêm cột Người phụ trách
  const tList = tasksOfDay([parsed], '2026-11-22');
  const oldClosed = [{ s: tList[0].s, g: tList[0].g, p: 'hoang thi quynh mai', k: tList[0].k, v: 'D' }];
  assert.equal(findTask(oldClosed, tList[0])?.v, 'D');
});

test('ô E1 duyệt KPI của BOD: FALSE -> bodApproved=false (đánh đỏ chưa được BOD duyệt); TRUE / sheet cũ -> bodApproved=true', async () => {
  const { attachPeople } = await kpi();
  const mkCsv = (r1) => [
    r1,
    'Stt,Nhóm,PIC,Người phụ trách,22/11,,',
    ',,,,KPI,Kết quả,',
    '1,Networking,Hoàng Thị Quỳnh Mai,,Gặp 5 khách VIP,TRUE,',
  ].join('\n');

  const unapproved = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', mkCsv('HƯỚNG DẪN,,,KPI đã được sếp duyệt,FALSE,,')), { year: 2026 });
  assert.equal(unapproved.bodApproved, false);

  const blankAfterLabel = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', mkCsv('HƯỚNG DẪN,,,KPI đã được sếp duyệt,,,')), { year: 2026 });
  assert.equal(blankAfterLabel.bodApproved, false);

  const approved = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', mkCsv('HƯỚNG DẪN,,,KPI đã được sếp duyệt,TRUE,,')), { year: 2026 });
  assert.equal(approved.bodApproved, true);

  const legacy = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', mkCsv('BẢNG KPI,,,,,,')), { year: 2026 });
  assert.equal(legacy.bodApproved, true);

  const attached = attachPeople([unapproved, approved]);
  const model = buildModel({ today: '2026-11-22', now: Date.UTC(2026, 10, 22, 8, 0), days: unapproved.days, streams: attached });
  // Sheet chưa có cột "Trạng thái duyệt": cả dòng tiền theo ô E1. Chưa duyệt -> nhóm "Chưa trình BOD", không hiện KPI.
  assert.equal(model.streams[0].bodApproved, false);
  assert.deepEqual(model.streams[0].groups.map((g) => [g.name, g.approval.code, g.approval.label]), [['Networking', 'N', 'Chưa trình BOD']]);
  assert.equal(model.streams[0].items.length, 0);
  assert.equal(model.streams[1].bodApproved, true);
  assert.equal(model.streams[1].items[0].bodApproved, true);
  assert.deepEqual(model.streams[1].approval, { A: 1, R: 0, N: 0, total: 1, pending: 0 });
});

test('Cột "Trạng thái duyệt" theo nhóm: 3 trạng thái, chỉ tính KPI nhóm BOD đã duyệt; ghi ở dòng đầu nhóm hoặc dòng mục La Mã', async () => {
  const { attachPeople } = await kpi();
  for (const [v, code] of [['Đã được BOD duyệt', 'A'], ['Đã được BOD tạm duyệt', 'A'], ['BOD đã duyệt', 'A'], ['TRUE', 'A'],
    ['Cần điều chỉnh, bổ sung và trình lại', 'R'], ['Cần điều chỉnh lại KPI theo bút phê', 'R'], ['Trình lại BOD', 'R'],
    ['Chưa trình BOD', 'N'], ['chưa trình', 'N'], ['FALSE', 'N'], ['', '']]) assert.equal(approvalCode(v), code, v);
  const csv = [
    'HƯỚNG DẪN,,,KPI đã được sếp duyệt,TRUE,,,,',
    'Stt,Nhóm,PIC,Người phụ trách,Trạng thái duyệt BOD,Chỉ đạo của BLĐ,22/11,,',
    ',,,,,,KPI,Kết quả,',
    '1,Networking,Hoàng Thị Quỳnh Mai,,Đã được BOD duyệt,Liên tục cập nhật,Gặp 5 khách VIP,TRUE,',
    '2,Networking,Hoàng Thị Quỳnh Mai,An,,,Gọi 20 khách,,',
    '3,Phụ trách đại lý,Nguyễn Thị Kim Cúc,,Cần điều chỉnh lại KPI theo bút phê của BOD,,Ký 2 HĐ,,',
    'I,Data,,,Chưa trình BOD,,,,',
    '4,,Lê Thị Mai Tâm,,,,100 data,,',
    '5,Pháp lý,Trần Ngọc Vy,,,,Soạn hợp đồng,,',
  ].join('\n');
  const s = parseKpiTab(tab('1. Dòng tiền bán 4 dự án', csv), { year: 2026 });
  assert.equal(s.error, undefined);
  assert.deepEqual(s.groups.map((g) => [g.name, g.approval.code, g.approval.label, g.approval.directive || '']), [
    ['Networking', 'A', 'Đã được BOD duyệt', 'Liên tục cập nhật'],
    ['Phụ trách đại lý', 'R', 'Cần điều chỉnh lại KPI theo bút phê của BOD', ''],
    ['Data', 'N', 'Chưa trình BOD', ''],
    ['Pháp lý', 'N', 'Chưa trình BOD', ''], // trống = chưa trình, dù ô E1 đã tick
  ]);
  assert.equal(s.bodApproved, false);
  const model = buildModel({ today: '2026-11-22', now: Date.UTC(2026, 10, 22, 8, 0), days: s.days, streams: attachPeople([s]) });
  const st = model.streams[0];
  assert.deepEqual(st.approval, { A: 1, R: 1, N: 2, total: 4, pending: 3 });
  assert.deepEqual(st.items.map((it) => [it.group, it.kpi]), [['Networking', 'Gặp 5 khách VIP'], ['Networking', 'Gọi 20 khách']]);
  assert.deepEqual(st.groups.map((g) => g.items.length), [2, 0, 0, 0]);
  const r = noWaitingPoint(model, Date.UTC(2026, 10, 22, 8, 0));
  assert.deepEqual(r.unapproved.map((u) => [u.group, u.code]), [['Phụ trách đại lý', 'R'], ['Data', 'N'], ['Pháp lý', 'N']]);
});

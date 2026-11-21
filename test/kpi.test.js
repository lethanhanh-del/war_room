import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvSheet, parseCsv } from '../src/excel/gsheet.js';
import { isKpiTab, parseKpiBook, parseKpiTab, personName, resultCode, streamNameOf } from '../src/kpi/sheet.js';
import { buildModel, count, defaultDay, isLateTick, memberStats, noteTargets, refDate, statusOf, weekday } from '../public/kpi-model.js';
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
  assert.equal(streamNameOf('DÒNG TIỀN BÁN 4 DỰ ÁN'), 'Bán 4 dự án');
  assert.equal(streamNameOf('Dòng tiền thu trước hạn quá hạn'), 'Thu trước hạn quá hạn');
  assert.equal(streamNameOf('DÒNG TIỀN: BANKING'), 'Banking');
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
  assert.equal(s.name, 'Bán 4 dự án');
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
  assert.deepEqual(book.streams.map((s) => [s.sheet, s.name]), [['DÒNG TIỀN BÁN 4 DỰ ÁN', 'Bán 4 dự án'], ['Dòng tiền tài chính', 'Tài chính']]);
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
    ['Dòng tiền bán 4 dự án', 'Trang tính6', 'Bán 4 dự án', 'Hoàng Thị Quỳnh Mai'],
    ['Dòng tiền Equity / IPO', 'Trang tính12', 'Equity / IPO', ''],
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
  // Hoàn thành trễ hạn: tick sau khi hết ngày của KPI (giờ VN = UTC+7), có 10 phút du di sau nửa đêm
  assert.equal(isLateTick('2026-11-21', '2026-11-21T16:59:00.000Z'), false); // 23:59 ngày 21
  assert.equal(isLateTick('2026-11-21', '2026-11-21T17:05:00.000Z'), false); // 00:05 ngày 22: còn du di
  assert.equal(isLateTick('2026-11-21', '2026-11-21T17:11:00.000Z'), true); // 00:11 ngày 22
  assert.equal(isLateTick('2026-11-21', ''), false); // không biết giờ tick
  assert.equal(statusOf({ kpi: 'a', res: 'D', at: '2026-11-22T02:00:00.000Z' }, '2026-11-21', '2026-11-23'), 'L');
  assert.equal(statusOf({ kpi: 'a', res: 'D', at: '2026-11-21T02:00:00.000Z' }, '2026-11-21', '2026-11-23'), 'D');
  assert.equal(statusOf(undefined, '2026-11-21', '2026-11-23'), null);
  assert.equal(weekday('2026-11-21'), 'T7');
  assert.equal(weekday('2026-11-22'), 'CN');

  const m = buildModel(DEMO);
  const today = m.items.filter((it) => it.date === '2026-11-23');
  assert.deepEqual(count(today), { D: 10, L: 0, K: 3, N: 6, S: 0, total: 19 });
  assert.deepEqual(count(m.items.filter((it) => it.date <= '2026-11-23')), { D: 37, L: 4, K: 10, N: 6, S: 0, total: 57 });
  const ban = m.streams[0];
  assert.deepEqual(count(ban.items), { D: 16, L: 2, K: 3, N: 3, S: 16, total: 40 });
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
  assert.deepEqual([nam.total, nam.done, nam.late, nam.backlog], [1, 1, 1, 0]); // tick trễ: vẫn là đã hoàn thành
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
    assert.deepEqual(data.streams.map((s) => [s.name, s.groups.length]), [['Bán 4 dự án', 4]]);
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

test('navBar: 4 trang + tài khoản, đánh dấu trang đang mở', async () => {
  const { navBar, NAV_PAGES } = await import('../src/pages.js');
  assert.deepEqual(NAV_PAGES.map(([href]) => href), ['/', '/kpi', '/lich-truc', '/lich']);
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

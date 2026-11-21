import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvSheet, parseCsv } from '../src/excel/gsheet.js';
import { isKpiTab, parseKpiBook, parseKpiTab, personName, resultCode, streamNameOf } from '../src/kpi/sheet.js';
import { buildModel, count, defaultDay, noteTargets, refDate, statusOf, weekday } from '../public/kpi-model.js';
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
  assert.throws(() => parseKpiBook([tab('Sheet1', HEAD)]), /chưa có tab/);
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
  assert.equal(kpiSheetId({}), '1vjhwDkU2-pdktEqGvqWHy2Op86cpjq8JAFVv5e1GjHg');
  assert.equal(kpiSheetId({ KPI_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0' }), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  assert.equal(kpiSheetId({ KPI_SHEET_URL: 'off' }), '');
  assert.equal(vnDate(Date.UTC(2026, 10, 22, 18, 30)), '2026-11-23'); // 01:30 ngày 23 giờ VN
});

test('kpi-model: trạng thái theo hôm nay, đếm, ghi chú ở KPI tồn đọng gần nhất, ngày mặc định', () => {
  assert.equal(statusOf({ kpi: 'a', res: 'D' }, '2026-11-21', '2026-11-23'), 'D');
  assert.equal(statusOf({ kpi: 'a', res: 'K' }, '2026-11-25', '2026-11-23'), 'K');
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-23', '2026-11-23'), 'C');
  assert.equal(statusOf({ kpi: 'a', res: '?' }, '2026-11-21', '2026-11-23'), 'C');
  assert.equal(statusOf({ kpi: 'a', res: '' }, '2026-11-24', '2026-11-23'), 'S');
  assert.equal(statusOf(undefined, '2026-11-21', '2026-11-23'), null);
  assert.equal(weekday('2026-11-21'), 'T7');
  assert.equal(weekday('2026-11-22'), 'CN');

  const m = buildModel(DEMO);
  const today = m.items.filter((it) => it.date === '2026-11-23');
  assert.deepEqual(count(today), { D: 10, K: 3, C: 6, S: 0, total: 19 });
  assert.deepEqual(count(m.items.filter((it) => it.date <= '2026-11-23')), { D: 37, K: 14, C: 6, S: 0, total: 57 });
  const ban = m.streams[0];
  assert.deepEqual(count(ban.items), { D: 16, K: 5, C: 3, S: 16, total: 40 });
  const net = ban.groups[0];
  assert.equal(net.items.filter((it) => it.date === '2026-11-23').length, 3); // 3 người, mỗi người 1 KPI
  const notes = noteTargets(net.items, '2026-11-23');
  assert.deepEqual([...notes].map((id) => net.items.find((it) => it.id === id).kpi), ['Chăm sóc 10 khách tiềm năng']);
  assert.equal(defaultDay(m), '2026-11-23');
  assert.equal(defaultDay({ ...m, today: '2026-12-01' }), 'all');
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

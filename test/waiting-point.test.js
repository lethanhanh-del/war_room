// Kiểm thử Waiting Point trên nhánh feat/kpi-plan (chỉ đọc tab Waiting Point gid=2043772221).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/d1.js';

import {
  parseTimeSpec,
  resolveDeadlineFromSpec,
  computeTiming,
  isCompleteWaitingRow,
  reconcileMissingItems,
  pruneTodayHistoryBySheet,
  parseGvizPayload,
  parseCsvText,
  groupItemsByPerson,
  getPeopleGridLayout,
  getTaskLimitForPeopleCount,
  buildDailyStats,
  formatDateLabelVN,
  buildWaitingPointXlsx,
  fetchWaitingPoints,
} from '../public/waiting-point.js';
import { countWaitingPointPeopleFromCsv, emptyWaitingPointState, mergeWaitingPointState, pruneHistoryAgainstSheetRows } from '../src/waiting-point-sync.js';
import { AUTO_ROTATE_TABS, nextRotateTarget, navBar, waitingPointRotateSec } from '../src/pages.js';

test('parseTimeSpec xử lý đủ 12 mốc dropdown và các định dạng giờ', () => {
  const presets = [
    ['5 phút', 300],
    ['10 phút', 600],
    ['15 phút', 900],
    ['20 phút', 1200],
    ['30 phút', 1800],
    ['45 phút', 2700],
    ['1 giờ', 3600],
    ['1 giờ 30 phút', 5400],
    ['2 giờ', 7200],
    ['3 giờ', 10800],
    ['4 giờ', 14400],
    ['1 ngày', 86400],
  ];
  for (const [label, sec] of presets) {
    const spec = parseTimeSpec(label);
    assert.equal(spec.kind, 'duration', label);
    assert.equal(spec.durationSec, sec, label);
  }
  assert.equal(parseTimeSpec('15p').durationSec, 900);
  assert.equal(parseTimeSpec('1h30').durationSec, 5400);
  assert.equal(parseTimeSpec('00:20:00').durationSec, 1200);
  assert.equal(parseTimeSpec('2:30 CH').targetHour, 14);
  assert.equal(parseTimeSpec('').kind, 'none');

  // Khoảng thời lượng (2-3 giờ, 10-15 phút) vẫn tính thời lượng, không nhận nhầm là ngày
  assert.equal(parseTimeSpec('2-3 giờ').kind, 'duration');
  assert.equal(parseTimeSpec('10-15 phút').kind, 'duration');
});

test('Ô Thời gian xử lý nhập ngày / mốc ngày thì chuyển sang trạng thái Đang xử lý (không đếm thời gian)', () => {
  const dateInputs = [
    '21/11',
    '22/11/2026',
    '2026-11-22',
    '22-11-2026',
    '22.11.2026',
    'Ngày 23/11',
    'Ngày 23',
    '23 tháng 11',
    'Date(2026,10,22)',
    'Date(2026,10,22,0,0,0)',
    'Nộp 21/11; có kết quả 22/11; được duyệt 23/11',
    'Trình 21/11, chi tiền 22/11',
    '21/11 (xác nhận hạn mức, gửi thử 400 tin)',
  ];
  const now = 1_700_000_000_000;

  for (const raw of dateInputs) {
    const spec = parseTimeSpec(raw);
    assert.equal(spec.kind, 'processing', raw);
    assert.deepEqual(resolveDeadlineFromSpec(spec, now), { totalSec: null, endAt: null }, raw);
    assert.equal(
      isCompleteWaitingRow({
        stream: 'Dòng tiền 1: Bán 4 dự án',
        group: 'Data',
        issue: 'Mẫu Zalo',
        timeRaw: raw,
        owner: 'Xuân Thi',
        supporter: 'DAIT',
      }),
      true,
      raw,
    );
    // Kể cả khi bản ghi cũ còn sót endAt đã quá hạn trong cache, computeTiming vẫn trả mode/tier = processing
    const timing = computeTiming({ timeRaw: raw, timeSpec: spec, startedAt: now - 7200_000, endAt: now - 3600_000 }, now);
    assert.equal(timing.mode, 'processing', raw);
    assert.equal(timing.tier, 'processing', raw);
    assert.equal(timing.remainingSec, Number.POSITIVE_INFINITY, raw);
  }

  // Nhóm có toàn việc nhập ngày -> topTier = processing; có việc gấp đếm ngược thì việc gấp đứng trên
  const dateItem = {
    id: 'd1',
    stream: 'Bán 4 dự án',
    group: 'Data',
    issue: 'Duyệt mẫu Zalo',
    timeRaw: 'Nộp 21/11; có kết quả 22/11',
    timeSpec: parseTimeSpec('Nộp 21/11; có kết quả 22/11'),
    owner: 'Thi',
    supporter: 'DAIT',
    startedAt: now - 60_000,
    totalSec: null,
    endAt: null,
    isClearing: false,
  };
  dateItem.timing = computeTiming(dateItem, now);
  const urgentItem = {
    id: 'u1',
    stream: 'Bán 4 dự án',
    group: 'Networking',
    issue: 'Hư wifi',
    timeRaw: '15 phút',
    timeSpec: parseTimeSpec('15 phút'),
    owner: 'Anh',
    supporter: 'Chiến',
    startedAt: now - 60_000,
    totalSec: 900,
    endAt: now + 840_000,
    isClearing: false,
  };
  urgentItem.timing = computeTiming(urgentItem, now);

  const grouped = groupItemsByPerson([dateItem, urgentItem]);
  assert.equal(grouped[0].name, 'Chiến');
  assert.equal(grouped[1].name, 'DAIT');
  assert.equal(grouped[1].topTier, 'processing');
});

test('parseGvizPayload & parseCsvText chỉ nhận dòng nhập đủ 6 cột thông tin, bỏ dòng thiếu bất kỳ trường nào', () => {
  const full = {
    stt: '',
    stream: 'Dòng tiền 1: Bán 4 dự án',
    group: 'Networking',
    issue: 'Hư wifi',
    timeRaw: '15 phút',
    owner: 'Thành Anh',
    supporter: 'Chiến',
  };
  assert.equal(isCompleteWaitingRow(full), true);
  assert.equal(isCompleteWaitingRow({ ...full, stream: '' }), false);
  assert.equal(isCompleteWaitingRow({ ...full, group: '' }), false);
  assert.equal(isCompleteWaitingRow({ ...full, issue: '' }), false);
  assert.equal(isCompleteWaitingRow({ ...full, timeRaw: '' }), false);
  assert.equal(isCompleteWaitingRow({ ...full, timeRaw: 'chưa rõ' }), false);
  assert.equal(isCompleteWaitingRow({ ...full, owner: '' }), false);
  assert.equal(isCompleteWaitingRow({ ...full, supporter: '' }), false);

  const gviz = `google.visualization.Query.setResponse(${JSON.stringify({
    status: 'ok',
    table: {
      cols: [
        { label: 'PIC phụ trách: Hoàng Thị Quỳnh Mai STT' },
        { label: 'Dòng tiền' },
        { label: 'Nhóm công việc' },
        { label: 'Vấn đề gặp phải' },
        { label: 'Thời gian xử lý' },
        { label: 'Người phụ trách' },
        { label: 'Người hỗ trợ' },
      ],
      rows: [
        { c: [{ v: 'STT' }, { v: 'Dòng tiền' }, { v: 'Nhóm công việc' }, { v: 'Vấn đề gặp phải' }, { v: 'Thời gian xử lý' }, { v: 'Người phụ trách' }, { v: 'Người hỗ trợ' }] },
        // Đủ 6 cột thông tin (có STT) -> nhận
        { c: [{ v: 1 }, { v: 'Dòng tiền 1: Bán 4 dự án' }, { v: 'Networking' }, { v: 'Hư wifi' }, { v: '15 phút' }, { v: 'Thành anh' }, { v: 'Chiến' }] },
        // Đủ 6 cột thông tin (trống STT) -> vẫn nhận
        { c: [null, { v: 'Dòng tiền 1: Bán 4 dự án' }, { v: 'Data' }, { v: 'Thiếu file' }, { v: '10 phút' }, { v: 'Mai' }, { v: 'Tuấn' }] },
        // Thiếu Dòng tiền (không carry-forward) -> loại
        { c: [null, null, { v: 'Networking' }, { v: 'Hư máy lạnh' }, { v: '5 phút' }, { v: 'Phong' }, { v: 'Tuấn' }] },
        // Thiếu Người hỗ trợ -> loại
        { c: [{ v: 3 }, { v: 'Dòng tiền 1: Bán 4 dự án' }, { v: 'Networking' }, { v: 'Đang nhập dở' }, { v: '15 phút' }, { v: 'Phong' }, null] },
        // Thiếu Thời gian xử lý -> loại
        { c: [{ v: 4 }, { v: 'Dòng tiền 1: Bán 4 dự án' }, { v: 'Networking' }, { v: 'Chưa chọn giờ' }, null, { v: 'Phong' }, { v: 'Chiến' }] },
        // Thiếu Người phụ trách -> loại
        { c: [{ v: 5 }, { v: 'Dòng tiền 1: Bán 4 dự án' }, { v: 'Networking' }, { v: 'Chưa điền PIC' }, { v: '20 phút' }, null, { v: 'Chiến' }] },
        // Thiếu Nhóm công việc -> loại
        { c: [{ v: 6 }, { v: 'Dòng tiền 1: Bán 4 dự án' }, null, { v: 'Chưa chọn nhóm' }, { v: '20 phút' }, { v: 'Phong' }, { v: 'Chiến' }] },
      ],
    },
  })});`;

  const parsed = parseGvizPayload(gviz);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.incompleteCount, 5);
  assert.equal(parsed.items[0].supporter, 'Chiến');
  assert.equal(parsed.items[1].supporter, 'Tuấn');

  const csv = [
    'PIC phụ trách: Hoàng Thị Quỳnh Mai,,,,,,',
    'STT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải,Thời gian xử lý,Người phụ trách,Người hỗ trợ',
    '1,"Dòng tiền 1: Bán 4 dự án","Hồ sơ, giấy tờ khác","Thiếu sổ hồng",10 phút,Mai,Hùng',
    '2,,"Networking","Thiếu dòng tiền",5 phút,TÂN,Chiến',
    '3,"Dòng tiền 1: Bán 4 dự án","Networking","Thiếu người hỗ trợ",5 phút,TÂN,',
  ].join('\n');
  const csvParsed = parseCsvText(csv);
  assert.equal(csvParsed.items.length, 1);
  assert.equal(csvParsed.incompleteCount, 2);
  assert.equal(csvParsed.items[0].group, 'Hồ sơ, giấy tờ khác');
  assert.equal(csvParsed.items[0].supporter, 'Hùng');
});

test('groupItemsByPerson gom theo người hỗ trợ, xếp việc gấp nhất lên đầu và chia lưới hợp lý', () => {
  const now = 1_700_000_000_000;
  const mk = (id, supporter, remSec) => {
    const base = { id, stream: 'Bán 4 dự án', group: 'Data', issue: id, owner: 'Mai', supporter, startedAt: now - 60_000, totalSec: 600, endAt: now + remSec * 1000, isClearing: false };
    return { ...base, timing: computeTiming(base, now) };
  };
  const people = groupItemsByPerson([mk('a', 'Lan', 1200), mk('b', ' lan ', 180), mk('c', 'Minh', -60), mk('d', '', 500)]);
  assert.equal(people.length, 3);
  assert.equal(people[0].name, 'Minh');
  assert.equal(people[1].tasks[0].id, 'b');
  assert.equal(people[2].isUnassigned, true);
  assert.equal(getPeopleGridLayout(1), 'cols-1');
  assert.equal(getPeopleGridLayout(4), 'cols-2');
  assert.equal(getPeopleGridLayout(6), 'cols-3');
  assert.equal(getPeopleGridLayout(8), 'cols-4');
  assert.equal(getTaskLimitForPeopleCount(2), 4);
  assert.equal(getTaskLimitForPeopleCount(5), 3);
  assert.equal(getTaskLimitForPeopleCount(7), 2);
});

test('mergeWaitingPointState giữ lastSupporter khi xóa cột G trước cột D, backfill trùng và thống kê theo ngày', () => {
  const d1 = Date.UTC(2026, 10, 21, 5, 0, 0);
  const d2 = Date.UTC(2026, 10, 22, 5, 0, 0);
  const s1 = mergeWaitingPointState(
    emptyWaitingPointState(d1),
    { timers: { a: { startedAt: d1 - 10_000, totalSec: 600, endAt: d1 + 590_000, rawTime: '10 phút', lastSupporter: 'Tuấn', lastOwner: 'Phong' } } },
    d1,
  );
  const s2 = mergeWaitingPointState(
    s1,
    {
      timers: { a: { startedAt: d1 - 5_000, totalSec: 600, endAt: d1 + 595_000, rawTime: '10 phút', lastSupporter: '', lastOwner: '' } },
      clearedItems: [{ id: 'x', group: 'Data', issue: 'Thiếu SĐT', supporter: '', owner: '', clearedAt: d1 }],
    },
    d1 + 1000,
  );
  assert.equal(s2.timers.a.lastSupporter, 'Tuấn');

  const s3 = mergeWaitingPointState(
    s2,
    {
      clearedItems: [
        { id: 'x', group: 'Data', issue: 'Thiếu SĐT', supporter: 'Chiến', owner: 'Mai', clearedAt: d1 + 3000 },
        { id: 'a', group: 'Networking', issue: 'Hư máy lạnh', supporter: '', owner: '', clearedAt: d1 + 3000 },
      ],
      removedIds: ['a'],
    },
    d1 + 3000,
  );
  assert.equal(s3.recentCleared.find((r) => r.id === 'x').supporter, 'Chiến');
  assert.equal(s3.recentCleared.find((r) => r.id === 'a').supporter, 'Tuấn');

  const s4 = mergeWaitingPointState(
    s3,
    { clearedItems: [{ id: 'b', group: 'Pháp lý', issue: 'Scan sổ', supporter: 'Chiến', spentSec: 120, clearedAt: d2 }] },
    d2,
  );
  assert.equal(s4.historyByDate['2026-11-21'].length, 2);
  assert.equal(s4.historyByDate['2026-11-22'].length, 1);

  const stats = buildDailyStats([
    { supporter: 'Chiến', spentSec: 300 },
    { supporter: ' chiến ', spentSec: 100 },
    { supporter: 'Tuấn', spentSec: 200 },
  ]);
  assert.equal(stats.total, 3);
  assert.equal(stats.supporterCount, 2);
  assert.equal(stats.avgSec, 200);
  assert.equal(stats.bySupporter[0].name, 'Chiến');
  assert.equal(formatDateLabelVN('2026-11-22', '2026-11-22'), 'Hôm nay · 22/11');
  assert.equal(resolveDeadlineFromSpec(parseTimeSpec('15 phút'), d1).totalSec, 900);
});

test('Xóa 1 hàng chỉ chốt đúng 1 việc (không đánh hoàn thành toàn bộ), chống lỗi thiếu header và chống Ctrl+Z', () => {
  // 1. Dữ liệu lỗi/HTML không có dòng header -> phải throw, tuyệt đối không trả mảng rỗng làm chốt oan toàn bộ task
  assert.throws(() => parseCsvText('<html><body>Temporary error</body></html>'));

  // 2. Xóa 1 hàng trên Sheet (kể cả xóa luôn dòng banner PIC ở dòng 1) -> 2 hàng còn lại giữ nguyên ID
  const csvBefore = [
    'PIC phụ trách: Hoàng Thị Quỳnh Mai,,,,,,',
    'STT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải,Thời gian xử lý,Người phụ trách,Người hỗ trợ',
    '1,Dòng tiền 1: Bán 4 dự án,Networking,Hư wifi,15 phút,Thành Anh,Chiến',
    '2,Dòng tiền 1: Bán 4 dự án,Data,Thiếu file,10 phút,Mai,Tuấn',
    '3,Dòng tiền 2: Thu hồi công nợ,Pháp lý,Ký phụ lục,30 phút,Hương,Phong',
  ].join('\n');
  const csvAfterDeleteRow1 = [
    'STT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải,Thời gian xử lý,Người phụ trách,Người hỗ trợ',
    '2,Dòng tiền 1: Bán 4 dự án,Data,Thiếu file,10 phút,Mai,Tuấn',
    '3,Dòng tiền 2: Thu hồi công nợ,Pháp lý,Ký phụ lục,30 phút,Hương,Phong',
  ].join('\n');

  const before = parseCsvText(csvBefore);
  const after = parseCsvText(csvAfterDeleteRow1);
  assert.equal(before.items.length, 3);
  assert.equal(after.items.length, 2);
  assert.equal(after.items[0].id, before.items[1].id);
  assert.equal(after.items[1].id, before.items[2].id);

  // 3. reconcileMissingItems: nhịp 1 tạm giữ (nếu Ctrl+Z kịp thời -> không đánh hoàn thành), nhịp 2 mới chốt đúng 1 việc bị xóa
  const prevMap = new Map(before.items.map((x) => [x.id, x]));
  const pending = new Map();

  const poll1Next = new Map(after.items.map((x) => [x.id, x]));
  const r1 = reconcileMissingItems(prevMap, poll1Next, pending, 2);
  assert.equal(r1.confirmedRemoved.length, 0);
  assert.equal(r1.heldItems.length, 1);
  assert.equal(poll1Next.size, 3);

  // Nếu người dùng ấn Ctrl+Z ở nhịp 2 -> xóa bộ đếm thiếu, 0 việc bị chốt oan
  const undoNext = new Map(before.items.map((x) => [x.id, x]));
  const rUndo = reconcileMissingItems(poll1Next, undoNext, pending, 2);
  assert.equal(rUndo.confirmedRemoved.length, 0);
  assert.equal(pending.size, 0);

  // Nếu thực sự xóa hẳn dòng 1 qua 2 nhịp liên tiếp -> chỉ chốt đúng dòng 1, 2 dòng kia nguyên vẹn
  const delPoll1 = new Map(after.items.map((x) => [x.id, x]));
  reconcileMissingItems(prevMap, delPoll1, pending, 2);
  const delPoll2 = new Map(after.items.map((x) => [x.id, x]));
  const r2 = reconcileMissingItems(delPoll1, delPoll2, pending, 2);
  assert.equal(r2.confirmedRemoved.length, 1);
  assert.equal(r2.confirmedRemoved[0].issue, 'Hư wifi');
  assert.equal(delPoll2.size, 2);
});

test('Bảng thống kê tự đối chiếu với Sheet: dòng còn trên Sheet sẽ không bị tính là đã hoàn thành', () => {
  const now = Date.UTC(2026, 10, 21, 20, 30, 0); // 03:30 ngày 22/11 giờ VN
  const sheetRows = [
    { group: 'Networking', issue: 'buồn ngủ quớ', owner: 'TÂN', supporter: 'Chiến' },
    { group: 'Networking', issue: 'hiihi', owner: 'Anh', supporter: 'Chá' },
  ];
  const s1 = mergeWaitingPointState(
    emptyWaitingPointState(now),
    {
      clearedItems: [
        { id: '1', group: 'Networking', issue: 'hiihi', owner: 'Anh', supporter: 'Chá', clearedAt: now - 60_000 },
        { id: '2', group: 'Networking', issue: 'buồn ngủ quớ', owner: 'TÂN', supporter: 'Chiến', clearedAt: now - 60_000 },
        { id: '3', group: 'Networking', issue: 'Hư Người', owner: 'Tân', supporter: 'Chiến', clearedAt: now - 60_000 },
      ],
    },
    now,
  );
  assert.equal(s1.recentCleared.length, 3);

  // Client prune & Server merge với activeSheetRows đều chỉ giữ lại đúng 1 dòng đã xóa thật ("Hư Người")
  const clientCleaned = pruneTodayHistoryBySheet(s1.recentCleared, sheetRows);
  assert.equal(clientCleaned.length, 1);
  assert.equal(clientCleaned[0].issue, 'Hư Người');

  const helperCleaned = pruneHistoryAgainstSheetRows(s1.recentCleared, sheetRows);
  assert.equal(helperCleaned.length, 1);

  const s2 = mergeWaitingPointState(s1, { activeSheetRows: sheetRows }, now + 5000);
  assert.equal(s2.recentCleared.length, 1);
  assert.equal(s2.recentCleared[0].issue, 'Hư Người');

  // Xóa toàn bộ dữ liệu thống kê qua clearHistory: xóa sạch mọi ngày & chặn bản ghi cũ hơn historyResetAt quay lại
  const cleared = mergeWaitingPointState(s2, { clearHistory: true }, now + 10_000);
  assert.equal(cleared.recentCleared.length, 0);
  assert.equal(cleared.historyResetAt, now + 10_000);

  const staleRetry = mergeWaitingPointState(
    cleared,
    {
      clearedItems: [
        { id: 'old', group: 'Data', issue: 'Bản ghi cũ trước khi xóa', clearedAt: now + 5000 },
        { id: 'fresh', group: 'Data', issue: 'Bản ghi mới sau khi xóa', supporter: 'Chiến', clearedAt: now + 15_000 },
      ],
    },
    now + 15_000,
  );
  assert.equal(staleRetry.recentCleared.length, 1);
  assert.equal(staleRetry.recentCleared[0].issue, 'Bản ghi mới sau khi xóa');
});

test('Tự động chuyển tab: KPI (3p) ↔ Waiting Point (10s/người, bỏ qua khi 0 người) ↔ Hẹn lịch BOD (30s khi có lịch họp)', async () => {
  assert.deepEqual(
    AUTO_ROTATE_TABS.map((t) => [t.href, t.sec, t.secPerPerson || 0]),
    [
      ['/kpi', 180, 0],
      ['/waiting-point', 0, 10],
      ['/lich', 30, 0],
    ],
  );
  assert.equal(waitingPointRotateSec(0), 0);
  assert.equal(waitingPointRotateSec(1), 10);
  assert.equal(waitingPointRotateSec(4), 40);

  const allOn = { '/kpi': true, '/waiting-point': true, '/lich': true };
  // Đủ cả 3 tab có dữ liệu
  assert.equal(nextRotateTarget('/kpi', allOn, 2, 1).href, '/waiting-point');
  assert.equal(nextRotateTarget('/waiting-point', allOn, 2, 1).href, '/lich');
  assert.equal(nextRotateTarget('/lich', allOn, 2, 1).href, '/kpi');

  // Waiting Point trống (0 người), có lịch họp -> KPI <-> Hẹn lịch BOD (30s)
  assert.equal(nextRotateTarget('/kpi', allOn, 0, 1).href, '/lich');
  assert.equal(nextRotateTarget('/waiting-point', allOn, 0, 1).href, '/kpi');

  // Cả Waiting Point và Hẹn lịch đều trống -> ở lại KPI (null); đang ở /lich thì quay về /kpi
  assert.equal(nextRotateTarget('/kpi', allOn, 0, 0), null);
  assert.equal(nextRotateTarget('/lich', allOn, 0, 0).href, '/kpi');

  // Đang ở trang ngoài vòng xoay (/lich-truc) -> trả tab bật đầu tiên (/kpi)
  assert.equal(nextRotateTarget('/lich-truc', allOn).href, '/kpi');

  // Chỉ bật 0 hoặc 1 tab -> không tự chuyển
  assert.equal(nextRotateTarget('/kpi', { '/kpi': true, '/waiting-point': false, '/lich': false }), null);
  assert.equal(nextRotateTarget('/kpi', { '/kpi': false, '/waiting-point': false, '/lich': false }), null);

  // Đếm lịch họp sắp tới: bỏ qua block (chặn lịch) và khung đã qua, có lịch họp -> 30s
  const { summarizeUpcomingMeetings } = await import('../src/bookings.js');
  assert.deepEqual(
    summarizeUpcomingMeetings(
      [
        { slot: '2026-11-22T09:00', kind: 'meeting' },
        { slot: '2026-11-22T15:00', kind: 'block' },
      ],
      '2026-11-22T14:00',
    ),
    { upcomingCount: 0, nextSlot: '', sec: 0 },
  );
  assert.deepEqual(
    summarizeUpcomingMeetings(
      [
        { slot: '2026-11-22T14:30', kind: 'meeting' },
        { slot: '2026-11-22T15:00', kind: 'meeting' },
      ],
      '2026-11-22T14:00',
    ),
    { upcomingCount: 2, nextSlot: '2026-11-22T14:30', sec: 30 },
  );

  // Đếm người từ CSV Waiting Point: bỏ dòng thiếu cột, mỗi người +10s
  const emptyCsv = 'STT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải,Thời gian xử lý,Người phụ trách,Người hỗ trợ\n1,Dòng tiền 1: Bán 4 dự án,Networking,Thiếu người,10 phút,Mai,\n';
  assert.deepEqual(countWaitingPointPeopleFromCsv(emptyCsv), { peopleCount: 0, itemCount: 0, sec: 0 });
  const activeCsv = [
    'STT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải,Thời gian xử lý,Người phụ trách,Người hỗ trợ',
    '1,Dòng tiền 1: Bán 4 dự án,Networking,Hư wifi,15 phút,Thành Anh,Chiến',
    '2,Dòng tiền 1: Bán 4 dự án,Data,Thiếu file,10 phút,Mai,Chiến',
    '3,Dòng tiền 2: Banking,H300,Thiếu hồ sơ,20 phút,Thu,Tuấn',
  ].join('\n');
  assert.deepEqual(countWaitingPointPeopleFromCsv(activeCsv), { peopleCount: 2, itemCount: 3, sec: 20 });

  // navBar ẩn Dòng tiền, chèn công tắc xoay vòng 3 tab + banner lịch họp mới 30s
  const html = navBar({ role: 'admin', fullName: 'Quản trị viên' }, '/waiting-point');
  assert.match(html, /id="wrRotToggle"/);
  assert.match(html, /id="wrRotCfg"/);
  assert.match(html, /id="wrRotPop"/);
  assert.match(html, /id="wrBkBar"/);
  assert.doesNotMatch(html, /data-rot-href="\/"/);
  assert.doesNotMatch(html, /class="wr-link" href="\/"/);
  assert.match(html, /data-rot-href="\/kpi"/);
  assert.match(html, /data-rot-href="\/waiting-point"/);
  assert.match(html, /data-rot-href="\/lich"/);
  assert.match(html, /3 phút/);
  assert.match(html, /10s \/ người/);
  assert.match(html, /30s khi có lịch/);
});

test('buildWaitingPointXlsx tạo file .xlsx chuẩn OOXML ZIP với 2 sheet và giữ nguyên tiếng Việt UTF-8', () => {
  const items = [
    { date: '2026-11-22', at: '03:21', supporter: 'Chiến', owner: 'Tân', group: 'Networking & IT', stream: 'Dòng tiền 1: Bán 4 dự án', issue: 'Hư wifi <khẩn>', spentSec: 191 },
    { date: '2026-11-22', at: '03:35', supporter: 'Phong', owner: 'Tuấn', group: 'Data', stream: 'Dòng tiền 2: Banking', issue: 'Thiếu file đối soát', spentSec: 85 },
  ];
  const bytes = buildWaitingPointXlsx({
    dateKey: '2026-11-22',
    dateLabel: 'Hôm nay · 22/11',
    supporterLabel: 'Tất cả',
    items,
  });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000);
  // Kiểm tra magic bytes PKZIP header & End-of-Central-Directory
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...bytes.slice(bytes.length - 22, bytes.length - 18)], [0x50, 0x4b, 0x05, 0x06]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /xl\/worksheets\/sheet1\.xml/);
  assert.match(text, /xl\/worksheets\/sheet2\.xml/);
  assert.match(text, /Dòng tiền 1: Bán 4 dự án/);
  assert.match(text, /Networking &amp; IT/);
  assert.match(text, /Hư wifi &lt;khẩn&gt;/);
  assert.match(text, /Tổng hợp hỗ trợ/);
});

test('Đọc trực tiếp tab Waiting Point (read-only) trên Google Sheet thành công', async () => {
  const res = await fetchWaitingPoints();
  assert.ok(res.picName.length > 0);
  assert.ok(Array.isArray(res.items));
});

// Kiểm thử Waiting Point: parser thời gian/Sheet, gom theo người, đồng bộ trạng thái & API /api/waiting-point.
// CHỈ ĐỌC tab Waiting Point (gid=2043772221), tuyệt đối không ghi Google Sheet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTimeSpec,
  resolveDeadlineFromSpec,
  computeTiming,
  parseGvizPayload,
  parseCsvText,
  groupItemsByPerson,
  getPeopleGridLayout,
  getTaskLimitForPeopleCount,
  buildDailyStats,
  formatDateLabelVN,
  fetchWaitingPoints,
} from '../src/waiting-point/sheetService.js';
import { emptyWaitingPointState, mergeWaitingPointState } from '../api/_lib/waitingPointSync.js';

const { createServer } = await import('./dev-api.mjs');
let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

test('parseTimeSpec xử lý đủ 12 mốc dropdown và các định dạng rút gọn/mốc giờ', () => {
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
  for (const [label, expectedSec] of presets) {
    const spec = parseTimeSpec(label);
    assert.equal(spec.kind, 'duration', `preset ${label}`);
    assert.equal(spec.durationSec, expectedSec, `preset ${label}`);
  }

  assert.equal(parseTimeSpec('15p').durationSec, 900);
  assert.equal(parseTimeSpec('1h30').durationSec, 5400);
  assert.equal(parseTimeSpec('00:20:00').durationSec, 1200);
  assert.equal(parseTimeSpec('45s').durationSec, 45);
  assert.deepEqual(
    { kind: parseTimeSpec('22:00').kind, h: parseTimeSpec('22:00').targetHour, m: parseTimeSpec('22:00').targetMin },
    { kind: 'deadline', h: 22, m: 0 },
  );
  assert.deepEqual(
    { kind: parseTimeSpec('2:30 CH').kind, h: parseTimeSpec('2:30 CH').targetHour, m: parseTimeSpec('2:30 CH').targetMin },
    { kind: 'deadline', h: 14, m: 30 },
  );
  assert.equal(parseTimeSpec('21/11/2026 15:30').kind, 'timestamp');
  assert.equal(parseTimeSpec('').kind, 'none');
});

test('parseGvizPayload & parseCsvText đọc đủ 7 cột, carry-forward Dòng tiền và bỏ dòng header lặp', () => {
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
        { c: [{ v: 1 }, { v: 'Dòng tiền 1: Bán 4 dự án' }, { v: 'Networking' }, { v: 'Thiếu đầu mối sàn' }, { v: '15 phút' }, { v: 'An' }, { v: 'Bình' }] },
        { c: [null, null, { v: 'Networking' }, { v: 'Chờ duyệt bảng giá' }, { v: '5 phút' }, { v: 'An' }, { v: 'Bình' }] },
      ],
    },
  })});`;

  const parsed = parseGvizPayload(gviz);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[1].stream, 'Dòng tiền 1: Bán 4 dự án');
  assert.equal(parsed.items[0].owner, 'An');
  assert.equal(parsed.items[0].supporter, 'Bình');

  const csv = [
    'PIC phụ trách: Hoàng Thị Quỳnh Mai,,,,,,',
    'STT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải,Thời gian xử lý,Người phụ trách,Người hỗ trợ',
    '1,"Dòng tiền 1: Bán 4 dự án","Hồ sơ, giấy tờ khác","Thiếu bản scan sổ hồng",10 phút,Mai,Hùng',
  ].join('\n');
  const csvParsed = parseCsvText(csv);
  assert.equal(csvParsed.items.length, 1);
  assert.equal(csvParsed.items[0].group, 'Hồ sơ, giấy tờ khác');
  assert.equal(csvParsed.items[0].supporter, 'Hùng');
});

test('groupItemsByPerson gom theo người hỗ trợ, xếp việc gấp nhất lên đầu và chia lưới hợp lý', () => {
  const now = 1_700_000_000_000;
  const makeItem = (id, supporter, remainingSec) => {
    const spec = parseTimeSpec(`${Math.max(1, Math.abs(Math.round(remainingSec / 60)))} phút`);
    const base = {
      id,
      stream: 'Dòng tiền 1: Bán 4 dự án',
      group: 'Data',
      issue: `Task ${id}`,
      owner: 'Mai',
      supporter,
      startedAt: now - 60_000,
      totalSec: 600,
      endAt: now + remainingSec * 1000,
      timeSpec: spec,
      isClearing: false,
    };
    return { ...base, timing: computeTiming(base, now) };
  };

  const people = groupItemsByPerson([
    makeItem('t1', 'Lan', 1200),
    makeItem('t2', '  lan ', 180),
    makeItem('t3', 'Minh', -90),
    makeItem('t4', '', 600),
  ]);

  assert.equal(people.length, 3);
  assert.equal(people[0].name, 'Minh');
  assert.equal(people[0].burnCount, 1);
  assert.equal(people[1].name, 'Lan');
  assert.equal(people[1].tasks[0].id, 't2');
  assert.equal(people[2].isUnassigned, true);

  assert.equal(getPeopleGridLayout(1), 'cols-1');
  assert.equal(getPeopleGridLayout(4), 'cols-2');
  assert.equal(getPeopleGridLayout(6), 'cols-3');
  assert.equal(getPeopleGridLayout(7), 'cols-4');
  assert.equal(getTaskLimitForPeopleCount(2), 4);
  assert.equal(getTaskLimitForPeopleCount(5), 3);
  assert.equal(getTaskLimitForPeopleCount(8), 2);
});

test('mergeWaitingPointState giữ lastSupporter khi xóa cột G trước cột D, backfill trùng và lưu thống kê theo ngày', () => {
  const day1Ms = Date.UTC(2026, 10, 21, 5, 0, 0); // 2026-11-21 12:00 VN
  const day2Ms = Date.UTC(2026, 10, 22, 5, 0, 0); // 2026-11-22 12:00 VN

  const s0 = emptyWaitingPointState(day1Ms);
  const s1 = mergeWaitingPointState(
    s0,
    {
      timers: {
        a: {
          startedAt: day1Ms - 5000,
          totalSec: 600,
          endAt: day1Ms + 595000,
          rawTime: '10 phút',
          updatedAt: day1Ms,
          lastSupporter: 'Tuấn',
          lastOwner: 'Phong',
        },
      },
    },
    day1Ms,
  );
  // Máy khác mở sau cập nhật nhưng cột G vừa bị xóa -> vẫn giữ lastSupporter = 'Tuấn'
  const s2 = mergeWaitingPointState(
    s1,
    {
      timers: {
        a: {
          startedAt: day1Ms - 20000,
          totalSec: 600,
          endAt: day1Ms + 580000,
          rawTime: '10 phút',
          updatedAt: day1Ms + 1000,
          lastSupporter: '',
          lastOwner: '',
        },
      },
      clearedItems: [{ id: 'x', group: 'Data', issue: 'Thiếu SĐT', supporter: '', owner: '', clearedAt: day1Ms }],
    },
    day1Ms + 1000,
  );
  assert.equal(s2.timers.a.startedAt, day1Ms - 20000);
  assert.equal(s2.timers.a.lastSupporter, 'Tuấn');
  assert.equal(s2.timers.a.lastOwner, 'Phong');
  assert.equal(s2.recentCleared.length, 1);

  // Máy thứ 2 báo lại cùng item 'x' trong cửa sổ 30s CÓ tên người hỗ trợ -> backfill chứ không bỏ qua!
  // Đồng thời xóa item 'a' dù payload clearedItem thiếu supporter -> tự hồi phục từ removedMeta ('Tuấn')!
  const s3 = mergeWaitingPointState(
    s2,
    {
      clearedItems: [
        { id: 'x', group: 'Data', issue: 'Thiếu SĐT', supporter: 'Chiến', owner: 'Mai', clearedAt: day1Ms + 4000 },
        { id: 'a', group: 'Networking', issue: 'Hư máy lạnh', supporter: '', owner: '', clearedAt: day1Ms + 4000 },
      ],
      removedIds: ['a'],
    },
    day1Ms + 4000,
  );
  assert.equal(s3.recentCleared.length, 2);
  assert.equal(s3.timers.a, undefined);
  assert.ok(s3.removedTimers.a);
  const recX = s3.recentCleared.find((r) => r.id === 'x');
  const recA = s3.recentCleared.find((r) => r.id === 'a');
  assert.equal(recX.supporter, 'Chiến');
  assert.equal(recX.owner, 'Mai');
  assert.equal(recA.supporter, 'Tuấn');
  assert.equal(recA.owner, 'Phong');

  // Sang ngày hôm sau (22/11): dữ liệu ngày 21/11 VẪN được giữ trong historyByDate!
  const s4 = mergeWaitingPointState(
    s3,
    {
      clearedItems: [{ id: 'b', group: 'Pháp lý', issue: 'Scan sổ', supporter: 'Chiến', spentSec: 120, clearedAt: day2Ms }],
    },
    day2Ms,
  );
  assert.equal(s4.date, '2026-11-22');
  assert.equal(s4.recentCleared.length, 1);
  assert.equal(s4.historyByDate['2026-11-21'].length, 2);
  assert.equal(s4.historyByDate['2026-11-22'].length, 1);

  const stats = buildDailyStats([
    { supporter: 'Chiến', spentSec: 300 },
    { supporter: ' chiến ', spentSec: 100 },
    { supporter: 'Tuấn', spentSec: 200 },
    { supporter: '', spentSec: 400 },
  ]);
  assert.equal(stats.total, 4);
  assert.equal(stats.supporterCount, 2);
  assert.equal(stats.avgSec, 250);
  assert.equal(stats.fastestSec, 100);
  assert.equal(stats.bySupporter[0].name, 'Chiến');
  assert.equal(stats.bySupporter[0].count, 2);
  assert.equal(stats.bySupporter[0].avgSec, 200);
  assert.equal(stats.bySupporter[2].isUnassigned, true);
  assert.equal(formatDateLabelVN('2026-11-22', '2026-11-22'), 'Hôm nay · 22/11');

  const resolved = resolveDeadlineFromSpec(parseTimeSpec('15 phút'), day1Ms);
  assert.equal(resolved.totalSec, 900);
});

test('API /api/waiting-point hỗ trợ GET, POST và trả 405 cho DELETE', async () => {
  const getRes = await fetch(`${base}/waiting-point`);
  assert.equal(getRes.status, 200);
  const initial = await getRes.json();
  assert.match(initial.date, /^\d{4}-\d{2}-\d{2}$/);

  const postRes = await fetch(`${base}/waiting-point`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timers: {
        'test-sync-id': { startedAt: Date.now() - 10_000, totalSec: 900, endAt: Date.now() + 890_000, rawTime: '15 phút' },
      },
    }),
  });
  assert.equal(postRes.status, 200);
  const updated = await postRes.json();
  assert.ok(updated.timers['test-sync-id']);

  // Dọn timer test
  await fetch(`${base}/waiting-point`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removedIds: ['test-sync-id'] }),
  });

  const delRes = await fetch(`${base}/waiting-point`, { method: 'DELETE' });
  assert.equal(delRes.status, 405);
});

test('Đọc trực tiếp tab Waiting Point (read-only) trên Google Sheet thành công', async () => {
  const res = await fetchWaitingPoints();
  assert.ok(res.picName.length > 0);
  assert.ok(Array.isArray(res.items));
});

// Kiểm thử Waiting Point trên nhánh feat/kpi-plan (chỉ đọc tab Waiting Point gid=2043772221).
import { test } from 'node:test';
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
} from '../public/waiting-point.js';
import { emptyWaitingPointState, mergeWaitingPointState } from '../src/waiting-point-sync.js';

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
        { c: [{ v: 1 }, { v: 'Dòng tiền 1: Bán 4 dự án' }, { v: 'Networking' }, { v: 'Hư wifi' }, { v: '15 phút' }, { v: 'Thành anh' }, { v: 'Chiến' }] },
        { c: [null, null, { v: 'Networking' }, { v: 'Hư máy lạnh' }, { v: '5 phút' }, { v: 'Phong' }, { v: 'Tuấn' }] },
      ],
    },
  })});`;

  const parsed = parseGvizPayload(gviz);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[1].stream, 'Dòng tiền 1: Bán 4 dự án');
  assert.equal(parsed.items[0].supporter, 'Chiến');
  assert.equal(parsed.items[1].supporter, 'Tuấn');

  const csv = [
    'PIC phụ trách: Hoàng Thị Quỳnh Mai,,,,,,',
    'STT,Dòng tiền,Nhóm công việc,Vấn đề gặp phải,Thời gian xử lý,Người phụ trách,Người hỗ trợ',
    '1,"Dòng tiền 1: Bán 4 dự án","Hồ sơ, giấy tờ khác","Thiếu sổ hồng",10 phút,Mai,Hùng',
  ].join('\n');
  const csvParsed = parseCsvText(csv);
  assert.equal(csvParsed.items.length, 1);
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

test('Đọc trực tiếp tab Waiting Point (read-only) trên Google Sheet thành công', async () => {
  const res = await fetchWaitingPoints();
  assert.ok(res.picName.length > 0);
  assert.ok(Array.isArray(res.items));
});

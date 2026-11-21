// Kiểm thử quy tắc trạng thái đã thống nhất: tick = Đạt; qua ngày chưa tick = Không đạt;
// hôm nay chưa tick = Đang làm; tương lai = Chưa đến hạn; không có task = không tính.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStatus, aggregateStatus, buildView, flattenTasks, allDays, allPics, allGroups } from '../src/lib/status.js';

const D = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'];
const TODAY = '2026-11-23';
const mk = (pairs) => pairs.map(([task, done], i) => ({ date: D[i], task, done }));

test('trạng thái từng task', () => {
  const days = mk([['A', true], ['B', false], ['C', null], ['D', null], [null, null]]);
  assert.equal(dayStatus(days[0], TODAY), 'done');
  assert.equal(dayStatus(days[1], TODAY), 'late');
  assert.equal(dayStatus(days[2], TODAY), 'in_progress');
  assert.equal(dayStatus(days[3], TODAY), 'upcoming');
  assert.equal(dayStatus(days[4], TODAY), 'none');
});

test('tick hôm nay hoặc tick ngày tương lai vẫn là Đạt; tick mà không ghi task vẫn tính', () => {
  assert.equal(dayStatus({ date: TODAY, task: 'X', done: true }, TODAY), 'done');
  assert.equal(dayStatus({ date: '2026-11-25', task: 'X', done: true }, TODAY), 'done');
  assert.equal(dayStatus({ date: '2026-11-21', task: null, done: true }, TODAY), 'done');
  assert.equal(dayStatus({ date: '2026-11-21', task: null, done: false }, TODAY), 'none');
});

test('trạng thái tổng của dòng KPI', () => {
  assert.equal(aggregateStatus(['done', 'late', 'upcoming']), 'late');
  assert.equal(aggregateStatus(['done', 'in_progress', 'upcoming']), 'in_progress');
  assert.equal(aggregateStatus(['done', 'upcoming']), 'upcoming');
  assert.equal(aggregateStatus(['done', 'none']), 'done');
  assert.equal(aggregateStatus(['none', 'none']), 'none');
});

const DATA = {
  flows: [
    {
      key: 'a',
      label: 'A',
      days: D,
      groups: [{ name: 'G1' }, { name: 'G2' }, { name: 'G3' }],
      items: [
        { row: 5, pic: 'P1', group: 'G1', kpi: 'K1', note: 'vướng', days: mk([['t1', true], ['t2', false], ['t3', null], ['t4', null], [null, null]]) },
        { row: 6, pic: 'P2', group: 'G2', kpi: 'K2', note: '', days: mk([['u1', true], ['u2', true], ['u3', true], ['u4', null], ['u5', null]]) },
        { row: 7, pic: 'P3', group: 'G3', kpi: '', placeholder: true, note: '', days: mk([[null, null], [null, null], [null, null], [null, null], [null, null]]) },
      ],
    },
  ],
};

test('buildView: cả kỳ', () => {
  const v = buildView(DATA, { date: 'all', status: 'all', pic: 'all' }, TODAY);
  const f = v.flows[0];
  assert.equal(f.rows.length, 3);
  assert.equal(f.counts.done, 4);
  assert.equal(f.counts.late, 1);
  assert.equal(f.counts.in_progress, 1);
  assert.equal(f.counts.upcoming, 3);
  assert.equal(f.tasks, 9);
  assert.equal(f.due, 5); // đã tick (4) + quá ngày chưa tick (1)
  assert.equal(f.completed, 4);
  assert.deepEqual(f.rows.map((r) => r.status), ['late', 'upcoming', 'none']);
  assert.deepEqual([f.rows[0].done, f.rows[0].total, f.rows[0].due, f.rows[0].pct], [1, 4, 2, 0.5]);
  assert.deepEqual([f.rows[1].done, f.rows[1].total, f.rows[1].pct], [3, 5, 1]);
  assert.equal(f.rows[2].pct, null);
  assert.equal(v.blockers, 1);
  assert.equal(v.rate, 4 / 5);
});

test('buildView: lọc theo ngày, trạng thái, PIC, nhóm, dòng tiền', () => {
  let v = buildView(DATA, { date: '2026-11-22', status: 'all', pic: 'all' }, TODAY);
  assert.deepEqual(v.flows[0].rows.map((r) => r.status), ['late', 'done', 'none']);

  // Lọc trạng thái: chỉ giữ dòng có task mang trạng thái đó; số đếm không đổi theo bộ lọc trạng thái
  v = buildView(DATA, { date: 'all', status: 'late', pic: 'all' }, TODAY);
  assert.deepEqual(v.flows[0].rows.map((r) => r.item.pic), ['P1']);
  assert.deepEqual(v.flows[0].rows[0].tasks.map((t) => t.task), ['t2']);
  assert.equal(v.totals.done, 4);

  v = buildView(DATA, { date: 'all', status: 'all', pic: 'P2' }, TODAY);
  assert.deepEqual(v.flows[0].rows.map((r) => r.item.pic), ['P2']);
  v = buildView(DATA, { date: 'all', status: 'all', pic: 'all', group: 'G1' }, TODAY);
  assert.deepEqual(v.flows[0].rows.map((r) => r.item.pic), ['P1']);
  const two = { flows: [...DATA.flows, { ...DATA.flows[0], key: 'b', label: 'B' }] };
  assert.equal(buildView(two, { date: 'all', status: 'all', pic: 'all', flow: 'b' }, TODAY).flows.length, 1);

  assert.deepEqual(allDays(DATA), D);
  assert.deepEqual(allPics(DATA), ['P1', 'P2', 'P3']);
  assert.deepEqual(allGroups(DATA), ['G1', 'G2', 'G3']);
});

test('danh sách task cho màn chi tiết: Không đạt lên đầu, rồi Đang làm, Chưa đến hạn, Đạt', () => {
  const list = flattenTasks(buildView(DATA, { date: 'all', status: 'all', pic: 'all' }, TODAY));
  assert.equal(list.length, 9);
  assert.deepEqual(list.map((x) => x.task.status), ['late', 'in_progress', 'upcoming', 'upcoming', 'upcoming', 'done', 'done', 'done', 'done']);
  assert.deepEqual(list.slice(0, 2).map((x) => x.task.task), ['t2', 't3']);
});

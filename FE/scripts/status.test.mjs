// Kiểm thử quy tắc trạng thái đã thống nhất.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStatus, aggregateStatus, buildView, allDays, allPics, allGroups } from '../src/lib/status.js';

const D = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'];
const mk = (pairs) => pairs.map(([kpi, result], i) => ({ date: D[i], kpi, result }));
const TODAY = '2026-11-23';

test('Hoàn thành: kết quả >= KPI trong ngày', () => {
  const days = mk([[10, 10], [10, 15], [10, null], [10, null], [10, null]]);
  assert.equal(dayStatus(days, 0, TODAY), 'done');
  assert.equal(dayStatus(days, 1, TODAY), 'done');
});

test('Hoàn thành trễ hạn: ngày sau bù đủ lũy kế', () => {
  // 21: 4/10 (thiếu 6) -> 22: 16/10 => lũy kế 20 >= 20? KPI lũy kế đến 21 là 10, kết quả lũy kế đến 22 là 20 -> bù đủ
  const days = mk([[10, 4], [10, 16], [10, null], [10, null], [10, null]]);
  assert.equal(dayStatus(days, 0, TODAY), 'done_late');
  assert.equal(dayStatus(days, 1, TODAY), 'done');
});

test('Trễ hạn: ngày đã qua, chưa bù đủ', () => {
  // 21: 4/10, 22: 5/10 -> lũy kế 9 < 10 nên cả 2 ngày đều trễ hạn
  const days = mk([[10, 4], [10, 5], [10, null], [10, null], [10, null]]);
  assert.equal(dayStatus(days, 0, TODAY), 'late');
  assert.equal(dayStatus(days, 1, TODAY), 'late');
});

test('Đang thực hiện (hôm nay) và Chưa đến hạn (tương lai)', () => {
  const days = mk([[10, 10], [10, 10], [10, 3], [10, null], [10, null]]);
  assert.equal(dayStatus(days, 2, TODAY), 'in_progress');
  assert.equal(dayStatus(days, 3, TODAY), 'upcoming');
});

test('Không có KPI -> none', () => {
  const days = mk([[null, 5], [0, 0], ['', null], [10, null], [10, null]]);
  assert.equal(dayStatus(days, 0, TODAY), 'none');
  assert.equal(dayStatus(days, 1, TODAY), 'none');
  assert.equal(dayStatus(days, 2, TODAY), 'none');
});

test('Trạng thái tổng của PIC trong cả kỳ', () => {
  assert.equal(aggregateStatus(['done', 'late', 'upcoming']), 'late');
  assert.equal(aggregateStatus(['done', 'done_late', 'upcoming']), 'upcoming');
  assert.equal(aggregateStatus(['done', 'done_late']), 'done_late');
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
        { row: 5, pic: 'P1', group: 'G1', note: 'vướng', days: mk([[10, 10], [10, 2], [10, 3], [10, null], [null, null]]) },
        { row: 6, pic: 'P2', group: 'G2', note: '', days: mk([[10, 4], [10, 16], [10, 10], [10, null], [10, null]]) },
        { row: 7, pic: 'P3', group: 'G3', note: '', days: mk([[null, null], [null, null], [null, null], [null, null], [null, null]]) },
      ],
    },
  ],
};

test('buildView: cả kỳ', () => {
  const v = buildView(DATA, { date: 'all', status: 'all', pic: 'all' }, TODAY);
  const f = v.flows[0];
  assert.equal(f.rows.length, 3);
  // P1: done, late, in_progress, upcoming ; P2: done_late, done, done, upcoming, upcoming
  assert.equal(f.counts.done, 3);
  assert.equal(f.counts.done_late, 1);
  assert.equal(f.counts.late, 1);
  assert.equal(f.counts.in_progress, 1);
  assert.equal(f.counts.upcoming, 3);
  assert.equal(f.tasks, 9);
  assert.equal(f.due, 5); // ngày đã qua + task hôm nay đã xong (task hôm nay đang làm chưa tính)
  assert.equal(f.completed, 4);
  assert.equal(f.rows[0].status, 'late');
  assert.equal(f.rows[1].status, 'upcoming');
  assert.equal(f.rows[2].status, 'none');
  assert.equal(f.rows[0].kpi, 40);
  assert.equal(f.rows[0].result, 15);
  assert.equal(v.blockers, 1);
  assert.equal(v.rate, 4 / 5);
});

test('buildView: lọc theo ngày, trạng thái, PIC', () => {
  let v = buildView(DATA, { date: '2026-11-22', status: 'all', pic: 'all' }, TODAY);
  assert.deepEqual(v.flows[0].rows.map((r) => r.status), ['late', 'done', 'none']);
  assert.equal(v.flows[0].rows[0].pct, 0.2);
  assert.equal(v.flows[0].rows[2].pct, null);

  v = buildView(DATA, { date: '2026-11-21', status: 'done_late', pic: 'all' }, TODAY);
  assert.deepEqual(v.flows[0].rows.map((r) => r.item.pic), ['P2']);

  v = buildView(DATA, { date: 'all', status: 'all', pic: 'P1' }, TODAY);
  assert.deepEqual(v.flows[0].rows.map((r) => r.item.pic), ['P1']);

  assert.deepEqual(allDays(DATA), D);
  assert.deepEqual(allPics(DATA), ['P1', 'P2', 'P3']);
});

test('Kết luận Đạt / Không đạt', () => {
  const week = buildView(DATA, { date: 'all', status: 'all', pic: 'all' }, TODAY).flows[0].rows;
  // P1: 15/40, có ngày trễ hạn -> Không đạt ; P2: 30/50, chưa trễ ngày nào nhưng chưa đủ tổng -> Đang làm ; P3: chưa có KPI
  assert.deepEqual(week.map((r) => r.verdict), ['fail', 'doing', 'none']);
  const day21 = buildView(DATA, { date: '2026-11-21', status: 'all', pic: 'all' }, TODAY).flows[0].rows;
  assert.deepEqual(day21.map((r) => r.verdict), ['pass', 'pass_late', 'none']);
  const day23 = buildView(DATA, { date: '2026-11-23', status: 'all', pic: 'all' }, TODAY).flows[0].rows;
  assert.deepEqual(day23.map((r) => r.verdict), ['doing', 'pass', 'none']);
});

test('Lọc theo dòng tiền và nhóm nhỏ', () => {
  const two = { flows: [...DATA.flows, { ...DATA.flows[0], key: 'b', label: 'B' }] };
  assert.equal(buildView(two, { date: 'all', status: 'all', pic: 'all', flow: 'b' }, TODAY).flows.length, 1);
  const g = buildView(DATA, { date: 'all', status: 'all', pic: 'all', group: 'G2' }, TODAY).flows[0].rows;
  assert.deepEqual(g.map((r) => r.item.pic), ['P2']);
  assert.deepEqual(allGroups(DATA), ['G1', 'G2', 'G3']);
});

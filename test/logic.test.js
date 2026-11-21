import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDashboard, parseNumber, streamCode } from '../src/logic.js';
import { parseVnDateTime, fmtVn } from '../src/time.js';
import { SEED } from '../src/seed.js';

// 21/11/2026 09:37 giờ VN
const NOW = parseVnDateTime('21/11/2026 09:37');
const model = computeDashboard(structuredClone(SEED), { now: NOW });

test('đọc ngày giờ kiểu Việt Nam', () => {
  assert.equal(fmtVn(parseVnDateTime('25/11/2026 17:00')), '25/11/2026 17:00');
  assert.equal(fmtVn(parseVnDateTime('25/11/2026', { endOfDay: true }), { seconds: true }), '25/11/2026 23:59:59');
  assert.equal(fmtVn(parseVnDateTime('23/11 17h00', { defaultYear: 2026 })), '23/11/2026 17:00');
  assert.equal(parseVnDateTime('không phải ngày'), null);
});

test('đọc số tiền kiểu Việt Nam', () => {
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('45 tỷ'), 45);
  assert.equal(parseNumber(''), null);
});

test('mã dòng tiền', () => {
  assert.equal(streamCode('DT01'), '01');
  assert.equal(streamCode('DT #7'), '07');
  assert.equal(streamCode('Hạ tầng điều hành'), null);
});

test('KPI mục tiêu khớp báo cáo 20/11', () => {
  assert.equal(model.kpi.total, 14);
  assert.equal(model.kpi.reportedDone, 8, '8 task báo hoàn thành nhưng chưa có chứng từ');
  assert.equal(model.kpi.verified, 0);
  assert.equal(model.kpi.inProgress, 6);
  assert.equal(model.kpi.overdue, 1, 'MT-01 hạn 20/11 đã quá hạn');
});

test('One Owner: mục tiêu giao nhóm bị đánh dấu', () => {
  const byId = Object.fromEntries(model.targets.map((t) => [t.id, t]));
  assert.equal(byId['MT-02'].checks.owner.ok, true);
  for (const id of ['MT-01', 'MT-03', 'MT-04', 'MT-05', 'MT-06']) assert.equal(byId[id].checks.owner.ok, false, id);
  assert.equal(byId['MT-02'].checks.output.reason, 'Đầu ra là bước trung gian');
});

test('Dòng tiền & điểm chờ', () => {
  assert.equal(model.streams.length, 10);
  const states = model.streams.map((s) => s.state);
  assert.deepEqual(states.filter((s) => s === 'noPeople').length, 4);
  assert.deepEqual(states.filter((s) => s === 'undefined').length, 2);
  assert.equal(model.streams.find((s) => s.id === 'DT04').state, 'short');
  assert.equal(model.waiting.byKind['Dòng tiền chưa có người'], 4);
  assert.equal(model.waiting.byKind['Điểm nghẽn công việc'], 1);
});

test('Quyết định mở, time-box, ca trực', () => {
  assert.equal(model.decisions.open.length, 4);
  assert.equal(model.timebox.phase, 'running');
  assert.equal(model.timebox.dayIndex, 1);
  assert.equal(model.timebox.totalDays, 5);
  assert.equal(model.shift.name, 'Ngày');
  assert.deepEqual(model.shift.onDuty.map((p) => p.person), ['Nguyễn Thị Mai Thu']);
});

test('Tiền chỉ tính khi có chứng từ', () => {
  const raw = structuredClone(SEED);
  raw.ThuTien = [
    { date: '21/11/2026', stream: 'DT02', amount: '1,5', evidence: 'https://drive/x' },
    { date: '21/11/2026', stream: 'DT02', amount: '2', evidence: '' },
  ];
  const m = computeDashboard(raw, { now: NOW });
  assert.equal(m.money.collected, 1.5);
  assert.equal(m.money.pendingCollected, 2);
  assert.equal(m.streams.find((s) => s.id === 'DT02').collected, 1.5);
});

test('Loại mục tiêu khỏi War Room không tính vào KPI', () => {
  const raw = structuredClone(SEED);
  raw.MucTieu[4].status = 'Đã loại';
  raw.MucTieu[4].removedReason = 'Không hoàn thành được trong time-box';
  const m = computeDashboard(raw, { now: NOW });
  assert.equal(m.kpi.total, 13);
  assert.equal(m.removedTargets.length, 1);
  assert.equal(m.removedTargets[0].id, 'MT-05');
});

test('Hoàn thành chỉ được tính khi Bước 6 + có chứng từ', () => {
  const raw = structuredClone(SEED);
  Object.assign(raw.MucTieu[1], { status: 'Hoàn thành', stage: 6, evidence: '' });
  let m = computeDashboard(raw, { now: NOW });
  assert.equal(m.targets.find((t) => t.id === 'MT-02').missingEvidence, true);
  raw.MucTieu[1].evidence = 'https://drive/chung-tu';
  m = computeDashboard(raw, { now: NOW });
  assert.equal(m.kpi.verified, 1);
});

test('nhận diện owner là 1 người', async () => {
  const { looksLikeOnePerson } = await import('../src/logic.js');
  for (const ok of ['Nguyễn Thị Kim Cúc', 'Mr. Vinh', 'Phạm Thanh Hùng', 'Hùng']) assert.equal(looksLikeOnePerson(ok), true, ok);
  for (const bad of ['Kinh doanh', 'DAIT', 'Nhóm Networking', 'Kinh doanh / Data', 'IT (DAIT) & Tổng vụ', 'Ban Tài chính', '']) assert.equal(looksLikeOnePerson(bad), false, bad);
});

test('5 nguyên tắc: chỉ tính vi phạm trên việc đang làm', () => {
  const r = Object.fromEntries(model.rules.map((x) => [x.key, x]));
  assert.equal(r.owner.status, '5/6 chưa có 1 owner');
  assert.equal(r.e2e.status, '4/6 thiếu đầu ra đo được');
  assert.equal(r.timebox.status, '5 chưa có hạn · 1 quá hạn');
  assert.equal(model.waiting.total, 5, '4 dòng tiền chưa có người + 1 điểm nghẽn');
});

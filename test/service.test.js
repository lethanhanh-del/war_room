import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DemoStore } from '../src/store/demo.js';
import { WarRoomService } from '../src/service.js';

function makeService() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warroom-test-'));
  const config = {
    dataDir, warRoomStart: '21/11/2026 07:30', warRoomEnd: '25/11/2026 23:59', shiftDayStart: '07:30', shiftNightStart: '19:30',
    staleMinutes: 60, refreshSeconds: 30, pollSeconds: 20, scanMinutes: 5, reportTime: '18:00', maxFilesPerScan: 5, maxDocChars: 1000,
    aiModelExtract: 'claude-opus-5-5', aiModelReport: 'claude-opus-5-5', aiEffortExtract: 'low', aiEffortReport: 'medium',
    anthropicApiKey: '', operatorPin: '1234', demoNow: '21/11/2026 09:37',
  };
  const store = new DemoStore();
  return { service: new WarRoomService({ store, drive: null, config }), store };
}

const logActions = (store) => store.tables.NhatKy.map((l) => l.action);

test('thêm mục tiêu: cấp mã MT-15, chuẩn hoá hạn & tiền, ghi nhật ký', async () => {
  const { service, store } = makeService();
  await service.refresh();
  const { id } = await service.addTarget({
    title: 'Thu 5% sổ hồng I-Home đợt 1', stream: 'DT01', owner: 'Phạm Hoàng Oanh',
    deadline: '24/11/2026 17h00', moneyTarget: '3,5', output: 'Thu đủ 5% của 20 hồ sơ', criteria: 'Sao kê ngân hàng',
  }, 'Thư ký');
  assert.equal(id, 'MT-15');
  const row = store.tables.MucTieu.find((t) => t.id === 'MT-15');
  assert.equal(row.deadline, '24/11/2026 17:00');
  assert.equal(row.moneyTarget, 3.5);
  assert.equal(row.status, 'Chưa bắt đầu');
  assert.ok(logActions(store).includes('Thêm mục tiêu'));
  const m = service.getDashboard().model;
  assert.equal(m.kpi.total, 15);
  assert.equal(m.money.moneyTarget, 3.5);
});

test('không cho đóng việc khi thiếu Bước 6 hoặc chứng từ (End-to-End)', async () => {
  const { service } = makeService();
  await service.refresh();
  await assert.rejects(() => service.updateTarget('MT-02', { status: 'Hoàn thành' }, 'Thư ký'), /End-to-End/);
  await assert.rejects(() => service.updateTarget('MT-02', { status: 'Hoàn thành', stage: 6 }, 'Thư ký'), /End-to-End/);
  const r = await service.updateTarget('MT-02', { status: 'Hoàn thành', stage: 6, evidence: 'https://drive.google.com/x' }, 'Thư ký');
  assert.equal(r.changed, 3);
  assert.equal(service.getDashboard().model.kpi.verified, 1);
});

test('kiểm tra dữ liệu nhập', async () => {
  const { service } = makeService();
  await service.refresh();
  await assert.rejects(() => service.addTarget({ title: '' }, 'Thư ký'), /tên mục tiêu/);
  await assert.rejects(() => service.updateTarget('MT-03', { stage: 9 }, 'Thư ký'), /1 đến 6/);
  await assert.rejects(() => service.updateTarget('MT-03', { deadline: '32/13/2026' }, 'Thư ký'), /Ngày giờ không hợp lệ/);
  await assert.rejects(() => service.updateTarget('MT-99', { note: 'x' }, 'Thư ký'), /Không tìm thấy/);
});

test('loại khỏi War Room cần lý do; khôi phục được; không xoá dòng', async () => {
  const { service, store } = makeService();
  await service.refresh();
  await assert.rejects(() => service.removeTarget('MT-05', '', 'Thư ký'), /lý do/);
  await service.removeTarget('MT-05', 'Không đo được kết quả trong time-box', 'Thư ký');
  let m = service.getDashboard().model;
  assert.equal(m.kpi.total, 13);
  assert.equal(m.removedTargets[0].removedReason, 'Không đo được kết quả trong time-box');
  assert.equal(store.tables.MucTieu.length, 14, 'dòng vẫn còn trong Sổ');
  await assert.rejects(() => service.updateTarget('MT-05', { note: 'x' }, 'Thư ký'), /khôi phục/);
  await service.restoreTarget('MT-05', 'Thư ký');
  m = service.getDashboard().model;
  assert.equal(m.kpi.total, 14);
  assert.deepEqual(logActions(store).filter((a) => /Loại|Khôi phục/.test(a)), ['Loại khỏi War Room', 'Khôi phục mục tiêu']);
});

test('duyệt / từ chối đề xuất AI', async () => {
  const { service, store } = makeService();
  await service.refresh();
  await store.appendRows('DeXuatAI', [
    { id: 'DX-1', source: 'BBH_21-11.docx', target: 'MT-04', field: 'Hạn', current: '', proposed: '22/11/2026 17:00', quote: 'chốt xử lý xong trước 17h ngày 22/11', confidence: 'Cao', status: 'Chờ duyệt' },
    { id: 'DX-2', source: 'BBH_21-11.docx', target: 'MOI', field: 'Tên mục tiêu', current: '', proposed: 'Ký hợp đồng thuê khối đế Léman', quote: '...', confidence: 'Trung bình', status: 'Chờ duyệt' },
    { id: 'DX-3', source: 'BBH_21-11.docx', target: 'MT-06', field: 'Owner (1 người)', current: '', proposed: 'Mạc Thị Thúy Hiền', quote: '...', confidence: 'Thấp', status: 'Chờ duyệt' },
  ]);
  await service.refresh();
  assert.equal(service.getDashboard().model.proposals.pending.length, 3);
  await service.approveProposal('DX-1', 'Thư ký');
  assert.equal(store.tables.MucTieu.find((t) => t.id === 'MT-04').deadline, '22/11/2026 17:00');
  const { id } = await service.approveProposal('DX-2', 'Thư ký');
  assert.equal(id, 'MT-15');
  await service.rejectProposal('DX-3', 'Thư ký', 'Chưa có quyết định chính thức');
  await assert.rejects(() => service.approveProposal('DX-3', 'Thư ký'), /đã được xử lý/);
  const m = service.getDashboard().model;
  assert.equal(m.proposals.pending.length, 0);
  assert.ok(logActions(store).includes('Duyệt đề xuất'));
  assert.ok(logActions(store).includes('Từ chối đề xuất'));
});

test('quyết định: thêm và ghi kết quả', async () => {
  const { service } = makeService();
  await service.refresh();
  const { id } = await service.addDecision({ content: 'Duyệt ngân sách quảng cáo', decider: 'Chủ tịch' }, 'Thư ký');
  assert.equal(id, 'QĐ-5');
  await service.resolveDecision('QĐ-4', { result: 'Chốt chạy 8 dòng tiền' }, 'Thư ký');
  assert.equal(service.getDashboard().model.decisions.open.length, 4);
});

test('sửa trực tiếp trên Sheet được ghi nhật ký và đóng dấu "Cập nhật lúc"', async () => {
  const { service, store } = makeService();
  await service.refresh();
  store.tables.MucTieu.find((t) => t.id === 'MT-03').owner = 'Trần Thị Xuân Thi';
  await service.refresh();
  const entry = store.tables.NhatKy.at(-1);
  assert.equal(entry.channel, 'Google Sheet');
  assert.equal(entry.field, 'Owner (1 người)');
  assert.equal(entry.after, 'Trần Thị Xuân Thi');
  assert.ok(store.tables.MucTieu.find((t) => t.id === 'MT-03').updatedAt);
});

test('báo cáo ngày không cần AI vẫn tạo được (mẫu tự động)', async () => {
  const { service, store } = makeService();
  await service.refresh();
  const { content, model } = await service.generateReport('Thủ công', 'Thư ký');
  assert.match(content, /1\. Tổng quan/);
  assert.match(content, /8 \(0 đã kiểm chứng chứng từ\)/);
  assert.equal(model, 'Mẫu tự động (không dùng AI)');
  assert.equal(store.tables.BaoCao.length, 1);
});

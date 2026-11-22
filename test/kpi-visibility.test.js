// Quản trị › Quản lý hiển thị nhiệm vụ: admin bật / tắt hiện KPI theo nhóm (src/kpi/visibility.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, fakeD1 } from './fixtures/d1.js';
import { buildModel } from '../public/kpi-model.js';

const { applyVisibility, visibilityList, handleKpiVisibility, loadVisibility } = await import('../src/kpi/visibility.js');

const cell = (kpi) => ({ kpi, res: '' });
const streams = () => [{
  key: 'banking', name: 'Dòng tiền Banking', no: 2, pic: 'Thu', bodApproved: true, days: [{ date: '2026-11-21', label: '21/11' }],
  groups: [
    { key: 'a', name: 'Nhóm A', pic: { name: 'An' }, approval: { code: 'A', label: 'BOD đã duyệt', source: 'column' }, rows: [{ person: 'An', cells: { '2026-11-21': cell('k1') } }] },
    { key: 'b', name: 'Nhóm B', pic: { name: 'Bình' }, approval: { code: 'N', label: 'Chưa trình BOD', source: 'column', note: 'ghi chú sheet' }, rows: [{ person: 'Bình', cells: { '2026-11-21': cell('k2'), '2026-11-22': cell('') } }] },
  ],
}];

test('applyVisibility: lựa chọn của admin được ưu tiên hơn sheet, giữ lại trạng thái sheet', () => {
  const none = streams();
  assert.equal(applyVisibility(none, new Map()), none);
  const out = applyVisibility(streams(), new Map([
    ['banking|a', { code: 'R', note: 'bổ sung chỉ tiêu', by: 'admin', at: '2026-11-22T02:00:00.000Z' }],
    ['banking|b', { code: 'A', note: '', by: 'admin', at: '2026-11-22T02:00:00.000Z' }],
    ['khac|a', { code: 'N' }],
  ]));
  const [a, b] = out[0].groups;
  assert.deepEqual([a.approval.code, a.approval.source, a.approval.note, a.approval.sheet.code], ['R', 'admin', 'bổ sung chỉ tiêu', 'A']);
  assert.deepEqual([b.approval.code, b.approval.label, b.approval.sheet.code], ['A', 'BOD đã duyệt', 'N']);
  assert.equal(out[0].bodApproved, false);
  // Trình duyệt: chỉ tính KPI của nhóm đang Hiện.
  const m = buildModel({ streams: out, days: out[0].days, today: '2026-11-21', now: Date.UTC(2026, 10, 21, 3) });
  assert.deepEqual(m.streams[0].groups.map((g) => g.items.length), [0, 1]);
});

test('visibilityList: số KPI, nguồn và ghi chú của từng nhóm', () => {
  const list = visibilityList(applyVisibility(streams(), new Map([['banking|a', { code: 'N', note: 'chưa gửi', by: 'admin', at: 'x' }]])));
  assert.deepEqual(list[0].groups.map((g) => [g.key, g.kpis, g.show, g.code, g.source, g.note, g.sheetCode]), [
    ['a', 1, false, 'N', 'admin', 'chưa gửi', 'A'],
    ['b', 1, false, 'N', 'sheet', 'ghi chú sheet', 'N'],
  ]);
});

test('API: ẩn phải có lý do, hiện / ẩn / quay về sheet đều lưu và ghi nhật ký', { skip: !DatabaseSync }, async () => {
  const DB = fakeD1();
  await DB.prepare('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, ts TEXT, username TEXT, action TEXT, detail TEXT, ip TEXT)').run();
  await DB.prepare("CREATE TABLE kpi_sheet (id INTEGER PRIMARY KEY, checked_at TEXT DEFAULT '', changed_at TEXT DEFAULT '', error TEXT DEFAULT '', warnings TEXT DEFAULT '[]', data TEXT DEFAULT '')").run();
  const raw = [{ name: 'Dòng tiền Banking', sheet: 'x', days: [{ date: '2026-11-21', label: '21/11' }], groups: [{ name: 'Nhóm A', approval: { code: 'N', source: 'column' }, rows: [{ person: 'An', cells: { '2026-11-21': cell('k1') } }] }] }];
  await DB.prepare('INSERT INTO kpi_sheet (id, data) VALUES (1, ?)').bind(JSON.stringify(raw)).run();
  const env = { DB, KPI_SHEET_URL: '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0' };
  const user = { username: 'admin' };
  const req = (method, body) => new Request('http://x/api/admin/kpi-visibility', { method, body: body ? JSON.stringify(body) : undefined });
  const call = async (method, body) => { const r = await handleKpiVisibility(req(method, body), env, user); return { status: r.status, body: await r.json() }; };

  let r = await call('GET');
  const g0 = r.body.streams[0].groups[0];
  assert.deepEqual([g0.show, g0.source, g0.kpis], [false, 'sheet', 1]);
  const id = { stream: r.body.streams[0].key, group: g0.key };

  r = await call('POST', { ...id, show: true });
  assert.deepEqual([r.status, r.body.streams[0].groups[0].show, r.body.streams[0].groups[0].source], [200, true, 'admin']);
  r = await call('POST', { ...id, show: false });
  assert.equal(r.status, 400);
  r = await call('POST', { ...id, show: false, reason: 'R', note: '  sửa chỉ tiêu  ' });
  assert.deepEqual([r.body.streams[0].groups[0].code, r.body.streams[0].groups[0].note, r.body.streams[0].groups[0].by], ['R', 'sửa chỉ tiêu', 'admin']);
  assert.equal((await loadVisibility(env, env.KPI_SHEET_URL)).size, 1);
  r = await call('POST', { stream: 'khong-co', group: 'x', show: true });
  assert.equal(r.status, 404);
  r = await call('DELETE', id);
  assert.deepEqual([r.status, r.body.streams[0].groups[0].source, r.body.streams[0].groups[0].code], [200, 'sheet', 'N']);
  r = await call('DELETE', id);
  assert.equal(r.status, 404);
  const { results } = await DB.prepare('SELECT action FROM audit_log ORDER BY id').all();
  assert.deepEqual(results.map((x) => x.action), ['kpi_visibility_show', 'kpi_visibility_hide', 'kpi_visibility_reset']);
});

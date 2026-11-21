import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStreamsModel, classifyTask, initials, parseDue, streamTitle } from '../src/worksuite/model.js';
import { WorksuiteClient, fetchWorksuiteRaw, resetWorksuiteSessions } from '../src/worksuite/client.js';
import { getStreams, resetStreamsCache } from '../src/worksuite/index.js';
import { DEMO_NOW, demoRaw } from '../src/worksuite/demo.js';

const NOW = DEMO_NOW; // 21/11/2026 15:00 giờ VN

test('parseDue: ngày không giờ = hết ngày theo giờ VN, có giờ = đúng giờ VN', () => {
  assert.equal(parseDue('2026-11-21').ms, Date.UTC(2026, 10, 21, 16, 59, 59));
  assert.equal(parseDue('2026-11-21 12:00:00').ms, Date.UTC(2026, 10, 21, 5, 0, 0));
  assert.equal(parseDue('2026-11-21').hasTime, false);
  assert.equal(parseDue(''), null);
  assert.equal(parseDue('21/11/2026'), null);
});

test('classifyTask: trạng thái Worksuite -> trạng thái dashboard', () => {
  assert.equal(classifyTask({ status: 'Cancelled' }, NOW), null);
  assert.equal(classifyTask({ status: 'Completed', progress: 40 }, NOW).progress, 100);
  assert.equal(classifyTask({ status: 'In Review', exp_end_date: '2026-11-19' }, NOW).status, 'review');
  assert.equal(classifyTask({ status: 'In Progress', exp_end_date: '2026-11-23' }, NOW).status, 'doing');
  assert.equal(classifyTask({ status: 'Open', exp_end_date: '2026-11-24' }, NOW).status, 'todo');
  assert.equal(classifyTask({ status: 'Open', progress: 10 }, NOW).status, 'doing');
  assert.equal(classifyTask({ status: 'Overdue' }, NOW).status, 'overdue');
  const late = classifyTask({ status: 'In Progress', progress: 60, exp_end_date: '2026-11-21 12:00:00' }, NOW);
  assert.equal(late.status, 'overdue');
  assert.equal(late.dueLabel, 'Quá hạn 3 giờ · hạn 21/11 · 12:00');
  const waiting = classifyTask({ status: 'Pending', exp_end_date: '2026-11-21 16:00:00', custom_blocker_reason: '<p>Chờ ngân hàng</p>' }, NOW);
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.blocker, 'Chờ ngân hàng');
  assert.equal(waiting.dueLabel, 'Hạn 21/11 · 16:00');
  // Đang chờ nhưng đã quá hạn -> tính là quá hạn
  assert.equal(classifyTask({ status: 'Pending', exp_end_date: '2026-11-20' }, NOW).status, 'overdue');
  assert.equal(classifyTask({ status: 'In Progress' }, NOW).dueLabel, 'Chưa có hạn');
  assert.equal(classifyTask({ status: 'In Progress', progress: 150 }, NOW).progress, 100);
});

test('initials và tên dòng tiền', () => {
  assert.equal(initials('Hoàng Thị Quỳnh Mai'), 'QM');
  assert.equal(initials('Mr. Vinh'), 'MV');
  assert.equal(initials(''), '?');
  assert.equal(streamTitle('Dòng tiền bán 4 dự án'), 'Bán 4 dự án');
  assert.equal(streamTitle('Dòng tiền Banking'), 'Banking');
  assert.equal(streamTitle('Dòng tiền DT02 - Banking'), 'Banking');
  assert.equal(streamTitle('Dòng tiền'), 'Dòng tiền');
});

test('buildStreamsModel trên dữ liệu mẫu (cấu trúc dự án WAR ROOM)', () => {
  const m = buildStreamsModel(demoRaw(), { now: NOW, worksuiteUrl: 'https://ws.example/worksuite' });
  assert.deepEqual(m.project, { id: 'PROJ-0536', name: 'WAR ROOM', url: 'https://ws.example/worksuite/projects/PROJ-0536' });
  assert.deepEqual(m.streams.map((s) => s.name), [
    'Banking',
    'Tài chính phụ trách triển khai và chịu trách nhiệm 10 dòng tiền',
    'Kiểm soát kỷ luật War-Room',
    'Bán 4 dự án',
    'Nợ khó đòi',
    'Thu trước hạn/quá hạn',
  ]);
  assert.deepEqual(m.otherGroups.map((g) => [g.name, g.taskCount]), [['Nhóm hỗ trợ', 1]]);

  const banking = m.streams[0];
  assert.equal(banking.pic.name, 'Nguyễn Thị Mai Thu');
  assert.equal(banking.pic.department, 'Ban Tài chính - Kế toán');
  assert.deepEqual(banking.counts, { total: 9, done: 3, doing: 3, review: 1, waiting: 1, overdue: 1, todo: 0 });
  assert.equal(banking.tone, 'warning');
  assert.match(banking.url, /\/worksuite\/tasks\/TASK-2026-13956$/);
  const waitingTask = banking.people.flatMap((p) => p.tasks).find((t) => t.status === 'waiting');
  assert.equal(waitingTask.blocker, 'Chờ ngân hàng xác nhận lịch làm việc');

  const discipline = m.streams[2];
  assert.equal(discipline.pic, null, 'chưa có PIC');
  assert.equal(discipline.percent, null);
  assert.equal(discipline.headcount, 0);

  const sales = m.streams[3];
  // Người có task quá hạn xếp trước, rồi người có task đang chờ, rồi PIC.
  assert.equal(sales.people[0].counts.overdue, 1);
  assert.equal(sales.people[0].tasks[0].status, 'overdue');
  assert.equal(sales.people[2].name, 'Ngô Thị Thu Thủy');
  assert.equal(sales.people[3].isPic, true);

  assert.equal(m.streams[4].tone, 'danger');
  const sum = (k) => m.streams.reduce((a, s) => a + s.counts[k], 0);
  for (const k of ['total', 'done', 'doing', 'review', 'waiting', 'overdue', 'todo']) assert.equal(m.summary[k], sum(k), k);
  assert.equal(m.summary.streams, 6);
  assert.equal(m.summary.pics, 5);
  assert.ok(m.summary.people < m.streams.reduce((a, s) => a + s.headcount, 0), 'người ở nhiều dòng tiền chỉ tính 1 lần');
});

test('buildStreamsModel: task con nhiều cấp, nhóm con có người phụ trách, task chưa giao', () => {
  const m = buildStreamsModel({
    project: { name: 'P1', project_name: 'WAR ROOM' },
    employees: [{ name: 'E1', employee_name: 'Người A' }, { name: 'E2', employee_name: 'Trưởng nhóm B' }],
    tasks: [
      { name: 'G', subject: 'Dòng tiền thử', is_group: 1, status: 'Open', creation: '1' },
      { name: 'G2', subject: 'Nhóm con', is_group: 1, status: 'Open', parent_task: 'G', custom_assignee: 'E2', creation: '2' },
      { name: 'T1', subject: 'Việc cấp 3', is_group: 1, status: 'In Progress', progress: 40, parent_task: 'G2', custom_assignee: 'E1', creation: '3' },
      { name: 'T2', subject: 'Việc chưa giao', is_group: 0, status: 'Open', parent_task: 'G', creation: '4' },
      { name: 'X', subject: 'Không phải dòng tiền', is_group: 0, status: 'Open', creation: '5' },
    ],
  }, { now: NOW });
  const s = m.streams[0];
  assert.equal(s.counts.total, 2);
  assert.equal(s.percent, 20);
  assert.deepEqual(s.people.map((p) => p.name).sort(), ['Chưa giao người', 'Người A', 'Trưởng nhóm B']);
  assert.equal(s.headcount, 2);
  assert.deepEqual(m.otherGroups.map((g) => [g.name, g.taskCount]), [['Không phải dòng tiền', 1]], 'task cấp cao ngoài dòng tiền -> liệt kê riêng');
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const { status = 200, body, headers = {} } = await handler(new URL(url), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  };
  fn.calls = calls;
  return fn;
}

test('WorksuiteClient: gửi token, fields/filters dạng JSON, lỗi Frappe dễ đọc', async () => {
  const f = fakeFetch((url) => {
    if (url.pathname === '/api/resource/Project') return { body: { data: [{ name: 'P1' }] } };
    return { status: 403, body: { exc_type: 'PermissionError', _server_messages: JSON.stringify([JSON.stringify({ message: 'Insufficient Permission for <strong>Task</strong>' })]) } };
  });
  const c = new WorksuiteClient({ baseUrl: 'https://ws.example/worksuite', apiKey: 'k', apiSecret: 's', fetch: f });
  const r = await c.list('Project', { fields: ['name'], filters: [['status', '!=', 'Cancelled']] });
  assert.deepEqual(r.rows, [{ name: 'P1' }]);
  const call = f.calls[0];
  assert.equal(call.init.headers.Authorization, 'token k:s');
  assert.equal(call.url.origin, 'https://ws.example');
  assert.deepEqual(JSON.parse(call.url.searchParams.get('fields')), ['name']);
  assert.deepEqual(JSON.parse(call.url.searchParams.get('filters')), [['status', '!=', 'Cancelled']]);
  assert.equal(call.url.searchParams.get('limit_page_length'), '0');
  await assert.rejects(c.list('Task', { fields: ['name'] }), /từ chối quyền truy cập \(403\): Insufficient Permission for Task/);
});

test('WorksuiteClient: trường custom_* bị từ chối (thông báo tiếng Việt) -> chỉ bỏ đúng trường đó', async () => {
  const f = fakeFetch((url) => {
    const fields = JSON.parse(url.searchParams.get('fields'));
    if (fields.includes('custom_blocker_reason')) {
      return { status: 417, body: { exception: 'frappe.exceptions.DataError: Trường không được phép trong truy vấn: custom_blocker_reason', exc_type: 'DataError' } };
    }
    return { body: { data: [{ name: 'T1', custom_assignee: 'E1' }] } };
  });
  const c = new WorksuiteClient({ baseUrl: 'https://ws.example', apiKey: 'k', apiSecret: 's', fetch: f });
  const r = await c.list('Task', { fields: ['name', 'custom_assignee', 'custom_blocker_reason'] });
  assert.deepEqual(r.missing, ['custom_blocker_reason']);
  assert.deepEqual(JSON.parse(f.calls[1].url.searchParams.get('fields')), ['name', 'custom_assignee']);
});

test('fetchWorksuiteRaw: tự tìm dự án WAR ROOM -> task của dự án -> nhân sự', async () => {
  const f = fakeFetch((url) => {
    const dt = url.pathname.split('/').pop();
    const filters = JSON.parse(url.searchParams.get('filters') || '[]');
    if (dt === 'Project') {
      assert.deepEqual(filters[0], ['project_name', 'like', '%war%room%']);
      return { body: { data: [{ name: 'PROJ-0536', project_name: 'WAR ROOM ' }] } };
    }
    if (dt === 'Task') {
      assert.deepEqual(filters[0], ['project', '=', 'PROJ-0536']);
      return { body: { data: [{ name: 'T1', subject: 'Dòng tiền A', is_group: 1, custom_assignee: 'E1' }] } };
    }
    if (dt === 'Employee') return { body: { data: [{ name: 'E1', employee_name: 'Người A' }] } };
    return { status: 404, body: {} };
  });
  const c = new WorksuiteClient({ baseUrl: 'https://ws.example', apiKey: 'k', apiSecret: 's', fetch: f });
  const raw = await fetchWorksuiteRaw(c);
  assert.equal(raw.project.name, 'PROJ-0536');
  assert.equal(raw.tasks.length, 1);
  assert.deepEqual(raw.employees.map((e) => e.name), ['E1']);
  assert.deepEqual(raw.warnings, []);
});

test('fetchWorksuiteRaw: WORKSUITE_PROJECT không tồn tại -> báo rõ', async () => {
  const f = fakeFetch(() => ({ body: { data: [] } }));
  const c = new WorksuiteClient({ baseUrl: 'https://ws.example', apiKey: 'k', apiSecret: 's', fetch: f });
  await assert.rejects(fetchWorksuiteRaw(c, { project: 'PROJ-9999' }), /Không thấy dự án PROJ-9999/);
  await assert.rejects(fetchWorksuiteRaw(c), /WORKSUITE_PROJECT/);
});

test('getStreams: chưa cấu hình / dữ liệu mẫu / cache / lỗi giữ dữ liệu cũ', async () => {
  resetStreamsCache();
  assert.equal((await getStreams({})).mode, 'unconfigured');
  const demo = await getStreams({}, { demo: true });
  assert.equal(demo.mode, 'demo');
  assert.equal(demo.streams.length, 6);

  let fail = false;
  const f = fakeFetch((url) => {
    if (fail) return { status: 502, body: '<html>Bad gateway</html>' };
    const dt = url.pathname.split('/').pop();
    if (dt === 'Project') return { body: { data: [{ name: 'P1', project_name: 'WAR ROOM' }] } };
    if (dt === 'Task') {
      return { body: { data: [
        { name: 'G', subject: 'Dòng tiền A', is_group: 1, status: 'Open' },
        { name: 'T1', subject: 'Việc', is_group: 0, parent_task: 'G', status: 'In Progress', custom_assignee_name: 'Người A', progress: 50 },
      ] } };
    }
    return { body: { data: [] } };
  });
  const env = { WORKSUITE_URL: 'https://ws.example/worksuite', WORKSUITE_API_KEY: 'k', WORKSUITE_API_SECRET: 's' };
  const live = await getStreams(env, { fetch: f, now: NOW });
  assert.equal(live.mode, 'live');
  assert.equal(live.streams[0].percent, 50);
  const n = f.calls.length;
  await getStreams(env, { fetch: f, now: NOW + 1000 });
  assert.equal(f.calls.length, n, 'dùng cache trong 60 giây');

  fail = true;
  const stale = await getStreams(env, { fetch: f, now: NOW + 120000 });
  assert.equal(stale.stale, true);
  assert.match(stale.error, /HTTP 502/);
  assert.equal(stale.streams.length, 1, 'vẫn giữ dữ liệu lần đọc trước');
  resetStreamsCache();
});

test('Đăng nhập bằng tài khoản: login 1 lần, dùng lại cookie sid, hết phiên thì đăng nhập lại', async () => {
  resetWorksuiteSessions();
  let current = 'sid-1';
  let logins = 0;
  const f = fakeFetch((url, init) => {
    if (url.pathname === '/api/method/login') {
      assert.deepEqual(JSON.parse(init.body), { usr: 'xem@ctg.vn', pwd: 'mat-khau' });
      logins++;
      current = `sid-${logins}`;
      return { body: { message: 'Logged In' }, headers: { 'Set-Cookie': `sid=${current}; path=/; HttpOnly` } };
    }
    if (init.headers.Cookie !== `sid=${current}`) return { status: 403, body: { exc_type: 'PermissionError' } };
    return { body: { data: [{ name: 'P1' }] } };
  });
  const c = new WorksuiteClient({ baseUrl: 'https://ws.example/worksuite', username: 'xem@ctg.vn', password: 'mat-khau', fetch: f });
  assert.equal(c.mode, 'password');
  await c.list('Project', { fields: ['name'] });
  await c.list('Project', { fields: ['name'] });
  assert.equal(logins, 1, 'dùng lại phiên');
  assert.equal(f.calls.filter((x) => x.init.headers.Authorization).length, 0, 'không gửi header token');
  current = 'sid-expired';
  const r = await c.list('Project', { fields: ['name'] });
  assert.deepEqual(r.rows, [{ name: 'P1' }]);
  assert.equal(logins, 2, 'đăng nhập lại đúng 1 lần');
  resetWorksuiteSessions();
});

test('Đăng nhập sai mật khẩu: báo lỗi, ngừng thử 10 phút, không lộ mật khẩu', async () => {
  resetWorksuiteSessions();
  let logins = 0;
  const f = fakeFetch((url) => {
    if (url.pathname === '/api/method/login') { logins++; return { status: 401, body: { message: 'Invalid login credentials', exc_type: 'AuthenticationError' } }; }
    return { body: { data: [] } };
  });
  const c = new WorksuiteClient({ baseUrl: 'https://ws.example', username: 'xem@ctg.vn', password: 'sai-mat-khau', fetch: f });
  await assert.rejects(c.list('Project', { fields: ['name'] }), (e) => /Đăng nhập Worksuite thất bại: Invalid login credentials/.test(e.message) && !e.message.includes('sai-mat-khau'));
  await assert.rejects(c.list('Project', { fields: ['name'] }), /Tạm ngừng thử lại 10 phút/);
  assert.equal(logins, 1, 'không gửi đăng nhập lần 2 trong 10 phút');
  resetWorksuiteSessions();
});

test('Đăng nhập: tài khoản bật OTP -> báo rõ', async () => {
  resetWorksuiteSessions();
  const f = fakeFetch(() => ({ body: { verification: { method: 'OTP App' }, tmp_id: 'abc' } }));
  const c = new WorksuiteClient({ baseUrl: 'https://ws.example', username: 'a', password: 'b', fetch: f });
  await assert.rejects(c.get('/api/resource/Project'), /xác thực 2 lớp/);
  resetWorksuiteSessions();
});

test('getStreams bằng tài khoản: mật khẩu và email không xuất hiện trong dữ liệu trả về', async () => {
  resetStreamsCache();
  resetWorksuiteSessions();
  const f = fakeFetch((url) => {
    if (url.pathname === '/api/method/login') return { body: { message: 'Logged In' }, headers: { 'Set-Cookie': 'sid=s1; path=/' } };
    const dt = url.pathname.split('/').pop();
    if (dt === 'Project') return { body: { data: [{ name: 'P1', project_name: 'WAR ROOM' }] } };
    if (dt === 'Task') return { body: { data: [{ name: 'G', subject: 'Dòng tiền A', is_group: 1, status: 'Open', custom_assignee_name: 'Người A' }] } };
    return { body: { data: [] } };
  });
  const env = { WORKSUITE_URL: 'https://ws.example/worksuite', WORKSUITE_USERNAME: 'xem@ctg.vn', WORKSUITE_PASSWORD: 'bi-mat-123' };
  const data = await getStreams(env, { fetch: f, now: NOW });
  assert.equal(data.mode, 'live');
  assert.equal(data.streams[0].pic.name, 'Người A');
  assert.ok(!JSON.stringify(data).includes('bi-mat-123'));
  assert.ok(!JSON.stringify(data).includes('xem@ctg.vn'));
  resetStreamsCache();
  resetWorksuiteSessions();
});

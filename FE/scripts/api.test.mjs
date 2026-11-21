// Kiểm thử API: chạy bằng `npm test` (không cần Google Sheet thật).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_SHEETS = 'true';
process.env.APP_ACCESS_KEY = 'secret-test-key';

const { createServer } = await import('./dev-api.mjs');
let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

const H = { 'content-type': 'application/json', 'x-access-key': 'secret-test-key' };

test('health trả về ok và không lộ secret', async () => {
  const r = await fetch(`${base}/health`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.mode, 'mock');
  assert.equal(j.authRequired, true);
  assert.ok(!JSON.stringify(j).includes('secret-test-key'));
});

test('thiếu / sai access key -> 401', async () => {
  assert.equal((await fetch(`${base}/tasks`)).status, 401);
  assert.equal((await fetch(`${base}/tasks`, { headers: { 'x-access-key': 'sai' } })).status, 401);
});

test('CRUD task đầy đủ', async () => {
  let r = await fetch(`${base}/tasks`, { headers: H });
  assert.equal(r.status, 200);
  const before = (await r.json()).data.length;

  r = await fetch(`${base}/tasks`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ title: '  Task mới  ', priority: 'High', due_date: '2026-12-31' }),
  });
  assert.equal(r.status, 201);
  const created = (await r.json()).data;
  assert.equal(created.title, 'Task mới');
  assert.equal(created.status, 'Todo');
  assert.match(created.id, /^[0-9a-f-]{36}$/);

  r = await fetch(`${base}/tasks?id=${created.id}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ status: 'Done' }),
  });
  assert.equal(r.status, 200);
  const updated = (await r.json()).data;
  assert.equal(updated.status, 'Done');
  assert.equal(updated.title, 'Task mới');

  r = await fetch(`${base}/tasks`, { headers: H });
  assert.equal((await r.json()).data.length, before + 1);

  r = await fetch(`${base}/tasks?id=${created.id}`, { method: 'DELETE', headers: H });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/tasks?id=${created.id}`, { method: 'DELETE', headers: H });
  assert.equal(r.status, 404);
});

test('validate dữ liệu đầu vào', async () => {
  const post = (body) =>
    fetch(`${base}/tasks`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ title: 'x', status: 'Xyz' })).status, 400);
  assert.equal((await post({ title: 'x', priority: 'Urgent' })).status, 400);
  assert.equal((await post({ title: 'x', due_date: '2026-02-30' })).status, 400);
  assert.equal((await post({ title: 'x'.repeat(201) })).status, 400);
  const r = await fetch(`${base}/tasks?id=abc`, { method: 'PUT', headers: H, body: '{}' });
  assert.equal(r.status, 400);
  const m = await fetch(`${base}/tasks`, { method: 'OPTIONS', headers: H });
  assert.equal(m.status, 405);
});

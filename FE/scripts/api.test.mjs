// Kiểm thử endpoint (chế độ MOCK, không cần Google Sheet thật).
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

const H = { 'x-access-key': 'secret-test-key' };

test('health ok, không lộ secret', async () => {
  const r = await fetch(`${base}/health`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.mode, 'mock');
  assert.equal(j.flows.length, 5);
  assert.ok(!JSON.stringify(j).includes('secret-test-key'));
});

test('thiếu / sai access key -> 401', async () => {
  assert.equal((await fetch(`${base}/dashboard`)).status, 401);
  assert.equal((await fetch(`${base}/dashboard`, { headers: { 'x-access-key': 'sai' } })).status, 401);
});

test('dashboard trả về 5 dòng tiền đã chuẩn hoá', async () => {
  const r = await fetch(`${base}/dashboard`, { headers: H });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mode, 'mock');
  assert.match(j.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(j.flows.length, 5);
  for (const f of j.flows) {
    assert.ok(!f.error, f.error);
    assert.equal(f.days.length, 5);
    assert.ok(f.items.length >= 4);
    for (const it of f.items) {
      assert.ok(it.pic);
      assert.equal(it.days.length, 5);
    }
  }
  assert.ok(j.flows[0].days.includes(j.today));
});

test('method khác GET -> 405', async () => {
  const r = await fetch(`${base}/dashboard`, { method: 'POST', headers: H });
  assert.equal(r.status, 405);
});

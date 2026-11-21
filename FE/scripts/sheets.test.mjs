// Kiểm thử lớp Google Sheet với một Sheets API giả lập trong bộ nhớ
// (xác minh đúng URL, range, valueInputOption và logic tìm/xoá dòng).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_SHEETS = 'false';
process.env.GOOGLE_SHEET_ID = 'SHEET123';
process.env.GOOGLE_SHEET_TAB = 'Tasks';

const { getRepo, __setClientForTest } = await import('../api/_lib/sheets.js');
const { COLUMNS } = await import('../api/_lib/schema.js');

function fakeSheets() {
  const grid = [COLUMNS.slice()];
  const calls = [];
  return {
    grid,
    calls,
    async request({ url, method = 'GET', data }) {
      calls.push({ url, method });
      assert.ok(url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/SHEET123'));
      if (url.includes('?fields=sheets.properties')) {
        return { data: { sheets: [{ properties: { sheetId: 42, title: 'Tasks' } }] } };
      }
      if (url.endsWith(':batchUpdate')) {
        const r = data.requests[0].deleteDimension.range;
        assert.equal(r.sheetId, 42);
        grid.splice(r.startIndex, r.endIndex - r.startIndex);
        return { data: {} };
      }
      const decoded = decodeURIComponent(url.split('/values/')[1]);
      const range = decoded.split(/[?]/)[0].replace(/:append$/, '');
      assert.ok(range.startsWith("'Tasks'!"), `range sai: ${range}`);
      const ref = range.slice("'Tasks'!".length);
      if (decoded.includes(':append')) {
        assert.ok(decoded.includes('valueInputOption=RAW'));
        grid.push(...data.values);
        return { data: {} };
      }
      if (method === 'PUT') {
        assert.ok(decoded.includes('valueInputOption=RAW'));
        const row = Number(ref.match(/^A(\d+)/)[1]);
        grid[row - 1] = data.values[0];
        return { data: {} };
      }
      // GET
      if (ref === 'A:A') return { data: { values: grid.map((r) => [r[0]]) } };
      if (ref === 'A2:I') return { data: { values: grid.slice(1) } };
      const m = ref.match(/^A(\d+):I(\d+)$/);
      if (m) return { data: { values: [grid[Number(m[1]) - 1]] } };
      throw new Error(`range không hỗ trợ: ${ref}`);
    },
  };
}

test('sheetRepo: create / list / update / delete trên sheet', async () => {
  const fake = fakeSheets();
  __setClientForTest(fake);
  const repo = getRepo();

  const a = await repo.create({ title: 'A', description: '', assignee: '', status: 'Todo', priority: 'Low', due_date: '' });
  const b = await repo.create({ title: '=HYPERLINK("x")', description: '', assignee: 'Bèm', status: 'Todo', priority: 'High', due_date: '2026-12-01' });
  assert.equal(fake.grid.length, 3);

  let list = await repo.list();
  assert.deepEqual(list.map((t) => t.title), ['A', '=HYPERLINK("x")']);

  const u = await repo.update(b.id, { status: 'Done' });
  assert.equal(u.status, 'Done');
  assert.equal(fake.grid[2][4], 'Done');
  assert.equal(fake.grid[2][0], b.id);

  await repo.remove(a.id);
  list = await repo.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, b.id);

  await assert.rejects(repo.update(a.id, { status: 'Done' }), { status: 404 });
  await assert.rejects(repo.remove('header-id-not-exist'), { status: 404 });
});

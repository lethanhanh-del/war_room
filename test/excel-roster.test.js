import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readXlsx } from '../src/excel/xlsx.js';
import { MASTER_HEADER, makeZip, masterFile, rosterFile, sheetXml } from './fixtures/xlsx.js';

// src/live.js import "cloudflare:workers" (chỉ có trên Worker): khi chạy thử trên Node, thay bằng bản rỗng.
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
  return next(specifier, context);
}`)}`);

test('readXlsx: dừng đọc sheet sau hàng trăm dòng trống liên tiếp', async () => {
  const rows = [[1, MASTER_HEADER], [2, [1, 'Banking', 'Nhóm', 'Task A', 'Người A']]];
  for (let r = 3; r <= 120; r++) rows.push([r, []]); // khoảng trống ngắn -> vẫn đọc tiếp
  rows.push([121, [2, 'Banking', 'Nhóm', 'Task B', 'Người B']]);
  for (let r = 122; r <= 900; r++) rows.push([r, []]); // khoảng trống dài
  rows.push([901, [3, 'Banking', 'Nhóm', 'Task xa', 'Người C']]);
  const xml = sheetXml(rows).replace(/<x:row r="(\d+)"><\/x:row>/g, '<x:row r="$1"><x:c r="G$1" s="1"/></x:row>');
  const bytes = await makeZip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Dòng tiền Banking" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': xml,
  }, { deflate: true });
  const book = await readXlsx(bytes);
  assert.deepEqual(book.sheets[0].rows.map((r) => r.cells[3]?.v).filter(Boolean), ['Task / Đầu việc', 'Task A', 'Task B']);
});

// ---------- nạp file phân chia nhiệm vụ qua API, D1 giả lập bằng SQLite của Node ----------

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* Node chưa có node:sqlite: bỏ qua phần dưới */
}

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of list) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const emptyCounts = () => ({ total: 0, done: 0, doing: 0, review: 0, waiting: 0, overdue: 0, todo: 0 });
const WS = {
  mode: 'live',
  project: null,
  summary: { ...emptyCounts(), percent: null, people: 0, streams: 3, pics: 0, streamsWithOverdue: 0 },
  otherGroups: [],
  warnings: [],
  streams: [['T1', 'Banking'], ['T2', 'Tài chính phụ trách triển khai và chịu trách nhiệm 10 dòng tiền'], ['T3', 'Nợ khó đòi']].map(([id, name]) => ({
    id, code: '', name, fullName: `Dòng tiền ${name}`, url: '', own: null, pic: null, percent: null, counts: emptyCounts(), tone: 'accent', headcount: 0, people: [],
  })),
};

test('nạp file phân chia nhiệm vụ: xem trước, lưu, gắn nhóm vào thẻ, gỡ — task không bị ảnh hưởng', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { handleExcel, withExcel } = await import('../src/excel/index.js');
  const env = { DB: fakeD1() };
  await ensureSchema(env);
  const user = { username: 'admin', fullName: 'Quản trị viên', role: 'admin' };
  const getWorksuite = async () => WS;
  const call = async (method, path, bytes, name) => {
    const url = new URL(`https://wr.example${path}`);
    const headers = { Origin: url.origin };
    if (bytes) Object.assign(headers, { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' });
    const res = await handleExcel(new Request(url, { method, headers, body: bytes }), env, url, user, getWorksuite);
    return { status: res.status, body: await res.json() };
  };

  // Task: nạp tay file tổng (thường do đồng bộ Google Sheet ghi)
  const tasks = await call('POST', '/api/excel', await masterFile(), 'WR - MASTER TASK.xlsx');
  assert.equal(tasks.status, 200, JSON.stringify(tasks.body));

  const pre = await call('POST', '/api/excel?preview=1', await rosterFile(), 'WarRoom_CTHomes_Final.xlsx');
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  assert.equal(pre.body.kind, 'roster');
  assert.deepEqual(pre.body.sections.map((x) => [x.name, x.target.streamId]), [
    ['Tài chính phụ trách triển khai và chịu trách nhiệm 10 dòng tiền', 'T2'],
    ['Bán 4 dự án', ''],
    ['Banking', 'T1'],
    ['Thu trước hạn/quá hạn', ''],
  ]);
  assert.deepEqual(pre.body.skipped, ['Cố vấn, chỉ đạo', 'Nhóm IT']);

  const saved = await call('POST', '/api/excel', await rosterFile(), 'WarRoom_CTHomes_Final.xlsx');
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  let data = await withExcel(env, WS);
  const banking = data.streams.find((x) => x.id === 'T1');
  assert.equal(banking.teams.groups[0].lead.name, 'Nguyễn Thị Mai Thu');
  assert.equal(banking.counts.total, 2); // task vẫn từ file tổng
  assert.ok(data.streams.some((x) => x.id === 'team:ban 4 du an'));
  assert.equal(data.excelTeams.length, 4);

  const removed = await call('DELETE', '/api/excel/teams');
  assert.deepEqual([removed.status, removed.body.removed], [200, 4]);
  data = await withExcel(env, WS);
  assert.equal(data.streams.find((x) => x.id === 'T1').teams, undefined);
  assert.equal(data.streams.find((x) => x.id === 'T1').counts.total, 2);
});

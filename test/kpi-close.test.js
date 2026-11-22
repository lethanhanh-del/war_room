// KPI-CLOSE: chốt sổ lúc 05:00 (src/kpi/close.js) + trạng thái hiển thị (public/kpi-model.js › statusOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDay, closeDeadline, closeVerdict } from '../src/kpi/close.js';
import { statusOf } from '../public/kpi-model.js';
import { DatabaseSync, fakeD1 } from './fixtures/d1.js';

const VN = 7 * 3600000;
const vn = (d, h, m = 0, s = 0) => Date.UTC(2026, 10, d, h, m, s) - VN; // ngày d/11/2026 h:m:s giờ VN

test('closeDeadline: KPI ngày 21/11 hết hạn lúc 05:00 ngày 22/11 (giờ VN)', () => {
  assert.equal(closeDeadline('2026-11-21'), vn(22, 5));
  assert.equal(closeDeadline('2026-11-21', 30), vn(22, 4, 30)); // chỉ để thử: dời sớm 30 phút
});

test('closeDay + closeVerdict: căn cứ từ lượt đọc trước / sau hạn và kết luận từng task', () => {
  const D = closeDeadline('2026-11-21');
  const t = (k, done, at = '') => ({ s: 'dt', g: 'nhom', p: 'an', k, done, at });
  const verdicts = (r) => r.data.map((x) => x[4]).join('');
  // Lượt 04:59:30 và 05:00:30 giống nhau -> biết chính xác.
  let r = closeDay(D, [t('a', true), t('b', false)], vn(22, 4, 59, 30), [t('a', true), t('b', false)]);
  assert.deepEqual([r.basis, verdicts(r)], ['exact', 'DK']);
  // b đổi giữa 2 lượt, lượt trước sát hạn -> tính theo lượt trước (chưa tick).
  r = closeDay(D, [t('a', true), t('b', false)], vn(22, 4, 59, 30), [t('a', true), t('b', true)]);
  assert.deepEqual([r.basis, verdicts(r)], ['window', 'DK']);
  // Worker ngừng 03:00 -> 06:00: b tick ở lượt sau -> không xác định (tính đã tick).
  r = closeDay(D, [t('a', true), t('b', false)], vn(22, 3), [t('a', true), t('b', true)]);
  assert.deepEqual([r.basis, verdicts(r), r.tally], ['gap', 'DU', { D: 1, K: 0, U: 1 }]);
  // Mới bật: tick sẵn không rõ giờ -> U; giờ tick đã ghi sau hạn -> K.
  r = closeDay(D, null, undefined, [t('a', true), t('b', true, new Date(vn(22, 6)).toISOString()), t('c', false)]);
  assert.deepEqual([r.basis, verdicts(r), r.lateAt], ['none', 'UKK', 1]);

  assert.equal(closeVerdict(true, null, 'exact'), 'D');
  assert.equal(closeVerdict(false, true, 'window'), 'K');
  assert.equal(closeVerdict(false, true, 'gap'), 'U');
  assert.equal(closeVerdict(false, false, 'gap'), 'K');
  assert.equal(closeVerdict(null, true, 'none'), 'U');
});

test('statusOf: ngày 21/11 không ghi nhận trễ hạn; từ 22/11 lúc 05:00 chưa tick -> tick sau đó = Hoàn thành trễ hạn', () => {
  // Ngày 21/11: hệ thống chưa áp dụng chấm trễ hạn -> đã tick luôn là Hoàn thành (D), chưa tick vẫn Tồn đọng (K).
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'K' }, '2026-11-21', '2026-11-22', vn(22, 9)), 'D');
  assert.equal(statusOf({ kpi: 'a', res: '', closed: 'K' }, '2026-11-21', '2026-11-22', vn(22, 9)), 'K');

  // Từ ngày 22/11 trở đi: áp dụng đầy đủ bản chốt lúc 05:00 hôm sau.
  const day = '2026-11-22';
  const now = vn(23, 9);
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'D' }, day, '2026-11-23', now), 'D');
  assert.equal(statusOf({ kpi: 'a', res: '', closed: 'K' }, day, '2026-11-23', now), 'K');
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'K' }, day, '2026-11-23', now), 'L');
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'U' }, day, '2026-11-23', now), 'D');
  // Bản chốt quyết định, không phụ thuộc giờ Worker thấy tick: tick lúc 04:58 (Worker thấy lúc 05:30) vẫn là Hoàn thành.
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'D', at: new Date(vn(23, 5, 30)).toISOString() }, day, '2026-11-23', now), 'D');
  // Chưa chốt (trước 05:00): như cũ.
  assert.equal(statusOf({ kpi: 'a', res: '' }, day, '2026-11-23', vn(23, 4)), 'N');
});

// ---------- đồng bộ + chốt sổ đầu-cuối: Google Sheet giả lập có lịch sử phiên bản + D1 giả lập ----------

const ID = 'KPI_CLOSE_SHEET_00000000001';
// src/kpi/index.js chỉ tạo bảng kpi_sheet 1 lần mỗi tiến trình -> các test dùng chung 1 database, dọn dữ liệu giữa các test.
let sharedDb;
async function freshEnv() {
  sharedDb ??= fakeD1();
  for (const t of ['kpi_sheet', 'kpi_close', 'kpi_close_obs', 'kpi_audit_log', 'kpi_cell_log', 'kpi_confirm', 'audit_log']) await sharedDb.prepare(`DELETE FROM ${t}`).run().catch(() => {});
  return { DB: sharedDb, KPI_SHEET_URL: ID, KPI_PLAN_URL: 'off', WARROOM_START: '2026-11-21' };
}
const HEAD = 'Stt,Nhóm,PIC,22/11,,23/11,,Ghi chú / Vướng mắc';
const SUB = ',,,KPI,Kết quả,KPI,Kết quả,';
const csv = ({ an = 'FALSE', hien = 'TRUE', extra = [] } = {}) => [
  'BẢNG KPI VÀ KẾT QUẢ ĐẠT ĐƯỢC WAR ROOM CT HOMES (21/11/2026 - 25/11/2026)',
  '"DÒNG TIỀN: BÁN 4 DỰ ÁN\nPIC: HOÀNG THỊ QUỲNH MAI"',
  HEAD, SUB,
  'I,Networking,,,,,,',
  `1,Networking,Mạc Thị Thúy Hiền,Gặp 5 khách,${hien},Gọi 10 khách,FALSE,`,
  `2,Networking,Trương Huỳnh Thúy An,Gọi 40 khách,${an},Mời 15 khách,FALSE,`,
  ...extra,
].join('\n');

/** revs(): [csv phiên bản 1, 2, …]; tab đầu ("KPI 21-25.11") có từ phiên bản 1. */
function fakeGoogle(revs) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith(`/d/${ID}/htmlview`)) {
      return new Response('items.push({name: "KPI 21-25.11", pageUrl: "x", gid: "1"}); items.push({name: "DÒNG TIỀN BÁN 4 DỰ ÁN", pageUrl: "x", gid: "2"});', { headers: { 'Content-Type': 'text/html' } });
    }
    const m = /export\?format=csv&gid=(\d+)(?:&revision=(\d+))?/.exec(u);
    if (!m || !u.includes(ID)) return new Response('not found', { status: 404 });
    const rev = m[2] ? Number(m[2]) : revs().length;
    if (rev < 1 || rev > revs().length) return new Response('<html>400</html>', { status: 400, headers: { 'Content-Type': 'text/html' } });
    return new Response(m[1] === '1' ? 'tổng quan' : revs()[rev - 1], { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  };
  return () => { globalThis.fetch = real; };
}

const cellOf = (data, person, day = '2026-11-22') => data.streams[0].groups[0].rows.find((r) => r.person === person).cells[day];
const status = (data, person, now, day = '2026-11-22') => statusOf(cellOf(data, person, day), day, data.today, now);

test('chốt sổ đầu-cuối: An chưa tick lúc 05:00 rồi 09:00 mới tick (từ ngày 22/11) -> Hoàn thành trễ hạn; Hiền tick trước hạn -> Hoàn thành', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await import('../src/kpi/index.js');
  const { auditReport } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  try {
    await syncKpi(env, { force: true, now: vn(23, 4, 50) });
    await syncKpi(env, { force: true, now: vn(23, 4, 59) });
    let data = await kpiData(env, vn(23, 4, 59));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 4, 59)), 'N'); // còn hạn tới 05:00
    await syncKpi(env, { force: true, now: vn(23, 5, 0, 20) }); // lượt đầu sau 05:00 -> chốt ngày 22
    const rep = await auditReport(env, ID);
    assert.deepEqual(rep.closes.map((c) => [c.day, c.basis, c.count]), [['2026-11-22', 'exact', { D: 1, K: 1, U: 0 }]]);
    data = await kpiData(env, vn(23, 5, 1));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 5, 1)), 'K'); // Tồn đọng
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(23, 5, 1)), 'D'); // Hoàn thành

    revs.push(csv({ an: 'TRUE' })); // 09:00: An mới tick
    await syncKpi(env, { force: true, now: vn(23, 9) });
    data = await kpiData(env, vn(23, 9));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 9)), 'L'); // Hoàn thành trễ hạn
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(23, 9)), 'D');

    // Sửa sheet sau khi chốt không đổi được bản chốt (ghi 1 lần).
    revs.push(csv({ an: 'TRUE', hien: 'FALSE' }));
    await syncKpi(env, { force: true, now: vn(23, 10) });
    assert.deepEqual((await auditReport(env, ID)).closes[0].count, { D: 1, K: 1, U: 0 });
    data = await kpiData(env, vn(23, 10));
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(23, 10)), 'K'); // bỏ tick sau hạn: hiển thị theo ô hiện tại
  } finally {
    restore();
  }
});

test('chốt sổ khi Worker lỡ nhịp lúc 05:00: dùng lượt đọc cuối trước hạn, ô tick ở lượt sau = không xác định', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await import('../src/kpi/index.js');
  const { auditReport } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  try {
    await syncKpi(env, { force: true, now: vn(23, 4) }); // thấy phiên bản 1 lúc 04:00 (An chưa tick)
    revs.push(csv({ an: 'TRUE' })); // An tick lúc nào đó trong khi Worker ngừng chạy
    await syncKpi(env, { force: true, now: vn(23, 6) }); // Worker chạy lại lúc 06:00
    const c = (await auditReport(env, ID)).closes[0];
    assert.deepEqual([c.basis, c.readBefore, c.readAfter, c.count], ['gap', new Date(vn(23, 4)).toISOString(), new Date(vn(23, 6)).toISOString(), { D: 1, K: 0, U: 1 }]);
    const data = await kpiData(env, vn(23, 6));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 6)), 'D'); // không xác định -> không tính trễ oan
  } finally {
    restore();
  }
});

test('xác nhận lại: An tick 20:00, lỡ bỏ tick 04:58 -> chốt Tồn đọng; vào danh sách cần xác nhận; tick lại = trễ hạn; admin xác nhận -> Hoàn thành', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await import('../src/kpi/index.js');
  const { handleKpiReview } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  const admin = { username: 'admin', role: 'admin' };
  const api = async (method, body) => {
    const req = new Request('https://x/api/admin/kpi-review', { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const res = await handleKpiReview(req, env, new URL(req.url), admin);
    return { status: res.status, ...(await res.json()) };
  };
  try {
    await syncKpi(env, { force: true, now: vn(22, 19) }); // mốc
    revs.push(csv({ an: 'TRUE' }));
    await syncKpi(env, { force: true, now: vn(22, 20) }); // 20:00 An tick
    revs.push(csv({ an: 'FALSE' }));
    await syncKpi(env, { force: true, now: vn(23, 4, 58) }); // 04:58 lỡ bỏ tick
    await syncKpi(env, { force: true, now: vn(23, 5, 0, 20) }); // chốt: An chưa tick
    let items = (await api('GET')).items;
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].person, items[0].kpi, items[0].history.map((h) => h.change), items[0].confirmed], ['Trương Huỳnh Thúy An', 'Gọi 40 khách', ['tick', 'untick'], null]);

    revs.push(csv({ an: 'TRUE' }));
    await syncKpi(env, { force: true, now: vn(23, 8, 10) }); // 08:10 An tick lại
    let data = await kpiData(env, vn(23, 8, 10));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 8, 10)), 'L'); // chưa xác nhận: trễ hạn

    assert.equal((await api('POST', { day: '2026-11-22', cell: items[0].cell })).status, 400); // bắt buộc lý do
    assert.equal((await api('POST', { day: '2026-11-22', cell: items[0].cell, reason: 'Lỡ bấm bỏ tick lúc 04:58' })).status, 200);
    data = await kpiData(env, vn(23, 8, 11));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 8, 11)), 'D'); // admin xác nhận -> Hoàn thành
    assert.equal(cellOf(data, 'Trương Huỳnh Thúy An').confirmed.by, 'admin');
    items = (await api('GET')).items;
    assert.equal(items[0].confirmed.reason, 'Lỡ bấm bỏ tick lúc 04:58');
    const logs = (await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'kpi_%'").all()).results.map((r) => r.action);
    assert.deepEqual(logs, ['kpi_confirm']);

    assert.equal((await api('DELETE', { day: '2026-11-22', cell: items[0].cell })).status, 200); // huỷ xác nhận
    data = await kpiData(env, vn(23, 8, 12));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 8, 12)), 'L');
  } finally {
    restore();
  }
});

test('tải Excel chốt sổ theo ngày (admin): lúc chốt / hiện tại / kết quả, dòng thêm sau chốt, dòng đã xoá; file đọc lại được', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { syncKpi } = await import('../src/kpi/index.js');
  const { handleKpiCloseExport } = await import('../src/kpi/close-export.js');
  const { readXlsx } = await import('../src/excel/xlsx.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  const admin = { username: 'admin', role: 'admin' };
  const get = (q = '') => {
    const req = new Request(`https://x/api/admin/kpi-close${q}`);
    return handleKpiCloseExport(req, env, new URL(req.url), admin);
  };
  const values = (sheet) => sheet.rows.map((r) => r.cells.map((c) => c?.v ?? ''));
  try {
    await syncKpi(env, { force: true, now: vn(23, 4, 50) });
    assert.equal((await get('?day=2026-11-22')).status, 404); // chưa chốt
    await syncKpi(env, { force: true, now: vn(23, 5, 0, 20) }); // chốt: Hiền đã tick, An chưa
    // Sau chốt: An tick (trễ), xoá dòng Hiền, thêm dòng mới.
    revs.push(csv({ an: 'TRUE', extra: ['3,Networking,Lê Văn Mới,Việc thêm sau,FALSE,,FALSE,'] }).split('\n').filter((l) => !l.includes('Thúy Hiền')).join('\n'));
    await syncKpi(env, { force: true, now: vn(23, 9) });

    const list = await (await get()).json();
    assert.deepEqual(list.days.map((d) => [d.day, d.basis, d.count]), [['2026-11-22', 'exact', { D: 1, K: 1, U: 0 }]]);
    assert.equal((await get('?day=22-11-2026')).status, 400);

    const res = await get('?day=2026-11-22');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Disposition'), /chot-so-KPI-2026-11-22\.xlsx/);
    const book = await readXlsx(new Uint8Array(await res.arrayBuffer()));
    assert.deepEqual(book.sheets.map((s) => s.name), ['Chốt sổ', 'Tổng hợp', 'Nhật ký']);
    const main = values(book.sheets[0]);
    const head = main.findIndex((r) => r[0] === 'STT');
    const byPerson = Object.fromEntries(main.slice(head + 1).map((r) => [r[3], r]));
    assert.deepEqual(byPerson['Trương Huỳnh Thúy An'].slice(5, 8), ['Chưa tick', 'Đã tick', 'Hoàn thành trễ hạn']);
    assert.deepEqual(byPerson['Lê Văn Mới'].slice(5, 8), ['Chưa có lúc chốt', 'Chưa tick', 'Tồn đọng']);
    assert.deepEqual(byPerson['Mạc Thị Thúy Hiền'].slice(4, 7), ['Gặp 5 khách', 'Đã tick', 'Không còn trên Sheet']); // tên lấy từ bản chốt
    assert.match(String(byPerson['Trương Huỳnh Thúy An'][9]), /tick/); // lịch sử ô
    const total = values(book.sheets[1]).find((r) => r[0] === 'Tổng');
    assert.deepEqual(total.slice(1), [3, 0, 1, 1, 1]);
    assert.ok(values(book.sheets[2]).some((r) => r[1] === 'close'));
    const logs = (await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'kpi_close_export'").all()).results;
    assert.equal(logs.length, 1); // mỗi lần tải được ghi nhật ký thao tác
  } finally {
    restore();
  }
});

test('dòng trùng hệt nhau (cùng người, cùng KPI): mỗi dòng có kết quả chốt riêng, không bị gộp', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await import('../src/kpi/index.js');
  const { auditReport } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const dup = '3,Networking,Trương Huỳnh Thúy An,Gọi 40 khách,TRUE,Mời 15 khách,FALSE,'; // trùng dòng 2, nhưng đã tick
  const revs = [csv({ extra: [dup] })];
  const restore = fakeGoogle(() => revs);
  try {
    await syncKpi(env, { force: true, now: vn(23, 4, 50) });
    await syncKpi(env, { force: true, now: vn(23, 5, 0, 20) });
    assert.deepEqual((await auditReport(env, ID)).closes[0].count, { D: 2, K: 1, U: 0 });
    const data = await kpiData(env, vn(23, 6));
    const an = data.streams[0].groups[0].rows.filter((r) => r.person === 'Trương Huỳnh Thúy An').map((r) => statusOf(r.cells['2026-11-22'], '2026-11-22', data.today, vn(23, 6)));
    assert.deepEqual(an, ['K', 'D']);
  } finally {
    restore();
  }
});

test('lần đầu bật chốt sổ (căn cứ none): ô đã ghi giờ tick sau hạn vẫn là Hoàn thành trễ hạn; ô tick sẵn không rõ giờ = Hoàn thành', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await import('../src/kpi/index.js');
  const { auditReport } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  try {
    await syncKpi(env, { force: true, now: vn(23, 4, 50) }); // trước khi có chốt sổ: kpi_sheet đã có dữ liệu (An chưa tick)
    for (const t of ['kpi_close', 'kpi_close_obs', 'kpi_cell_log', 'kpi_audit_log']) await env.DB.prepare(`DELETE FROM ${t}`).run();
    revs.push(csv({ an: 'TRUE' }));
    await syncKpi(env, { force: true, now: vn(23, 6) }); // deploy: lượt đầu có chốt sổ; ticks.js ghi An tick lúc 06:00
    const c = (await auditReport(env, ID)).closes[0];
    assert.deepEqual([c.basis, c.count], ['none', { D: 0, K: 1, U: 1 }]);
    const data = await kpiData(env, vn(23, 6));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(23, 6)), 'L');
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(23, 6)), 'D');
  } finally {
    restore();
  }
});

test('chốt sổ không gọi Google thêm lần nào (gói Free: tối đa 50 lần gọi ra ngoài / lượt)', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { syncKpi } = await import('../src/kpi/index.js');
  const { auditReport, closeKpi } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  try {
    await syncKpi(env, { force: true, now: vn(23, 4, 59) });
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('không được gọi ra ngoài'); };
    try {
      await closeKpi(env, ID, JSON.parse((await env.DB.prepare('SELECT data FROM kpi_sheet WHERE id = 1').first()).data), vn(23, 5, 0, 30));
    } finally {
      globalThis.fetch = real;
    }
    assert.equal(calls, 0);
    const rep = await auditReport(env, ID);
    assert.deepEqual(rep.closes.map((c) => [c.day, c.basis, c.count]), [['2026-11-22', 'exact', { D: 1, K: 1, U: 0 }]]);
    assert.ok(!rep.log.some((l) => l.kind === 'error'));
  } finally {
    restore();
  }
});

test('ngày 21/11 hoàn thành muộn: không ghi nhận trễ hạn trên UI lẫn Excel xuất chốt sổ', async () => {
  const { reconcileRows } = await import('../src/kpi/close-export.js');
  const close = { day: '2026-11-21', data: [['ban4duan', 'networking', 'an', 'goi 40 khach', 'K', ['Dòng tiền bán 4 dự án', 'Networking', 'An', 'Gọi 40 khách']]] };
  const streams = [{ name: 'Dòng tiền bán 4 dự án', groups: [{ name: 'Networking', rows: [{ person: 'An', cells: { '2026-11-21': { kpi: 'Gọi 40 khách', res: 'D', at: '2026-11-22T02:00:00.000Z' } } }] }] }];
  const rows = reconcileRows(close, streams, [], {}, new Map());
  assert.equal(rows[0].status, 'D');
  assert.equal(rows[0].result, 'Hoàn thành');
  assert.equal(rows[0].tickAt, '');
});

// KPI-CLOSE: chốt sổ lúc 05:00 (src/kpi/close.js) + trạng thái hiển thị (public/kpi-model.js › statusOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDeadline, closeVerdict, evidenceFor } from '../src/kpi/close.js';
import { statusOf } from '../public/kpi-model.js';
import { DatabaseSync, fakeD1 } from './fixtures/d1.js';

const VN = 7 * 3600000;
const vn = (d, h, m = 0, s = 0) => Date.UTC(2026, 10, d, h, m, s) - VN; // ngày d/11/2026 h:m:s giờ VN

test('closeDeadline: KPI ngày 21/11 hết hạn lúc 05:00 ngày 22/11 (giờ VN)', () => {
  assert.equal(closeDeadline('2026-11-21'), vn(22, 5));
  assert.equal(closeDeadline('2026-11-21', 30), vn(22, 4, 30)); // chỉ để thử: dời sớm 30 phút
});

test('evidenceFor + closeVerdict: căn cứ lúc hết hạn và kết luận từng task', () => {
  const D = closeDeadline('2026-11-21');
  // Phiên bản 3 được thấy từ 04:00 tới 05:00:30 -> biết chính xác lúc 05:00.
  assert.deepEqual(evidenceFor(D, [{ rev: 3, from: vn(22, 4), to: vn(22, 5, 0, 30) }]), { A: 3, B: 3, basis: 'exact' });
  // Thấy bản 3 lần cuối 04:59:30, bản 4 lúc 05:00:30 -> sát hạn.
  assert.equal(evidenceFor(D, [{ rev: 3, from: vn(22, 4), to: vn(22, 4, 59, 30) }, { rev: 4, from: vn(22, 5, 0, 30), to: vn(22, 5, 0, 30) }]).basis, 'window');
  // Worker ngừng từ 03:00 tới 06:00 -> khoảng mù.
  assert.deepEqual(evidenceFor(D, [{ rev: 3, from: vn(22, 2), to: vn(22, 3) }, { rev: 9, from: vn(22, 6), to: vn(22, 6) }]), { A: 3, B: 9, basis: 'gap' });
  // Chưa có quan sát nào sau hạn: chưa chốt.
  assert.equal(evidenceFor(D, [{ rev: 3, from: vn(22, 2), to: vn(22, 4) }]), null);

  assert.equal(closeVerdict(true, null, 'exact'), 'D'); // lúc hết hạn đã tick
  assert.equal(closeVerdict(false, null, 'exact'), 'K'); // lúc hết hạn chưa tick
  assert.equal(closeVerdict(false, null, 'window'), 'K'); // tick sát giờ sau lượt cuối trước hạn: tính chưa tick (sai số ±1 phút)
  assert.equal(closeVerdict(false, true, 'gap'), 'U'); // khoảng mù: không biết tick trước hay sau hạn -> tính đã tick
  assert.equal(closeVerdict(false, false, 'gap'), 'K'); // sau khoảng mù vẫn chưa tick -> chắc chắn chưa tick lúc hết hạn
  assert.equal(closeVerdict(null, true, 'none'), 'U'); // mới bật hệ thống, ô đã tick sẵn -> tính đã tick
});

test('statusOf: ngày đã chốt — lúc 05:00 đã tick = Hoàn thành; chưa tick = Tồn đọng; tick sau đó = Hoàn thành trễ hạn', () => {
  const day = '2026-11-21';
  const now = vn(22, 9);
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'D' }, day, '2026-11-22', now), 'D');
  assert.equal(statusOf({ kpi: 'a', res: '', closed: 'K' }, day, '2026-11-22', now), 'K');
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'K' }, day, '2026-11-22', now), 'L');
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'U' }, day, '2026-11-22', now), 'D');
  // Bản chốt quyết định, không phụ thuộc giờ Worker thấy tick: tick lúc 04:58 (Worker thấy lúc 05:30) vẫn là Hoàn thành.
  assert.equal(statusOf({ kpi: 'a', res: 'D', closed: 'D', at: new Date(vn(22, 5, 30)).toISOString() }, day, '2026-11-22', now), 'D');
  // Chưa chốt (trước 05:00): như cũ.
  assert.equal(statusOf({ kpi: 'a', res: '' }, day, '2026-11-22', vn(22, 4)), 'N');
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
const HEAD = 'Stt,Nhóm,PIC,21/11,,22/11,,Ghi chú / Vướng mắc';
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

const cellOf = (data, person) => data.streams[0].groups[0].rows.find((r) => r.person === person).cells['2026-11-21'];
const status = (data, person, now) => statusOf(cellOf(data, person), '2026-11-21', data.today, now);

test('chốt sổ đầu-cuối: An chưa tick lúc 05:00 rồi 09:00 mới tick -> Hoàn thành trễ hạn; Hiền tick trước hạn -> Hoàn thành', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await import('../src/kpi/index.js');
  const { auditReport } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  try {
    await syncKpi(env, { force: true, now: vn(22, 4, 50) });
    await syncKpi(env, { force: true, now: vn(22, 4, 59) });
    let data = await kpiData(env, vn(22, 4, 59));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 4, 59)), 'N'); // còn hạn tới 05:00
    await syncKpi(env, { force: true, now: vn(22, 5, 0, 20) }); // lượt đầu sau 05:00 -> chốt ngày 21
    const rep = await auditReport(env, ID);
    assert.deepEqual(rep.closes.map((c) => [c.day, c.basis, c.count]), [['2026-11-21', 'exact', { D: 1, K: 1, U: 0 }]]);
    data = await kpiData(env, vn(22, 5, 1));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 5, 1)), 'K'); // Tồn đọng
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(22, 5, 1)), 'D'); // Hoàn thành

    revs.push(csv({ an: 'TRUE' })); // 09:00: An mới tick
    await syncKpi(env, { force: true, now: vn(22, 9) });
    data = await kpiData(env, vn(22, 9));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 9)), 'L'); // Hoàn thành trễ hạn
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(22, 9)), 'D');

    // Sửa sheet sau khi chốt không đổi được bản chốt (ghi 1 lần).
    revs.push(csv({ an: 'TRUE', hien: 'FALSE' }));
    await syncKpi(env, { force: true, now: vn(22, 10) });
    assert.deepEqual((await auditReport(env, ID)).closes[0].count, { D: 1, K: 1, U: 0 });
    data = await kpiData(env, vn(22, 10));
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(22, 10)), 'K'); // bỏ tick sau hạn: hiển thị theo ô hiện tại
  } finally {
    restore();
  }
});

test('chốt sổ khi Worker lỡ nhịp lúc 05:00: đọc lại phiên bản cuối trước hạn từ lịch sử Google', { skip: !DatabaseSync && 'Node chưa có node:sqlite' }, async () => {
  const { ensureSchema } = await import('../src/db.js');
  const { kpiData, syncKpi } = await import('../src/kpi/index.js');
  const { auditReport } = await import('../src/kpi/close.js');
  const env = await freshEnv();
  await ensureSchema(env);
  const revs = [csv()];
  const restore = fakeGoogle(() => revs);
  try {
    await syncKpi(env, { force: true, now: vn(22, 4) }); // thấy phiên bản 1 lúc 04:00 (An chưa tick)
    revs.push(csv({ an: 'TRUE' })); // An tick lúc nào đó trong khi Worker ngừng chạy
    await syncKpi(env, { force: true, now: vn(22, 6) }); // Worker chạy lại lúc 06:00
    const c = (await auditReport(env, ID)).closes[0];
    assert.deepEqual([c.basis, c.revA, c.revB, c.count], ['gap', 1, 2, { D: 1, K: 0, U: 1 }]);
    const data = await kpiData(env, vn(22, 6));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 6)), 'D'); // không xác định -> không tính trễ oan
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
    await syncKpi(env, { force: true, now: vn(21, 19) }); // mốc
    revs.push(csv({ an: 'TRUE' }));
    await syncKpi(env, { force: true, now: vn(21, 20) }); // 20:00 An tick
    revs.push(csv({ an: 'FALSE' }));
    await syncKpi(env, { force: true, now: vn(22, 4, 58) }); // 04:58 lỡ bỏ tick
    await syncKpi(env, { force: true, now: vn(22, 5, 0, 20) }); // chốt: An chưa tick
    let items = (await api('GET')).items;
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].person, items[0].kpi, items[0].history.map((h) => h.change), items[0].confirmed], ['Trương Huỳnh Thúy An', 'Gọi 40 khách', ['tick', 'untick'], null]);

    revs.push(csv({ an: 'TRUE' }));
    await syncKpi(env, { force: true, now: vn(22, 8, 10) }); // 08:10 An tick lại
    let data = await kpiData(env, vn(22, 8, 10));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 8, 10)), 'L'); // chưa xác nhận: trễ hạn

    assert.equal((await api('POST', { day: '2026-11-21', cell: items[0].cell })).status, 400); // bắt buộc lý do
    assert.equal((await api('POST', { day: '2026-11-21', cell: items[0].cell, reason: 'Lỡ bấm bỏ tick lúc 04:58' })).status, 200);
    data = await kpiData(env, vn(22, 8, 11));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 8, 11)), 'D'); // admin xác nhận -> Hoàn thành
    assert.equal(cellOf(data, 'Trương Huỳnh Thúy An').confirmed.by, 'admin');
    items = (await api('GET')).items;
    assert.equal(items[0].confirmed.reason, 'Lỡ bấm bỏ tick lúc 04:58');
    const logs = (await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'kpi_%'").all()).results.map((r) => r.action);
    assert.deepEqual(logs, ['kpi_confirm']);

    assert.equal((await api('DELETE', { day: '2026-11-21', cell: items[0].cell })).status, 200); // huỷ xác nhận
    data = await kpiData(env, vn(22, 8, 12));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 8, 12)), 'L');
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
    await syncKpi(env, { force: true, now: vn(22, 4, 50) });
    assert.equal((await get('?day=2026-11-21')).status, 404); // chưa chốt
    await syncKpi(env, { force: true, now: vn(22, 5, 0, 20) }); // chốt: Hiền đã tick, An chưa
    // Sau chốt: An tick (trễ), xoá dòng Hiền, thêm dòng mới.
    revs.push(csv({ an: 'TRUE', extra: ['3,Networking,Lê Văn Mới,Việc thêm sau,FALSE,,FALSE,'] }).split('\n').filter((l) => !l.includes('Thúy Hiền')).join('\n'));
    await syncKpi(env, { force: true, now: vn(22, 9) });

    const list = await (await get()).json();
    assert.deepEqual(list.days.map((d) => [d.day, d.basis, d.count]), [['2026-11-21', 'exact', { D: 1, K: 1, U: 0 }]]);
    assert.equal((await get('?day=21-11-2026')).status, 400);

    const res = await get('?day=2026-11-21');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Disposition'), /chot-so-KPI-2026-11-21\.xlsx/);
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
    await syncKpi(env, { force: true, now: vn(22, 4, 50) });
    await syncKpi(env, { force: true, now: vn(22, 5, 0, 20) });
    assert.deepEqual((await auditReport(env, ID)).closes[0].count, { D: 2, K: 1, U: 0 });
    const data = await kpiData(env, vn(22, 6));
    const an = data.streams[0].groups[0].rows.filter((r) => r.person === 'Trương Huỳnh Thúy An').map((r) => statusOf(r.cells['2026-11-21'], '2026-11-21', data.today, vn(22, 6)));
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
    await syncKpi(env, { force: true, now: vn(22, 4, 50) }); // trước khi có chốt sổ: kpi_sheet đã có dữ liệu (An chưa tick)
    for (const t of ['kpi_close', 'kpi_close_obs', 'kpi_cell_log', 'kpi_audit_log']) await env.DB.prepare(`DELETE FROM ${t}`).run();
    revs.push(csv({ an: 'TRUE' }));
    await syncKpi(env, { force: true, now: vn(22, 6) }); // deploy: lượt đầu có chốt sổ; ticks.js ghi An tick lúc 06:00
    const c = (await auditReport(env, ID)).closes[0];
    assert.deepEqual([c.basis, c.count], ['none', { D: 0, K: 1, U: 1 }]);
    const data = await kpiData(env, vn(22, 6));
    assert.equal(status(data, 'Trương Huỳnh Thúy An', vn(22, 6)), 'L');
    assert.equal(status(data, 'Mạc Thị Thúy Hiền', vn(22, 6)), 'D');
  } finally {
    restore();
  }
});

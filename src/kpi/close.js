// CHỐT SỔ KPI lúc 05:00 (KPI-CLOSE).
//
// Hạn của KPI ngày D là 05:00 ngày D+1 (giờ Việt Nam). Đúng hạn, hệ thống ghi lại task nào đã tick, task nào chưa, lưu vào
// D1 (bảng kpi_close) — ghi 1 lần, không sửa. Trạng thái hiển thị lấy từ bản ghi đó + trạng thái tick hiện tại:
//   lúc 05:00 đã tick                      -> Hoàn thành
//   lúc 05:00 chưa tick, hiện vẫn chưa tick -> Tồn đọng (Không đạt)
//   lúc 05:00 chưa tick, hiện đã tick       -> Hoàn thành trễ hạn
// Sửa sheet sau 05:00 (tick, bỏ tick, xoá dòng, Worker ngừng chạy một lúc) không đổi được kết luận đã chốt.
//
// Căn cứ: mỗi lượt đồng bộ (cron 1 phút) Worker đã đọc toàn bộ sheet; ở đây chỉ lưu lại trạng thái tick của mọi ô kèm giờ đọc
// (bảng kpi_close_obs). Lượt đầu tiên sau hạn so LƯỢT ĐỌC TRƯỚC (trước hạn) với lượt hiện tại để chốt — không gọi thêm Google
// lần nào (gói Free: tối đa 50 lần gọi ra ngoài / lượt). Google không cho biết giờ tick nên độ chính xác là ±1 lượt đọc (~1 phút).
//
// Bảng D1 (tự tạo): kpi_close_obs (lượt đọc gần nhất), kpi_close (bản chốt từng ngày), kpi_audit_log (nhật ký, chỉ thêm),
// kpi_cell_log (lịch sử tick / bỏ tick từng ô), kpi_confirm (admin xác nhận đúng hạn).
// API: GET /api/kpi/audit (chỉ đọc); GET/POST/DELETE /api/admin/kpi-review (chỉ admin); GET /api/admin/kpi-close (tải Excel, close-export.js).
//
// XÁC NHẬN LẠI: ô bị chốt "chưa tick" nhưng lịch sử cho thấy ĐÃ TỪNG TICK TRƯỚC HẠN (vd lỡ bỏ tick lúc 04:58) được đưa vào
// danh sách "cần xác nhận" ở trang Quản trị. Admin xem lịch sử ô và bấm "Xác nhận đúng hạn" (kèm lý do) -> ô tính như lúc 05:00
// đã tick. Không tự động (tránh lách: tick sớm rồi bỏ tick khi chưa làm). Mọi lần xác nhận / huỷ đều ghi nhật ký.

import { log } from '../db.js';
import { json } from '../http.js';
import { normKey } from '../worksuite/model.js';

const DUE_HOUR = 5;
const TAU_MS = 2 * 60 * 1000; // lượt đọc trước cách hạn ≤ 2 phút coi là "sát hạn"

/** Hạn (ms) của KPI ngày `date` = 05:00 ngày hôm sau giờ VN. shiftMin: CHỈ để thử trên máy (KPI_DUE_SHIFT_MIN). */
export const closeDeadline = (date, shiftMin = 0) => Date.parse(`${date}T00:00:00Z`) + (24 + DUE_HOUR - 7) * 3600000 - shiftMin * 60000;

const shiftOf = (env) => Number(env.KPI_DUE_SHIFT_MIN) || 0;
export const loose = (s) => normKey(s).replace(/[^a-z0-9]+/g, '');

const ready = new WeakSet();
export async function ensureTables(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kpi_close_obs (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)'),
    // rev_a / rev_b: giờ (ms) của lượt đọc trước / sau hạn dùng để chốt.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kpi_close (
      sheet TEXT NOT NULL, day TEXT NOT NULL, closed_at TEXT NOT NULL, deadline TEXT NOT NULL, basis TEXT NOT NULL,
      rev_a INTEGER, rev_b INTEGER, data TEXT NOT NULL, PRIMARY KEY (sheet, day))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kpi_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, sheet TEXT NOT NULL, day TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kpi_cell_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sheet TEXT NOT NULL, day TEXT NOT NULL, cell TEXT NOT NULL, at TEXT NOT NULL,
      change TEXT NOT NULL, rev INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kpi_confirm (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sheet TEXT NOT NULL, day TEXT NOT NULL, cell TEXT NOT NULL, by TEXT NOT NULL,
      at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', revoked_by TEXT NOT NULL DEFAULT '', revoked_at TEXT NOT NULL DEFAULT '')`),
  ]);
  ready.add(env.DB);
}

// ---------- quy tắc chốt sổ (hàm thuần) ----------

/**
 * Kết luận 1 task lúc hết hạn: 'D' = đã tick, 'K' = chưa tick, 'U' = không xác định được (tính như đã tick, ghi nhật ký).
 * atA / atB: đã tick ở lượt đọc trước / sau hạn (true/false; false cả khi chưa có task), null = không có lượt đọc đó.
 */
export function closeVerdict(atA, atB, basis) {
  if (atA === true) return 'D';
  if (basis === 'exact' || basis === 'window') return 'K';
  return atB === true ? 'U' : 'K';
}

/** Task của 1 ngày từ dữ liệu sheet: [{ s, g, p, k, done, at, label, cell }] — s/g/p/k = dòng tiền / nhóm / người / nội dung KPI
 * (đã chuẩn hoá), cell = ô gốc trong `streams`. Nhiều dòng trùng hệt nhau (cùng người, cùng KPI) đánh số theo thứ tự: k, k#2…
 */
export function tasksOfDay(streams, day) {
  const out = [];
  const seen = new Map();
  for (const s of streams || []) {
    const sk = loose(s.sourceName || s.name);
    for (const g of s.groups || []) {
      for (const r of g.rows || []) {
        const c = r.cells?.[day];
        if (!c || (!c.kpi && !c.res)) continue;
        const t = { s: sk, g: normKey(g.name), p: normKey(r.person), k: normKey(c.kpi) };
        const n = (seen.get(cellKey(t)) || 0) + 1;
        seen.set(cellKey(t), n);
        if (n > 1) t.k += `#${n}`; // dòng trùng
        out.push({ ...t, done: c.res === 'D', at: c.at || '', label: [s.name, g.name, r.person || '', c.kpi || ''], cell: c });
      }
    }
  }
  return out;
}

/** Khoá 1 ô trong bản chốt / lịch sử: dòng tiền|nhóm|người|nội dung KPI (đã chuẩn hoá). */
export const cellKey = (t) => `${t.s}|${t.g}|${t.p}|${t.k}`;

/** Tìm task trong danh sách: cùng dòng tiền + nhóm + người + nội dung KPI; không có thì cùng dòng tiền + nhóm + người (duy nhất). */
export function findTask(list, t) {
  const exact = list.find((x) => x.s === t.s && x.g === t.g && x.p === t.p && x.k === t.k);
  if (exact) return exact;
  const same = list.filter((x) => x.s === t.s && x.g === t.g && x.p === t.p);
  return same.length === 1 ? same[0] : null;
}

/** Lượt đọc gọn để lưu: { day: [[s, g, p, k, 0/1, label]] }. */
const snapshot = (streams, days) => Object.fromEntries(days.map((day) => [day, tasksOfDay(streams, day).map((t) => [t.s, t.g, t.p, t.k, t.done ? 1 : 0, t.label])]));
const unpack = (rows) => (rows || []).map(([s, g, p, k, d, label]) => ({ s, g, p, k, done: d === 1, label }));

/** Lượt đọc đã lưu -> { cells: {"day|ô": 0/1}, labels: {"day|ô": [dòng tiền, nhóm, người, KPI]} } (danh sách xác nhận, Excel). */
export function obsMaps(obs) {
  const cells = {};
  const labels = {};
  for (const [day, rows] of Object.entries(obs?.days || {})) {
    for (const t of unpack(rows)) {
      cells[`${day}|${cellKey(t)}`] = t.done ? 1 : 0;
      labels[`${day}|${cellKey(t)}`] = t.label;
    }
  }
  return { cells, labels };
}

/**
 * Chốt 1 ngày (hàm thuần).
 * @param prev  task của ngày ở lượt đọc trước, null = không có lượt đọc nào trước hạn
 * @param prevAt giờ (ms) lượt đọc trước
 * @param cur   task của ngày ở lượt đọc hiện tại (có `at` = giờ tick ticks.js đã ghi)
 * basis: exact = trạng thái không đổi giữa 2 lượt; window = có đổi, lượt trước cách hạn ≤ 2 phút (tính theo lượt trước);
 *        gap = lượt trước đã cũ (Worker ngừng chạy); none = chưa có lượt nào trước hạn (mới bật).
 */
export function closeDay(deadline, prev, prevAt, cur) {
  let basis = 'none';
  if (prev) {
    const same = prev.length === cur.length && cur.every((t) => findTask(prev, t)?.done === t.done);
    basis = same ? 'exact' : deadline - prevAt <= TAU_MS ? 'window' : 'gap';
  }
  const data = [];
  const tally = { D: 0, K: 0, U: 0 };
  let lateAt = 0;
  const seen = new Set();
  for (const t of [...(prev || []), ...cur]) {
    const key = cellKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    const atA = prev ? Boolean(findTask(prev, t)?.done) : null;
    const now = findTask(cur, t);
    let v = closeVerdict(atA, Boolean(now?.done), basis);
    // Mới bật: ô có giờ tick (ticks.js) sau hạn -> chưa tick lúc hết hạn (giữ "Hoàn thành trễ hạn" như trước khi có chốt sổ).
    if (v === 'U' && basis === 'none' && Date.parse(now?.at || '') > deadline) { v = 'K'; lateAt++; }
    tally[v]++;
    data.push([t.s, t.g, t.p, t.k, v, t.label]); // label: tên hiển thị lúc chốt (cho file Excel đối soát)
  }
  return { basis, data, tally, lateAt };
}

// ---------- lưu lượt đọc + chốt sổ (gọi trong mỗi lượt đồng bộ, src/kpi/index.js › syncKpi) ----------

/**
 * Lưu lượt đọc hiện tại, ghi lịch sử ô vừa đổi, rồi chốt các ngày đã qua hạn mà chưa chốt. Không gọi Google.
 * @param streams  kết quả parseKpiBook().streams của lượt đọc này (đã có `at` của ticks.js)
 * Lỗi ở đây không làm hỏng lượt đồng bộ: ghi vào nhật ký rồi bỏ qua (lượt sau thử lại).
 */
export async function closeKpi(env, id, streams, now = Date.now()) {
  await ensureTables(env);
  const at = new Date(now).toISOString();
  const logs = [];
  try {
    const row = await env.DB.prepare('SELECT data FROM kpi_close_obs WHERE id = 1').first();
    let prev = null;
    try { prev = row ? JSON.parse(row.data) : null; } catch { prev = null; }
    if (!prev || prev.sheet !== id || !prev.days || !(prev.at <= now)) prev = null; // chưa có / sheet khác / bản cũ
    const days = [...new Set((streams || []).flatMap((s) => (s.days || []).map((d) => d.date)))].sort();
    const obs = { sheet: id, at: now, days: snapshot(streams, days) };

    // Chốt các ngày đã qua hạn mà chưa có bản chốt.
    const { results } = await env.DB.prepare('SELECT day FROM kpi_close WHERE sheet = ?').bind(id).all();
    const closed = new Set(results.map((r) => r.day));
    for (const day of days) {
      const deadline = closeDeadline(day, shiftOf(env));
      if (now < deadline || closed.has(day)) continue;
      const before = prev && prev.at <= deadline ? unpack(prev.days[day]) : null;
      const r = closeDay(deadline, before, prev?.at, tasksOfDay(streams, day));
      // Ghi 1 lần: đã có bản chốt thì giữ nguyên (INSERT OR IGNORE).
      await env.DB.prepare('INSERT OR IGNORE INTO kpi_close (sheet, day, closed_at, deadline, basis, rev_a, rev_b, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, day, at, new Date(deadline).toISOString(), r.basis, before ? prev.at : null, now, JSON.stringify(r.data)).run();
      const read = before ? `đọc ${new Date(prev.at).toISOString()} / ${at}` : `đọc ${at}`;
      logs.push([day, 'close', `Chốt sổ ${day} (căn cứ ${r.basis}, ${read}): ${r.tally.D} đã tick, ${r.tally.K} chưa tick, ${r.tally.U} không xác định (tính đã tick)${r.lateAt ? `; ${r.lateAt} ô tính chưa tick vì giờ tick đã ghi sau hạn` : ''}`]);
    }

    // Lịch sử từng ô: các ô đổi trạng thái so với lượt trước (lượt đầu chỉ ghi mốc).
    const changes = [];
    if (prev) {
      const before = obsMaps(prev).cells;
      for (const [key, done] of Object.entries(obsMaps(obs).cells)) {
        const b = before[key];
        if (b === done || (b === undefined && !done)) continue;
        changes.push([key.slice(0, 10), key.slice(11), done ? 'tick' : 'untick']);
      }
    }
    if (changes.length) {
      await env.DB.batch(changes.slice(0, 500).map(([day, cell, change]) => env.DB.prepare('INSERT INTO kpi_cell_log (sheet, day, cell, at, change, rev) VALUES (?, ?, ?, ?, ?, NULL)').bind(id, day, cell, at, change)));
    }
    // Lưu lượt đọc sau cùng: chốt lỗi giữa chừng thì lượt sau vẫn còn lượt đọc trước hạn để chốt lại.
    await env.DB.prepare('INSERT INTO kpi_close_obs (id, data) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET data = ?1').bind(JSON.stringify(obs)).run();
  } catch (e) {
    logs.push(['', 'error', String(e?.message || e).slice(0, 300)]);
  }
  if (logs.length) {
    await env.DB.batch(logs.map(([day, kind, detail]) => env.DB.prepare('INSERT INTO kpi_audit_log (at, sheet, day, kind, detail) VALUES (?, ?, ?, ?, ?)').bind(at, id, day, kind, detail)));
  }
}

/**
 * Gắn kết quả chốt sổ vào dữ liệu /api/kpi (sửa tại chỗ): mỗi ô của ngày đã chốt có `closed` = 'D' | 'K' | 'U'
 * (lúc 05:00 đã tick / chưa tick / không xác định). Task xuất hiện sau khi chốt -> 'K' (lúc hết hạn chưa có).
 * Trình duyệt (public/kpi-model.js › statusOf) dùng `closed` + trạng thái tick hiện tại để ra Hoàn thành / Trễ hạn / Tồn đọng.
 */
export async function applyCloses(env, id, streams) {
  if (!id || !streams?.length) return streams;
  await ensureTables(env);
  const { results } = await env.DB.prepare('SELECT day, data FROM kpi_close WHERE sheet = ?').bind(id).all();
  const confirms = await activeConfirms(env, id);
  for (const r of results) {
    let list = [];
    try { list = JSON.parse(r.data).map(([s, g, p, k, v]) => ({ s, g, p, k, v })); } catch { continue; }
    for (const t of tasksOfDay(streams, r.day)) {
      const c = t.cell;
      const hit = findTask(list, t);
      c.closed = hit ? hit.v : 'K';
      // Admin đã xác nhận đúng hạn (lỡ bỏ tick trước hạn): tính như lúc 05:00 đã tick.
      const ok = hit && c.closed === 'K' && confirms.get(`${r.day}|${cellKey(hit)}`);
      if (ok) { c.closed = 'D'; c.confirmed = { by: ok.by, at: ok.at, reason: ok.reason }; }
    }
  }
  return streams;
}

/** rev_a / rev_b -> giờ đọc (ISO). Bản chốt cũ (trước 22/11/2026) lưu số phiên bản Google -> trả nguyên số. */
export const readTime = (v) => (v == null ? null : v > 1e12 ? new Date(v).toISOString() : v);

/** GET /api/kpi/audit: các bản chốt sổ + nhật ký (chỉ đọc). */
export async function auditReport(env, id) {
  await ensureTables(env);
  const [closes, logs, obs] = await Promise.all([
    env.DB.prepare('SELECT day, closed_at, deadline, basis, rev_a, rev_b, data FROM kpi_close WHERE sheet = ? ORDER BY day').bind(id).all(),
    env.DB.prepare('SELECT at, day, kind, detail FROM kpi_audit_log WHERE sheet = ? ORDER BY id DESC LIMIT 200').bind(id).all(),
    env.DB.prepare('SELECT data FROM kpi_close_obs WHERE id = 1').first(),
  ]);
  let o = null;
  try { o = obs ? JSON.parse(obs.data) : null; } catch { o = null; }
  return {
    sheet: id,
    lastRead: o?.at ? new Date(o.at).toISOString() : null,
    closes: closes.results.map((c) => {
      let data = [];
      try { data = JSON.parse(c.data); } catch { /* bỏ qua */ }
      const count = { D: 0, K: 0, U: 0 };
      for (const x of data) count[x[4]]++;
      return { day: c.day, closedAt: c.closed_at, deadline: c.deadline, basis: c.basis, readBefore: readTime(c.rev_a), readAfter: readTime(c.rev_b), count, tasks: data.map(([s, g, p, k, v]) => ({ stream: s, group: g, person: p, kpi: k, atDeadline: v })) };
    }),
    log: logs.results,
  };
}

// ---------- xác nhận lại (trang Quản trị, chỉ admin) ----------

export async function activeConfirms(env, id) {
  const { results } = await env.DB.prepare("SELECT day, cell, by, at, reason FROM kpi_confirm WHERE sheet = ? AND revoked_at = '' ORDER BY id").bind(id).all();
  return new Map(results.map((c) => [`${c.day}|${c.cell}`, c]));
}

/**
 * Danh sách cần xác nhận: ô bị chốt "chưa tick" (K) mà lịch sử cho thấy đã từng tick trước hạn. Kèm lịch sử ô, trạng thái hiện tại
 * và xác nhận (nếu có). Hàm thuần, để test.
 * @param closes   [{ day, deadline, data: [[s,g,p,k,v]] }]
 * @param cellLog  [{ day, cell, at, change }]
 * @param obs      obsMaps(lượt đọc gần nhất): { cells: {"day|cell": 0/1}, labels: {"day|cell": [dòng tiền, nhóm, người, KPI]} }
 * @param confirms Map "day|cell" -> xác nhận
 */
export function reviewList(closes, cellLog, obs, confirms) {
  const out = [];
  for (const c of closes) {
    const deadline = Date.parse(c.deadline);
    for (const [s, g, p, k, v] of c.data) {
      if (v !== 'K') continue;
      const cell = `${s}|${g}|${p}|${k}`;
      const hist = cellLog.filter((x) => x.day === c.day && x.cell === cell).sort((a, b) => (a.at < b.at ? -1 : 1));
      if (!hist.some((x) => x.change === 'tick' && Date.parse(x.at) < deadline)) continue;
      const key = `${c.day}|${cell}`;
      const [stream, group, person, kpi] = obs?.labels?.[key] || [s, g, p, k];
      out.push({ day: c.day, cell, deadline: c.deadline, stream, group, person, kpi, nowTicked: obs?.cells?.[key] === 1, history: hist.map(({ at, change }) => ({ at, change })), confirmed: confirms.get(key) || null });
    }
  }
  return out;
}

/** GET / POST / DELETE /api/admin/kpi-review (src/index.js đã chặn người không phải admin). */
export async function handleKpiReview(request, env, url, user) {
  const { kpiSheetId } = await import('./index.js');
  const id = kpiSheetId(env);
  if (!id) return json({ error: 'Đồng bộ Google Sheet KPI đang tắt.' }, 400);
  await ensureTables(env);
  if (request.method === 'GET') {
    const [closes, cellLog, obs] = await Promise.all([
      env.DB.prepare('SELECT day, deadline, data FROM kpi_close WHERE sheet = ? ORDER BY day').bind(id).all(),
      env.DB.prepare('SELECT day, cell, at, change FROM kpi_cell_log WHERE sheet = ? ORDER BY id').bind(id).all(),
      env.DB.prepare('SELECT data FROM kpi_close_obs WHERE id = 1').first(),
    ]);
    let o = null;
    try { o = obs ? JSON.parse(obs.data) : null; } catch { o = null; }
    const list = closes.results.map((c) => { try { return { ...c, data: JSON.parse(c.data) }; } catch { return { ...c, data: [] }; } });
    return json({ items: reviewList(list, cellLog.results, obsMaps(o), await activeConfirms(env, id)) });
  }
  const body = await request.json().catch(() => ({}));
  const day = String(body.day || '');
  const cell = String(body.cell || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !cell) return json({ error: 'Thiếu ngày hoặc ô cần xác nhận.' }, 400);
  const at = new Date().toISOString();
  if (request.method === 'POST') {
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (!reason) return json({ error: 'Cần ghi lý do xác nhận.' }, 400);
    const exist = await env.DB.prepare("SELECT 1 AS ok FROM kpi_confirm WHERE sheet = ? AND day = ? AND cell = ? AND revoked_at = ''").bind(id, day, cell).first();
    if (exist) return json({ error: 'Ô này đã được xác nhận.' }, 409);
    await env.DB.prepare('INSERT INTO kpi_confirm (sheet, day, cell, by, at, reason) VALUES (?, ?, ?, ?, ?, ?)').bind(id, day, cell, user.username, at, reason).run();
    await env.DB.prepare('INSERT INTO kpi_audit_log (at, sheet, day, kind, detail) VALUES (?, ?, ?, ?, ?)').bind(at, id, day, 'confirm', `${user.username} xác nhận đúng hạn: ${cell} — ${reason}`.slice(0, 300)).run();
    await log(env, request, user.username, 'kpi_confirm', `${day} · ${cell} · ${reason}`.slice(0, 300));
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    const { meta } = await env.DB.prepare("UPDATE kpi_confirm SET revoked_by = ?, revoked_at = ? WHERE sheet = ? AND day = ? AND cell = ? AND revoked_at = ''").bind(user.username, at, id, day, cell).run();
    if (!meta.changes) return json({ error: 'Không có xác nhận để huỷ.' }, 404);
    await env.DB.prepare('INSERT INTO kpi_audit_log (at, sheet, day, kind, detail) VALUES (?, ?, ?, ?, ?)').bind(at, id, day, 'unconfirm', `${user.username} huỷ xác nhận: ${cell}`.slice(0, 300)).run();
    await log(env, request, user.username, 'kpi_unconfirm', `${day} · ${cell}`.slice(0, 300));
    return json({ ok: true });
  }
  return json({ error: 'Phương thức không được hỗ trợ.' }, 405);
}

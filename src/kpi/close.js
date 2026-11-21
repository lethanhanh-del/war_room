// CHỐT SỔ KPI lúc 05:00 (KPI-CLOSE).
//
// Hạn của KPI ngày D là 05:00 ngày D+1 (giờ Việt Nam). Đúng hạn, hệ thống ghi lại task nào đã tick, task nào chưa, lưu vào
// D1 (bảng kpi_close) — ghi 1 lần, không sửa. Trạng thái hiển thị lấy từ bản ghi đó + trạng thái tick hiện tại:
//   lúc 05:00 đã tick                      -> Hoàn thành
//   lúc 05:00 chưa tick, hiện vẫn chưa tick -> Tồn đọng (Không đạt)
//   lúc 05:00 chưa tick, hiện đã tick       -> Hoàn thành trễ hạn
// Sửa sheet sau 05:00 (tick, bỏ tick, xoá dòng, Worker ngừng chạy một lúc) không đổi được kết luận đã chốt.
//
// Căn cứ: Google Sheet lưu lịch sử từng lần sửa (phiên bản 1, 2, 3…). Mỗi lượt cron (1 phút), Worker ghi lại "lúc này sheet
// đang ở phiên bản số mấy" (bảng kpi_close_obs). Khi chốt ngày D, Worker lấy nội dung sheet ở PHIÊN BẢN CUỐI TRƯỚC 05:00
// (đọc lại đúng phiên bản đó qua link xuất CSV công khai …/export?format=csv&gid=…&revision=N), nên kể cả lỡ nhịp lúc 05:00
// vẫn biết chính xác lúc hết hạn ô đã tick chưa. Tham số `revision` không có trong tài liệu chính thức của Google (đã kiểm tra
// chạy được 22/11/2026); không đọc được thì chốt theo bản đã đọc gần nhất trước hạn, kèm ghi chú trong nhật ký.
//
// Bảng D1 (tự tạo): kpi_close_obs (quan sát), kpi_close (bản chốt từng ngày), kpi_audit_log (nhật ký, chỉ thêm),
// kpi_cell_log (lịch sử tick / bỏ tick từng ô), kpi_confirm (admin xác nhận đúng hạn).
// API: GET /api/kpi/audit (chỉ đọc); GET/POST/DELETE /api/admin/kpi-review (chỉ admin); GET /api/admin/kpi-close (tải Excel, close-export.js).
//
// XÁC NHẬN LẠI: ô bị chốt "chưa tick" nhưng lịch sử cho thấy ĐÃ TỪNG TICK TRƯỚC HẠN (vd lỡ bỏ tick lúc 04:58) được đưa vào
// danh sách "cần xác nhận" ở trang Quản trị. Admin xem lịch sử ô và bấm "Xác nhận đúng hạn" (kèm lý do) -> ô tính như lúc 05:00
// đã tick. Không tự động (tránh lách: tick sớm rồi bỏ tick khi chưa làm). Mọi lần xác nhận / huỷ đều ghi nhật ký.

import { csvSheet, parseCsv, parseSheetList } from '../excel/gsheet.js';
import { log } from '../db.js';
import { json } from '../http.js';
import { normKey } from '../worksuite/model.js';
import { parseKpiBook } from './sheet.js';

const DUE_HOUR = 5;
const TAU_MS = 2 * 60 * 1000; // quan sát cách hạn ≤ 2 phút coi là "sát hạn"
const TABS_EVERY_MS = 10 * 60 * 1000;
const MAX_INTERVALS = 3000;
const FETCH_TIMEOUT_MS = 15000;

/** Hạn (ms) của KPI ngày `date` = 05:00 ngày hôm sau giờ VN. shiftMin: CHỈ để thử trên máy (KPI_DUE_SHIFT_MIN). */
export const closeDeadline = (date, shiftMin = 0) => Date.parse(`${date}T00:00:00Z`) + (24 + DUE_HOUR - 7) * 3600000 - shiftMin * 60000;

const shiftOf = (env) => Number(env.KPI_DUE_SHIFT_MIN) || 0;
export const loose = (s) => normKey(s).replace(/[^a-z0-9]+/g, '');

const ready = new WeakSet();
export async function ensureTables(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kpi_close_obs (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)'),
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

// ---------- đọc Google Sheet theo phiên bản ----------

const base = (id) => `https://docs.google.com/spreadsheets/d/${id}`;
const get = (url) => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

async function hasRevision(id, gid, rev) {
  const res = await get(`${base(id)}/export?format=csv&gid=${gid}&revision=${rev}`);
  await res.body?.cancel();
  if (res.status === 200 && /text\/csv/.test(res.headers.get('Content-Type') || '')) return true;
  if (res.status === 400 || res.status === 404) return false;
  throw new Error(`Google Sheet trả về lỗi HTTP ${res.status} khi đọc phiên bản ${rev}.`);
}

/** Phiên bản mới nhất. Biết head lần trước thì thường 1 lần gọi; chưa biết thì tăng gấp đôi rồi chia đôi. */
export async function findHead(id, gid, from = 0) {
  let lo = from;
  if (!lo) {
    for (let r = 1; r <= 2 ** 24; r *= 2) {
      if (await hasRevision(id, gid, r)) { lo = r; break; }
    }
    if (!lo) return 0;
  }
  let step = 1;
  let hi = lo + step;
  while (await hasRevision(id, gid, hi)) {
    lo = hi; step *= 2; hi = lo + step;
    if (hi > 2 ** 30) throw new Error('Không xác định được phiên bản mới nhất của Google Sheet.');
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await hasRevision(id, gid, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Các tab của sheet ở phiên bản `rev` (cùng dạng fetchSheetTabs). Tab chưa có ở phiên bản đó -> bỏ qua. */
async function tabsAt(id, tabs, rev) {
  const out = await Promise.all(tabs.map(async ({ name, gid }) => {
    const res = await get(`${base(id)}/export?format=csv&gid=${gid}&revision=${rev}`);
    if (res.status !== 200) { await res.body?.cancel(); return null; }
    return csvSheet(name, parseCsv(await res.text()));
  }));
  return out.filter(Boolean);
}

// ---------- quy tắc chốt sổ (hàm thuần) ----------

/**
 * Chọn căn cứ quanh hạn. intervals = [{ rev, from, to }] (ms, theo from tăng dần): khoảng thời gian thấy phiên bản rev là
 * bản mới nhất. Trả về null nếu chưa có quan sát nào sau hạn (chưa chốt được).
 *   exact  : phiên bản A được thấy cả trước lẫn sau hạn -> biết chính xác lúc hết hạn
 *   window : thấy A lần cuối trong vòng 2 phút trước hạn
 *   gap    : quan sát trước hạn đã cũ (Worker ngừng chạy một lúc)
 *   none   : không có quan sát nào trước hạn (mới bật / mới thêm sheet)
 */
export function evidenceFor(deadline, intervals) {
  let a = null;
  for (const iv of intervals) if (iv.from <= deadline) a = iv;
  if (a && a.to >= deadline) return { A: a.rev, B: a.rev, basis: 'exact' };
  const b = intervals.find((iv) => iv.from > deadline);
  if (!b) return null;
  if (!a) return { A: null, B: b.rev, basis: 'none' };
  return { A: a.rev, B: b.rev, basis: deadline - a.to <= TAU_MS ? 'window' : 'gap' };
}

/**
 * Kết luận 1 task lúc hết hạn: 'D' = đã tick, 'K' = chưa tick, 'U' = không xác định được (tính như đã tick, ghi nhật ký).
 * atA / atB: true = đã tick ở phiên bản A / B, false = chưa (hoặc chưa có task), null = không có phiên bản đó.
 */
export function closeVerdict(atA, atB, basis) {
  if (atA === true) return 'D';
  if (basis === 'exact' || basis === 'window') return 'K';
  return atB === true ? 'U' : 'K';
}

/**
 * Task của 1 ngày: [{ s, g, p, k, done, at, label, cell }] — s/g/p/k = dòng tiền / nhóm / người / nội dung KPI (đã chuẩn hoá),
 * cell = ô gốc trong `streams`. Nhiều dòng trùng hệt nhau (cùng người, cùng nội dung KPI) được đánh số theo thứ tự: k, k#2, k#3…
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
        if (n > 1) t.k += `#${n}`; // KPI-CLOSE: dòng trùng
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

// ---------- quan sát + chốt sổ (gọi trong mỗi lượt đồng bộ, src/kpi/index.js › syncKpi) ----------

/**
 * Ghi quan sát (phiên bản hiện tại) rồi chốt các ngày đã qua hạn mà chưa chốt.
 * @param streams  kết quả parseKpiBook().streams của lượt đọc này (nội dung sheet hiện tại)
 * Lỗi ở đây không làm hỏng lượt đồng bộ: ghi vào nhật ký rồi bỏ qua (lượt sau thử lại).
 */
export async function closeKpi(env, id, streams, now = Date.now(), year) {
  await ensureTables(env);
  const at = new Date(now).toISOString();
  const logs = [];
  try {
    const row = await env.DB.prepare('SELECT data FROM kpi_close_obs WHERE id = 1').first();
    let obs = null;
    try { obs = row ? JSON.parse(row.data) : null; } catch { obs = null; }
    if (!obs || obs.sheet !== id) obs = { sheet: id, head: 0, tabs: [], tabsAt: 0, intervals: [] };
    if (!obs.tabs.length || now - obs.tabsAt > TABS_EVERY_MS) {
      const res = await get(`${base(id)}/htmlview`);
      obs.tabs = parseSheetList(await res.text());
      obs.tabsAt = now;
    }
    if (!obs.tabs.length) throw new Error('Không đọc được danh sách tab của Google Sheet.');
    // Google còn hỗ trợ đọc theo phiên bản (tham số không có trong tài liệu chính thức): phiên bản rất lớn phải bị từ chối.
    if (!obs.revOk) {
      if (await hasRevision(id, obs.tabs[0].gid, 2 ** 31 - 1)) throw new Error('Google không còn hỗ trợ đọc Sheet theo phiên bản: chưa chốt sổ được, cần kiểm tra lại.');
      obs.revOk = true;
    }
    const head = await findHead(id, obs.tabs[0].gid, obs.head);
    const last = obs.intervals[obs.intervals.length - 1];
    if (last && last.rev === head) last.to = now;
    else obs.intervals.push({ rev: head, from: now, to: now });
    obs.head = head;
    if (obs.intervals.length > MAX_INTERVALS) obs.intervals = obs.intervals.slice(-MAX_INTERVALS);
    // Lịch sử từng ô: ghi các ô vừa đổi trạng thái so với lượt trước (lượt đầu chỉ ghi mốc, không ghi thay đổi).
    const current = {};
    const labels = {};
    for (const day of new Set((streams || []).flatMap((s) => (s.days || []).map((d) => d.date)))) {
      for (const t of tasksOfDay(streams, day)) {
        const key = `${day}|${cellKey(t)}`;
        current[key] = t.done ? 1 : 0;
        labels[key] = t.label;
      }
    }
    const changes = [];
    if (obs.cells) {
      for (const [key, done] of Object.entries(current)) {
        const before = obs.cells[key];
        if (before === done || (before === undefined && !done)) continue;
        changes.push([key.slice(0, 10), key.slice(11), done ? 'tick' : 'untick']);
      }
    }
    obs.cells = current;
    obs.labels = labels;
    await env.DB.prepare('INSERT INTO kpi_close_obs (id, data) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET data = ?1').bind(JSON.stringify(obs)).run();
    if (changes.length) {
      await env.DB.batch(changes.slice(0, 500).map(([day, cell, change]) => env.DB.prepare('INSERT INTO kpi_cell_log (sheet, day, cell, at, change, rev) VALUES (?, ?, ?, ?, ?, ?)').bind(id, day, cell, at, change, head)));
    }

    // Chốt các ngày đã qua hạn mà chưa có bản chốt.
    const days = [...new Set((streams || []).flatMap((s) => (s.days || []).map((d) => d.date)))].sort();
    const { results } = await env.DB.prepare('SELECT day FROM kpi_close WHERE sheet = ?').bind(id).all();
    const closed = new Set(results.map((r) => r.day));
    const cache = new Map([[head, streams]]); // nội dung theo phiên bản (bản hiện tại = head)
    const contentAt = async (rev) => {
      if (rev === null) return null;
      if (!cache.has(rev)) cache.set(rev, parseKpiBook(await tabsAt(id, obs.tabs, rev), { year }).streams);
      return cache.get(rev);
    };
    for (const day of days) {
      const deadline = closeDeadline(day, shiftOf(env));
      if (now < deadline || closed.has(day)) continue;
      const ev = evidenceFor(deadline, obs.intervals);
      if (!ev) continue;
      const A = ev.A === null ? null : tasksOfDay(await contentAt(ev.A), day);
      const B = ev.basis === 'exact' || ev.basis === 'window' ? null : tasksOfDay(await contentAt(ev.B), day);
      const all = [...(A || []), ...(B || [])];
      // Căn cứ none (mới bật, chưa có quan sát trước hạn): dùng giờ tick ticks.js đã ghi trước đó — tick sau hạn thì
      // tính lúc hết hạn chưa tick (giữ "Hoàn thành trễ hạn" như trước khi có chốt sổ). Căn cứ gap không dùng: giờ ghi
      // lúc Worker ngừng chạy không đáng tin.
      const cur = ev.basis === 'none' ? tasksOfDay(streams, day) : null;
      const seen = new Set();
      const data = [];
      const tally = { D: 0, K: 0, U: 0 };
      let lateAt = 0;
      for (const t of all) {
        const key = cellKey(t);
        if (seen.has(key)) continue;
        seen.add(key);
        const atA = A ? Boolean(findTask(A, t)?.done) : null;
        const atB = B ? Boolean(findTask(B, t)?.done) : null;
        let v = closeVerdict(atA, atB, ev.basis);
        const seenAt = v === 'U' && cur ? Date.parse(findTask(cur, t)?.at || '') : 0;
        if (seenAt > deadline) { v = 'K'; lateAt++; }
        tally[v]++;
        data.push([t.s, t.g, t.p, t.k, v, t.label]); // label: tên hiển thị lúc chốt (cho file Excel đối soát)
      }
      // Ghi 1 lần: đã có bản chốt thì giữ nguyên (INSERT OR IGNORE).
      await env.DB.prepare('INSERT OR IGNORE INTO kpi_close (sheet, day, closed_at, deadline, basis, rev_a, rev_b, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, day, at, new Date(deadline).toISOString(), ev.basis, ev.A, ev.B, JSON.stringify(data)).run();
      logs.push([day, 'close', `Chốt sổ ${day} (căn cứ ${ev.basis}, phiên bản ${ev.A ?? '—'}${ev.B !== ev.A ? `/${ev.B}` : ''}): ${tally.D} đã tick, ${tally.K} chưa tick, ${tally.U} không xác định (tính đã tick)${lateAt ? `; ${lateAt} ô tính chưa tick vì giờ tick đã ghi sau hạn` : ''}`]);
    }
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
    head: o?.head ?? null,
    observations: (o?.intervals || []).slice(-30).map((iv) => ({ rev: iv.rev, from: new Date(iv.from).toISOString(), to: new Date(iv.to).toISOString() })),
    closes: closes.results.map((c) => {
      let data = [];
      try { data = JSON.parse(c.data); } catch { /* bỏ qua */ }
      const count = { D: 0, K: 0, U: 0 };
      for (const x of data) count[x[4]]++;
      return { day: c.day, closedAt: c.closed_at, deadline: c.deadline, basis: c.basis, revA: c.rev_a, revB: c.rev_b, count, tasks: data.map(([s, g, p, k, v]) => ({ stream: s, group: g, person: p, kpi: k, atDeadline: v })) };
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
 * @param obs      { cells: {"day|cell": 0/1}, labels: {"day|cell": [dòng tiền, nhóm, người, KPI]} }
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
    return json({ items: reviewList(list, cellLog.results, o, await activeConfirms(env, id)) });
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

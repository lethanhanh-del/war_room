// Tự đồng bộ task từ Google Sheet "WR - MASTER TASK" lên dashboard "Tiến độ dòng tiền" (/). Cách đọc sheet: gsheet.js.
//
// Khi nào chạy: mỗi phút (Cron Trigger, wrangler.jsonc) và khi có người đang xem dashboard (GET /api/streams),
// không quá 1 lần mỗi SYNC_EVERY_MS. POST /api/excel/sync: đồng bộ ngay.
// Sheet là nguồn chính: so với dữ liệu đang lưu, khác thì lưu như nạp file tổng (sheet trống -> gỡ task của dòng tiền
// đó; dòng tiền do đồng bộ tạo mà sheet đã bỏ -> gỡ), ghi nhật ký và báo các màn hình tải lại (WebSocket, scope "streams").
// Không khác -> không ghi gì.
//
//   GET  /api/excel/sync    trạng thái đồng bộ
//   POST /api/excel/sync    đồng bộ ngay
//
// Biến cấu hình (tuỳ chọn): EXCEL_SHEET_URL = 1 hoặc nhiều link / ID Google Sheet, cách nhau bởi dấu phẩy hoặc xuống dòng
// (mặc định: WR - MASTER TASK + file phân chia nhiệm vụ WarRoom_CTHomes_Final, xem gsheet.js › DEFAULT_SHEETS); "off" để tắt.
// Sheet task được gộp lại (readSheets). Sheet phân chia nhiệm vụ (DS nhân sự War-Room) thay bảng excel_teams khi khác —
// như nạp file phân chia nhiệm vụ bằng nút "Nạp task Excel".

import { log } from '../db.js';
import { json } from '../http.js';
import { notifyLive } from '../live.js';
import { SHEET_FILE_NAME, readSheets, sharedLoader, sheetIds } from './gsheet.js';
import { sourceUrlOf } from './sharepoint.js';
import { ensureTable as ensureImportsTable, importSummary, planImport, saveImport, sheetOnlyBase } from './index.js';
import { matchStream } from './merge.js';

export const SYNC_EVERY_MS = 20000;
const FORCE_EVERY_MS = 5000;
const SYNC_USER = { username: 'google-sheet', fullName: 'Google Sheet (tự đồng bộ)' };
const TEAMS_FILE_NAME = 'Google Sheet phân chia nhiệm vụ';

let ready = false;
async function ensureTable(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS excel_sync (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        checked_at TEXT NOT NULL DEFAULT '',
        changed_at TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        warnings TEXT NOT NULL DEFAULT '[]',
        total INTEGER NOT NULL DEFAULT 0,
        sheets INTEGER NOT NULL DEFAULT 0
      )`
    ),
    // Bản đọc được gần nhất của từng Google Sheet (JSON {sections, warnings}): khi đồng bộ nhiều sheet mà 1 sheet đọc lỗi,
    // dùng tạm bản này để task của sheet đó không biến mất trong lúc các sheet khác vẫn cập nhật (readSheets › previous).
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS excel_sheet_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        read_at TEXT NOT NULL
      )`
    ),
  ]);
  ready = true;
}

/** id Google Sheet -> { json, book } của lần đọc được gần nhất. */
async function cachedBooks(env) {
  const { results } = await env.DB.prepare('SELECT id, data FROM excel_sheet_cache').all();
  const out = new Map();
  for (const r of results) {
    try {
      out.set(r.id, { json: r.data, book: JSON.parse(r.data) });
    } catch { /* bản lưu hỏng: coi như chưa có */ }
  }
  return out;
}

/** Lưu bản vừa đọc được của các sheet có nội dung khác bản đang lưu. */
async function saveCache(env, fresh, cache, now) {
  const at = new Date(now).toISOString();
  const rows = [...fresh]
    .map(([id, b]) => [id, JSON.stringify({ sections: b.sections, warnings: b.warnings })])
    .filter(([id, data]) => cache.get(id)?.json !== data);
  if (!rows.length) return;
  await env.DB.batch(rows.map(([id, data]) => env.DB.prepare(
    'INSERT INTO excel_sheet_cache (id, data, read_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?2, read_at = ?3'
  ).bind(id, data, at)));
}

/** Giành lượt đồng bộ: chỉ 1 lượt trong mỗi khoảng minGapMs, kể cả khi cron và nhiều người xem gọi cùng lúc. */
async function claim(env, minGapMs, now) {
  const { meta } = await env.DB.prepare(
    `INSERT INTO excel_sync (id, checked_at) VALUES (1, ?1)
     ON CONFLICT(id) DO UPDATE SET checked_at = ?1 WHERE excel_sync.checked_at < ?2`
  ).bind(new Date(now).toISOString(), new Date(now - minGapMs).toISOString()).run();
  return meta.changes > 0;
}

// Dòng tiền thuộc quyền đồng bộ: do đồng bộ ghi, hoặc nạp tay từ chính file tổng (bản tải về của Google Sheet này).
const owned = (r) => r.uploaded_by === SYNC_USER.username || /master[\s_.-]*task/i.test(r.file_name || '');

/** Dữ liệu đang lưu có khớp sheet không; orphans = dòng tiền thuộc quyền đồng bộ mà sheet đã bỏ / đổi tên. */
async function diff(env, plan) {
  const { results } = await env.DB.prepare('SELECT stream_key, title, code, name, pic, as_of, tasks, uploaded_by, file_name FROM excel_imports').all();
  const have = new Map(results.map((r) => [r.stream_key, r]));
  const stale = plan.some(({ key, sec }) => {
    const r = have.get(key);
    return !r || r.title !== sec.title || r.code !== sec.code || r.name !== sec.name || r.pic !== sec.pic
      || r.as_of !== sec.asOf || r.tasks !== JSON.stringify(sec.tasks);
  });
  const inPlan = new Set(plan.map((p) => p.key));
  const orphans = results.filter((r) => !inPlan.has(r.stream_key) && owned(r)).map((r) => r.stream_key);
  return { changed: stale || orphans.length > 0, orphans };
}

/**
 * Phân chia nhóm từ Google Sheet: thay toàn bộ bảng excel_teams khi khác dữ liệu đang lưu (giống nạp file phân chia nhiệm vụ:
 * chỉ giữ khối khớp 1 dòng tiền trên dashboard hoặc được tạo thẻ mới, vd bỏ "Cố vấn, chỉ đạo", "Nhóm IT").
 * @param choices  dòng tiền từ sheet task: [{ id, name, fullName, code }]
 * @returns {Promise<boolean>} có thay đổi
 */
async function syncTeams(env, roster, choices, now) {
  const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const sections = roster.sections.filter((sec) => sec.canCreate || matchStream(choices, sec));
  if (!sections.length) return false;
  const rows = sections.map((sec) => [sec.key, sec.name, sec.code, sec.raw, sec.canCreate ? 1 : 0, JSON.stringify(sec.groups), sec.memberCount]).sort(byKey);
  const { results } = await env.DB.prepare('SELECT team_key, name, code, raw, can_create, groups, member_count FROM excel_teams').all();
  const have = results.map((r) => [r.team_key, r.name, r.code, r.raw, Number(r.can_create), r.groups, Number(r.member_count)]).sort(byKey);
  if (JSON.stringify(have) === JSON.stringify(rows)) return false;
  const at = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM excel_teams'),
    ...rows.map((v) => env.DB.prepare(
      `INSERT INTO excel_teams (team_key, name, code, raw, can_create, groups, member_count, file_name, uploaded_by, uploaded_by_name, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(...v, TEAMS_FILE_NAME, SYNC_USER.username, SYNC_USER.fullName, at)),
  ]);
  const summary = sections.map((sec) => `${sec.raw}: ${sec.groups.length} nhóm`).join('; ');
  await log(env, new Request('https://sync.invalid/'), SYNC_USER.username, 'excel_teams', `${TEAMS_FILE_NAME} · ${summary}`.slice(0, 1000));
  return true;
}

const errText = (e) => String(e?.name === 'TimeoutError' ? 'Google Sheet không phản hồi (quá 15 giây).' : e?.message || e).slice(0, 300);

/**
 * Đọc sheet và lưu nếu khác dữ liệu đang có.
 * @returns {Promise<{off?: true, skipped?: true, error?: string, changed?: boolean, total?: number}>}
 */
export async function syncSheet(env, { force = false, now = Date.now(), load } = {}) {
  const ids = sheetIds(env); // WR - MASTER TASK + sheet thứ 2 (EXCEL_SHEET_URL)
  if (!ids.length) return { off: true };
  await ensureTable(env);
  await ensureImportsTable(env); // database mới (cron chạy trước khi ai mở trang): diff() đọc excel_imports
  if (!(await claim(env, force ? FORCE_EVERY_MS : SYNC_EVERY_MS, now))) return { skipped: true };
  try {
    const cache = await cachedBooks(env);
    const loader = load || sharedLoader(env);
    const book = await readSheets(ids, { now, load: loader, previous: new Map([...cache].map(([id, c]) => [id, c.book])) });
    const total = book.sections.reduce((n, s) => n + s.tasks.length, 0);
    let changed = false;
    let notes = book.warnings;
    let choices = [];
    // Chỉ đồng bộ task khi có ít nhất 1 sheet task (mới đọc hoặc bản trước): tránh gỡ hết task khi chỉ còn sheet phân chia nhóm.
    if (book.taskSheets) {
      const planned = await planImport(env, book, async () => sheetOnlyBase()); // không kết nối Worksuite
      if (planned.error) throw new Error(planned.error);
      notes = planned.warnings;
      choices = planned.plan.map(({ key, sec }) => ({ id: key, name: sec.name, fullName: sec.title, code: sec.code }));
      const { changed: stale, orphans } = await diff(env, planned.plan);
      if (stale) {
        const saved = await saveImport(env, planned.plan, { fileName: SHEET_FILE_NAME, user: SYNC_USER, now, keepEmpty: true });
        if (saved.error) throw new Error(saved.error);
        if (orphans.length) await env.DB.batch(orphans.map((k) => env.DB.prepare('DELETE FROM excel_imports WHERE stream_key = ?').bind(k)));
        await log(env, new Request('https://sync.invalid/'), SYNC_USER.username, 'excel_sync', importSummary(SHEET_FILE_NAME, saved));
        changed = true;
      }
    }
    if (book.roster && (await syncTeams(env, book.roster, choices, now))) changed = true;
    if (changed) await notifyLive(env, { scope: 'streams' });
    await saveCache(env, book.fresh, cache, now);
    const warnings = JSON.stringify([...notes].slice(0, 20).map((w) => String(w).slice(0, 300)));
    await env.DB.prepare(`UPDATE excel_sync SET error = '', warnings = ?, total = ?, sheets = ?${changed ? ', changed_at = ?' : ''} WHERE id = 1`)
      .bind(warnings, total, book.sections.length, ...(changed ? [new Date(now).toISOString()] : []))
      .run();
    return { changed, total };
  } catch (e) {
    const error = errText(e);
    await env.DB.prepare('UPDATE excel_sync SET error = ? WHERE id = 1').bind(error).run().catch(() => {});
    return { error };
  }
}

/** Trạng thái cho dashboard (trường sheetSync của /api/streams); null = đồng bộ đang tắt. */
export async function sheetSyncStatus(env) {
  const ids = sheetIds(env);
  if (!ids.length) return null;
  const urls = ids.map((id) => sourceUrlOf(id));
  const status = { sheetUrl: urls[0], sheetUrls: urls, checkedAt: '', changedAt: '', error: '', warnings: [], total: 0, sheets: 0 };
  try {
    await ensureTable(env);
    const r = await env.DB.prepare('SELECT checked_at, changed_at, error, warnings, total, sheets FROM excel_sync WHERE id = 1').first();
    if (r) {
      let warnings = [];
      try { warnings = JSON.parse(r.warnings); } catch { /* bỏ qua */ }
      Object.assign(status, { checkedAt: r.checked_at, changedAt: r.changed_at, error: r.error, warnings, total: r.total, sheets: r.sheets });
    }
  } catch (e) {
    status.error = `Không đọc được trạng thái đồng bộ: ${errText(e)}`;
  }
  return status;
}

export async function handleSheetSync(request, env) {
  if (request.method === 'GET') return json({ status: await sheetSyncStatus(env) });
  if (request.method !== 'POST') return json({ error: 'Phương thức không được hỗ trợ.' }, 405);
  const r = await syncSheet(env, { force: true });
  if (r.off) return json({ error: 'Đồng bộ Google Sheet đang tắt (EXCEL_SHEET_URL=off).' }, 400);
  return json({ ...r, status: await sheetSyncStatus(env) }, r.error ? 502 : 200);
}

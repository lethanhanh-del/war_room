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
// (mặc định: WR - MASTER TASK + sheet thứ 2, xem gsheet.js › DEFAULT_SHEETS); "off" để tắt. Nhiều sheet được gộp lại (readSheets).

import { log } from '../db.js';
import { json } from '../http.js';
import { notifyLive } from '../live.js';
import { SHEET_FILE_NAME, readSheets, sheetIds } from './gsheet.js';
import { ensureTable as ensureImportsTable, importSummary, planImport, saveImport, sheetOnlyBase } from './index.js';

export const SYNC_EVERY_MS = 20000;
const FORCE_EVERY_MS = 5000;
const SYNC_USER = { username: 'google-sheet', fullName: 'Google Sheet (tự đồng bộ)' };

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

const errText = (e) => String(e?.name === 'TimeoutError' ? 'Google Sheet không phản hồi (quá 15 giây).' : e?.message || e).slice(0, 300);

/**
 * Đọc sheet và lưu nếu khác dữ liệu đang có.
 * @returns {Promise<{off?: true, skipped?: true, error?: string, changed?: boolean, total?: number}>}
 */
export async function syncSheet(env, { force = false, now = Date.now() } = {}) {
  const ids = sheetIds(env); // WR - MASTER TASK + sheet thứ 2 (EXCEL_SHEET_URL)
  if (!ids.length) return { off: true };
  await ensureTable(env);
  await ensureImportsTable(env); // database mới (cron chạy trước khi ai mở trang): diff() đọc excel_imports
  if (!(await claim(env, force ? FORCE_EVERY_MS : SYNC_EVERY_MS, now))) return { skipped: true };
  try {
    const cache = await cachedBooks(env);
    const book = await readSheets(ids, { now, previous: new Map([...cache].map(([id, c]) => [id, c.book])) });
    const planned = await planImport(env, book, async () => sheetOnlyBase()); // không kết nối Worksuite
    if (planned.error) throw new Error(planned.error);
    const total = book.sections.reduce((n, s) => n + s.tasks.length, 0);
    const { changed, orphans } = await diff(env, planned.plan);
    if (changed) {
      const saved = await saveImport(env, planned.plan, { fileName: SHEET_FILE_NAME, user: SYNC_USER, now, keepEmpty: true });
      if (saved.error) throw new Error(saved.error);
      if (orphans.length) await env.DB.batch(orphans.map((k) => env.DB.prepare('DELETE FROM excel_imports WHERE stream_key = ?').bind(k)));
      await log(env, new Request('https://sync.invalid/'), SYNC_USER.username, 'excel_sync', importSummary(SHEET_FILE_NAME, saved));
      await notifyLive(env, { scope: 'streams' });
    }
    await saveCache(env, book.fresh, cache, now);
    const warnings = JSON.stringify([...planned.warnings].slice(0, 20).map((w) => String(w).slice(0, 300)));
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
  const urls = ids.map((id) => `https://docs.google.com/spreadsheets/d/${id}/edit`);
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

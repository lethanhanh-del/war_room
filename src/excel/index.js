// Nạp task từ file Excel lên dashboard "Tiến độ dòng tiền". Dữ liệu lưu trong D1 (bảng excel_imports),
// mỗi dòng tiền 1 bản ghi: nạp lại file của cùng dòng tiền sẽ thay toàn bộ task Excel cũ của dòng tiền đó.
//
//   GET    /api/excel                         danh sách file đã nạp
//   POST   /api/excel?preview=1[&target=…]    body = nội dung file .xlsx -> xem trước, chưa lưu
//   POST   /api/excel[?target=…]              đọc và lưu. File tổng (mỗi sheet 1 dòng tiền) gắn từng sheet vào thẻ cùng tên;
//                                             sheet trống -> gỡ task Excel cũ của dòng tiền đó. File 1 dòng tiền: target =
//                                             id thẻ Worksuite | "new" (thẻ riêng) | bỏ trống = tự nhận theo tên
//   DELETE /api/excel?key=…                   gỡ task Excel của 1 dòng tiền
// Header X-File-Name: tên file (encodeURIComponent). Header này cũng buộc trình duyệt gửi preflight khi gọi
// từ trang khác, nên trang lạ không thể tự gửi file bằng phiên đăng nhập của người dùng.
//
// Biến cấu hình (tuỳ chọn): WARROOM_START, WARROOM_END (YYYY-MM-DD) — thời hạn War Room để kiểm
// nguyên tắc STRICT TIME BOX. Mặc định 2026-11-21 → 2026-11-25 (theo lịch trực trong file nhân sự War Room).

import { log } from '../db.js';
import { json } from '../http.js';
import { normKey } from '../worksuite/model.js';
import { matchStream, mergeExcelImports, previewImport } from './merge.js';
import { parseWorkbookFile } from './tasks.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 1500000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function warRoomPeriod(env = {}) {
  const start = String(env.WARROOM_START || '').trim();
  const end = String(env.WARROOM_END || '').trim();
  return { start: DATE_RE.test(start) ? start : '2026-11-21', end: DATE_RE.test(end) ? end : '2026-11-25' };
}

let ready = false;
async function ensureTable(env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS excel_imports (
      stream_key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      pic TEXT NOT NULL DEFAULT '',
      as_of TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      task_count INTEGER NOT NULL DEFAULT 0,
      tasks TEXT NOT NULL,
      uploaded_by TEXT NOT NULL DEFAULT '',
      uploaded_by_name TEXT NOT NULL DEFAULT '',
      uploaded_at TEXT NOT NULL
    )`
  ).run();
  ready = true;
}

const fromRow = (r) => ({
  key: r.stream_key,
  title: r.title,
  code: r.code,
  name: r.name,
  pic: r.pic,
  asOf: r.as_of,
  fileName: r.file_name,
  count: r.task_count,
  uploadedBy: r.uploaded_by,
  uploadedByName: r.uploaded_by_name,
  uploadedAt: r.uploaded_at,
});

export async function listImports(env, { withTasks = true } = {}) {
  await ensureTable(env);
  const cols = 'stream_key, title, code, name, pic, as_of, file_name, task_count, uploaded_by, uploaded_by_name, uploaded_at';
  const { results } = await env.DB.prepare(`SELECT ${cols}${withTasks ? ', tasks' : ''} FROM excel_imports ORDER BY code, title`).all();
  return results.map((r) => {
    const out = fromRow(r);
    if (withTasks) {
      try { out.tasks = JSON.parse(r.tasks); } catch { out.tasks = []; }
    }
    return out;
  });
}

async function loadUsers(env) {
  try {
    const { results } = await env.DB.prepare('SELECT full_name, title, department FROM users').all();
    return results;
  } catch {
    return []; // bảng users chưa có (môi trường thử): bỏ qua phần tra chức danh
  }
}

/** Gắn task Excel vào kết quả /api/streams. Lỗi D1 không làm hỏng dashboard: chỉ thêm 1 cảnh báo. */
export async function withExcel(env, data, now = Date.now()) {
  try {
    const imports = await listImports(env);
    if (!imports.length) return data;
    const users = await loadUsers(env);
    return { ...mergeExcelImports(data, imports, { now, period: warRoomPeriod(env), users }), warRoom: warRoomPeriod(env) };
  } catch (e) {
    return { ...data, warnings: [...(data.warnings || []), `Không đọc được task nạp từ Excel: ${e?.message || e}`] };
  }
}

function cleanFileName(raw) {
  let s = '';
  try { s = decodeURIComponent(String(raw || '')); } catch { s = String(raw || ''); }
  return s.split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').trim().slice(0, 150);
}

/**
 * @param getWorksuite  (env) => Promise<kết quả getStreams()> — chỉ dữ liệu Worksuite, chưa gắn Excel
 */
export async function handleExcel(request, env, url, user, getWorksuite) {
  await ensureTable(env);

  if (request.method === 'GET') {
    return json({ imports: await listImports(env, { withTasks: false }), warRoom: warRoomPeriod(env) });
  }

  if (request.method === 'DELETE') {
    const key = String(url.searchParams.get('key') || '');
    const row = await env.DB.prepare('SELECT title, task_count FROM excel_imports WHERE stream_key = ?').bind(key).first();
    if (!row) return json({ error: 'Không tìm thấy file đã nạp.' }, 404);
    await env.DB.prepare('DELETE FROM excel_imports WHERE stream_key = ?').bind(key).run();
    await log(env, request, user.username, 'excel_remove', `${row.title} · ${row.task_count} task`);
    return json({ ok: true });
  }

  if (request.method !== 'POST') return json({ error: 'Phương thức không được hỗ trợ.' }, 405);
  if (!request.headers.get('X-File-Name')) return json({ error: 'Thiếu tên file (header X-File-Name).' }, 400);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_FILE_BYTES) return json({ error: 'File lớn hơn 5 MB.' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: 'Chưa chọn file.' }, 400);
  if (bytes.length > MAX_FILE_BYTES) return json({ error: 'File lớn hơn 5 MB.' }, 413);

  const fileName = cleanFileName(request.headers.get('X-File-Name'));
  if (!/\.xlsx$/i.test(fileName)) return json({ error: 'Chỉ nhận file Excel .xlsx. File .xls cũ hãy mở bằng Excel rồi lưu lại dạng .xlsx.' }, 400);
  const now = Date.now();
  let book;
  try {
    book = await parseWorkbookFile(bytes, { fileName, now });
  } catch (e) {
    return json({ error: `Không đọc được file: ${e?.message || e}` }, 400);
  }

  // Chọn thẻ dòng tiền cho từng phần (sheet) của file.
  const ws = await getWorksuite(env).catch(() => null);
  const choices = (ws?.streams || []).map((s) => ({ id: s.id, name: s.name, fullName: s.fullName }));
  const single = book.sections.length === 1;
  const target = single ? String(url.searchParams.get('target') || '') : '';
  const ownKey = (sec) => `xl:${sec.code || normKey(sec.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'khong-ten'}`;
  const warnings = [...book.warnings];
  const used = new Map();
  const plan = [];
  for (const sec of book.sections) {
    let match = null;
    let key;
    if (target === 'new') key = ownKey(sec);
    else if (target) {
      match = choices.find((c) => c.id === target) || null;
      if (!match) return json({ error: 'Dòng tiền đã chọn không còn trên Worksuite. Tải lại trang rồi thử lại.' }, 400);
      key = match.id;
    } else {
      match = matchStream(choices, sec);
      key = match ? match.id : ownKey(sec);
    }
    if (used.has(key)) {
      warnings.push(`Sheet “${sec.sheet}” cùng dòng tiền với sheet “${used.get(key)}” — bỏ qua sheet “${sec.sheet}”.`);
      continue;
    }
    used.set(key, sec.sheet);
    plan.push({ sec, key, match });
  }

  const existingRows = await listImports(env, { withTasks: false });
  const existing = new Map(existingRows.map((r) => [r.key, r]));
  const period = warRoomPeriod(env);

  if (url.searchParams.get('preview') === '1') {
    const users = await loadUsers(env);
    return json({
      preview: true,
      fileName,
      format: book.format,
      warnings,
      warRoom: period,
      choices,
      worksuiteError: ws?.error || (ws?.mode === 'unconfigured' ? 'Chưa kết nối Worksuite' : ''),
      sections: plan.map(({ sec, key, match }) => {
        const { counts, issues, tasks } = previewImport(sec, { now, period, users, key });
        const ex = existing.get(key);
        return {
          sheet: sec.sheet,
          title: sec.title,
          code: sec.code,
          name: sec.name,
          pic: sec.pic,
          asOf: sec.asOf,
          counts,
          issues,
          tasks,
          target: { key, streamId: match?.id || '', streamName: match?.fullName || match?.name || '' },
          existing: ex ? { title: ex.title, fileName: ex.fileName, count: ex.count, uploadedBy: ex.uploadedByName || ex.uploadedBy, uploadedAt: ex.uploadedAt } : null,
        };
      }),
    });
  }

  const at = new Date(now).toISOString();
  const statements = [];
  const results = [];
  for (const { sec, key, match } of plan) {
    const streamName = match?.fullName || match?.name || sec.title;
    if (!sec.tasks.length) {
      // File tổng: sheet của dòng tiền này đã trống -> gỡ task Excel cũ (nếu có).
      if (existing.has(key)) {
        statements.push(env.DB.prepare('DELETE FROM excel_imports WHERE stream_key = ?').bind(key));
        results.push({ key, title: sec.title, count: 0, streamName, removed: true });
      }
      continue;
    }
    const tasksJson = JSON.stringify(sec.tasks);
    if (tasksJson.length > MAX_JSON_BYTES) return json({ error: `${sec.title}: quá nhiều nội dung để lưu. Hãy bớt số dòng hoặc rút gọn ghi chú.` }, 413);
    statements.push(
      env.DB.prepare(
        `INSERT INTO excel_imports (stream_key, title, code, name, pic, as_of, file_name, task_count, tasks, uploaded_by, uploaded_by_name, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stream_key) DO UPDATE SET title = excluded.title, code = excluded.code, name = excluded.name, pic = excluded.pic,
           as_of = excluded.as_of, file_name = excluded.file_name, task_count = excluded.task_count, tasks = excluded.tasks,
           uploaded_by = excluded.uploaded_by, uploaded_by_name = excluded.uploaded_by_name, uploaded_at = excluded.uploaded_at`
      ).bind(key, sec.title, sec.code, sec.name, sec.pic, sec.asOf, fileName, sec.tasks.length, tasksJson, user.username, user.fullName || '', at)
    );
    results.push({ key, title: sec.title, count: sec.tasks.length, streamName });
  }
  if (statements.length) await env.DB.batch(statements);
  const total = results.reduce((n, r) => n + r.count, 0);
  await log(env, request, user.username, 'excel_import', `${fileName} · ${total} task · ${results.map((r) => `${r.title} → ${r.removed ? 'gỡ' : r.streamName}`).join('; ')}`.slice(0, 1000));
  return json({ ok: true, total, results });
}

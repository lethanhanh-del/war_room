// Nạp task từ file Excel lên dashboard "Tiến độ dòng tiền". Dữ liệu lưu trong D1 (bảng excel_imports),
// mỗi dòng tiền 1 bản ghi: nạp lại file của cùng dòng tiền sẽ thay toàn bộ task Excel cũ của dòng tiền đó.
//
//   GET    /api/excel                         danh sách file đã nạp
//   POST   /api/excel?preview=1[&target=…]    body = nội dung file .xlsx -> xem trước, chưa lưu
//   POST   /api/excel[?target=…]              đọc và lưu. File tổng (mỗi sheet 1 dòng tiền) gắn từng sheet vào thẻ cùng tên;
//                                             sheet trống -> gỡ task Excel cũ của dòng tiền đó. File 1 dòng tiền: target =
//                                             id thẻ Worksuite | "new" (thẻ riêng) | bỏ trống = tự nhận theo tên
//   DELETE /api/excel?key=…                   gỡ task Excel của 1 dòng tiền
//   DELETE /api/excel/teams                   gỡ phân chia nhóm
// File phân chia nhiệm vụ (sheet "DS nhân sự War-Room": Dòng tiền · Thành viên · Đội trưởng/Đội phó · Nhiệm vụ thực hiện)
// cũng nạp qua POST /api/excel: tự nhận ra, lưu vào bảng excel_teams (nhóm, PIC, nhiệm vụ từng thành viên) và thay toàn bộ
// phân chia cũ. Task vẫn lấy từ Google Sheet WR - MASTER TASK (sheet-sync.js).
// Header X-File-Name: tên file (encodeURIComponent). Header này cũng buộc trình duyệt gửi preflight khi gọi
// từ trang khác, nên trang lạ không thể tự gửi file bằng phiên đăng nhập của người dùng.
//
// Biến cấu hình (tuỳ chọn): WARROOM_START, WARROOM_END (YYYY-MM-DD) — thời hạn War Room để kiểm
// nguyên tắc STRICT TIME BOX. Mặc định 2026-11-21 → 2026-11-25 (theo lịch trực trong file nhân sự War Room).

import { log } from '../db.js';
import { json } from '../http.js';
import { notifyLive } from '../live.js';
import { normKey } from '../worksuite/model.js';
import { matchStream, mergeExcelImports, mergeTeams, previewImport } from './merge.js';
import { extractRoster, isRoster } from './roster.js';
import { extractWorkbook } from './tasks.js';
import { readXlsx } from './xlsx.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 1500000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Nền dữ liệu của dashboard "Tiến độ dòng tiền": KHÔNG kết nối CT Worksuite nữa (từ 21/11/2026), mọi thẻ dòng tiền
 * và task đến từ Google Sheet WR - MASTER TASK (sheet-sync.js) và file Excel / file phân chia nạp tay.
 * Cùng dạng với kết quả cũ của getStreams() khi chưa cấu hình Worksuite, nên giao diện không phải đổi.
 */
export function sheetOnlyBase(now = Date.now()) {
  return { mode: 'unconfigured', refreshSeconds: 60, syncedAt: null, now, warnings: [], project: null, summary: null, streams: [], otherGroups: [] };
}

export function warRoomPeriod(env = {}) {
  const start = String(env.WARROOM_START || '').trim();
  const end = String(env.WARROOM_END || '').trim();
  return { start: DATE_RE.test(start) ? start : '2026-11-21', end: DATE_RE.test(end) ? end : '2026-11-25' };
}

let ready = false;
export async function ensureTable(env) {
  if (ready) return;
  await env.DB.batch([env.DB.prepare(
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
  ), env.DB.prepare(
    // Phân chia nhóm theo dòng tiền (file phân chia nhiệm vụ): groups = [{ lead, mainTask, members }]
    `CREATE TABLE IF NOT EXISTS excel_teams (
      team_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      raw TEXT NOT NULL DEFAULT '',
      can_create INTEGER NOT NULL DEFAULT 0,
      groups TEXT NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 0,
      file_name TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL DEFAULT '',
      uploaded_by_name TEXT NOT NULL DEFAULT '',
      uploaded_at TEXT NOT NULL
    )`
  )]);
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

export async function listTeams(env) {
  await ensureTable(env);
  const { results } = await env.DB.prepare('SELECT * FROM excel_teams ORDER BY code, name').all();
  return results.map((r) => {
    let groups = [];
    try { groups = JSON.parse(r.groups); } catch { groups = []; }
    return {
      key: r.team_key, name: r.name, code: r.code, raw: r.raw, canCreate: Boolean(r.can_create), groups, memberCount: r.member_count,
      fileName: r.file_name, uploadedBy: r.uploaded_by, uploadedByName: r.uploaded_by_name, uploadedAt: r.uploaded_at,
    };
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

/** Gắn task Excel và phân chia nhóm vào kết quả /api/streams. Lỗi D1 không làm hỏng dashboard: chỉ thêm 1 cảnh báo. */
export async function withExcel(env, data, now = Date.now()) {
  try {
    const [imports, teams] = await Promise.all([listImports(env), listTeams(env)]);
    let out = data;
    if (imports.length) out = { ...mergeExcelImports(out, imports, { now, period: warRoomPeriod(env), users: await loadUsers(env) }), warRoom: warRoomPeriod(env) };
    if (teams.length) out = mergeTeams(out, teams);
    return out;
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
 * @param getWorksuite  (env) => Promise<nền dữ liệu> — giờ luôn là sheetOnlyBase() (không còn kết nối Worksuite)
 */
export async function handleExcel(request, env, url, user, getWorksuite) {
  await ensureTable(env);

  if (url.pathname === '/api/excel/teams') {
    if (request.method !== 'DELETE') return json({ error: 'Phương thức không được hỗ trợ.' }, 405);
    const { meta } = await env.DB.prepare('DELETE FROM excel_teams').run();
    await log(env, request, user.username, 'excel_teams_remove', `gỡ phân chia nhóm của ${meta?.changes || 0} dòng tiền`);
    await notifyLive(env, { scope: 'streams' });
    return json({ ok: true, removed: meta?.changes || 0 });
  }

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
    const raw = await readXlsx(bytes);
    // File phân chia nhiệm vụ (DS nhân sự War-Room): nhóm, PIC, nhiệm vụ từng thành viên.
    if (isRoster(raw)) return await handleRoster(request, env, url, user, getWorksuite, { book: raw, fileName, now });
    book = extractWorkbook(raw, { fileName, now });
  } catch (e) {
    return json({ error: `Không đọc được file: ${e?.message || e}` }, 400);
  }

  const planned = await planImport(env, book, getWorksuite, String(url.searchParams.get('target') || ''));
  if (planned.error) return json({ error: planned.error }, 400);
  const { ws, choices, plan, warnings } = planned;

  if (url.searchParams.get('preview') === '1') {
    const existing = new Map((await listImports(env, { withTasks: false })).map((r) => [r.key, r]));
    const period = warRoomPeriod(env);
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

  const saved = await saveImport(env, plan, { fileName, user, now });
  if (saved.error) return json({ error: saved.error }, saved.status);
  await log(env, request, user.username, 'excel_import', importSummary(fileName, saved));
  await notifyLive(env, { scope: 'streams' });
  return json({ ok: true, total: saved.total, results: saved.results });
}

/** Nạp file phân chia nhiệm vụ: xem trước, hoặc thay toàn bộ phân chia nhóm cũ. */
async function handleRoster(request, env, url, user, getWorksuite, { book, fileName, now }) {
  const roster = extractRoster(book);
  // So với các thẻ đang hiện trên dashboard (Worksuite + task từ Google Sheet / file), không chỉ Worksuite.
  const ws = await getWorksuite(env).catch(() => null);
  const shown = await withExcel(env, ws || { mode: 'unconfigured', streams: [], summary: null, otherGroups: [], warnings: [] }, now);
  const streams = (shown.streams || []).filter((s) => !String(s.id).startsWith('team:'));
  const sections = [];
  const skipped = [];
  for (const sec of roster.sections) {
    const match = matchStream(streams, sec);
    if (match || sec.canCreate) sections.push({ ...sec, match });
    else skipped.push(sec.raw);
  }
  if (!sections.length) return json({ error: 'File phân chia không có dòng tiền nào khớp với dashboard.' }, 400);

  if (url.searchParams.get('preview') === '1') {
    return json({
      preview: true,
      kind: 'roster',
      fileName,
      warnings: roster.warnings,
      skipped,
      existing: (await listTeams(env)).length,
      sections: sections.map(({ match, ...sec }) => ({ ...sec, target: { streamId: match?.id || '', streamName: match ? match.fullName || match.name : '' } })),
    });
  }

  const at = new Date(now).toISOString();
  const statements = [env.DB.prepare('DELETE FROM excel_teams')];
  for (const sec of sections) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO excel_teams (team_key, name, code, raw, can_create, groups, member_count, file_name, uploaded_by, uploaded_by_name, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(sec.key, sec.name, sec.code, sec.raw, sec.canCreate ? 1 : 0, JSON.stringify(sec.groups), sec.memberCount, fileName, user.username, user.fullName || '', at)
    );
  }
  await env.DB.batch(statements);
  const results = sections.map((sec) => ({ key: `team:${sec.key}`, title: sec.raw, groups: sec.groups.length, members: sec.memberCount, streamName: sec.match ? sec.match.fullName || sec.match.name : sec.raw, streamId: sec.match?.id || `team:${sec.key}` }));
  await log(env, request, user.username, 'excel_teams', `${fileName} · ${results.map((r) => `${r.title}: ${r.groups} nhóm`).join('; ')}`.slice(0, 1000));
  await notifyLive(env, { scope: 'streams' });
  return json({ ok: true, kind: 'roster', results });
}

export const importSummary = (fileName, saved) =>
  `${fileName} · ${saved.total} task · ${saved.results.map((r) => `${r.title} → ${r.removed ? 'gỡ' : r.streamName}`).join('; ')}`.slice(0, 1000);

/**
 * Chọn thẻ dòng tiền cho từng phần (sheet) của file. Dùng chung cho "Nạp task Excel" và đồng bộ Google Sheet.
 * @param target  chỉ áp dụng cho file 1 dòng tiền: id thẻ Worksuite | "new" | "" (tự nhận theo tên)
 * @returns {Promise<{ error: string } | { ws, choices, plan: {sec, key, match}[], warnings: string[] }>}
 */
export async function planImport(env, book, getWorksuite, target = '') {
  const ws = await getWorksuite(env).catch(() => null);
  const choices = (ws?.streams || []).map((s) => ({ id: s.id, name: s.name, fullName: s.fullName }));
  if (book.sections.length !== 1) target = '';
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
      if (!match) return { error: 'Dòng tiền đã chọn không còn trên Worksuite. Tải lại trang rồi thử lại.' };
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
  return { ws, choices, plan, warnings };
}

/**
 * Lưu kết quả planImport() vào D1. Sheet trống của file tổng -> gỡ task Excel cũ của dòng tiền đó,
 * trừ khi keepEmpty (đồng bộ Google Sheet: giữ thẻ dòng tiền 0 task để dashboard hiện đủ các dòng tiền).
 * @returns {Promise<{ error: string, status: number } | { total: number, results: object[] }>}
 */
export async function saveImport(env, plan, { fileName, user, now, keepEmpty = false }) {
  await ensureTable(env);
  const existing = new Set((await listImports(env, { withTasks: false })).map((r) => r.key));
  const at = new Date(now).toISOString();
  const statements = [];
  const results = [];
  for (const { sec, key, match } of plan) {
    const streamName = match?.fullName || match?.name || sec.title;
    if (!sec.tasks.length && !keepEmpty) {
      // File tổng: sheet của dòng tiền này đã trống -> gỡ task Excel cũ (nếu có).
      if (existing.has(key)) {
        statements.push(env.DB.prepare('DELETE FROM excel_imports WHERE stream_key = ?').bind(key));
        results.push({ key, title: sec.title, count: 0, streamName, removed: true });
      }
      continue;
    }
    const tasksJson = JSON.stringify(sec.tasks);
    if (tasksJson.length > MAX_JSON_BYTES) return { error: `${sec.title}: quá nhiều nội dung để lưu. Hãy bớt số dòng hoặc rút gọn ghi chú.`, status: 413 };
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
  return { total: results.reduce((n, r) => n + r.count, 0), results };
}

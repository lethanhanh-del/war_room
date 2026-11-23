// Theo dõi "Người thêm" và "Người sửa gần nhất" (kèm ô/trường vừa sửa) cho từng dòng trên tab Điểm nghẽn / Test local (lưu D1).
// - Khi CSV không đổi -> 0 lời gọi Graph API, trả ngay dữ liệu đã lưu từ D1 (< 1ms).
// - Lần đầu khởi tạo 1 sheet chưa có lịch sử trong D1 -> tự đối chiếu tối đa 6 phiên bản gần nhất trên SharePoint để xác định
//   người thêm / người sửa gần nhất của các dòng hiện có.
// - Các lần cập nhật sau -> chỉ diff snapshot nhẹ theo từng trường trong D1 + gọi 1 request JSON /activities?$top=10 để ghi nhận
//   đúng người vừa sửa gần nhất và chính xác cột nào trên dòng đó vừa đổi.

import { parseBlockers, nk } from '../public/diem-nghen-model.js';
import { sha256Hex } from './auth.js';
import {
  fetchSharePointRecentEditors,
  fetchSharePointRecentVersionCsvs,
  isSharePointConfigured,
  sharePointMasterUrl,
} from './excel/sharepoint.js';
import { json } from './http.js';

let ready = false;
async function ensureTables(env) {
  if (ready || !env?.DB) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS diem_nghen_authors (
        sheet_key TEXT NOT NULL,
        row_key TEXT NOT NULL,
        row_num INTEGER NOT NULL,
        stt TEXT NOT NULL DEFAULT '',
        content_key TEXT NOT NULL DEFAULT '',
        fingerprint TEXT NOT NULL DEFAULT '',
        fields_json TEXT NOT NULL DEFAULT '{}',
        added_by TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        last_change TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (sheet_key, row_key)
      )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS diem_nghen_sheet_state (
        sheet_key TEXT PRIMARY KEY,
        csv_hash TEXT NOT NULL DEFAULT '',
        initialized INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT ''
      )`
    ),
  ]);
  // Nâng cấp an toàn nếu bảng tạo từ lượt chạy trước chưa có fields_json / last_change.
  const { results: cols } = await env.DB.prepare('PRAGMA table_info(diem_nghen_authors)').all();
  const names = new Set((cols || []).map((c) => c.name));
  if (!names.has('fields_json')) {
    await env.DB.prepare("ALTER TABLE diem_nghen_authors ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}'").run();
  }
  if (!names.has('last_change')) {
    await env.DB.prepare("ALTER TABLE diem_nghen_authors ADD COLUMN last_change TEXT NOT NULL DEFAULT ''").run();
  }
  ready = true;
}

export function resetAuthorsTableReady() {
  ready = false;
}

const FIELD_DEFS = [
  ['content', 'Nội dung'],
  ['supportContent', 'Nội dung hỗ trợ'],
  ['statusRaw', 'Trạng thái'],
  ['deadlineRaw', 'Hạn xử lý'],
  ['owner', 'Phụ trách'],
  ['supporter', 'Hỗ trợ'],
  ['stream', 'Dòng tiền'],
];

function extractFieldValues(it) {
  const dlKey = it.due != null ? `${it.dueFrom ?? ''}-${it.due}` : nk(it.deadlineRaw);
  return {
    content: nk(it.content),
    supportContent: nk(it.supportContent),
    statusRaw: nk(it.statusRaw),
    deadlineRaw: dlKey,
    owner: `${nk(it.owner)}|${nk(it.ownerUnit)}`,
    supporter: `${nk(it.supporter)}|${nk(it.supporterUnit)}|${nk(it.supportUnit)}`,
    stream: `${nk(it.stream)}|${nk(it.group)}|${nk(it.kind)}`,
  };
}

function itemFingerprint(fields) {
  return FIELD_DEFS.map(([k]) => fields[k] || '').join('||');
}

function describeChangedFields(prevFieldsJson, nextFields) {
  let prev = null;
  try { prev = prevFieldsJson ? JSON.parse(prevFieldsJson) : null; } catch { prev = null; }
  if (!prev || typeof prev !== 'object') return 'Cập nhật';
  const changed = [];
  for (const [key, label] of FIELD_DEFS) {
    if ((prev[key] || '') !== (nextFields[key] || '')) changed.push(label);
  }
  if (!changed.length) return 'Cập nhật';
  return `Sửa ${changed.slice(0, 2).join(', ')}${changed.length > 2 ? '…' : ''}`;
}

function rowKeyOf(it) {
  return `r:${it.row}`;
}

/** Khớp dòng mới với bản cũ: ưu tiên cùng số dòng Excel (row_num), dự phòng cùng nội dung (khi dòng trên bị xoá/chèn). */
function matchPreviousRecord(it, prevByRow, prevByContent, claimedKeys) {
  const byRow = prevByRow.get(it.row);
  if (byRow && !claimedKeys.has(byRow.row_key)) return byRow;
  const ck = nk(it.content);
  const candidates = prevByContent.get(ck) || [];
  for (const c of candidates) {
    if (!claimedKeys.has(c.row_key)) return c;
  }
  return null;
}

/** Áp 1 snapshot (items + tác giả `actor`) lên trạng thái `prevRecords` -> trả về danh sách bản ghi mới. */
export function applyAuthorSnapshot(prevRecords, items, actor, nowIso) {
  const prevByRow = new Map();
  const prevByContent = new Map();
  for (const r of prevRecords || []) {
    prevByRow.set(Number(r.row_num), r);
    const arr = prevByContent.get(r.content_key) || [];
    arr.push(r);
    prevByContent.set(r.content_key, arr);
  }

  const claimed = new Set();
  const next = [];
  const editorName = String(actor?.name || '').trim();
  const editorAt = String(actor?.at || nowIso || '');

  for (const it of items) {
    const rk = rowKeyOf(it);
    const ck = nk(it.content);
    const fields = extractFieldValues(it);
    const fp = itemFingerprint(fields);
    const fieldsJson = JSON.stringify(fields);
    const prev = matchPreviousRecord(it, prevByRow, prevByContent, claimed);

    if (prev) {
      claimed.add(prev.row_key);
      const changed = prev.fingerprint !== fp;
      next.push({
        row_key: rk,
        row_num: it.row,
        stt: it.stt || '',
        content_key: ck,
        fingerprint: fp,
        fields_json: fieldsJson,
        added_by: prev.added_by || editorName,
        added_at: prev.added_at || editorAt,
        updated_by: changed ? (editorName || prev.updated_by) : prev.updated_by,
        updated_at: changed ? (editorAt || prev.updated_at) : prev.updated_at,
        last_change: changed ? describeChangedFields(prev.fields_json, fields) : (prev.last_change || 'Mới thêm'),
      });
    } else {
      next.push({
        row_key: rk,
        row_num: it.row,
        stt: it.stt || '',
        content_key: ck,
        fingerprint: fp,
        fields_json: fieldsJson,
        added_by: editorName,
        added_at: editorAt,
        updated_by: editorName,
        updated_at: editorAt,
        last_change: 'Mới thêm',
      });
    }
  }
  return next;
}

async function saveRecords(env, sheetKey, csvHash, records, nowIso) {
  const stmts = [
    env.DB.prepare('DELETE FROM diem_nghen_authors WHERE sheet_key = ?').bind(sheetKey),
    ...records.map((r) =>
      env.DB.prepare(
        `INSERT INTO diem_nghen_authors
         (sheet_key, row_key, row_num, stt, content_key, fingerprint, fields_json, added_by, added_at, updated_by, updated_at, last_change)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sheetKey, r.row_key, r.row_num, r.stt, r.content_key, r.fingerprint,
        r.fields_json || '{}', r.added_by, r.added_at, r.updated_by, r.updated_at, r.last_change || '',
      ),
    ),
    env.DB.prepare(
      `INSERT INTO diem_nghen_sheet_state (sheet_key, csv_hash, initialized, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(sheet_key) DO UPDATE SET csv_hash = excluded.csv_hash, initialized = 1, updated_at = excluded.updated_at`
    ).bind(sheetKey, csvHash, nowIso),
  ];
  await env.DB.batch(stmts);
}

/**
 * Đồng bộ bảng tác giả theo nội dung CSV mới nhất của 1 sheet (chỉ gọi SharePoint khi CSV thực sự thay đổi).
 */
export async function syncSheetAuthors(env, sheetName, csv, {
  now = Date.now(),
  fetchEditors = fetchSharePointRecentEditors,
  fetchVersions = fetchSharePointRecentVersionCsvs,
} = {}) {
  if (!env?.DB || !isSharePointConfigured(env)) return null;
  await ensureTables(env);

  const sheetKey = nk(sheetName) || 'diem nghen';
  const csvHash = await sha256Hex(String(csv || ''));
  const state = await env.DB.prepare('SELECT csv_hash, initialized FROM diem_nghen_sheet_state WHERE sheet_key = ?').bind(sheetKey).first();
  if (state?.initialized && state.csv_hash === csvHash) {
    return { changed: false };
  }

  const parsed = parseBlockers(csv, now);
  if (parsed.error) return null;
  const items = parsed.items;
  const nowIso = new Date(now).toISOString();
  const masterUrl = sharePointMasterUrl(env);

  // Lần đầu khởi tạo sheet: đối chiếu tối đa 6 phiên bản gần nhất để xác định chính xác ai vừa thêm / vừa sửa từng dòng.
  if (!state?.initialized) {
    let records = [];
    try {
      const history = await fetchVersions(env, masterUrl, sheetName, csv, { limit: 6, now });
      if (history.length >= 2) {
        for (const h of history) {
          const p = parseBlockers(h.csv, now);
          if (p.error) continue;
          records = applyAuthorSnapshot(records, p.items, { name: h.by, at: h.at }, nowIso);
        }
      }
    } catch { /* bỏ qua lỗi backfill, dùng fallback bên dưới */ }

    if (!records.length && items.length) {
      let actor = { name: '', at: nowIso };
      try { actor = await fetchEditors(env, masterUrl, now); } catch { /* bỏ qua */ }
      records = applyAuthorSnapshot([], items, actor, nowIso);
    }

    await saveRecords(env, sheetKey, csvHash, records, nowIso);
    return { changed: true, seeded: true, count: records.length };
  }

  // Các lần sau: đọc snapshot cũ từ D1, gọi 1 request JSON nhẹ /activities?$top=10 rồi cập nhật diff.
  const { results: prevRows } = await env.DB.prepare(
    'SELECT row_key, row_num, stt, content_key, fingerprint, fields_json, added_by, added_at, updated_by, updated_at, last_change FROM diem_nghen_authors WHERE sheet_key = ?'
  ).bind(sheetKey).all();

  let actor = { name: '', at: nowIso };
  try { actor = await fetchEditors(env, masterUrl, now); } catch { /* giữ trống nếu lỗi mạng */ }

  const nextRecords = applyAuthorSnapshot(prevRows || [], items, actor, nowIso);
  await saveRecords(env, sheetKey, csvHash, nextRecords, nowIso);
  return { changed: true, seeded: false, count: nextRecords.length };
}

/** Đọc bản đồ tác giả hiện lưu trong D1 để trả cho UI (tra theo `row` hoặc `stt`). */
export async function getSheetAuthors(env, sheetName) {
  if (!env?.DB || !isSharePointConfigured(env)) {
    return { enabled: false, byRow: {}, byStt: {} };
  }
  await ensureTables(env);
  const sheetKey = nk(sheetName) || 'diem nghen';
  const { results } = await env.DB.prepare(
    'SELECT row_num, stt, content_key, added_by, added_at, updated_by, updated_at, last_change FROM diem_nghen_authors WHERE sheet_key = ?'
  ).bind(sheetKey).all();

  const byRow = {};
  const byStt = {};
  for (const r of results || []) {
    const entry = {
      row: r.row_num,
      stt: r.stt,
      addedBy: r.added_by || '',
      addedAt: r.added_at || '',
      updatedBy: r.updated_by || r.added_by || '',
      updatedAt: r.updated_at || r.added_at || '',
      lastChange: r.last_change || '',
    };
    byRow[String(r.row_num)] = entry;
    if (r.stt) byStt[String(r.stt)] = entry;
  }
  return { enabled: true, byRow, byStt };
}

export async function handleWaitingPointAuthors(request, env, url, defaultSheetName = 'Điểm nghẽn') {
  if (request.method !== 'GET') return json({ error: 'Chỉ hỗ trợ GET.' }, 405);
  const rawQuery = String(url?.searchParams?.get('sheet') || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 80);
  const envSheet = defaultSheetName === 'Điểm nghẽn' ? String(env?.WP_SHEET_NAME || '').trim().slice(0, 80) : '';
  const sheetName = rawQuery || envSheet || defaultSheetName;
  const data = await getSheetAuthors(env, sheetName);
  return json(data, 200);
}

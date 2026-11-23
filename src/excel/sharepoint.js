// Đọc Excel trên Microsoft Teams / SharePoint qua Microsoft Graph API (chỉ đọc, Application permissions).
// Thuần Web API (fetch, TextEncoder, btoa, AbortSignal.timeout) — chạy được cả Cloudflare Worker lẫn Node >= 22.
//
// Biến môi trường (lưu dạng Cloudflare Secrets, không ghi mật khẩu vào mã nguồn):
//   MS_TENANT_ID          Directory (tenant) ID của Microsoft Entra ID
//   MS_CLIENT_ID          Application (client) ID
//   MS_CLIENT_SECRET      Client Secret Value
//   SHAREPOINT_MASTER_URL (tuỳ chọn) Link SharePoint file WR - MASTER TASK.xlsx ("off" để tắt và dùng lại Google Sheet)

import { csvSheet } from './gsheet.js';
import { readXlsx } from './xlsx.js';

export const DEFAULT_SHAREPOINT_MASTER_URL =
  'https://ctgroupvietnam.sharepoint.com/:x:/r/sites/TAPDOANCTGROUP/_layouts/15/Doc.aspx?sourcedoc=%7B13E2C89E-7C5A-4204-B3D4-530FF46E86FC%7D&file=WR%20-%20MASTER%20TASK.xlsx&action=default&mobileredirect=true&share=cQqeyOITWnwEQrPUUw_0bob8EgUCS0I3jE6af_c9Pgl_xLC4SA&wdslf=spodoclib-c';

const FETCH_TIMEOUT_MS = 15000;
const TOKEN_SKEW_MS = 120 * 1000;
const ITEM_CACHE_MS = 10 * 60 * 1000;
const WORKSHEETS_CACHE_MS = 60 * 1000;
const SINGLE_SHEET_CACHE_MS = 1500;
const BATCH_MAX = 20;

let tokenCache = { key: '', token: '', exp: 0 };
const itemCache = new Map();
const worksheetsCache = new Map();
const singleSheetCache = new Map();

export function resetSharePointCache() {
  tokenCache = { key: '', token: '', exp: 0 };
  itemCache.clear();
  worksheetsCache.clear();
  singleSheetCache.clear();
}

/** Kiểm tra đã cấu hình đủ 3 secret Microsoft Graph và chưa tắt SharePoint. */
export function isSharePointConfigured(env = {}) {
  if (!env?.MS_TENANT_ID || !env?.MS_CLIENT_ID || !env?.MS_CLIENT_SECRET) return false;
  const raw = String(env.SHAREPOINT_MASTER_URL ?? '').trim();
  return !/^(off|false|0|none)$/i.test(raw);
}

/** Nguồn dữ liệu có phải link SharePoint / OneDrive không. */
export function isSharePointSource(ref) {
  return /^https?:\/\/[^/\s]+\.sharepoint\.com\//i.test(String(ref || '').trim());
}

/** Link file master trên SharePoint ('' nếu chưa bật). */
export function sharePointMasterUrl(env = {}) {
  if (!isSharePointConfigured(env)) return '';
  const raw = String(env.SHAREPOINT_MASTER_URL ?? '').trim();
  return raw || DEFAULT_SHAREPOINT_MASTER_URL;
}

/** Khoá ổn định cho bảng D1 (kpi_close / kpi_audit_log): lấy GUID sourcedoc nếu có, tránh phụ thuộc query string. */
export function sourceKeyOf(id) {
  const s = String(id || '').trim();
  if (!isSharePointSource(s)) return s;
  const m = /sourcedoc=(?:%7B|\{)([0-9a-f-]{32,36})(?:%7D|\})/i.exec(s);
  return m ? `sp:${m[1].toLowerCase()}` : `sp:${s.slice(0, 120)}`;
}

/** Link mở file gốc trên trình duyệt (SharePoint hoặc Google Sheet). */
export function sourceUrlOf(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://docs.google.com/spreadsheets/d/${s}/edit`;
}

/** Mã hoá URL chia sẻ SharePoint thành shareId chuẩn Microsoft Graph: u!<base64url>. */
export function encodeShareId(shareUrl) {
  const bytes = new TextEncoder().encode(String(shareUrl || '').trim());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'u!' + btoa(bin).replace(/=+$/g, '').replace(/\//g, '_').replace(/\+/g, '-');
}

/** Chuyển mảng 2 chiều text[][] từ Graph Excel sang chuỗi CSV (RFC 4180). */
export function rowsToCsv(rows) {
  const escCell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (rows || []).map((r) => (Array.isArray(r) ? r.map(escCell).join(',') : '')).join('\n');
}

/** Xin OAuth2 Access Token (client_credentials) và lưu đệm trong bộ nhớ Worker tới sát lúc hết hạn. */
export async function getGraphToken(env, now = Date.now()) {
  const tenant = String(env?.MS_TENANT_ID || '').trim();
  const clientId = String(env?.MS_CLIENT_ID || '').trim();
  const clientSecret = String(env?.MS_CLIENT_SECRET || '').trim();
  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Chưa cấu hình đầy đủ MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET cho SharePoint.');
  }
  const cacheKey = `${tenant}|${clientId}`;
  if (tokenCache.key === cacheKey && tokenCache.token && now < tokenCache.exp - TOKEN_SKEW_MS) {
    return tokenCache.token;
  }
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Không lấy được token Microsoft Graph: ${String(detail).slice(0, 180)}`);
  }
  const expiresInMs = Math.max(60, Number(data.expires_in) || 3599) * 1000;
  tokenCache = { key: cacheKey, token: data.access_token, exp: now + expiresInMs };
  return data.access_token;
}

async function graphJson(token, path, init = {}) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Microsoft Graph lỗi (${res.status}): ${String(msg).slice(0, 180)}`);
  }
  return data;
}

/** Giải mã link SharePoint -> { driveId, itemId, webUrl, name } (cache 10 phút). */
export async function resolveSharePointItem(env, shareUrl, now = Date.now()) {
  const url = String(shareUrl || '').trim();
  const cached = itemCache.get(url);
  if (cached && now - cached.at < ITEM_CACHE_MS) return cached.meta;

  const token = await getGraphToken(env, now);
  const shareId = encodeShareId(url);
  const item = await graphJson(
    token,
    `/shares/${shareId}/driveItem?$select=id,name,eTag,webUrl,parentReference`,
  );
  const driveId = item?.parentReference?.driveId;
  const itemId = item?.id;
  if (!driveId || !itemId) {
    throw new Error('Không tìm thấy file Excel từ link SharePoint (thiếu driveId/itemId).');
  }
  const meta = { driveId, itemId, webUrl: item.webUrl || url, name: item.name || 'Excel SharePoint' };
  itemCache.set(url, { at: now, meta });
  return meta;
}

async function listVisibleWorksheets(token, driveId, itemId, shareUrl, now, force = false) {
  const cached = !force ? worksheetsCache.get(shareUrl) : null;
  if (cached && now - cached.at < WORKSHEETS_CACHE_MS) return cached.visible;

  const wsData = await graphJson(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/worksheets?$select=id,name,visibility,position`,
  );
  const visible = (wsData?.value || [])
    .filter((w) => String(w.visibility || 'Visible').toLowerCase() === 'visible')
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));

  if (!visible.length) {
    throw new Error('File Excel SharePoint không có sheet nào đang hiện.');
  }
  worksheetsCache.set(shareUrl, { at: now, visible });
  return visible;
}

/**
 * Đọc trực tiếp dữ liệu mới nhất của toàn bộ các sheet đang hiện trên SharePoint bằng 1 lệnh Graph $batch duy nhất
 * (KHÔNG phụ thuộc cTag để cập nhật realtime ngay khi Excel Online lưu ô), trả về đúng định dạng [{ name, hidden: false, rows }].
 */
export async function fetchSharePointTabs(env, shareUrl, now = Date.now(), { force = false } = {}) {
  const token = await getGraphToken(env, now);
  const { driveId, itemId } = await resolveSharePointItem(env, shareUrl, now);

  const readAll = async (visible) => {
    const textByIdx = new Map();
    let missingSheet = false;
    for (let start = 0; start < visible.length; start += BATCH_MAX) {
      const chunk = visible.slice(start, start + BATCH_MAX);
      const batchBody = {
        requests: chunk.map((w, idx) => ({
          id: String(start + idx),
          method: 'GET',
          url: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/worksheets('${encodeURIComponent(w.id).replace(/'/g, "''")}')/usedRange(valuesOnly=true)?$select=text`,
        })),
      };
      const batch = await graphJson(token, '/$batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchBody),
      });
      for (const r of batch?.responses || []) {
        if (r.status >= 200 && r.status < 300 && Array.isArray(r.body?.text)) {
          textByIdx.set(Number(r.id), r.body.text);
        } else if (r.status === 404) {
          const code = String(r.body?.error?.code || '');
          if (/ItemNotFound/i.test(code)) missingSheet = true;
          textByIdx.set(Number(r.id), []);
        }
      }
    }
    return { textByIdx, missingSheet };
  };

  let visible = await listVisibleWorksheets(token, driveId, itemId, shareUrl, now, force);
  let { textByIdx, missingSheet } = await readAll(visible);
  // Nếu có tab vừa bị đổi/xóa trong khi danh sách tab đang được đệm -> đọc lại danh sách tab rồi lấy lại 1 lượt.
  if (missingSheet && !force) {
    visible = await listVisibleWorksheets(token, driveId, itemId, shareUrl, now, true);
    ({ textByIdx } = await readAll(visible));
  }

  return visible.map((w, idx) => {
    const rows = textByIdx.get(idx) || [];
    // Cập nhật luôn bộ đệm CSV cho tab Điểm nghẽn (nếu có) để trang Waiting Point dùng chung.
    if (/điểm\s*nghẽn|diem\s*nghen/i.test(w.name)) {
      singleSheetCache.set(`${shareUrl}|${w.name}`, { at: now, csv: rowsToCsv(rows) });
    }
    return csvSheet(w.name, rows);
  });
}

/**
 * Đọc riêng 1 sheet trên SharePoint (vd tab "Điểm nghẽn" cho trang Waiting Point) và trả về chuỗi CSV.
 * Đệm 5 giây trong bộ nhớ isolate để nhiều màn hình xem cùng lúc dùng chung 1 lần gọi Graph.
 */
export async function fetchSharePointSheetCsv(env, shareUrl, sheetName, now = Date.now()) {
  const key = `${shareUrl}|${sheetName}`;
  const cached = singleSheetCache.get(key);
  if (cached && now - cached.at < SINGLE_SHEET_CACHE_MS) return cached.csv;

  const token = await getGraphToken(env, now);
  const { driveId, itemId } = await resolveSharePointItem(env, shareUrl, now);
  const encName = encodeURIComponent(sheetName).replace(/'/g, "''");
  const range = await graphJson(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/worksheets('${encName}')/usedRange(valuesOnly=true)?$select=text`,
  );
  const csv = rowsToCsv(range?.text || []);
  singleSheetCache.set(key, { at: now, csv });
  return csv;
}

/**
 * Lấy tên người vừa chỉnh sửa file gần nhất trên SharePoint (từ /activities + dự phòng lastModifiedBy).
 * Rất nhẹ (1–2 request JSON nhỏ, < 1ms CPU). Nếu nhiều người cùng sửa trong cửa sổ 15 giây sẽ ghép cả 2 tên.
 */
export async function fetchSharePointRecentEditors(env, shareUrl, now = Date.now()) {
  const token = await getGraphToken(env, now);
  const { driveId, itemId } = await resolveSharePointItem(env, shareUrl, now);
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;

  try {
    const act = await graphJson(token, `${base}/activities?$top=10`);
    const edits = (act?.value || [])
      .filter((a) => a?.action?.edit && (a?.actor?.user?.displayName || a?.actor?.user?.email))
      .map((a) => ({
        name: String(a.actor.user.displayName || a.actor.user.email || '').trim(),
        email: String(a.actor.user.email || '').trim(),
        at: String(a.times?.recordedDateTime || ''),
        ms: Date.parse(a.times?.recordedDateTime || '') || 0,
      }))
      .filter((e) => e.name)
      .sort((a, b) => b.ms - a.ms);

    if (edits.length) {
      const topMs = edits[0].ms;
      const names = [];
      for (const e of edits) {
        if (topMs && e.ms && topMs - e.ms > 15000) break;
        if (!names.includes(e.name)) names.push(e.name);
        if (names.length >= 2) break;
      }
      return { name: names.join(', '), email: edits[0].email, at: edits[0].at || new Date(now).toISOString() };
    }
  } catch { /* thử fallback lastModifiedBy */ }

  const meta = await graphJson(token, `${base}?$select=lastModifiedDateTime,lastModifiedBy`);
  const name = String(meta?.lastModifiedBy?.user?.displayName || meta?.lastModifiedBy?.user?.email || '').trim();
  return {
    name,
    email: String(meta?.lastModifiedBy?.user?.email || '').trim(),
    at: String(meta?.lastModifiedDateTime || new Date(now).toISOString()),
  };
}

function formatExcelCell(c) {
  if (!c || c.v == null) return '';
  if (c.kind === 'date' && typeof c.v === 'number' && Number.isFinite(c.v)) {
    const ms = Date.UTC(1899, 11, 30) + Math.round(c.v * 86400000);
    const d = new Date(ms);
    if (Number.isFinite(d.getTime())) {
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      const hh = d.getUTCHours();
      const mi = d.getUTCMinutes();
      return hh || mi
        ? `${dd}/${mm}/${yyyy} ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
        : `${dd}/${mm}/${yyyy}`;
    }
  }
  return String(c.v);
}

function sheetToCsvFromBook(book, sheetName) {
  const sh = (book?.sheets || []).find((s) => s.name === sheetName);
  if (!sh || !sh.rows?.length) return '';
  const maxRow = sh.rows.reduce((m, r) => Math.max(m, r.r || 0), 0);
  const byRow = new Map(sh.rows.map((r) => [r.r, r.cells]));
  const grid = [];
  for (let r = 1; r <= maxRow; r++) {
    const cells = byRow.get(r);
    if (!cells) { grid.push([]); continue; }
    grid.push(cells.map(formatExcelCell));
  }
  return rowsToCsv(grid);
}

/**
 * Khôi phục lịch sử tác giả cho các dòng ĐÃ CÓ SẴN từ vài phiên bản gần nhất trên SharePoint (chỉ chạy 1 lần lúc khởi tạo).
 * Trả về danh sách phiên bản theo thứ tự CŨ -> MỚI: [{ id, at, by, csv }].
 * Lưu ý: phiên bản mới nhất trên SharePoint không tải được bằng /versions/{id}/content (trả 400) -> dùng `currentCsv` truyền vào.
 */
export async function fetchSharePointRecentVersionCsvs(env, shareUrl, sheetName, currentCsv, { limit = 5, now = Date.now() } = {}) {
  const token = await getGraphToken(env, now);
  const { driveId, itemId } = await resolveSharePointItem(env, shareUrl, now);
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;

  const vData = await graphJson(token, `${base}/versions?$top=${Math.max(2, limit)}`);
  const versions = (vData?.value || []).slice(0, limit);
  if (!versions.length) return [];

  // Bản mới nhất (versions[0]) dùng currentCsv; các bản cũ hơn tải /versions/{id}/content song song.
  const older = await Promise.all(
    versions.slice(1).map(async (v) => {
      try {
        const res = await fetch(`https://graph.microsoft.com/v1.0${base}/versions/${encodeURIComponent(v.id)}/content`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        const book = await readXlsx(buf);
        return {
          id: v.id,
          at: String(v.lastModifiedDateTime || ''),
          by: String(v.lastModifiedBy?.user?.displayName || v.lastModifiedBy?.user?.email || '').trim(),
          csv: sheetToCsvFromBook(book, sheetName),
        };
      } catch {
        return null;
      }
    }),
  );

  const latest = {
    id: versions[0].id,
    at: String(versions[0].lastModifiedDateTime || new Date(now).toISOString()),
    by: String(versions[0].lastModifiedBy?.user?.displayName || versions[0].lastModifiedBy?.user?.email || '').trim(),
    csv: String(currentCsv || ''),
  };

  return [...older.filter(Boolean).reverse(), latest];
}

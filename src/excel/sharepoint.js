// Đọc Excel trên Microsoft Teams / SharePoint qua Microsoft Graph API (chỉ đọc, Application permissions).
// Thuần Web API (fetch, TextEncoder, btoa, AbortSignal.timeout) — chạy được cả Cloudflare Worker lẫn Node >= 22.
//
// Biến môi trường (lưu dạng Cloudflare Secrets, không ghi mật khẩu vào mã nguồn):
//   MS_TENANT_ID          Directory (tenant) ID của Microsoft Entra ID
//   MS_CLIENT_ID          Application (client) ID
//   MS_CLIENT_SECRET      Client Secret Value
//   SHAREPOINT_MASTER_URL (tuỳ chọn) Link SharePoint file WR - MASTER TASK.xlsx ("off" để tắt và dùng lại Google Sheet)

import { csvSheet } from './gsheet.js';

export const DEFAULT_SHAREPOINT_MASTER_URL =
  'https://ctgroupvietnam.sharepoint.com/:x:/r/sites/TAPDOANCTGROUP/_layouts/15/Doc.aspx?sourcedoc=%7B13E2C89E-7C5A-4204-B3D4-530FF46E86FC%7D&file=WR%20-%20MASTER%20TASK.xlsx&action=default&mobileredirect=true&share=cQqeyOITWnwEQrPUUw_0bob8EgUCS0I3jE6af_c9Pgl_xLC4SA&wdslf=spodoclib-c';

const FETCH_TIMEOUT_MS = 15000;
const TOKEN_SKEW_MS = 120 * 1000;
const ITEM_CACHE_MS = 10 * 60 * 1000;
const SINGLE_SHEET_CACHE_MS = 2000;
const BATCH_MAX = 20;

let tokenCache = { key: '', token: '', exp: 0 };
const itemCache = new Map();
const tabsCache = new Map();
const singleSheetCache = new Map();

export function resetSharePointCache() {
  tokenCache = { key: '', token: '', exp: 0 };
  itemCache.clear();
  tabsCache.clear();
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

/**
 * Đọc toàn bộ các sheet đang hiện của file Excel trên SharePoint bằng 1 lệnh Graph $batch,
 * trả về đúng định dạng [{ name, hidden: false, rows }] như fetchSheetTabs() / readXlsx().
 * Kiểm tra cTag/eTag siêu nhẹ trước: nếu file chưa đổi kể từ lần đọc trước thì trả luôn bản đệm (0 lệnh $batch).
 */
export async function fetchSharePointTabs(env, shareUrl, now = Date.now(), { force = false } = {}) {
  const token = await getGraphToken(env, now);
  const { driveId, itemId } = await resolveSharePointItem(env, shareUrl, now);

  let versionTag = '';
  if (!force) {
    try {
      const meta = await graphJson(
        token,
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=eTag,cTag`,
      );
      versionTag = `${meta?.cTag || ''}|${meta?.eTag || ''}`;
      const prev = tabsCache.get(shareUrl);
      if (versionTag && prev && prev.versionTag === versionTag) {
        return prev.tabs;
      }
    } catch { /* bỏ qua kiểm tra eTag, đọc trực tiếp */ }
  }

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

  const textByIdx = new Map();
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
        // Sheet trống hoàn toàn (chưa có usedRange)
        textByIdx.set(Number(r.id), []);
      }
    }
  }

  const tabs = visible.map((w, idx) => csvSheet(w.name, textByIdx.get(idx) || []));
  if (versionTag) tabsCache.set(shareUrl, { versionTag, tabs });
  return tabs;
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

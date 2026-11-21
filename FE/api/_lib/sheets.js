// Đọc dữ liệu các sheet "Dòng tiền" từ Google Sheet (chỉ đọc) qua Service Account.
// File trong api/_lib không bị Vercel biến thành endpoint (tiền tố "_").
import { JWT } from 'google-auth-library';
import { normalize, parseCashflowSheet } from './parse.js';
import { buildMockSheets } from './mock.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Thứ tự = thứ tự ô 2..6 trên dashboard. Có thể ghi đè bằng biến môi trường CASHFLOW_SHEETS
// (danh sách tên sheet, phân cách bằng dấu |).
export const DEFAULT_FLOWS = [
  { key: 'ban-4-du-an', label: 'Dòng tiền bán 4 dự án', sheet: 'DÒNG TIỀN BÁN 4 DỰ ÁN' },
  { key: 'no-kho-doi', label: 'Dòng tiền nợ khó đòi', sheet: 'DÒNG TIỀN NỢ KHÓ ĐÒI' },
  { key: 'banking', label: 'Dòng tiền Banking', sheet: 'DÒNG TIỀN BANKING' },
  { key: 'tai-chinh', label: 'Dòng tiền tài chính', sheet: 'Dòng tiền tài chính' },
  { key: 'thu-truoc-han-qua-han', label: 'Dòng tiền thu trước hạn / quá hạn', sheet: 'Dòng tiền thu trước hạn quá hạn' },
];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.status = 500;
  }
}

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export function isMock() {
  return env('MOCK_SHEETS') === 'true';
}

export function extractPubId(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\/d\/e\/(2PACX-[\w-]+)/) || s.match(/^(2PACX-[\w-]+)$/);
  return m ? m[1] : '';
}

export function extractSheetId(raw) {
  const s = String(raw || '').trim();
  if (extractPubId(s)) return '';
  const m = s.match(/\/spreadsheets\/d\/([\w-]{20,})/) || s.match(/^([\w-]{20,})$/);
  return m ? m[1] : '';
}

export function hasServiceAccount() {
  return Boolean(jwtClient || (env('GOOGLE_SERVICE_ACCOUNT_EMAIL') && env('GOOGLE_PRIVATE_KEY') && extractSheetId(env('GOOGLE_SHEET_ID'))));
}

export function isPublicSheet() {
  if (isMock() || hasServiceAccount()) return false;
  return Boolean(extractPubId(env('GOOGLE_SHEET_PUB_URL')) || extractPubId(env('GOOGLE_SHEET_ID')) || extractSheetId(env('GOOGLE_SHEET_ID')));
}

export function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const unescapeJs = (s) =>
  s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, e) =>
    e.length > 1 ? String.fromCharCode(parseInt(e.slice(1), 16)) : ({ n: '\n', r: '\r', t: '\t' })[e] ?? e
  );

export function parsePublicTabs(html) {
  const tabs = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(/name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    tabs.push({ name: unescapeJs(m[1]), gid: m[2] });
  }
  const tm = String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = tm ? tm[1].replace(/\s*-\s*Google\s+(Sheets|Trang tính|Drive).*$/i, '').trim() : '';
  return { title, tabs };
}

function hasKpiHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const n = (rows[i] || []).map(normalize);
    if (n.includes('nhom') && n.includes('pic')) return true;
  }
  return false;
}

const looseName = (s) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();

async function fetchPublicText(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (/accounts\.google\.com/.test(res.url) || res.status === 401 || res.status === 403) {
    const e = new Error('Google Sheet chưa bật chia sẻ công khai hoặc chưa Xuất bản lên web (Publish to web).');
    e.status = 502;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`Google Sheet công khai trả về lỗi HTTP ${res.status}`);
    e.status = 502;
    throw e;
  }
  return res.text();
}

async function fetchRawPublic(flows) {
  const pubId = extractPubId(env('GOOGLE_SHEET_PUB_URL')) || extractPubId(env('GOOGLE_SHEET_ID'));
  const sheetId = extractSheetId(env('GOOGLE_SHEET_ID'));
  if (!pubId && !sheetId) {
    throw new ConfigError('Thiếu cấu hình GOOGLE_SHEET_PUB_URL hoặc GOOGLE_SHEET_ID');
  }

  const listUrl = pubId
    ? `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml`
    : `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;
  const csvUrl = (gid) =>
    pubId
      ? `https://docs.google.com/spreadsheets/d/e/${pubId}/pub?gid=${gid}&single=true&output=csv`
      : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  const { title: spreadsheetTitle, tabs } = parsePublicTabs(await fetchPublicText(listUrl));
  if (!tabs.length) {
    const e = new Error('Không đọc được danh sách tab từ Google Sheet công khai.');
    e.status = 502;
    throw e;
  }

  const csvCache = new Map();
  const loadTab = async (tab) => {
    if (!csvCache.has(tab.gid)) {
      csvCache.set(tab.gid, parseCsv(await fetchPublicText(csvUrl(tab.gid))));
    }
    return csvCache.get(tab.gid);
  };

  const matched = [];
  const sheets = {};
  await Promise.all(
    flows.map(async (f, i) => {
      const want = looseName(f.sheet);
      const idx = tabs.findIndex((t) => looseName(t.name) === want);
      if (idx < 0) {
        matched[i] = null;
        return;
      }
      const primary = tabs[idx];
      const rows = await loadTab(primary);
      if (hasKpiHeader(rows)) {
        matched[i] = primary.name;
        sheets[primary.name] = rows;
        return;
      }
      // Trong WR - MASTER TASK, tab "Dòng tiền ..." dạng master thường có tab KPI kế bên ("Trang tính7/8/9/10...")
      const next = tabs[idx + 1];
      if (next && !looseName(next.name).startsWith('dong tien')) {
        const nextRows = await loadTab(next);
        if (hasKpiHeader(nextRows)) {
          matched[i] = `${primary.name} (${next.name})`;
          sheets[matched[i]] = nextRows;
          return;
        }
      }
      matched[i] = primary.name;
      sheets[primary.name] = rows;
    })
  );

  return { spreadsheetTitle, matched, sheets, allTitles: tabs.map((t) => t.name) };
}

export function flowConfig() {
  const custom = env('CASHFLOW_SHEETS');
  if (!custom) return DEFAULT_FLOWS;
  return custom
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((sheet, i) => ({ key: `flow-${i + 1}`, label: prettyLabel(sheet), sheet }));
}

/** "DÒNG TIỀN BANKING" -> "Dòng tiền banking" (tên sheet viết hoa toàn bộ thì đổi sang dạng câu) */
export function prettyLabel(name) {
  const t = name.trim();
  if (t !== t.toUpperCase()) return t;
  const lower = t.toLocaleLowerCase('vi');
  return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1);
}

let jwtClient;
function getClient() {
  if (jwtClient) return jwtClient;
  const email = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const rawKey = env('GOOGLE_PRIVATE_KEY');
  if (!email || !rawKey || !env('GOOGLE_SHEET_ID')) {
    throw new ConfigError('Thiếu cấu hình GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY');
  }
  jwtClient = new JWT({
    email,
    key: rawKey.replace(/\\n/g, '\n'), // Vercel lưu "\n" dạng ký tự -> đổi về xuống dòng thật
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return jwtClient;
}

// Chỉ dùng trong unit test
export function __setClientForTest(client) {
  jwtClient = client;
  cache = null;
}

async function gapi(path) {
  const url = `${SHEETS_API}/${env('GOOGLE_SHEET_ID')}${path}`;
  try {
    const res = await getClient().request({ url });
    return res.data;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    const status = err?.response?.status;
    const msg = err?.response?.data?.error?.message || err.message;
    const e = new Error(`Google Sheets API lỗi${status ? ` (${status})` : ''}: ${msg}`);
    e.status = 502;
    throw e;
  }
}

const quote = (title) => `'${title.replace(/'/g, "''")}'`;

/** Đọc thô: { spreadsheetTitle, sheets: { [title]: values[][] } } */
async function fetchRaw(flows) {
  const meta = await gapi('?fields=properties.title,sheets.properties.title');
  const titles = (meta.sheets || []).map((s) => s.properties.title);

  const matched = flows.map((f) => {
    const want = normalize(f.sheet);
    return titles.find((t) => normalize(t) === want) || null;
  });
  const found = matched.filter(Boolean);
  const sheets = {};
  if (found.length) {
    const qs = found.map((t) => `ranges=${encodeURIComponent(`${quote(t)}!A1:Z500`)}`).join('&');
    const data = await gapi(
      `/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`
    );
    (data.valueRanges || []).forEach((vr, i) => {
      sheets[found[i]] = vr.values || [];
    });
  }
  return { spreadsheetTitle: meta.properties?.title || '', matched, sheets, allTitles: titles };
}

let cache = null; // { at, data }

/**
 * Trả về dữ liệu dashboard đã chuẩn hoá.
 * Có cache trong bộ nhớ (CACHE_SECONDS, mặc định 30s) để không vượt quota Google Sheets API
 * khi nhiều màn hình cùng mở.
 */
export async function getDashboardData({ force = false } = {}) {
  const ttl = Number(env('CACHE_SECONDS', '30')) * 1000;
  if (!force && cache && Date.now() - cache.at < ttl) return cache.data;

  const flows = flowConfig();
  let raw;
  if (isMock()) {
    const mock = buildMockSheets(flows);
    raw = { spreadsheetTitle: 'MOCK', matched: flows.map((f) => f.sheet), sheets: mock };
  } else if (hasServiceAccount()) {
    raw = await fetchRaw(flows);
  } else {
    raw = await fetchRawPublic(flows);
  }

  const result = flows.map((f, i) => {
    const title = raw.matched[i];
    const base = { key: f.key, label: f.label, sheet: title || f.sheet };
    if (!title) return { ...base, error: `Không tìm thấy sheet "${f.sheet}"`, days: [], groups: [], items: [] };
    try {
      const parsed = parseCashflowSheet(raw.sheets[title]);
      return { ...base, sheetTitle: parsed.title, days: parsed.days, groups: parsed.groups, items: parsed.items };
    } catch (err) {
      return { ...base, error: err.message, days: [], groups: [], items: [] };
    }
  });

  const data = {
    spreadsheetTitle: raw.spreadsheetTitle,
    generatedAt: new Date().toISOString(),
    mode: isMock() ? 'mock' : hasServiceAccount() ? 'google-sheets' : 'google-sheets-public',
    flows: result,
  };
  cache = { at: Date.now(), data };
  return data;
}

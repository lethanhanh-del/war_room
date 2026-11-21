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

export function flowConfig() {
  const custom = env('CASHFLOW_SHEETS');
  if (!custom) return DEFAULT_FLOWS;
  return custom
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((sheet, i) => ({ key: `flow-${i + 1}`, label: sheet, sheet }));
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
  } else {
    raw = await fetchRaw(flows);
  }

  const result = flows.map((f, i) => {
    const title = raw.matched[i];
    const base = { key: f.key, label: f.label, sheet: title || f.sheet };
    if (!title) return { ...base, error: `Không tìm thấy sheet "${f.sheet}"`, days: [], items: [] };
    try {
      const parsed = parseCashflowSheet(raw.sheets[title]);
      return { ...base, sheetTitle: parsed.title, days: parsed.days, items: parsed.items };
    } catch (err) {
      return { ...base, error: err.message, days: [], items: [] };
    }
  });

  const data = {
    spreadsheetTitle: raw.spreadsheetTitle,
    generatedAt: new Date().toISOString(),
    mode: isMock() ? 'mock' : 'google-sheets',
    flows: result,
  };
  cache = { at: Date.now(), data };
  return data;
}

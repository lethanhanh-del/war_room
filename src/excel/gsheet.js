// Đọc Google Sheet chia sẻ công khai ("Bất kỳ ai có đường liên kết đều xem được") mà không cần tài khoản Google.
// Không phụ thuộc Worker (chạy được cả trên Node để kiểm thử). Đồng bộ lên dashboard: xem sheet-sync.js.
//
// Cách đọc — nhẹ để vừa hạn mức CPU gói Free: KHÔNG đọc cả file .xlsx (file WR - MASTER TASK có sheet danh mục ẩn
// ~12.000 dòng, đọc mất ~30 ms CPU). Thay vào đó:
//   1. trang htmlview công khai -> tên + gid các sheet đang hiện (sheet ẩn không có ở đây);
//   2. mỗi sheet tải CSV (export?format=csv&gid=…), vài KB;
//   3. dựng lại bảng như readXlsx() rồi đọc bằng extractWorkbook() — đúng quy tắc của "Nạp task Excel".
// Nếu Google đổi định dạng trang htmlview: đọc cả file .xlsx (chậm hơn nhưng vẫn đúng).

import { extractWorkbook, parseStreamTitle, parseWorkbookFile } from './tasks.js';

const DEFAULT_SHEET = '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0'; // WR - MASTER TASK
const FETCH_TIMEOUT_MS = 15000;
const MAX_SHEETS = 20;
const MAX_BYTES = 5 * 1024 * 1024;
export const SHEET_FILE_NAME = 'Google Sheet WR - MASTER TASK';
export const NOT_PUBLIC = 'Không đọc được Google Sheet: hãy chia sẻ “Bất kỳ ai có đường liên kết” với quyền Người xem.';

/** ID Google Sheet cần đồng bộ; '' = tắt. EXCEL_SHEET_URL nhận link đầy đủ hoặc ID; trống = WR - MASTER TASK. */
export function sheetId(env = {}) {
  const raw = String(env.EXCEL_SHEET_URL ?? '').trim();
  if (!raw) return DEFAULT_SHEET;
  if (/^(off|false|0|none)$/i.test(raw)) return '';
  const m = /\/spreadsheets\/d\/([\w-]{20,})/.exec(raw) || /^([\w-]{20,})$/.exec(raw);
  return m ? m[1] : '';
}

const unescapeJs = (s) =>
  s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, e) =>
    e.length > 1 ? String.fromCharCode(parseInt(e.slice(1), 16)) : ({ n: '\n', r: '\r', t: '\t' })[e] ?? e);

/** Trang htmlview -> [{ name, gid }] của các sheet đang hiện, theo thứ tự trong file. */
export function parseSheetList(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "(?:[^"\\]|\\.)*", gid: "(\d+)"/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ name: unescapeJs(m[1]), gid: m[2] });
  }
  return out.slice(0, MAX_SHEETS);
}

/** CSV (RFC 4180: ô trong ngoặc kép, "" là dấu ", xuống dòng trong ô) -> mảng dòng, mỗi dòng là mảng chuỗi. */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
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

/**
 * Dòng CSV -> sheet dạng readXlsx(): { name, hidden, rows: [{ r, cells: [{ v } | undefined] }] }.
 * Ô CSV là chữ đã định dạng theo Sheet ("25/11/2026", "50%"), bộ đọc task hiểu được; chỉ bỏ phần giây của ngày giờ.
 */
export function csvSheet(name, rows) {
  const out = [];
  rows.forEach((cells, i) => {
    const mapped = cells.map((v) =>
      v.trim() === '' ? undefined : { v: v.replace(/^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4} \d{1,2}:\d{2}):\d{2}$/, '$1') });
    if (mapped.some(Boolean)) out.push({ r: i + 1, cells: mapped });
  });
  return { name, hidden: false, rows: out };
}

async function fetchGoogle(url, accept) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (/accounts\.google\.com/.test(res.url) || res.status === 401 || res.status === 403) throw new Error(NOT_PUBLIC);
  if (!res.ok) throw new Error(`Google Sheet trả về lỗi HTTP ${res.status}.`);
  if (accept && !accept.test(res.headers.get('Content-Type') || '')) throw new Error(NOT_PUBLIC);
  if (Number(res.headers.get('Content-Length') || 0) > MAX_BYTES) throw new Error('Google Sheet lớn hơn 5 MB.');
  return res;
}

/**
 * Đọc Google Sheet -> kết quả như parseWorkbookFile(): { format, sections, warnings }, thêm cảnh báo cho sheet
 * "Dòng tiền …" không nhận ra bảng task (vd tiêu đề cột bị đổi thành "Cột 2", "Cột 3"… khi chuyển vùng thành Bảng).
 */
export async function readSheet(id, { now = Date.now() } = {}) {
  const base = `https://docs.google.com/spreadsheets/d/${id}`;
  const list = parseSheetList(await (await fetchGoogle(`${base}/htmlview`)).text());
  if (!list.length) {
    const bytes = new Uint8Array(await (await fetchGoogle(`${base}/export?format=xlsx`, /spreadsheetml/)).arrayBuffer());
    return parseWorkbookFile(bytes, { fileName: SHEET_FILE_NAME, now });
  }
  const sheets = await Promise.all(
    list.map(async ({ name, gid }) => csvSheet(name, parseCsv(await (await fetchGoogle(`${base}/export?format=csv&gid=${gid}`, /text\/csv/)).text())))
  );
  const book = extractWorkbook({ sheets }, { fileName: SHEET_FILE_NAME, now });
  for (const { name } of list) {
    if (parseStreamTitle(name)?.name && !book.sections.some((s) => s.sheet === name)) {
      book.warnings.push(`Sheet “${name}” không có dòng tiêu đề hợp lệ (cần các cột “Task / Đầu việc”, “Người phụ trách”, “Hạn hoàn thành”, “Trạng thái”) — chưa đọc được task của sheet này.`);
    }
  }
  return book;
}

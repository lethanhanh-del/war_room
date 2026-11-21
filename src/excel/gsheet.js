// Đọc Google Sheet chia sẻ công khai ("Bất kỳ ai có đường liên kết đều xem được") mà không cần tài khoản Google.
// Không phụ thuộc Worker (chạy được cả trên Node để kiểm thử). Đồng bộ lên dashboard: xem sheet-sync.js.
//
// Cách đọc — nhẹ để vừa hạn mức CPU gói Free: KHÔNG đọc cả file .xlsx (file WR - MASTER TASK có sheet danh mục ẩn
// ~12.000 dòng, đọc mất ~30 ms CPU). Thay vào đó:
//   1. trang htmlview công khai -> tên + gid các sheet đang hiện (sheet ẩn không có ở đây);
//   2. mỗi sheet tải CSV (export?format=csv&gid=…), vài KB;
//   3. dựng lại bảng như readXlsx() rồi đọc bằng extractWorkbook() — đúng quy tắc của "Nạp task Excel".
// Nếu Google đổi định dạng trang htmlview: đọc cả file .xlsx (chậm hơn nhưng vẫn đúng).

import { normKey } from '../worksuite/model.js';
import { extractWorkbook, parseStreamTitle } from './tasks.js';
import { readXlsx } from './xlsx.js';

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

/** Số dòng tiền ghi trong ô của sheet (cột "Dòng tiền": "Dòng tiền 2: Banking" -> 2), khi tên sheet không có số. */
function streamNoInCells(sheet, name) {
  const loose = (s) => normKey(s).replace(/[^a-z0-9]+/g, ''); // "Thu trước hạn/quá hạn" = "Thu trước hạn quá hạn"
  const key = loose(name);
  for (const row of sheet.rows) {
    for (const cell of row.cells) {
      const st = cell && typeof cell.v === 'string' && /\d/.test(cell.v) ? parseStreamTitle(cell.v) : null;
      if (st?.no && loose(st.name) === key) return st.no;
    }
  }
  return null;
}

/**
 * Sheet là nguồn duy nhất của dashboard: mỗi sheet "Dòng tiền …" là 1 thẻ dòng tiền, theo thứ tự trong file —
 * kể cả sheet chưa có task hoặc hỏng dòng tiêu đề (thẻ 0 task, kèm cảnh báo để người nhập sửa).
 * @returns {{ format: 'master', sections: object[], warnings: string[] }}
 */
export function streamSections(sheets, { now = Date.now() } = {}) {
  const streams = sheets.filter((s) => !s.hidden && parseStreamTitle(s.name)?.name);
  if (!streams.length) throw new Error('Google Sheet không có sheet nào tên “Dòng tiền …” — kiểm tra lại link Sheet.');
  let book;
  try {
    book = extractWorkbook({ sheets: streams }, { fileName: SHEET_FILE_NAME, now });
  } catch (e) {
    // Mọi sheet dòng tiền đều trống / hỏng tiêu đề: vẫn hiện đủ thẻ dòng tiền, mỗi thẻ 0 task.
    if (!/Không tìm thấy bảng task|chưa có task nào/.test(e?.message || '')) throw e;
    book = { format: 'master', sections: [], warnings: ['Google Sheet chưa có task nào.'] };
  }
  const bySheet = new Map(book.sections.map((s) => [s.sheet, s]));
  const sections = streams.map((sheet) => {
    let sec = bySheet.get(sheet.name);
    if (!sec) {
      const st = parseStreamTitle(sheet.name);
      sec = { sheet: sheet.name, streamNo: st.no ?? null, name: st.name, pic: '', asOf: '', tasks: [], warnings: [] };
      book.warnings.push(`Sheet “${sheet.name}” không có dòng tiêu đề hợp lệ (cần các cột “Task / Đầu việc”, “Người phụ trách”, “Hạn hoàn thành”, “Trạng thái”) — chưa đọc được task của sheet này.`);
    }
    const no = sec.streamNo || streamNoInCells(sheet, sec.name);
    return {
      ...sec,
      streamNo: no,
      code: no ? `DT${String(no).padStart(2, '0')}` : '',
      title: `Dòng tiền${no ? ` ${no}` : ''}: ${sec.name}`,
    };
  });
  return { format: 'master', sections, warnings: book.warnings };
}

/** Đọc Google Sheet -> { format, sections, warnings } (xem streamSections). */
export async function readSheet(id, { now = Date.now() } = {}) {
  const base = `https://docs.google.com/spreadsheets/d/${id}`;
  const list = parseSheetList(await (await fetchGoogle(`${base}/htmlview`)).text());
  let sheets;
  if (list.length) {
    sheets = await Promise.all(
      list.map(async ({ name, gid }) => csvSheet(name, parseCsv(await (await fetchGoogle(`${base}/export?format=csv&gid=${gid}`, /text\/csv/)).text())))
    );
  } else {
    const bytes = new Uint8Array(await (await fetchGoogle(`${base}/export?format=xlsx`, /spreadsheetml/)).arrayBuffer());
    sheets = (await readXlsx(bytes)).sheets;
  }
  return streamSections(sheets, { now });
}

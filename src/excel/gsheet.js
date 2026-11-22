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
import { extractRoster, isRoster } from './roster.js';
import { fetchSharePointTabs, isSharePointConfigured, isSharePointSource, sharePointMasterUrl } from './sharepoint.js';
import { extractWorkbook, parseStreamTitle, unreadableWarning } from './tasks.js';
import { readXlsx } from './xlsx.js';

const DEFAULT_SHEET = '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0'; // WR - MASTER TASK
const SECOND_SHEET = '1APLf2zn0gk62bRfmD85ZpxtALv2wGjsFQ--RQDhaGNY'; // WarRoom_CTHomes_Final: phân chia nhiệm vụ (thêm 21/11/2026)
export const DEFAULT_SHEETS = [DEFAULT_SHEET, SECOND_SHEET];
const FETCH_TIMEOUT_MS = 15000;
const MAX_SHEETS = 20;
const MAX_BYTES = 5 * 1024 * 1024;
export const SHEET_FILE_NAME = 'Google Sheet WR - MASTER TASK';
export const NOT_PUBLIC = 'Không đọc được Google Sheet: hãy chia sẻ “Bất kỳ ai có đường liên kết” với quyền Người xem.';

/**
 * Các Google Sheet cần đồng bộ ([] = tắt). EXCEL_SHEET_URL: 1 hoặc nhiều link / ID, cách nhau bởi dấu phẩy, chấm phẩy,
 * khoảng trắng hoặc xuống dòng; "off" để tắt; trống = DEFAULT_SHEETS (WR - MASTER TASK + file phân chia nhiệm vụ).
 */
export function sheetIds(env = {}) {
  const raw = String(env.EXCEL_SHEET_URL ?? '').trim();
  if (!raw) {
    return isSharePointConfigured(env) ? [sharePointMasterUrl(env), SECOND_SHEET] : [...DEFAULT_SHEETS];
  }
  if (/^(off|false|0|none)$/i.test(raw)) return [];
  const ids = [];
  for (const part of raw.split(/[\s,;]+/)) {
    if (isSharePointSource(part)) {
      if (!ids.includes(part)) ids.push(part);
      continue;
    }
    const m = /\/spreadsheets\/d\/([\w-]{20,})/.exec(part) || /^([\w-]{20,})$/.exec(part);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** Sheet đầu tiên cần đồng bộ ('' = tắt) — giữ cho code cũ. */
export const sheetId = (env = {}) => sheetIds(env)[0] || '';

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
      const warning = unreadableWarning(sheet.name);
      if (!book.warnings.includes(warning)) book.warnings.push(warning); // extractWorkbook có thể đã báo
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

/** Các sheet đang hiện của 1 Google Sheet, cùng dạng với readXlsx: htmlview + CSV từng sheet; dự phòng: cả file .xlsx. */
export async function fetchSheetTabs(id) {
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
  return sheets;
}

/** Đọc 1 nguồn (Excel SharePoint hoặc Google Sheet) về cùng cấu trúc [{ name, hidden, rows }]. */
export async function fetchAnySourceTabs(id, env = {}, opts = {}) {
  if (isSharePointSource(id)) return fetchSharePointTabs(env, id, Date.now(), opts);
  return fetchSheetTabs(id);
}

/**
 * Hàm đọc sheet dùng chung trong 1 lượt (vd 1 lượt cron): đồng bộ task (sheet-sync.js) và KPI (src/kpi/) cùng đọc
 * file WR - MASTER TASK -> chỉ tải và tách 1 lần (gói Free: 10 ms CPU / lượt). Kết quả chỉ đọc, đừng sửa.
 */
export function sharedLoader(env = {}) {
  const seen = new Map();
  return (id) => {
    if (!seen.has(id)) {
      const p = fetchAnySourceTabs(id, env);
      seen.set(id, p);
      p.catch(() => seen.delete(id));
    }
    return seen.get(id);
  };
}

/** Đọc Google Sheet task -> { format, sections, warnings } (xem streamSections). */
export async function readSheet(id, { now = Date.now() } = {}) {
  return streamSections(await fetchSheetTabs(id), { now });
}

/**
 * Đọc nhiều Google Sheet và gộp lại. Mỗi sheet "Dòng tiền …" là 1 phần; cùng dòng tiền có ở nhiều file -> gộp task
 * (task file sau xếp sau). 1 file đọc lỗi (mạng, chưa / bị bỏ chia sẻ công khai) trong khi file khác đọc được:
 *   - có bản đọc được lần trước (previous) -> dùng tạm bản đó, kèm cảnh báo, để task của file này không biến mất;
 *   - chưa từng đọc được -> bỏ qua file đó, kèm cảnh báo (riêng file đầu tiên: dừng cả lượt, giữ dữ liệu đang hiện).
 * Chỉ 1 file, hoặc không đọc được file nào -> báo lỗi như trước.
 * File phân chia nhiệm vụ (vd WarRoom_CTHomes_Final, sheet "DS nhân sự War-Room" + "Nhóm hỗ trợ": cột Dòng tiền, Thành viên,
 * Nhiệm vụ thực hiện) không phải file task: đọc nhóm, PIC, nhiệm vụ từng người vào `roster` (xem roster.js).
 * @param {string[]} ids
 * @param {{ now?: number, previous?: Map<string, {sections: object[], warnings: string[]}>, load?: (id: string) => Promise<object[]> }} [opts]
 *   load = hàm tải sheet (mặc định fetchSheetTabs; truyền sharedLoader() để dùng chung với đồng bộ KPI)
 * @returns {Promise<{ format: 'master', sections: object[], warnings: string[], fresh: Map<string, object>,
 *   taskSheets: number, roster: { sections: object[] } | null }>}
 *   fresh = kết quả đọc mới của từng file task (để lưu làm bản dự phòng); taskSheets = số file task có dữ liệu (mới hoặc
 *   bản trước); roster = phân chia nhóm từ các file phân chia nhiệm vụ đọc được (null = không có / đọc lỗi)
 */
export async function readSheets(ids, { now = Date.now(), previous = new Map(), load = fetchSheetTabs } = {}) {
  const loose = (s) => normKey(s).replace(/[^a-z0-9]+/g, '');
  const sections = [];
  const byNo = new Map(); // cùng dòng tiền: cùng số ("Dòng tiền 2: …") hoặc cùng tên (bỏ dấu, hoa/thường, dấu câu)
  const byName = new Map();
  const warnings = [];
  const errors = [];
  const failed = []; // cảnh báo sheet đọc lỗi: đưa lên đầu danh sách
  const fresh = new Map();
  const rosters = [];
  let taskSheets = 0;
  for (const [i, id] of ids.entries()) {
    const label = `Google Sheet ${i + 1} (…${id.slice(-6)})`;
    let book;
    try {
      const tabs = await load(id);
      if (isRoster({ sheets: tabs })) {
        const roster = extractRoster({ sheets: tabs });
        rosters.push(roster);
        warnings.push(...roster.warnings.map((w) => `${label}: ${w}`));
        continue;
      }
      book = streamSections(tabs, { now });
      fresh.set(id, book);
    } catch (e) {
      if (ids.length === 1) throw e;
      const error = `${label}: ${e?.name === 'TimeoutError' ? 'không phản hồi (quá 15 giây).' : e?.message || e}`;
      errors.push(error);
      book = previous.get(id);
      if (!book && i === 0) throw new Error(error);
      failed.push(book ? `${error} Đang giữ dữ liệu lần đọc trước.` : error);
      if (!book) continue;
    }
    taskSheets++;
    warnings.push(...(i ? book.warnings.map((w) => `${label}: ${w}`) : book.warnings));
    for (const sec of book.sections) {
      // Dòng của file sau đánh số tiếp sau file trước, để thứ tự task và mã task không trùng.
      const tasks = i ? sec.tasks.map((t) => ({ ...t, row: t.row + i * 100000 })) : sec.tasks;
      const prev = (sec.streamNo && byNo.get(sec.streamNo)) || byName.get(loose(sec.name));
      if (!prev) {
        const copy = { ...sec, tasks: [...tasks] };
        if (sec.streamNo) byNo.set(sec.streamNo, copy);
        byName.set(loose(sec.name), copy);
        sections.push(copy);
        continue;
      }
      // Mã task (cột STT) là một phần id task trên dashboard: trùng với file trước thì thêm hậu tố số thứ tự file.
      const codes = new Set(prev.tasks.map((t) => t.code).filter(Boolean));
      for (const t of tasks) {
        const code = t.code && codes.has(t.code) ? `${t.code}·S${i + 1}` : t.code;
        if (code) codes.add(code);
        prev.tasks.push(code === t.code ? t : { ...t, code });
      }
      if (!prev.pic && sec.pic) prev.pic = sec.pic;
      if (!prev.streamNo && sec.streamNo) {
        Object.assign(prev, { streamNo: sec.streamNo, code: sec.code, title: sec.title });
        byNo.set(sec.streamNo, prev);
      }
    }
  }
  if (!fresh.size && !rosters.length) throw new Error(errors.join(' · '));
  // Nhiều file phân chia nhiệm vụ: cùng dòng tiền thì lấy theo file đứng trước.
  const teams = [];
  for (const r of rosters) for (const sec of r.sections) if (!teams.some((x) => x.key === sec.key)) teams.push(sec);
  return { format: 'master', sections, warnings: [...failed, ...warnings], fresh, taskSheets, roster: rosters.length ? { sections: teams } : null };
}

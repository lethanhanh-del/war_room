// Đọc file Excel (.xlsx) không cần thư viện ngoài: giải nén ZIP bằng DecompressionStream và đọc XML bằng regex.
// Chạy được trên Cloudflare Worker lẫn Node ≥ 22. Chỉ đọc giá trị ô (kể cả kết quả công thức đã lưu),
// không tính lại công thức, không đọc định dạng ngoài kiểu số (ngày / phần trăm).
//
// Worker gói Free chỉ có ~10 ms CPU mỗi request, nên bộ đọc giải nén TỪNG ĐOẠN và dừng sớm khi đủ:
//   - không đọc sheet ẩn (vd sheet danh mục "DataValidation" hàng chục nghìn dòng);
//   - mỗi sheet dừng khi đã qua EMPTY_RUN_LIMIT dòng trống liên tiếp (Excel Online / Google Sheets để sẵn
//     hàng nghìn dòng chỉ có định dạng);
//   - bảng chuỗi dùng chung (sharedStrings) chỉ đọc tới chuỗi cuối cùng mà các ô cần.
//
//   const book = await readXlsx(bytes);
//   book.sheets -> [{ name, hidden, rows: [{ r: 8, cells: [ {v, kind}, … ] }] }]
//   cell.v: string | number | boolean;  cell.kind: 'date' | 'pct' | undefined (chỉ với ô số)

export class XlsxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XlsxError';
  }
}

const MAX_ENTRY_BYTES = 30 * 1024 * 1024; // giới hạn mỗi file XML sau giải nén (chống file "bom")
export const EMPTY_RUN_LIMIT = 300; // số dòng trống liên tiếp (sau dòng có dữ liệu cuối) thì dừng đọc sheet
const MAX_VALUE_ROWS = 5000; // số dòng có dữ liệu tối đa đọc mỗi sheet

// ---------- ZIP ----------

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

function zipEntries(bytes) {
  const min = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('File không phải Excel .xlsx (không đọc được cấu trúc ZIP). Nếu là file .xls cũ, hãy mở bằng Excel và lưu lại dạng .xlsx.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new XlsxError('File Excel bị hỏng (mục lục ZIP không hợp lệ).');
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name.replace(/^\/+/, ''), { method, compSize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Giải nén 1 mục ZIP thành các đoạn chữ UTF-8. Người đọc dừng vòng lặp thì phần còn lại không bị giải nén. */
async function* entryText(bytes, entry) {
  if (entry.compSize === 0xffffffff || entry.size > MAX_ENTRY_BYTES) throw new XlsxError('File Excel quá lớn.');
  const p = entry.local;
  if (p + 30 > bytes.length || u32(bytes, p) !== 0x04034b50) throw new XlsxError('File Excel bị hỏng (dữ liệu ZIP không hợp lệ).');
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const data = bytes.subarray(start, start + entry.compSize);
  const decoder = new TextDecoder();
  if (entry.method === 0) {
    yield decoder.decode(data);
    return;
  }
  if (entry.method !== 8) throw new XlsxError(`File Excel dùng kiểu nén không hỗ trợ (${entry.method}).`);
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  let total = 0;
  let finished = false;
  try {
    for (;;) {
      let r;
      try {
        r = await reader.read();
      } catch {
        throw new XlsxError('File Excel bị hỏng (không giải nén được).');
      }
      if (r.done) { finished = true; break; }
      total += r.value.length;
      if (total > MAX_ENTRY_BYTES) throw new XlsxError('File Excel quá lớn sau khi giải nén.');
      const text = decoder.decode(r.value, { stream: true });
      if (text) yield text;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    if (!finished) reader.cancel().catch(() => {});
  }
}

async function readAll(bytes, entry) {
  let out = '';
  for await (const chunk of entryText(bytes, entry)) out += chunk;
  return out.replace(/^﻿/, '');
}

// ---------- XML ----------

const P = '(?:[\\w.-]+:)?'; // tiền tố namespace tuỳ ý: <x:c>, <c>, …
const elementRe = (tag) => new RegExp(`<${P}${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${P}${tag}>)`, 'g');
const HAS_VALUE = new RegExp(`<${P}(?:v|is)\\b`);

function decodeXml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, '\\$&')}\\s*=\\s*"([^"]*)"`).exec(attrs || '');
  return m ? decodeXml(m[1]) : null;
}

function elements(xml, tag) {
  const re = elementRe(tag);
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: m[1], body: m[2] ?? '' });
  return out;
}

/**
 * Đọc lần lượt các phần tử <tag> trong luồng chữ (các phần tử không lồng nhau, vd <row>, <si>).
 * onElement(attrs, body) trả về false để dừng — phần còn lại của file không được giải nén.
 */
async function scanElements(chunks, tag, onElement) {
  const re = elementRe(tag);
  let buf = '';
  for await (const chunk of chunks) {
    buf += chunk;
    re.lastIndex = 0;
    let consumed = 0;
    let m;
    while ((m = re.exec(buf))) {
      consumed = re.lastIndex;
      if (onElement(m[1], m[2] ?? '') === false) return;
    }
    if (consumed) buf = buf.slice(consumed);
  }
}

/** Ghép tất cả <t> trong 1 chuỗi (bỏ phần phiên âm <rPh>). */
function textOf(body) {
  const clean = body.replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?<\\/${P}rPh>`, 'g'), '');
  return elements(clean, 't').map((t) => decodeXml(t.body)).join('');
}

const colIndex = (ref) => {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Định dạng số dựng sẵn của Excel là ngày/giờ: 14–22, 45–47; phần trăm: 9, 10.
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function numberKinds(stylesXml) {
  if (!stylesXml) return [];
  const custom = new Map();
  for (const f of elements(stylesXml, 'numFmt')) custom.set(Number(attr(f.attrs, 'numFmtId')), attr(f.attrs, 'formatCode') || '');
  const xfsBlock = new RegExp(`<${P}cellXfs\\b[^>]*>([\\s\\S]*?)<\\/${P}cellXfs>`).exec(stylesXml);
  if (!xfsBlock) return [];
  return elements(xfsBlock[1], 'xf').map((xf) => {
    const id = Number(attr(xf.attrs, 'numFmtId') || 0);
    if (id === 9 || id === 10) return 'pct';
    if (BUILTIN_DATE.has(id)) return 'date';
    const code = custom.get(id);
    if (!code) return undefined;
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (bare.includes('%')) return 'pct';
    if (/[dmyhs]/i.test(bare)) return 'date';
    return undefined;
  });
}

/** Các ô của 1 dòng. Ô chuỗi dùng chung tạm giữ chỉ số ({ s }) và được thay bằng chữ sau khi đọc sharedStrings. */
function parseCells(body, kinds, shared) {
  const cells = [];
  let nextCol = 0;
  for (const c of elements(body, 'c')) {
    const ref = attr(c.attrs, 'r');
    const idx = ref ? colIndex(ref) : nextCol;
    nextCol = idx + 1;
    const t = attr(c.attrs, 't') || 'n';
    if (t === 'inlineStr') {
      const is = elements(c.body, 'is')[0];
      const v = is ? textOf(is.body) : '';
      if (v !== '') cells[idx] = { v };
      continue;
    }
    const vEl = elements(c.body, 'v')[0];
    if (!vEl) continue;
    const raw = decodeXml(vEl.body);
    if (raw === '') continue;
    if (t === 's') {
      const s = Number(raw);
      if (Number.isInteger(s) && s >= 0) {
        cells[idx] = { s };
        if (s > shared.max) shared.max = s;
      }
    } else if (t === 'str' || t === 'e') cells[idx] = { v: raw };
    else if (t === 'd') cells[idx] = { v: raw, kind: 'date' };
    else if (t === 'b') cells[idx] = { v: raw === '1' };
    else {
      const n = Number(raw);
      if (!Number.isFinite(n)) cells[idx] = { v: raw };
      else {
        const kind = kinds[Number(attr(c.attrs, 's') || 0)];
        cells[idx] = kind ? { v: n, kind } : { v: n };
      }
    }
  }
  return cells;
}

async function parseSheet(chunks, kinds, shared) {
  const rows = [];
  let nextRow = 1;
  let lastValue = 0;
  await scanElements(chunks, 'row', (attrs, body) => {
    const r = Number(attr(attrs, 'r')) || nextRow;
    nextRow = r + 1;
    if (!HAS_VALUE.test(body)) return !(lastValue > 0 && r - lastValue > EMPTY_RUN_LIMIT);
    lastValue = r;
    const cells = parseCells(body, kinds, shared);
    if (cells.length) rows.push({ r, cells });
    return rows.length < MAX_VALUE_ROWS;
  });
  return rows;
}

function resolveTarget(target) {
  let t = String(target || '').replace(/\\/g, '/');
  if (t.startsWith('/')) t = t.slice(1);
  else t = `xl/${t}`;
  const parts = [];
  for (const seg of t.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * @param {ArrayBuffer|Uint8Array} input nội dung file .xlsx
 * @param {{includeHidden?: boolean}} opts  mặc định bỏ qua sheet ẩn (vd sheet danh mục "DataValidation")
 * @returns {Promise<{sheets: {name: string, hidden: boolean, rows: {r: number, cells: ({v: any, kind?: string}|undefined)[]}[]}[]}>}
 */
export async function readXlsx(input, { includeHidden = false } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = zipEntries(bytes);
  const text = async (name) => {
    const e = entries.get(name);
    return e ? readAll(bytes, e) : null;
  };
  const stream = (name) => {
    const e = entries.get(name);
    return e ? entryText(bytes, e) : null;
  };

  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new XlsxError('File không phải bảng tính Excel (thiếu xl/workbook.xml).');
  const relsXml = (await text('xl/_rels/workbook.xml.rels')) || '';
  const rels = new Map();
  for (const rel of elements(relsXml, 'Relationship')) rels.set(attr(rel.attrs, 'Id'), resolveTarget(attr(rel.attrs, 'Target')));
  const sharedName = [...rels.values()].find((t) => /sharedStrings\.xml$/i.test(t)) || 'xl/sharedStrings.xml';
  const stylesName = [...rels.values()].find((t) => /styles\.xml$/i.test(t)) || 'xl/styles.xml';
  const kinds = numberKinds(await text(stylesName));

  const shared = { max: -1 };
  const sheets = [];
  for (const s of elements(workbook, 'sheet')) {
    const hidden = /hidden/i.test(attr(s.attrs, 'state') || ''); // hidden | veryHidden
    if (hidden && !includeHidden) continue;
    const rid = /(?:^|\s)[\w.-]+:id\s*=\s*"([^"]*)"/.exec(s.attrs)?.[1];
    const chunks = rels.has(rid) ? stream(rels.get(rid)) : null;
    if (!chunks) continue;
    sheets.push({ name: attr(s.attrs, 'name') || '', hidden, rows: await parseSheet(chunks, kinds, shared) });
  }
  if (!sheets.length) throw new XlsxError('File Excel không có sheet nào đọc được.');

  // Thay chỉ số chuỗi dùng chung bằng chữ — chỉ giải nén sharedStrings tới chuỗi lớn nhất cần dùng.
  if (shared.max >= 0) {
    const raw = [];
    const chunks = stream(sharedName);
    if (chunks) await scanElements(chunks, 'si', (attrs, body) => { raw.push(body); return raw.length <= shared.max; });
    const decoded = new Map();
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        for (let i = 0; i < row.cells.length; i++) {
          const cell = row.cells[i];
          if (!cell || cell.s === undefined) continue;
          if (!decoded.has(cell.s)) decoded.set(cell.s, raw[cell.s] === undefined ? '' : textOf(raw[cell.s]));
          const v = decoded.get(cell.s);
          row.cells[i] = v === '' ? undefined : { v };
        }
      }
      sheet.rows = sheet.rows.filter((row) => row.cells.some(Boolean));
    }
  }
  return { sheets };
}

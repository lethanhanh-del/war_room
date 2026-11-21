// Đọc file Excel (.xlsx) không cần thư viện ngoài: giải nén ZIP bằng DecompressionStream và đọc XML bằng regex.
// Chạy được trên Cloudflare Worker lẫn Node ≥ 22. Chỉ đọc giá trị ô (kể cả kết quả công thức đã lưu),
// không tính lại công thức, không đọc định dạng ngoài kiểu số (ngày / phần trăm).
//
//   const book = await readXlsx(bytes);
//   book.sheets -> [{ name, rows: [{ r: 8, cells: [ {v, kind}, … ] }] }]
//   cell.v: string | number | boolean | null;  cell.kind: 'date' | 'pct' | undefined (chỉ với ô số)

export class XlsxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XlsxError';
  }
}

const MAX_ENTRY_BYTES = 30 * 1024 * 1024; // giới hạn mỗi file XML sau giải nén (chống file "bom")

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

async function inflateRaw(data) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ENTRY_BYTES) {
      await reader.cancel();
      throw new XlsxError('File Excel quá lớn sau khi giải nén.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function readEntry(bytes, entry) {
  if (entry.compSize === 0xffffffff || entry.size > MAX_ENTRY_BYTES) throw new XlsxError('File Excel quá lớn.');
  const p = entry.local;
  if (p + 30 > bytes.length || u32(bytes, p) !== 0x04034b50) throw new XlsxError('File Excel bị hỏng (dữ liệu ZIP không hợp lệ).');
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const data = bytes.subarray(start, start + entry.compSize);
  let raw;
  if (entry.method === 0) raw = data;
  else if (entry.method === 8) {
    try { raw = await inflateRaw(data); } catch (e) {
      if (e instanceof XlsxError) throw e;
      throw new XlsxError('File Excel bị hỏng (không giải nén được).');
    }
  } else throw new XlsxError(`File Excel dùng kiểu nén không hỗ trợ (${entry.method}).`);
  return new TextDecoder().decode(raw).replace(/^﻿/, '');
}

// ---------- XML ----------

const P = '(?:[\\w.-]+:)?'; // tiền tố namespace tuỳ ý: <x:c>, <c>, …

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
  const re = new RegExp(`<${P}${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${P}${tag}>)`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: m[1], body: m[2] ?? '' });
  return out;
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

const HAS_VALUE = new RegExp(`<${P}(?:v|is)\\b`);

function parseSheet(xml, shared, kinds) {
  const dataBlock = new RegExp(`<${P}sheetData\\b[^>]*>([\\s\\S]*?)<\\/${P}sheetData>`).exec(xml);
  if (!dataBlock) return [];
  const rows = [];
  let nextRow = 1;
  for (const row of elements(dataBlock[1], 'row')) {
    const r = Number(attr(row.attrs, 'r')) || nextRow;
    nextRow = r + 1;
    // Excel Online để sẵn hàng nghìn dòng chỉ có định dạng, không có giá trị: bỏ qua nhanh.
    if (!HAS_VALUE.test(row.body)) continue;
    const cells = [];
    let nextCol = 0;
    for (const c of elements(row.body, 'c')) {
      const ref = attr(c.attrs, 'r');
      const idx = ref ? colIndex(ref) : nextCol;
      nextCol = idx + 1;
      const t = attr(c.attrs, 't') || 'n';
      let v = null;
      let kind;
      if (t === 'inlineStr') {
        const is = elements(c.body, 'is')[0];
        v = is ? textOf(is.body) : '';
      } else {
        const vEl = elements(c.body, 'v')[0];
        const raw = vEl ? decodeXml(vEl.body) : null;
        if (raw === null) v = null;
        else if (t === 's') v = shared[Number(raw)] ?? '';
        else if (t === 'str' || t === 'e' || t === 'd') v = raw;
        else if (t === 'b') v = raw === '1';
        else {
          const n = Number(raw);
          v = Number.isFinite(n) ? n : raw;
          if (typeof v === 'number') kind = kinds[Number(attr(c.attrs, 's') || 0)];
        }
        if (t === 'd') kind = 'date';
      }
      if (v === null || v === '') continue;
      cells[idx] = kind ? { v, kind } : { v };
    }
    if (cells.length) rows.push({ r, cells });
  }
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
  const read = async (name) => {
    const e = entries.get(name);
    return e ? readEntry(bytes, e) : null;
  };

  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new XlsxError('File không phải bảng tính Excel (thiếu xl/workbook.xml).');
  const relsXml = (await read('xl/_rels/workbook.xml.rels')) || '';
  const rels = new Map();
  for (const rel of elements(relsXml, 'Relationship')) rels.set(attr(rel.attrs, 'Id'), resolveTarget(attr(rel.attrs, 'Target')));

  const sharedName = [...rels.values()].find((t) => /sharedStrings\.xml$/i.test(t)) || 'xl/sharedStrings.xml';
  const sharedXml = await read(sharedName);
  // Chỉ giải mã chuỗi khi có ô dùng tới (file Excel Online có hàng chục nghìn chuỗi của sheet danh mục ẩn).
  const rawShared = sharedXml ? elements(sharedXml, 'si').map((si) => si.body) : [];
  const decoded = new Map();
  const shared = new Proxy([], {
    get(_, prop) {
      const i = typeof prop === 'string' && /^\d+$/.test(prop) ? Number(prop) : -1;
      if (i < 0 || i >= rawShared.length) return undefined;
      if (!decoded.has(i)) decoded.set(i, textOf(rawShared[i]));
      return decoded.get(i);
    },
  });
  const stylesName = [...rels.values()].find((t) => /styles\.xml$/i.test(t)) || 'xl/styles.xml';
  const kinds = numberKinds(await read(stylesName));

  const sheets = [];
  for (const s of elements(workbook, 'sheet')) {
    const hidden = /hidden/i.test(attr(s.attrs, 'state') || ''); // hidden | veryHidden
    if (hidden && !includeHidden) continue;
    const rid = /(?:^|\s)[\w.-]+:id\s*=\s*"([^"]*)"/.exec(s.attrs)?.[1];
    const path = rels.get(rid);
    const xml = path ? await read(path) : null;
    if (!xml) continue;
    sheets.push({ name: attr(s.attrs, 'name') || '', hidden, rows: parseSheet(xml, shared, kinds) });
  }
  if (!sheets.length) throw new XlsxError('File Excel không có sheet nào đọc được.');
  return { sheets };
}

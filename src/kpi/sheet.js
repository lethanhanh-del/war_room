// Đọc Google Sheet KPI War Room ("thamkhao_kpi", layout chốt ngày 21/11/2026) cho trang /kpi.
//
// - Mỗi tab tên "Dòng tiền …" là 1 dòng tiền. Tab khác (vd "KPI 21-25.11", "Trang_tính1") bị bỏ qua.
// - Dòng tiêu đề có cột "Nhóm" và "PIC"; các ô ngày "21/11" … mỗi ngày 2 cột: KPI | Kết quả (dòng dưới tiêu đề);
//   cột "Ghi chú / Vướng mắc" và "Thư mục dữ liệu lưu trữ" nếu có. Cột "Tổng kết" bỏ qua: dashboard tự tính.
// - Mỗi dòng dữ liệu là KPI của 1 người: cột PIC = người thực hiện. Các dòng cùng tên Nhóm là 1 nhóm.
//   Dòng có Stt là số La Mã (I, II…) mà không có PIC / KPI là dòng mục: tên nhóm cho các dòng bên dưới bỏ trống cột Nhóm.
// - Kết quả chỉ nhập "Đạt" / "Không đạt": res = 'D' | 'K' | '' (chưa nhập) | '?' (chữ khác, kèm cảnh báo).

import { normKey } from '../worksuite/model.js';

const DATE_RE = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?$/;
const ROMAN_RE = /^[IVXLC]+\.?$/i;
const pad = (n) => String(n).padStart(2, '0');
const raw = (row, i) => (i == null || i < 0 ? '' : String(row?.cells?.[i]?.v ?? ''));
const text = (row, i) => raw(row, i).replace(/\s+/g, ' ').trim();

/** Tab "Dòng tiền …" (không phân biệt hoa thường, dấu). */
export const isKpiTab = (name) => /^dong tien(\s|:|-|$)/.test(normKey(name));

/** "DÒNG TIỀN BÁN 4 DỰ ÁN" -> "Bán 4 dự án"; "Dòng tiền tài chính " -> "Tài chính". */
export function streamNameOf(tab) {
  const words = String(tab || '').normalize('NFC').replace(/\s+/g, ' ').trim().split(' ');
  let i = 0;
  if (normKey(words[0]) === 'dong' && normKey(words[1]).replace(/[:\-–]$/, '') === 'tien') i = 2;
  const rest = words.slice(i).join(' ').replace(/^[:\-–]\s*/, '');
  const lower = rest.toLocaleLowerCase('vi');
  return lower ? lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1) : String(tab || '').trim();
}

/**
 * Tên người viết hoa toàn bộ ("HOÀNG THỊ QUỲNH MAI") -> "Hoàng Thị Quỳnh Mai". Tên đã viết đúng và chữ viết tắt
 * 1 từ ("NVA") giữ nguyên.
 */
export function personName(s) {
  const t = String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!t.includes(' ') || t !== t.toLocaleUpperCase('vi') || !/\p{L}/u.test(t)) return t;
  return t.toLocaleLowerCase('vi').split(' ').map((w) => w.charAt(0).toLocaleUpperCase('vi') + w.slice(1)).join(' ');
}

/**
 * Ô Kết quả -> 'D' (Đạt) | 'K' (Không đạt) | '' (trống) | '?' (chữ khác).
 * Mẫu chỉ ghi Đạt / Không đạt; nhận thêm cách ghi quen tay: Hoàn thành, Xong, OK = Đạt; Chưa / Không hoàn thành = Không đạt.
 * Ô tick (checkbox) trên Google Sheet: TRUE = Đạt, FALSE = chưa nhập.
 */
export function resultCode(value) {
  const k = normKey(value).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k || k === 'false') return ''; // ô tick (checkbox) chưa tick: coi như chưa nhập
  if (k === 'true') return 'D'; // ô tick đã tick
  if (/^(khong|chua)\b/.test(k) || /^(fail|failed|kd)$/.test(k)) return 'K';
  if (/^(dat|da dat|hoan thanh|da hoan thanh|xong|da xong|ok|done|co)\b/.test(k)) return 'D';
  return '?';
}

const link = (s) => (/^https?:\/\/\S+$/i.test(s) ? s : '');

/**
 * Một tab dòng tiền -> { sheet, name, pic, days: [{date, label}], groups: [{ name, rows }], warnings } hoặc { error }.
 * row: { row, stt, person, note, folder, folderText, cells: { 'YYYY-MM-DD': { kpi, res } } } — chỉ có ngày có KPI / kết quả.
 */
export function parseKpiTab(sheet, { year = new Date().getUTCFullYear() } = {}) {
  const rows = sheet.rows || [];
  const label = `Tab “${String(sheet.name).trim()}”`;
  const warnings = [];
  let h = -1;
  let map = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = (rows[i].cells || []).map((c) => normKey(c?.v));
    const group = keys.indexOf('nhom');
    const person = keys.indexOf('pic');
    if (group >= 0 && person >= 0) {
      h = i;
      map = {
        stt: keys.indexOf('stt'),
        group,
        person,
        note: keys.findIndex((k) => k && (k.includes('ghi chu') || k.includes('vuong mac'))),
        folder: keys.findIndex((k) => k && k.includes('thu muc')),
      };
      break;
    }
  }
  if (h < 0) return { error: `${label}: không tìm thấy dòng tiêu đề có cột “Nhóm” và “PIC”.` };

  const days = [];
  (rows[h].cells || []).forEach((c, i) => {
    const m = DATE_RE.exec(String(c?.v ?? '').trim());
    if (!m) return;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : year;
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return;
    days.push({ date: `${y}-${pad(mo)}-${pad(d)}`, label: `${pad(d)}/${pad(mo)}`, kpi: i, res: i + 1 });
  });
  if (!days.length) return { error: `${label}: dòng tiêu đề chưa có cột ngày (vd 21/11).` };

  // Dòng ngay dưới tiêu đề: KPI | Kết quả của từng ngày (csvSheet bỏ dòng trống nên so số dòng thật).
  const next = rows[h + 1];
  const sub = next && next.r === rows[h].r + 1 && days.some((d) => normKey(text(next, d.kpi)) === 'kpi') ? next : null;
  if (sub) {
    const odd = days.filter((d) => normKey(text(sub, d.kpi)) !== 'kpi' || !normKey(text(sub, d.res)).startsWith('ket qua'));
    if (odd.length) warnings.push(`${label}: ngày ${odd.map((d) => d.label).join(', ')} chưa đúng mẫu 2 cột KPI | Kết quả.`);
  }

  // PIC dòng tiền ghi phía trên bảng, vd "DÒNG TIỀN: BÁN 4 DỰ ÁN\nPIC: HOÀNG THỊ QUỲNH MAI".
  let pic = '';
  for (let i = 0; i < h && !pic; i++) {
    for (const c of rows[i].cells || []) {
      const m = /\bPIC\s*[:：]\s*([^\n]+)/i.exec(String(c?.v ?? ''));
      if (m) { pic = personName(m[1]); break; }
    }
  }

  const groups = new Map();
  const unknown = new Set();
  let current = '';
  for (let i = sub ? h + 2 : h + 1; i < rows.length; i++) {
    const row = rows[i];
    const stt = text(row, map.stt);
    const gname = text(row, map.group);
    const person = personName(text(row, map.person));
    const cells = {};
    let any = false;
    for (const d of days) {
      const kpi = text(row, d.kpi);
      const value = text(row, d.res);
      if (!kpi && !value) continue;
      const res = resultCode(value);
      if (res === '?') unknown.add(value);
      cells[d.date] = { kpi, res };
      any = true;
    }
    if (ROMAN_RE.test(stt) && !person && !any) {
      if (gname) current = gname;
      continue;
    }
    if (!gname && !person && !any) continue;
    const name = gname || current;
    if (gname) current = gname;
    if (!name) warnings.push(`${label}: dòng ${row.r} chưa ghi cột Nhóm.`);
    if (person && name && normKey(person) === normKey(name)) {
      warnings.push(`${label}: dòng ${row.r} cột PIC đang ghi tên nhóm “${name}”, cần ghi tên người thực hiện.`);
    }
    const key = normKey(name) || `dong ${row.r}`;
    let g = groups.get(key);
    if (!g) {
      g = { name: name || 'Chưa ghi nhóm', rows: [] };
      groups.set(key, g);
    }
    const folderText = text(row, map.folder);
    g.rows.push({ row: row.r, stt, person, note: text(row, map.note).slice(0, 300), folder: link(folderText), folderText: link(folderText) ? '' : folderText.slice(0, 120), cells });
  }
  if (unknown.size) {
    warnings.push(`${label}: kết quả chưa hiểu (chỉ ghi Đạt hoặc Không đạt): ${[...unknown].slice(0, 5).map((s) => `“${s}”`).join(', ')}.`);
  }
  return {
    sheet: String(sheet.name).trim(),
    name: streamNameOf(sheet.name),
    pic,
    days: days.map(({ date, label: l }) => ({ date, label: l })),
    groups: [...groups.values()],
    warnings,
  };
}

/** Các tab của Google Sheet KPI -> { streams, warnings }. Không có tab dòng tiền nào đọc được -> báo lỗi. */
export function parseKpiBook(tabs, opts = {}) {
  const streams = [];
  const warnings = [];
  for (const tab of tabs) {
    if (tab.hidden || !isKpiTab(tab.name)) continue;
    const s = parseKpiTab(tab, opts);
    if (s.error) { warnings.push(s.error); continue; }
    warnings.push(...s.warnings);
    delete s.warnings;
    streams.push(s);
  }
  if (!streams.length) throw new Error(warnings[0] || 'Google Sheet KPI chưa có tab “Dòng tiền …”.');
  return { streams, warnings };
}

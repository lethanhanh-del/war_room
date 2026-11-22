// Đọc Google Sheet KPI War Room cho trang /kpi và màn hình War Room ở trang "/" (/api/dashboard).
//
// Hai kiểu file:
// - File master "WR - MASTER TASK" (từ 22/11/2026): mỗi dòng tiền có tab task "Dòng tiền …" (STT | Dòng tiền |
//   Nhóm công việc | Task / Đầu việc | Người phụ trách …), ngay sau nó là tab KPI tên tuỳ ý (vd "Trang tính6").
//   PIC dòng tiền lấy ở dòng "PIC phụ trách: …" của tab task.
// - File "thamkhao_kpi" (layout chốt 21/11/2026): mỗi tab KPI tên "Dòng tiền …" là 1 dòng tiền.
// Tab khác (vd "Waiting Point", "Nhóm hỗ trợ", "KPI 21-25.11") bị bỏ qua.
//
// Bảng KPI:
// - Dòng tiêu đề có cột "Nhóm" và "PIC"; các ô ngày "21/11" … mỗi ngày 2 cột: KPI | Kết quả (dòng dưới tiêu đề);
//   cột "Ghi chú / Vướng mắc" và "Thư mục dữ liệu lưu trữ" nếu có. Cột "Tổng kết" bỏ qua: dashboard tự tính.
// - Mỗi dòng dữ liệu là KPI của 1 người: cột PIC = người thực hiện. Các dòng cùng tên Nhóm là 1 nhóm.
//   Dòng có Stt là số La Mã (I, II…) mà không có PIC / KPI là dòng mục: tên nhóm cho các dòng bên dưới bỏ trống cột Nhóm.
// - Kết quả nhập "Đạt" / "Không đạt" hoặc ô tick: res = 'D' | 'K' | '' (chưa nhập / chưa tick) | '?' (chữ khác, kèm cảnh báo).
//   Ô chưa tick mà ngày đó không ghi KPI thì không tính là KPI.

import { normKey } from '../worksuite/model.js';

const DATE_RE = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?$/;
const ROMAN_RE = /^[IVXLC]+\.?$/i;
const pad = (n) => String(n).padStart(2, '0');
const PIC_RE = /\bPIC(?:\s+phụ\s+trách)?\s*[:：]\s*([^\n]+)/iu;
const raw = (row, i) => (i == null || i < 0 ? '' : String(row?.cells?.[i]?.v ?? ''));
const text = (row, i) => raw(row, i).replace(/\s+/g, ' ').trim();

/** Bỏ số thứ tự đứng đầu tên tab: "1. Dòng tiền ..." -> "Dòng tiền ..."; "8. Nhóm hỗ trợ" -> "Nhóm hỗ trợ". */
const stripPrefixNo = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().replace(/^\d+\s*[.)\-–]\s*/, '');

/** Số thứ tự đứng đầu tên tab: "4. Dòng tiền ..." -> 4; không có -> null. */
export const tabNoOf = (s) => {
  const m = /^(\d+)\s*[.)\-–]\s*/.exec(String(s || '').normalize('NFC').trim());
  return m ? Number(m[1]) : null;
};

/** Tab "Dòng tiền …" (có thể có số thứ tự "1. " ở đầu). */
export const isKpiTab = (name) => /^dong tien(\s|:|-|$)/.test(normKey(stripPrefixNo(name)));

/** Tab "Nhóm hỗ trợ" (có thể có số thứ tự "8. " ở đầu). */
export const isSupportTab = (name) => /^nhom ho tro(\s|:|-|$)/.test(normKey(stripPrefixNo(name)));

/** Tab "Nhóm thanh lý" (có thể có số thứ tự "9. " ở đầu). */
export const isLiquidationTab = (name) => /^nhom thanh ly(\s|:|-|$)/.test(normKey(stripPrefixNo(name)));

/**
 * Chuẩn hóa tên dòng tiền / nhóm từ tên tab (Google Sheet hoặc Excel SharePoint giới hạn 31 ký tự, không có "/"),
 * giữ ĐẦY ĐỦ tên chính thức:
 * "1. Dòng tiền bán 4 dự án" -> "Dòng tiền bán 4 dự án"; "4. Dòng tiền thu trước hạn quá " -> "Dòng tiền thu trước hạn quá hạn";
 * "5. Dòng tiền Equity  IPO" -> "Dòng tiền Equity / IPO"; "DÒNG TIỀN: BANKING" -> "Dòng tiền Banking";
 * "8. Nhóm thanh lý" -> "Nhóm thanh lý"; "9. Nhóm hỗ trợ" -> "Nhóm hỗ trợ".
 */
export function streamNameOf(tab) {
  const clean = stripPrefixNo(tab);
  if (!clean) return String(tab || '').trim();
  const words = clean.split(' ').filter(Boolean);
  if (normKey(words[0]) === 'dong' && normKey(words[1]).replace(/[:\-–]$/, '') === 'tien') {
    const rest = words.slice(2).join(' ').replace(/^[:\-–]\s*/, '').trim();
    if (!rest) return 'Dòng tiền';
    const restKey = normKey(rest).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (restKey === 'thu truoc han qua' || restKey === 'thu truoc han qua han') return 'Dòng tiền thu trước hạn quá hạn';
    if (restKey === 'equity ipo') return 'Dòng tiền Equity / IPO';
    const isAllUpper = clean === clean.toLocaleUpperCase('vi');
    if (!isAllUpper) return `Dòng tiền ${rest}`;
    const lower = rest.toLocaleLowerCase('vi');
    const fixed = lower === 'banking' ? 'Banking' : lower;
    return `Dòng tiền ${fixed}`;
  }
  const base = clean === clean.toLocaleUpperCase('vi') ? clean.toLocaleLowerCase('vi') : clean;
  return base.charAt(0).toLocaleUpperCase('vi') + base.slice(1);
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
  // Đường tắt cho ô tick (TRUE / FALSE) và ô trống: tab KPI có hàng trăm dòng mẫu, đỡ tốn CPU (gói Free: 10 ms / lượt).
  if (value === '' || value === 'FALSE' || value == null) return '';
  if (value === 'TRUE') return 'D';
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
export function parseKpiTab(sheet, { year = new Date().getUTCFullYear(), label = `Tab “${String(sheet.name).trim()}”` } = {}) {
  const rows = sheet.rows || [];
  const warnings = [];
  let h = -1;
  let map = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = (rows[i].cells || []).map((c) => normKey(c?.v));
    const group = keys.indexOf('nhom');
    const pic = keys.indexOf('pic');
    if (group >= 0 && pic >= 0) {
      h = i;
      map = {
        stt: keys.indexOf('stt'),
        group,
        pic,
        assignee: keys.findIndex((k) => k && (k.startsWith('nguoi phu trach') || k.startsWith('nguoi thuc hien'))),
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
  const pic = picAbove(rows, h);
  // Ô checkbox duyệt KPI của BOD ở E1 (cột E = chỉ số 4, dòng 1 đứng trên tiêu đề bảng).
  const bodApproved = parseBodApproved(rows, h);

  const groups = new Map();
  const unknown = new Set();
  let current = '';
  for (let i = sub ? h + 2 : h + 1; i < rows.length; i++) {
    const row = rows[i];
    const stt = text(row, map.stt);
    const gname = text(row, map.group);
    const taskPic = personName(text(row, map.pic));
    const assignee = map.assignee >= 0 ? personName(text(row, map.assignee)) : '';
    const person = assignee || taskPic;
    // Chỉ gắn kèm PIC khi cột "Người phụ trách" có điền và khác cột PIC; nếu cột Người phụ trách trống thì không gắn thêm PIC.
    const rowPic = assignee && taskPic && normKey(assignee) !== normKey(taskPic) ? taskPic : '';
    const cells = {};
    let hasKpi = false;
    for (const d of days) {
      const kpi = text(row, d.kpi);
      const value = text(row, d.res);
      const res = resultCode(value);
      if (!kpi && !res) continue; // ô trống, hoặc ô tick chưa tick mà ngày đó không có KPI
      if (res === '?') unknown.add(value);
      cells[d.date] = { kpi, res };
      if (kpi) hasKpi = true;
    }
    if (ROMAN_RE.test(stt) && !person && !hasKpi) {
      if (gname) current = gname;
      continue;
    }
    // Dòng mẫu (chỉ có Stt và ô tick, có khi bị tick nhầm) không có Nhóm, PIC, KPI: bỏ qua.
    if (!gname && !person && !hasKpi) continue;
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
    g.rows.push({
      row: row.r,
      stt,
      person,
      ...(rowPic ? { taskPic: rowPic } : {}),
      note: text(row, map.note).slice(0, 300),
      folder: link(folderText),
      folderText: link(folderText) ? '' : folderText.slice(0, 120),
      cells,
    });
  }
  if (unknown.size) {
    warnings.push(`${label}: kết quả chưa hiểu (chỉ ghi Đạt hoặc Không đạt): ${[...unknown].slice(0, 5).map((s) => `“${s}”`).join(', ')}.`);
  }
  return {
    sheet: String(sheet.name).trim(),
    name: streamNameOf(sheet.name),
    pic,
    bodApproved,
    days: days.map(({ date, label: l }) => ({ date, label: l })),
    groups: [...groups.values()],
    warnings,
  };
}

/**
 * Đọc checkbox duyệt KPI của BOD tại ô E1 (dòng 1, cột E = chỉ số 4, phải nằm phía trên dòng tiêu đề bảng).
 * - Sheet có ô E1 (hoặc nhãn "duyệt" ở D1) và đã tick (TRUE / Đã duyệt) -> true.
 * - Sheet có ô E1 / nhãn "duyệt" ở D1 nhưng FALSE hoặc để trống -> false (chưa được BOD duyệt).
 * - Sheet cũ chưa có ô E1 -> true (không đánh cảnh báo nhầm).
 */
export function parseBodApproved(rows, headerIdx) {
  const r1 = rows.find((r) => r.r === 1);
  if (!r1 || !rows[headerIdx] || r1.r >= rows[headerIdx].r) return true;
  const e1 = text(r1, 4);
  const d1 = normKey(text(r1, 3));
  if (!e1 && !d1.includes('duyet')) return true;
  const k = normKey(e1);
  if (k === 'true' || k === '1' || /^(da duyet|duyet|ok|yes|co|x)$/.test(k) || /^[✓✔☑]$/.test(e1)) return true;
  return false;
}

/** "PIC: …" / "PIC phụ trách: …" trong các dòng phía trên dòng tiêu đề (hoặc vài dòng đầu tab task). */
function picAbove(rows, end) {
  for (let i = 0; i < Math.min(end, rows.length); i++) {
    for (const c of rows[i].cells || []) {
      const m = PIC_RE.exec(String(c?.v ?? ''));
      if (m) return personName(m[1]);
    }
  }
  return '';
}

/** Số dòng tiền ghi trong cột "Dòng tiền" của tab task: "Dòng tiền 5: Equity / IPO" -> 5; không có -> null. */
export function streamNoOf(sheet) {
  for (const r of (sheet.rows || []).slice(0, 40)) {
    for (const c of r.cells || []) {
      const m = /^dong tien\s*(\d+)\s*:/.exec(normKey(c?.v));
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** Tab task của file master: có dòng tiêu đề "Task / Đầu việc", hoặc "Nhóm công việc" + "Người phụ trách". */
export function isTaskTab(sheet) {
  return (sheet.rows || []).slice(0, 10).some((r) => {
    const keys = (r.cells || []).map((c) => normKey(c?.v));
    return keys.some((k) => k.startsWith('task') && k.includes('dau viec'))
      || (keys.includes('nhom cong viec') && keys.some((k) => k.startsWith('nguoi phu trach')));
  });
}

/**
 * Các tab của Google Sheet KPI -> { streams, warnings }. Không có bảng KPI nào đọc được -> báo lỗi.
 * File master: tab KPI là tab ngay sau tab task "Dòng tiền …" (stream.sheet = tên tab task, stream.kpiSheet = tên tab KPI).
 * File thamkhao_kpi: tab KPI tên "Dòng tiền …".
 */
export function parseKpiBook(tabs, opts = {}) {
  const streams = [];
  const warnings = [];
  const seen = new Set();
  let task = null; // tab task "Dòng tiền …" ngay trước tab đang xét
  for (const tab of tabs) {
    if (tab.hidden) continue;
    const named = isKpiTab(tab.name);
    const support = isSupportTab(tab.name);
    const liquidation = isLiquidationTab(tab.name);
    const owner = task;
    task = null;
    if ((named || support || liquidation) && isTaskTab(tab)) { task = tab; continue; }
    if (!named && !support && !liquidation && !owner) continue;
    const kpiName = String(tab.name).trim();
    const taskName = owner ? String(owner.name).trim() : '';
    const ownerSupport = owner ? isSupportTab(owner.name) : false;
    const ownerLiquidation = owner ? isLiquidationTab(owner.name) : false;
    const label = owner ? `Tab “${kpiName}” (KPI của “${taskName}”)` : `Tab “${kpiName}”`;
    const s = parseKpiTab(tab, { ...opts, label });
    if (s.error) {
      if (named) warnings.push(s.error); // tab sau tab task hoặc tab Nhóm hỗ trợ / thanh lý không phải bảng KPI -> bỏ qua
      continue;
    }
    if (owner) {
      s.sheet = taskName;
      s.kpiSheet = kpiName;
      s.name = streamNameOf(taskName);
      if (!s.pic) s.pic = picAbove(owner.rows || [], 5);
      const no = streamNoOf(owner) || tabNoOf(taskName);
      if (no) s.no = no;
    } else if (!support && !ownerSupport && !liquidation && !ownerLiquidation) {
      const no = tabNoOf(kpiName);
      if (no) s.no = no;
    }
    if (support || ownerSupport) {
      s.kind = 'support';
      s.name = 'Nhóm hỗ trợ';
    } else if (liquidation || ownerLiquidation) {
      s.kind = 'liquidation';
      s.name = 'Nhóm thanh lý';
    }
    const key = normKey(s.name);
    if (seen.has(key)) { warnings.push(`${label}: dòng tiền “${s.name}” đã có bảng KPI ở tab khác, bỏ qua tab này.`); continue; }
    seen.add(key);
    warnings.push(...s.warnings);
    delete s.warnings;
    streams.push(s);
  }
  if (!streams.length) throw new Error(warnings[0] || 'Google Sheet KPI chưa có bảng KPI nào (tab “Dòng tiền …” hoặc tab KPI ngay sau tab task “Dòng tiền …”).');
  return { streams, warnings };
}

// Đọc danh sách task War Room từ file Excel. Hỗ trợ 2 dạng:
//
//  1. File tổng "WR - MASTER TASK" (Excel Online): MỖI SHEET LÀ 1 DÒNG TIỀN, tên sheet "Dòng tiền …"
//     (vd "Dòng tiền Banking"), dòng 1 là tiêu đề cột:
//       STT · Dòng tiền · Nhóm công việc · Task / Đầu việc · Người phụ trách · Người phối hợp · Hạn hoàn thành ·
//       Trạng thái · Ưu tiên · Đầu ra cần có · Điểm nghẽn / Cần hỗ trợ
//  2. File riêng 1 dòng tiền "Nhập task & theo dõi" (vd DONG_TIEN_2_BANKING_Template…xlsx, sheet 01_NHAP_TASK):
//     tiêu đề "DÒNG TIỀN 2: BANKING | …" phía trên bảng cho biết dòng tiền, "Phụ trách: …" cho biết PIC.
//
// Cột được nhận theo TIÊU ĐỀ, không theo vị trí, nên thêm/bớt/đổi thứ tự cột vẫn đọc được. Chỉ cột nhiệm vụ là bắt buộc.
// Dòng không có nội dung, hoặc "Hiển thị LED" = Không, được bỏ qua. Sheet ẩn (vd "DataValidation") không được đọc.

import { readXlsx } from './xlsx.js';
import { normKey } from '../worksuite/model.js';

export const MAX_TASKS = 500;
const MAX_TEXT = 1000;

// [trường, điều kiện trên tiêu đề đã bỏ dấu]. Thứ tự quan trọng: trường cụ thể hơn đứng trước.
const COLUMNS = [
  ['sourceCode', (h) => h === 'ma nguon' || h === 'ma goc'],
  ['code', (h) => h === 'ma task' || h === 'ma' || h === 'ma cv' || h === 'ma cong viec' || h === 'id'],
  ['stt', (h) => h === 'stt' || h === 'tt'],
  ['show', (h) => h.includes('hien thi')],
  ['note', (h) => h.includes('ghi chu')],
  ['output', (h) => h.includes('san pham') || h.includes('bang chung') || h.includes('dau ra') || h.includes('ket qua')],
  ['blocker', (h) => h.includes('diem nghen') || h.includes('vuong mac') || h.includes('rui ro')],
  ['next', (h) => h.includes('buoc tiep') || h.includes('hanh dong tiep')],
  ['priority', (h) => h.includes('uu tien') || h === 'priority'],
  ['link', (h) => h.includes('link') || h.includes('duong dan')],
  ['status', (h) => h.includes('trang thai') || h === 'status'],
  ['progress', (h) => h.startsWith('%') || h.includes('% ') || h.includes('tien do') || h.includes('ty le')],
  ['due', (h) => h === 'deadline' || h === 'han' || h.startsWith('han ') || h.includes('thoi han') || h.includes('ngay hoan thanh') || h === 'due date'],
  ['support', (h) => h.includes('phoi hop') || h.includes('ho tro thuc hien')],
  ['owner', (h) => h.includes('phu trach') || h === 'pic' || h.includes('nguoi thuc hien') || h.includes('chiu trach nhiem')],
  ['subject', (h) => h.includes('nhiem vu') || h.includes('dau viec') || h.startsWith('task') || h === 'noi dung' || h === 'cong viec' || h === 'ten task'],
  ['stream', (h) => h === 'dong tien'],
  ['group', (h) => h.startsWith('nhom') || h === 'hang muc' || h === 'du an' || h === 'phan loai'],
];

// Trạng thái trong file Excel -> trạng thái kiểu Worksuite (để dùng chung cách phân loại với task Worksuite).
const STATUS_RULES = [
  [/^(hoan thanh|da hoan thanh|hoan tat|da hoan tat|xong|da xong|done|completed|da xac nhan)/, 'Completed'],
  [/^(huy|da huy|cancel)/, 'Cancelled'],
  [/(cho duyet|cho xac nhan|cho nghiem thu|cho kiem chung|in review)/, 'In Review'],
  [/(qua han|tre han|overdue)/, 'Overdue'],
  [/(vuong|\bcho\b|tam dung|tam hoan|pending|blocked|nghen|can ho tro)/, 'Pending'],
  [/^(dang|in progress|doing|working)/, 'In Progress'],
  [/^(chua|moi|open|todo|to do|not started)/, 'Open'],
];

/** "Vướng mắc" -> "Pending". Trống -> "Open". Không nhận ra -> null. */
export function excelStatus(label) {
  const k = normKey(label);
  if (!k) return 'Open';
  for (const [re, status] of STATUS_RULES) if (re.test(k)) return status;
  return null;
}

const HONORIFIC = /^(?:anh|chị|ông|bà|cô|chú|em|a\.|c\.|mr\.?|mrs\.?|ms\.?|miss)\s+/i;

/** "Chị Nguyễn Thị Mai Thu" -> "Nguyễn Thị Mai Thu". */
export function cleanOwner(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2 && HONORIFIC.test(s); i++) s = s.replace(HONORIFIC, '');
  return s;
}

/** Người phụ trách là phòng ban hoặc nhiều người -> chưa có 1 người chịu trách nhiệm chính. */
export function isGroupOwner(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  return /^(ban|phòng|nhóm|bộ phận|khối|văn phòng|công ty|tổ|team|trung tâm|hđqt|bod|các)\b/i.test(s) || /[/,;&+]|\svà\s/i.test(s);
}

const pad = (n) => String(n).padStart(2, '0');

/** Ô hạn -> "YYYY-MM-DD" hoặc "YYYY-MM-DD HH:MM" (giờ VN). Không đọc được -> ''. */
export function dueFromCell(cell, defaultYear) {
  if (!cell) return '';
  const v = cell.v;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return ''; // không phải ngày Excel hợp lệ (1954–2119)
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const hasTime = d.getUTCHours() || d.getUTCMinutes();
    return hasTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}${m[4] ? ` ${pad(m[4])}:${m[5]}` : ''}`;
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:\s+(\d{1,2})[:h](\d{2}))?$/.exec(s);
  if (m) {
    const day = +m[1];
    const month = +m[2];
    let year = m[3] ? +m[3] : defaultYear;
    if (year < 100) year += 2000;
    if (day < 1 || day > 31 || month < 1 || month > 12) return '';
    return `${year}-${pad(month)}-${pad(day)}${m[4] ? ` ${pad(m[4])}:${m[5]}` : ''}`;
  }
  return '';
}

/** Ô % -> 0..100, trống -> null. Ô định dạng % hoặc số trong (0, 1) được hiểu là tỉ lệ. */
export function progressFromCell(cell) {
  if (!cell) return null;
  let n;
  let fraction = false;
  if (typeof cell.v === 'number') {
    n = cell.v;
    fraction = cell.kind === 'pct' || (n > 0 && n < 1);
  } else {
    const s = String(cell.v).trim().replace(',', '.');
    if (!s) return null;
    n = Number.parseFloat(s);
    fraction = !s.includes('%') && n > 0 && n < 1;
  }
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(fraction ? n * 100 : n)));
}

const text = (cell) => (cell === undefined || cell === null ? '' : String(cell.v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT));

/** "BANKING" -> "Banking", "nợ khó đòi" -> "Nợ khó đòi"; chữ hoa/thường lẫn lộn giữ nguyên (vd "SS1 Hạn mức"). */
function sentence(s) {
  let t = String(s || '').trim();
  if (t && t === t.toLocaleUpperCase('vi')) t = t.toLocaleLowerCase('vi');
  return t.charAt(0).toLocaleUpperCase('vi') + t.slice(1);
}

/** "DÒNG TIỀN 2: BANKING | NHẬP TASK & THEO DÕI" -> { no: 2, name: 'Banking' } */
export function parseStreamTitle(s) {
  const head = String(s || '').split('|')[0].trim();
  // "Dòng tiền", "DÒNG TIỀN", "Dong tien" (không dấu)
  const m = /^d[oòóỏõọ]ng\s*ti[eèéẻẽẹêềếểễệ]n(?![\p{L}\d])\s*(?:số\s*)?(\d{1,2})?\s*[:\-–—.]?\s*(.*)$/iu.exec(head);
  if (!m) return null;
  const name = sentence(m[2].trim());
  if (!name && !m[1]) return null;
  return { no: m[1] ? Number(m[1]) : null, name };
}

/** Tên file "DONG_TIEN_2_BANKING_Template….xlsx" -> { no: 2, name: 'Banking' } */
function streamFromFileName(fileName) {
  const m = /dong[_\s-]*tien[_\s-]*(\d{1,2})?[_\s-]+([a-z0-9]+)/i.exec(String(fileName || ''));
  return m ? { no: m[1] ? Number(m[1]) : null, name: sentence(m[2].toUpperCase()) } : null;
}

function findHeader(rows) {
  for (const row of rows.slice(0, 40)) {
    const map = {};
    row.cells.forEach((cell, i) => {
      if (!cell || typeof cell.v !== 'string') return;
      const h = normKey(cell.v);
      const hit = COLUMNS.find(([field, test]) => map[field] === undefined && test(h));
      if (hit) map[hit[0]] = i;
    });
    if (map.subject !== undefined && (map.owner !== undefined || map.status !== undefined || map.due !== undefined)) return { row: row.r, map };
  }
  return null;
}

/** Cảnh báo cho sheet "Dòng tiền …" không tìm được dòng tiêu đề (dùng chung với gsheet.js để không báo 2 lần). */
export const unreadableWarning = (sheet) =>
  `Sheet “${sheet}” không có dòng tiêu đề hợp lệ (cần các cột “Task / Đầu việc”, “Người phụ trách”, “Hạn hoàn thành”, “Trạng thái”) — chưa đọc được task của sheet này.`;

// Thứ tự cột A–K của file mẫu WR - MASTER TASK.
const MASTER_LAYOUT = ['stt', 'stream', 'group', 'subject', 'owner', 'support', 'due', 'status', 'priority', 'output', 'blocker'];
const MASTER_LABEL = ['STT', 'Dòng tiền', 'Nhóm công việc', 'Task / Đầu việc', 'Người phụ trách', 'Người phối hợp', 'Hạn hoàn thành', 'Trạng thái', 'Ưu tiên', 'Đầu ra cần có', 'Điểm nghẽn / Cần hỗ trợ'];

/**
 * Sheet "Dòng tiền …" có dòng tiêu đề giống file mẫu nhưng vài ô bị đổi tên (vd Google Sheets tự đặt "Cột 4"
 * khi ô tiêu đề của bảng bị xoá): đọc theo thứ tự cột của file mẫu nếu ít nhất 4 ô còn đúng tên ở đúng vị trí.
 */
function masterHeader(rows) {
  for (const row of rows.slice(0, 40)) {
    const wrong = [];
    let hits = 0;
    MASTER_LAYOUT.forEach((field, i) => {
      const cell = row.cells[i];
      const h = cell && typeof cell.v === 'string' ? normKey(cell.v) : '';
      if (h && COLUMNS.find(([f]) => f === field)[1](h)) hits++;
      else wrong.push(`${String.fromCharCode(65 + i)} “${cell?.v ?? ''}” (cần “${MASTER_LABEL[i]}”)`);
    });
    if (hits >= 4) return { row: row.r, map: Object.fromEntries(MASTER_LAYOUT.map((f, i) => [f, i])), wrong };
  }
  return null;
}

function findText(sheets, re, maxRow = 8) {
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (row.r > maxRow) break;
      for (const cell of row.cells) {
        if (cell && typeof cell.v === 'string') {
          const m = re.exec(cell.v);
          if (m) return m;
        }
      }
    }
  }
  return null;
}

const PIC_RE = /phụ\s*trách\s*:\s*([^|\n]+)/iu;
const AS_OF_RE = /(?:thời điểm|ngày)\s*kiểm soát\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/iu;

/** Đọc các dòng task của 1 bảng (sheet + dòng tiêu đề). */
function readRows(sheet, header, { defaultYear, label }) {
  const { map } = header;
  const col = (row, field) => (map[field] === undefined ? undefined : row.cells[map[field]]);
  // File riêng 1 dòng tiền dùng cột "Dòng tiền" cho nhóm con (H300 – DELTA…); file tổng có cột "Nhóm công việc" riêng.
  const groupField = map.group !== undefined ? 'group' : 'stream';
  const streamValues = new Set(); // file tổng: cột "Dòng tiền" của từng dòng, vd "Dòng tiền 2: Banking"
  const tasks = [];
  const warnings = [];
  const unknownStatus = new Set();
  const badDue = [];
  const codes = new Set();
  let hiddenRows = 0;
  let fromGroup = 0; // dòng ghi việc ở cột "Nhóm công việc", để trống cột "Task / Đầu việc"
  for (const row of sheet.rows) {
    if (row.r <= header.row) continue;
    let subject = text(col(row, 'subject'));
    let group = text(col(row, groupField)).slice(0, 80);
    // File tổng: có người ghi việc vào cột "Nhóm công việc" và để trống cột "Task / Đầu việc" -> vẫn lấy dòng đó,
    // tên task = nội dung "Nhóm công việc" (nếu dòng có người phụ trách / trạng thái / hạn, tức là 1 dòng việc thật).
    if (!subject && groupField === 'group' && group && (text(col(row, 'owner')) || text(col(row, 'status')) || col(row, 'due'))) {
      subject = text(col(row, groupField));
      group = '';
      fromGroup++;
    }
    if (!subject) continue;
    const show = normKey(text(col(row, 'show')));
    if (['khong', 'no', 'false', 'an', '0'].includes(show)) { hiddenRows++; continue; }
    if (tasks.length >= MAX_TASKS) {
      warnings.push(`${label}: có hơn ${MAX_TASKS} task — chỉ đọc ${MAX_TASKS} task đầu.`);
      break;
    }
    const status = text(col(row, 'status'));
    if (excelStatus(status) === null) unknownStatus.add(status);
    const dueCell = col(row, 'due');
    const due = dueFromCell(dueCell, defaultYear);
    let code = text(col(row, 'code')).slice(0, 30);
    if (dueCell && !due) badDue.push(`${code || `dòng ${row.r}`} (“${text(dueCell)}”)`);
    if (code && codes.has(code)) code = `${code}·${row.r}`;
    if (code) codes.add(code);
    const link = text(col(row, 'link'));
    const ownerRaw = text(col(row, 'owner'));
    if (groupField === 'group' && map.stream !== undefined) streamValues.add(text(col(row, 'stream')));
    tasks.push({
      row: row.r,
      code,
      group,
      subject,
      owner: cleanOwner(ownerRaw),
      ownerRaw,
      support: text(col(row, 'support')).slice(0, 200),
      due,
      dueText: due ? '' : text(dueCell).slice(0, 60),
      status,
      progress: progressFromCell(col(row, 'progress')),
      output: text(col(row, 'output')),
      blocker: text(col(row, 'blocker')),
      next: map.next === undefined ? null : text(col(row, 'next')), // null = file không có cột này
      priority: text(col(row, 'priority')).slice(0, 20),
      link: map.link === undefined ? null : /^https?:\/\//i.test(link) ? link : '',
      note: text(col(row, 'note')),
    });
  }
  if (hiddenRows) warnings.push(`${label}: bỏ qua ${hiddenRows} dòng có “Hiển thị LED” = Không.`);
  if (fromGroup) warnings.push(`${label}: ${fromGroup} dòng để trống cột “Task / Đầu việc” — đang lấy nội dung cột “Nhóm công việc” làm tên task. Nên ghi việc cụ thể vào cột “Task / Đầu việc”.`);
  if (unknownStatus.size) warnings.push(`${label}: trạng thái chưa nhận dạng được, tạm tính là “Chưa bắt đầu”: ${[...unknownStatus].map((s) => `“${s}”`).join(', ')}.`);
  if (badDue.length) warnings.push(`${label}: không đọc được hạn của ${badDue.slice(0, 5).join(', ')}${badDue.length > 5 ? '…' : ''}.`);
  return { tasks, warnings, streamValues: [...streamValues].filter(Boolean) };
}

function section(stream, sheet, header, extra) {
  let no = stream?.no ?? null;
  const name = stream?.name || '';
  const year = extra.asOf ? Number(extra.asOf.slice(-4)) : extra.year;
  const label = name ? `Dòng tiền ${name}` : `Sheet “${sheet.name}”`;
  const { tasks, warnings, streamValues } = readRows(sheet, header, { defaultYear: year, label });
  // Tên sheet "Dòng tiền Banking" không có số, nhưng cột "Dòng tiền" ghi "Dòng tiền 2: Banking" -> DT02.
  if (!no) {
    const key = normKey(name);
    for (const v of streamValues) {
      const t = parseStreamTitle(v);
      const k = normKey(t?.name);
      if (t?.no && (!key || !k || k === key || k.startsWith(`${key} `) || key.startsWith(`${k} `))) {
        no = t.no;
        break;
      }
    }
  }
  for (const f of ['owner', 'due', 'status']) {
    if (header.map[f] === undefined) warnings.push(`${label}: không có cột “${{ owner: 'Người phụ trách', due: 'Hạn hoàn thành', status: 'Trạng thái' }[f]}”.`);
  }
  return {
    sheet: sheet.name,
    // "Dòng tiền 2: Banking" (file có số dòng tiền) hoặc "Dòng tiền Banking" (tên sheet trong file tổng)
    title: name ? (no ? `Dòng tiền ${no}: ${name}` : `Dòng tiền ${name}`) : `Dòng tiền${no ? ` ${no}` : ''}`,
    streamNo: no,
    code: no ? `DT${pad(no)}` : '',
    name,
    pic: extra.pic || '',
    asOf: extra.asOf || '',
    tasks,
    warnings,
  };
}

/**
 * Đọc cả file: trả về 1 phần (section) cho mỗi dòng tiền có trong file.
 * @param book  kết quả readXlsx()
 * @param opts  { fileName, now }
 * @returns {{ format: 'master' | 'single', sections: object[], unreadable?: {sheet, name}[], warnings: string[] }}
 *   section: { sheet, title, streamNo, code, name, pic, asOf, tasks, warnings }
 *   unreadable: sheet "Dòng tiền …" không tìm được dòng tiêu đề (đã có cảnh báo unreadableWarning)
 */
export function extractWorkbook(book, opts = {}) {
  const year = new Date((opts.now ?? Date.now()) + 7 * 3600000).getUTCFullYear();
  const tables = [];
  const unreadable = []; // sheet "Dòng tiền …" không tìm được dòng tiêu đề
  const notes = [];
  for (const sheet of book.sheets) {
    if (sheet.hidden) continue;
    const stream = parseStreamTitle(sheet.name);
    let header = findHeader(sheet.rows);
    if (!header && stream?.name) {
      header = masterHeader(sheet.rows);
      if (header) notes.push(`Sheet “${sheet.name}”: dòng tiêu đề bị đổi (${header.wrong.join(', ')}) — đang đọc theo thứ tự cột của file mẫu, nên sửa lại dòng tiêu đề.`);
      else unreadable.push({ sheet: sheet.name, name: stream.name });
    }
    if (header) tables.push({ sheet, header, stream });
  }
  if (!tables.length) {
    throw new Error('Không tìm thấy bảng task trong file. Cần 1 dòng tiêu đề có cột “Task / Đầu việc” (hoặc “Nội dung nhiệm vụ”) và “Người phụ trách” / “Hạn hoàn thành” / “Trạng thái”.');
  }

  // Dạng 1 — file tổng: các sheet tên "Dòng tiền …", mỗi sheet 1 dòng tiền.
  const streamSheets = tables.filter((t) => t.stream?.name);
  if (streamSheets.length) {
    const sections = streamSheets.map((t) => {
      const above = { ...t.sheet, rows: t.sheet.rows.filter((r) => r.r < t.header.row) };
      const pic = findText([above], PIC_RE, t.header.row);
      const asOf = findText([above], AS_OF_RE, t.header.row);
      return section(t.stream, t.sheet, t.header, { year, pic: pic ? cleanOwner(pic[1]) : '', asOf: asOf ? asOf[1] : '' });
    });
    const warnings = [...notes, ...sections.flatMap((s) => s.warnings)];
    for (const u of unreadable) warnings.push(unreadableWarning(u.sheet));
    const empty = sections.filter((s) => !s.tasks.length).map((s) => s.name);
    if (empty.length === sections.length) {
      const lost = unreadable.length ? ` Sheet ${unreadable.map((u) => `“${u.sheet}”`).join(', ')} không thấy dòng tiêu đề.` : '';
      throw new Error(`File chưa có task nào: các sheet ${sections.map((s) => `“${s.sheet}”`).join(', ')} mới chỉ có dòng tiêu đề.${lost}`);
    }
    if (empty.length) warnings.push(`Sheet chưa có task: ${empty.join(', ')}.`);
    return { format: 'master', sections, unreadable, warnings };
  }

  // Dạng 2 — file riêng 1 dòng tiền: ưu tiên sheet "…NHAP…TASK…".
  const score = (s) => (/nh[aậ]p/i.test(s.name) ? 0 : /task|nhi[eệ]m v[uụ]/i.test(s.name) ? 1 : 2);
  const best = [...tables].sort((a, b) => score(a.sheet) - score(b.sheet))[0];
  let stream = null;
  for (const row of best.sheet.rows) {
    if (row.r >= best.header.row) break;
    for (const cell of row.cells) if (!stream && cell && typeof cell.v === 'string') stream = parseStreamTitle(cell.v);
  }
  if (!stream) {
    const m = findText(book.sheets, /dòng\s*tiền[^|\n]*/iu);
    stream = (m && parseStreamTitle(m[0])) || streamFromFileName(opts.fileName);
  }
  const pic = findText(book.sheets, PIC_RE);
  const asOf = findText(book.sheets, AS_OF_RE);
  const one = section(stream, best.sheet, best.header, { year, pic: pic ? cleanOwner(pic[1]) : '', asOf: asOf ? asOf[1] : '' });
  if (!one.tasks.length) throw new Error(`Sheet “${best.sheet.name}” không có dòng task nào có nội dung nhiệm vụ.`);
  if (!stream) one.warnings.unshift('Không xác định được tên dòng tiền từ tiêu đề file — hãy chọn dòng tiền cần gắn.');
  return { format: 'single', sections: [one], warnings: one.warnings };
}

/** Đọc thẳng từ nội dung file .xlsx. */
export async function parseWorkbookFile(bytes, opts = {}) {
  return extractWorkbook(await readXlsx(bytes), opts);
}

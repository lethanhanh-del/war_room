// Chuyển dữ liệu thô của 1 sheet "Dòng tiền ..." (mảng 2 chiều từ Google Sheets API,
// valueRenderOption=UNFORMATTED_VALUE, dateTimeRenderOption=SERIAL_NUMBER) thành cấu trúc JSON.
//
// Cấu trúc sheet hiện tại (tham chiếu file "thamkhao_kpi"):
//   Dòng 1: tiêu đề           Dòng 2: ghi chú hướng dẫn
//   Dòng 3: Stt | Nhóm | PIC | <ngày 1> (gộp 2 ô) | ... | <ngày 5> | Tổng kết | Ghi chú / Vướng mắc | Thư mục dữ liệu lưu trữ
//   Dòng 4:                   | KPI | Kết quả | ...                 | Lũy kế đạt | % đạt KPI | Đánh giá
//   Dòng 5+: dữ liệu theo từng PIC
// Parser tự dò vị trí các cột theo tiêu đề nên vẫn chạy nếu thêm/bớt ngày hoặc chèn cột.

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const pad = (n) => String(n).padStart(2, '0');

/** Số serial ngày của Google Sheets/Excel -> 'YYYY-MM-DD' */
export function serialToISO(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = 1970-01-01
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parseHeaderDate(v, fallbackYear) {
  if (typeof v === 'number' && v > 30000 && v < 80000) return serialToISO(v);
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
    if (m) {
      let y = m[3] ? Number(m[3]) : fallbackYear;
      if (y < 100) y += 2000;
      return `${y}-${pad(m[2])}-${pad(m[1])}`;
    }
  }
  return null;
}

/** Chuyển ô thành số: nhận number, "1.234.567", "1,5", "12%"... Trả null nếu trống/không phải số. */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/\s/g, '');
  if (!s) return null;
  const pct = s.endsWith('%');
  if (pct) s = s.slice(0, -1);
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

export class SheetFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SheetFormatError';
    this.status = 422;
  }
}

/**
 * @param {any[][]} values
 * @param {{ fallbackYear?: number }} opts
 */
export function parseCashflowSheet(values, { fallbackYear = new Date().getFullYear() } = {}) {
  const rows = values || [];
  const title = str(rows[0]?.[0]);
  const yearInTitle = title.match(/\d{1,2}\/\d{1,2}\/(\d{4})/);
  const year = yearInTitle ? Number(yearInTitle[1]) : fallbackYear;

  // 1. Tìm dòng tiêu đề có "Nhóm" và "PIC"
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const n = (rows[i] || []).map(normalize);
    if (n.includes('nhom') && n.includes('pic')) {
      h = i;
      break;
    }
  }
  if (h < 0) throw new SheetFormatError('Không tìm thấy dòng tiêu đề có cột "Nhóm" và "PIC"');

  const head = rows[h] || [];
  const sub = rows[h + 1] || [];
  const headN = head.map(normalize);
  const subN = sub.map(normalize);
  const width = Math.max(head.length, sub.length);

  const colStt = Math.max(0, headN.indexOf('stt'));
  const colGroup = headN.indexOf('nhom');
  const colPic = headN.indexOf('pic');
  const colNote = headN.findIndex((x) => x.startsWith('ghi chu') || x.includes('vuong mac'));
  const colFolder = headN.findIndex((x) => x.startsWith('thu muc') || x.includes('luu tru'));

  // 2. Các cột ngày
  const dateCols = [];
  for (let c = colPic + 1; c < width; c++) {
    const iso = parseHeaderDate(head[c], year);
    if (iso) dateCols.push({ c, iso });
  }
  if (!dateCols.length) throw new SheetFormatError('Không tìm thấy cột ngày ở dòng tiêu đề');

  const days = dateCols.map(({ c, iso }, k) => {
    const end = k + 1 < dateCols.length ? dateCols[k + 1].c : c + 2;
    let kpi = -1;
    let result = -1;
    for (let x = c; x < end; x++) {
      if (subN[x] === 'kpi' || subN[x] === 'chi tieu') kpi = x;
      if (subN[x] === 'ket qua') result = x;
    }
    if (kpi < 0) kpi = c;
    if (result < 0) result = kpi + 1;
    return { date: iso, kpiCol: kpi, resultCol: result };
  });

  // 3. Dữ liệu
  const items = [];
  let lastPic = '';
  let lastGroup = '';
  for (let r = h + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const group = str(row[colGroup]);
    const pic = str(row[colPic]);
    const dayVals = days.map((d) => ({
      date: d.date,
      kpi: toNumber(row[d.kpiCol]),
      result: toNumber(row[d.resultCol]),
    }));
    const hasNumbers = dayVals.some((d) => d.kpi !== null || d.result !== null);

    // Dòng trống hoặc dòng tiêu đề nhóm (không có PIC, không có số) -> bỏ qua
    if (!pic && !hasNumbers) {
      if (group) lastGroup = group;
      continue;
    }
    if (pic) lastPic = pic;
    if (group) lastGroup = group;

    items.push({
      row: r + 1, // số dòng trên sheet (1-based)
      stt: str(row[colStt]),
      group: group || lastGroup,
      pic: pic || lastPic,
      note: colNote >= 0 ? str(row[colNote]) : '',
      folder: colFolder >= 0 ? str(row[colFolder]) : '',
      days: dayVals,
    });
  }

  return { title, days: days.map((d) => d.date), items };
}

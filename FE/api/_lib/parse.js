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

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Nội dung task trong ô KPI của 1 ngày (chữ). Trả null nếu trống. */
export function toTask(v) {
  if (v === null || v === undefined || v === false) return null;
  const t = String(v).trim();
  return t ? t : null;
}

const TRUE_WORDS = new Set(['true', '1', 'x', 'v', '✓', '✔', 'ok', 'yes', 'co', 'dat', 'xong', 'done']);
const FALSE_WORDS = new Set(['false', '0', 'khong', 'chua', 'no']);
/** Ô Kết quả (checkbox): true = đã tick, false = chưa tick / bỏ tick, null = trống */
export function toBool(v) {
  if (v === true || v === false) return v;
  if (typeof v === 'number') return v !== 0;
  const t = normalize(v);
  if (!t) return null;
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return null;
}

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
  // Quy ước nhập liệu (theo hướng dẫn ở dòng 2 của sheet, người dùng chọn "cách 1"):
  //  - Dòng CÓ số Stt  = NHÓM NHỎ: cột Nhóm = tên nhóm, cột PIC = trưởng nhóm.
  //  - Dòng KHÔNG có Stt, chèn ngay dưới nhóm = 1 KPI (task): cột Nhóm = tên KPI,
  //    cột PIC = người làm (bỏ trống = trưởng nhóm).
  //  - Nhóm chưa có dòng KPI nào: vẫn hiện 1 dòng "Chưa có KPI" để thấy ai chưa được giao.
  //  - Nếu chính dòng nhóm có ghi task theo ngày -> coi dòng nhóm là 1 dòng KPI.
  const items = [];
  const groups = [];
  let current = null;
  const noteOf = (row) => (colNote >= 0 ? str(row[colNote]) : '');
  const folderOf = (row) => (colFolder >= 0 ? str(row[colFolder]) : '');

  for (let r = h + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const stt = str(row[colStt]);
    const colB = str(row[colGroup]);
    const colC = str(row[colPic]);
    // Mỗi ngày: ô KPI = nội dung task phải làm (chữ), ô Kết quả = checkbox (đã tick hay chưa)
    const dayVals = days.map((d) => ({
      date: d.date,
      task: toTask(row[d.kpiCol]),
      done: toBool(row[d.resultCol]),
    }));
    const hasTasks = dayVals.some((d) => d.task !== null || d.done === true);
    if (!colB && !colC && !hasTasks) continue; // dòng trống (kể cả dòng mẫu chỉ đánh số Stt)

    if (stt) {
      // Nếu cùng tên Nhóm với nhóm đang mở (vd: nhiều dòng đánh số 1, 2, 3... cùng thuộc "Networking" hoặc "H300 – DELTA")
      // thì gộp vào cùng 1 nhóm thay vì lặp lại tiêu đề nhóm ở mọi dòng.
      if (colB && current && current.name && normalize(current.name) === normalize(colB)) {
        if (hasTasks || colC) {
          const firstTask = dayVals.find((d) => d.task)?.task || '';
          current.count += 1;
          items.push({
            row: r + 1,
            stt,
            groupKey: current.key,
            group: current.name,
            lead: current.lead,
            kpi: firstTask,
            pic: colC || current.lead,
            note: noteOf(row),
            folder: folderOf(row) || current.folder,
            days: dayVals,
          });
        }
        continue;
      }

      current = { key: `g${r + 1}`, stt, name: colB, lead: colC, row: r + 1, note: noteOf(row), folder: folderOf(row), count: 0 };
      groups.push(current);
      if (hasTasks) {
        current.count += 1;
        items.push({
          row: r + 1, stt, groupKey: current.key, group: colB, lead: colC,
          kpi: '', pic: colC, note: noteOf(row), folder: folderOf(row), days: dayVals,
        });
      }
      continue;
    }

    if (!current) {
      // KPI nằm trước mọi nhóm -> nhóm ẩn danh
      current = { key: `g${r + 1}`, stt: '', name: '', lead: '', row: r + 1, note: '', folder: '', count: 0 };
      groups.push(current);
    }
    current.count += 1;
    items.push({
      row: r + 1,
      stt: current.stt,
      groupKey: current.key,
      group: current.name,
      lead: current.lead,
      kpi: colB,
      pic: colC || current.lead,
      note: noteOf(row),
      folder: folderOf(row) || current.folder,
      days: dayVals,
    });
  }

  // Nhóm chưa có KPI -> dòng giữ chỗ
  for (const g of groups) {
    if (g.count) continue;
    items.push({
      row: g.row, stt: g.stt, groupKey: g.key, group: g.name, lead: g.lead,
      kpi: '', pic: g.lead, note: g.note, folder: g.folder, placeholder: true,
      days: days.map((d) => ({ date: d.date, task: null, done: null })),
    });
  }
  items.sort((a, b) => a.row - b.row);

  return {
    title: h > 0 ? title : '',
    days: days.map((d) => d.date),
    groups: groups.map(({ key, stt, name, lead }) => ({ key, stt, name, lead })),
    items,
  };
}

// Dựng file .xlsx giả cho test (không cần file thật, không chứa dữ liệu nội bộ).

export const enc = new TextEncoder();
export const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP tối giản (không tính CRC — bộ đọc không kiểm CRC). */
export async function makeZip(files, { deflate = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(content);
    const data = deflate ? await deflateRaw(raw) : raw;
    const method = deflate ? 8 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, method, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, Object.keys(files).length, true);
  eocd.setUint16(10, Object.keys(files).length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

const col = (i) => String.fromCharCode(65 + i);
/** Ô: chuỗi -> inlineStr; {s: n} -> shared string; {n, s} -> số có style; null -> bỏ trống. */
function cellXml(ref, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return `<x:c r="${ref}" t="inlineStr"><x:is><x:t>${xmlEsc(v)}</x:t></x:is></x:c>`;
  if (typeof v === 'number') return `<x:c r="${ref}" t="n"><x:v>${v}</x:v></x:c>`;
  if ('shared' in v) return `<x:c r="${ref}" t="s"><x:v>${v.shared}</x:v></x:c>`;
  return `<x:c r="${ref}" s="${v.style}" t="n"><x:v>${v.n}</x:v></x:c>`;
}
export function sheetXml(rows) {
  const body = rows.map(([r, cells]) => `<x:row r="${r}">${cells.map((v, i) => cellXml(`${col(i)}${r}`, v)).join('')}</x:row>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${body}</x:sheetData></x:worksheet>`;
}

export const D = (serial) => ({ n: serial, style: 1 }); // ô ngày (style 1 = định dạng ngày)
export const PCT = (n) => ({ n, style: 2 }); // ô phần trăm (style 2)

// File tổng "WR - MASTER TASK": mỗi sheet "Dòng tiền …" là 1 dòng tiền, có sheet danh mục ẩn.
export const MASTER_HEADER = ['STT', 'Dòng tiền', 'Nhóm công việc', 'Task / Đầu việc', 'Người phụ trách', 'Người phối hợp', 'Hạn hoàn thành', 'Trạng thái', 'Ưu tiên', 'Đầu ra cần có', 'Điểm nghẽn / Cần hỗ trợ'];
export const MASTER_SHEETS = {
  'Dòng tiền Banking': [
    [1, MASTER_HEADER],
    [2, [1, 'Banking', 'SS1 – Hạn mức', 'Hoàn thiện hồ sơ trình HDBank', 'Nguyễn Thị Mai Thu', 'Huỳnh Ngọc Nhật Tài, Ban PTDA', D(46351), 'Đang thực hiện', 'P0', 'Hồ sơ tổng hợp', 'Chờ FS']],
    [3, [2, 'Banking', 'SS1 – Hạn mức', 'Chốt điều kiện hạn mức', 'Nguyễn Thế Nhiên', '', D(46352), 'Cần hỗ trợ', 'P0', 'Biên bản làm việc', 'Phụ thuộc HDBank']],
    ...Array.from({ length: 50 }, (_, i) => [4 + i, []]), // dòng trống có định dạng
  ],
  'Dòng tiền Tài chính': [[1, MASTER_HEADER], [2, [1, 'Tài chính', 'Kế hoạch', 'Tổng hợp 10 dòng tiền', 'Phạm Thanh Hùng', '', '24/11/2026', 'Hoàn tất', '', 'Báo cáo', '']]],
  'Dòng tiền nợ khó đòi': [[1, MASTER_HEADER]],
  'DataValidation': [[1, ['Company', 'Department']], [2, ['CTM', 'Ban Tài chính']]],
};

/** File tổng: mỗi phần tử của sheets là 1 sheet; "DataValidation" là sheet ẩn. Dòng [] = dòng trống chỉ có định dạng. */
export function masterFile(sheets = MASTER_SHEETS) {
  return workbookFile(sheets);
}

/** Workbook nhiều sheet (ô chuỗi inline); sheet tên "DataValidation" được đánh dấu ẩn. */
export async function workbookFile(sheets) {
  const names = Object.keys(sheets);
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}"${n === 'DataValidation' ? ' state="veryHidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map((n, i) => `<Relationship Id="rId${i + 1}" Type="…/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rS" Type="…/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="9"/></cellXfs></styleSheet>',
  };
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n]).replace(/<x:row r="(\d+)"><\/x:row>/g, '<x:row r="$1"><x:c r="G$1" s="1"/></x:row>');
  });
  return makeZip(files, { deflate: true });
}


// File phân chia nhiệm vụ "DS nhân sự War-Room" (dạng WarRoom_CTHomes_Final_20.11.2026.xlsx)
export const ROSTER_HEADER = ['STT', 'STT dòng tiền', 'Dòng tiền', 'Thành viên', 'Chức danh', 'Phòng ban', 'Đội trưởng/Đội phó', 'Nhiệm vụ thực hiện', 'Ngày', 'Đêm'];
export function rosterFile() {
  return workbookFile({
    'DS nhân sự War-Room': [
      [1, ['', '', '', '', '', '', '', '', 'Ngày 21/11/2026']],
      [2, ROSTER_HEADER],
      [3, [1, '', 'Cố vấn, chỉ đạo', 'Trần Kim Chung', 'Chủ tịch']],
      [4, [2, '', 'Nhóm Tài chính phụ trách triển khai và chịu trách nhiệm 10 dòng tiền', 'Phạm Thanh Hùng', 'Quyền Phó TGĐ', 'Ban TC-KT', 'Đội trưởng']],
      [5, [3, '', '', 'Nguyễn Thế Nhiên', 'Quyền GĐ Ban TC-KT', 'Ban TC-KT', 'Đội phó']],
      [6, [4, 1, 'Dòng tiền bán 4 dự án', 'Hoàng Thị Quỳnh Mai', 'Trưởng Phòng Sales', 'Ban Kinh doanh', 'Đội trưởng', 'Networking', 'X']],
      [7, [5, '', '', 'Mạc Thị Thúy Hiền', 'Trưởng Phòng Đối ngoại', 'Ban Đối ngoại', 'Đội phó', 'Networking']],
      [8, [6, '', '', 'Trương Huỳnh Thúy An', 'Junior AI Engineer', 'DAIT', '', 'Networking']],
      [9, [7, '', '', 'Ngô Thị Thu Thủy', 'Phó TGĐ', 'Ban PTDA', 'Đội trưởng', 'Xử lý pháp lý sổ hồng']],
      [10, [8, '', '', 'Ms Thủy Ngô đề xuất 1 NS phụ trách PLDA', '', 'Ban PTDA', '', 'Xử lý pháp lý sổ hồng']],
      [11, [9, 2, 'Dòng tiền Banking', 'Nguyễn Thị Mai Thu', 'Giám đốc Ban Kế toán 1', 'Ban TC-KT', 'Đội trưởng', 'Kế hoạch kinh doanh SS1 và N20.']],
      [12, [10, '', '', 'Nguyễn Thế Nhiên', 'Quyền GĐ Ban TC-KT', 'Ban TC-KT', 'Đội phó', 'Soát xét tất cả hồ sơ']],
      [13, [11, '', '', 'Võ Trường Sơn', 'Giám đốc BXD', 'Ban XD', '', 'Tiến độ xây dựng']],
      [14, [12, 4, 'Dòng tiền thu trước hạn/quá hạn', 'Hoàng Thị Hà Thu', 'Trưởng phòng CSKH', 'Ban Kinh doanh', 'Đội trưởng', 'Thu trước hạn và quá hạn']],
      [15, [13, 6, 'Trái phiếu', '', '', '', '', 'Chốt lộ trình và nhân sự']],
    ],
    'Nhóm hỗ trợ': [
      [2, ROSTER_HEADER.map((h) => (h === 'Thành viên' ? 'Thành viên tham gia' : h))],
      [3, [1, '', 'Dòng tiền thu trước hạn/quá hạn', 'Trương Thị Thanh Hiền', 'CV CSKH', 'Ban Kinh doanh', '', 'Thu trước hạn và quá hạn']],
      [4, [2, '', 'Nhóm IT', 'Nguyễn Thanh Phong', 'Giám đốc DAIT', 'DAIT', 'Đội trưởng', 'Chuẩn bị tài khoản AI']],
    ],
  });
}

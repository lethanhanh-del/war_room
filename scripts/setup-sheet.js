// Khởi tạo / nâng cấp Google Sheet "Sổ mục tiêu War Room":
//  - tạo các tab còn thiếu, ghi tiêu đề cột, thêm cột mới nếu phiên bản mới có thêm cột
//  - đặt locale vi_VN + múi giờ Asia/Ho_Chi_Minh, cố định dòng tiêu đề, danh sách chọn (dropdown)
//  - bảo vệ (cảnh báo khi sửa) tab NhatKy và DeXuatAI
//  - nạp dữ liệu khởi tạo vào tab còn trống (bỏ qua bằng --no-seed)
// Chạy: npm run setup-sheet   (hoặc trong Docker: docker compose run --rm warroom node scripts/setup-sheet.js)
import fs from 'node:fs';
import { config } from '../src/config.js';
import { googleClients, columnLetter, safeCell } from '../src/store/sheets.js';
import { COLUMNS, TARGET_STATUS, STAGES, DECISION_STATUS, PROPOSAL_STATUS, STREAM_FLAGS, SHIFT_NAMES, keyOfLabel } from '../src/schema.js';
import { SEED } from '../src/seed.js';

const seed = !process.argv.includes('--no-seed');
const spreadsheetId = config.spreadsheetId;
if (!spreadsheetId) {
  console.error('Thiếu SPREADSHEET_ID trong .env');
  process.exit(1);
}

let saEmail = '';
try {
  saEmail = JSON.parse(fs.readFileSync(config.googleCredentials, 'utf8')).client_email;
} catch {
  /* dùng ADC */
}

const { sheets } = googleClients(config.googleCredentials);
const quote = (t) => `'${t}'`;

const VALIDATIONS = {
  MucTieu: { status: TARGET_STATUS, stage: STAGES.map((_, i) => String(i + 1)) },
  DongTien: { flag: STREAM_FLAGS },
  QuyetDinh: { status: DECISION_STATUS },
  DeXuatAI: { status: PROPOSAL_STATUS },
  CaTruc: { shift: SHIFT_NAMES },
};
const WIDE = new Set(['title', 'output', 'criteria', 'blocker', 'content', 'quote', 'note', 'proposed', 'current', 'impact', 'result', 'removedReason']);
const PROTECTED = ['NhatKy', 'DeXuatAI'];

async function getMeta() {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets(properties(sheetId,title),protectedRanges(range))',
  });
  return res.data;
}

async function main() {
  let meta;
  try {
    meta = await getMeta();
  } catch (err) {
    console.error(`Không mở được Sheet: ${err.message}`);
    if (saEmail) console.error(`→ Hãy chia sẻ Sheet cho service account với quyền Người chỉnh sửa: ${saEmail}`);
    process.exit(1);
  }
  console.log(`Sheet: ${meta.properties.title}`);

  const existing = new Set(meta.sheets.map((s) => s.properties.title));
  const requests = [{
    updateSpreadsheetProperties: { properties: { locale: 'vi_VN', timeZone: 'Asia/Ho_Chi_Minh' }, fields: 'locale,timeZone' },
  }];
  for (const tab of Object.keys(COLUMNS)) {
    if (!existing.has(tab)) requests.push({ addSheet: { properties: { title: tab } } });
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  meta = await getMeta();
  const sheetId = Object.fromEntries(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const protectedTabs = new Set(meta.sheets.filter((s) => (s.protectedRanges || []).length).map((s) => s.properties.title));

  // Tiêu đề cột (giữ thứ tự hiện có, thêm cột mới vào cuối)
  const heads = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: Object.keys(COLUMNS).map((t) => `${quote(t)}!1:1`) });
  const headerOf = {};
  const headerWrites = [];
  Object.keys(COLUMNS).forEach((tab, i) => {
    const current = ((heads.data.valueRanges[i] || {}).values || [[]])[0].map((h) => String(h).trim()).filter(Boolean);
    const missing = COLUMNS[tab].map(([, l]) => l).filter((l) => !current.some((c) => c.toLowerCase() === l.toLowerCase()));
    headerOf[tab] = [...current, ...missing];
    if (missing.length) {
      headerWrites.push({ range: `${quote(tab)}!A1`, values: [headerOf[tab]] });
      console.log(`  ${tab}: ${current.length ? `thêm cột ${missing.join(', ')}` : 'tạo tiêu đề'}`);
    }
  });
  if (headerWrites.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: headerWrites } });
  }

  // Định dạng, danh sách chọn, bảo vệ
  const fmt = [];
  for (const tab of Object.keys(COLUMNS)) {
    const id = sheetId[tab];
    fmt.push({ updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
    fmt.push({
      repeatCell: {
        range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.027, green: 0.102, blue: 0.2 }, wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(textFormat,backgroundColor,wrapStrategy)',
      },
    });
    headerOf[tab].forEach((label, c) => {
      const key = keyOfLabel(tab, label);
      fmt.push({
        updateDimensionProperties: {
          range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
          properties: { pixelSize: WIDE.has(key) ? 300 : key === 'id' ? 80 : 150 },
          fields: 'pixelSize',
        },
      });
      const list = VALIDATIONS[tab]?.[key];
      if (list) {
        fmt.push({
          setDataValidation: {
            range: { sheetId: id, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: c, endColumnIndex: c + 1 },
            rule: { condition: { type: 'ONE_OF_LIST', values: list.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
          },
        });
      }
    });
    if (PROTECTED.includes(tab) && !protectedTabs.has(tab)) {
      fmt.push({
        addProtectedRange: {
          protectedRange: {
            range: { sheetId: id },
            description: tab === 'NhatKy' ? 'Nhật ký chỉ thêm — không sửa, không xoá' : 'Duyệt đề xuất trên dashboard',
            warningOnly: true,
          },
        },
      });
    }
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: fmt } });

  // Dữ liệu khởi tạo
  if (seed) {
    const counts = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ['MucTieu', 'DongTien', 'QuyetDinh', 'CaTruc'].map((t) => `${quote(t)}!A2:A`) });
    const tabs = ['MucTieu', 'DongTien', 'QuyetDinh', 'CaTruc'];
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const hasData = ((counts.data.valueRanges[i] || {}).values || []).length > 0;
      if (hasData || !(SEED[tab] || []).length) continue;
      const keys = headerOf[tab].map((h) => keyOfLabel(tab, h));
      const values = SEED[tab].map((row) => keys.map((k) => (k ? safeCell(row[k] ?? '') : '')));
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${quote(tab)}!A2:${columnLetter(keys.length - 1)}${values.length + 1}`,
        valueInputOption: 'USER_ENTERED', requestBody: { values },
      });
      console.log(`  ${tab}: nạp ${values.length} dòng khởi tạo`);
    }
  }
  console.log('Xong. Mở Sheet để kiểm tra, rồi chạy dashboard.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

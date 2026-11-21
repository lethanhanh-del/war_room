#!/usr/bin/env node
// Kiểm tra Service Account đọc được Google Sheet và parse đúng 5 sheet dòng tiền (chỉ đọc, không sửa gì).
//
// Cách dùng (từ thư mục gốc repo, sau khi `cd FE && npm install`):
//   node deploy/check-sheet.mjs --key path/to/service-account.json --sheet <GOOGLE_SHEET_ID>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const feDir = path.resolve(here, '..', 'FE');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const keyFile = arg('key');
const sheetId = arg('sheet');
if (!keyFile || !sheetId) {
  console.error('Ví dụ: node deploy/check-sheet.mjs --key ./sa.json --sheet 1AbC...xyz');
  process.exit(1);
}
if (!fs.existsSync(path.join(feDir, 'node_modules'))) {
  console.error('Chưa cài dependency. Chạy: cd FE && npm install');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
process.env.GOOGLE_SHEET_ID = sheetId;
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = sa.client_email;
process.env.GOOGLE_PRIVATE_KEY = sa.private_key;
process.env.MOCK_SHEETS = 'false';

const { getDashboardData } = await import(pathToFileURL(path.join(feDir, 'api/_lib/sheets.js')).href);

try {
  const d = await getDashboardData({ force: true });
  console.log(`✔ Đọc được Google Sheet: "${d.spreadsheetTitle}"  (service account: ${sa.client_email})\n`);
  let bad = 0;
  d.flows.forEach((f, i) => {
    if (f.error) {
      bad++;
      console.log(`✖ Ô ${i + 2} · ${f.label}: ${f.error}`);
      return;
    }
    const kpis = f.items.filter((it) => !it.placeholder);
    const withKpi = kpis.filter((it) => it.days.some((x) => x.task !== null)).length;
    const ticked = kpis.reduce((a, it) => a + it.days.filter((x) => x.done === true).length, 0);
    const noKpi = f.items.filter((it) => it.placeholder).map((it) => it.group);
    console.log(
      `✔ Ô ${i + 2} · ${f.label}  ←  sheet "${f.sheet}"\n    ngày: ${f.days.join(', ')}\n    ${f.groups.length} nhóm nhỏ, ${kpis.length} dòng KPI (${withKpi} dòng đã ghi task, ${ticked} ô đã tick)` +
        (noKpi.length ? `\n    nhóm chưa có dòng KPI: ${noKpi.join(', ')}` : '')
    );
  });
  process.exit(bad ? 2 : 0);
} catch (err) {
  console.error(`✖ ${err.message}`);
  if (/403/.test(err.message)) console.error(`  → Bật Google Sheets API và share Google Sheet cho ${sa.client_email} (quyền Viewer là đủ)`);
  if (/404/.test(err.message)) console.error('  → Kiểm tra lại GOOGLE_SHEET_ID');
  process.exit(1);
}

#!/usr/bin/env node
// Khởi tạo Google Sheet làm DB: tạo tab (mặc định "Tasks") nếu chưa có và ghi dòng tiêu đề.
//
// Cách dùng (chạy từ thư mục gốc repo, sau khi `cd FE && npm install`):
//   node deploy/init-sheet.mjs --key path/to/service-account.json --sheet <GOOGLE_SHEET_ID> [--tab Tasks]
//
// Yêu cầu: đã share Google Sheet cho email service account với quyền Editor.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const feDir = path.resolve(here, '..', 'FE');
const require = createRequire(path.join(feDir, 'package.json'));

const COLUMNS = ['id', 'title', 'description', 'assignee', 'status', 'priority', 'due_date', 'created_at', 'updated_at'];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const keyFile = arg('key');
const sheetId = arg('sheet');
const tab = arg('tab', 'Tasks');
if (!keyFile || !sheetId) {
  console.error('Thiếu tham số. Ví dụ:\n  node deploy/init-sheet.mjs --key ./sa.json --sheet 1AbC...xyz [--tab Tasks]');
  process.exit(1);
}

let JWT;
try {
  ({ JWT } = require('google-auth-library'));
} catch {
  console.error('Chưa cài dependency. Chạy: cd FE && npm install');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
const client = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const call = (url, opts = {}) => client.request({ url: base + url, ...opts }).then((r) => r.data);

try {
  const meta = await call('?fields=properties.title,sheets.properties(sheetId,title)');
  console.log(`✔ Kết nối được Google Sheet: "${meta.properties.title}"`);

  if (!meta.sheets.some((s) => s.properties.title === tab)) {
    await call(':batchUpdate', {
      method: 'POST',
      data: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
    });
    console.log(`✔ Đã tạo tab "${tab}"`);
  } else {
    console.log(`• Tab "${tab}" đã tồn tại`);
  }

  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:I1`);
  const head = await call(`/values/${range}`);
  const current = (head.values || [])[0] || [];
  if (current.length === 0) {
    await call(`/values/${range}?valueInputOption=RAW`, { method: 'PUT', data: { values: [COLUMNS] } });
    console.log('✔ Đã ghi dòng tiêu đề:', COLUMNS.join(', '));
  } else if (current.join() === COLUMNS.join()) {
    console.log('• Dòng tiêu đề đã đúng, không thay đổi');
  } else {
    console.error('✖ Dòng 1 đã có dữ liệu khác cấu trúc mong đợi. Không ghi đè. Hiện tại:', current.join(', '));
    process.exit(2);
  }
  console.log('\nXong. Service account:', sa.client_email);
} catch (err) {
  const status = err?.response?.status;
  const msg = err?.response?.data?.error?.message || err.message;
  console.error(`✖ Lỗi${status ? ` ${status}` : ''}: ${msg}`);
  if (status === 403) console.error('  → Kiểm tra đã bật Google Sheets API và share sheet cho', sa.client_email, '(Editor)');
  if (status === 404) console.error('  → Kiểm tra lại GOOGLE_SHEET_ID');
  process.exit(1);
}

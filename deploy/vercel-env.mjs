#!/usr/bin/env node
// Đẩy biến môi trường lên Vercel từ file service account JSON (không cần copy/paste private key thủ công).
//
// Yêu cầu: đã cài & đăng nhập Vercel CLI (`npm i -g vercel` rồi `vercel login`)
//          và đã link project: `cd FE && vercel link`
//
// Cách dùng (từ thư mục gốc repo):
//   node deploy/vercel-env.mjs --key path/to/service-account.json --sheet <GOOGLE_SHEET_ID> \
//        [--tab Tasks] [--access-key <chuỗi bí mật>] [--targets production[,preview]]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const feDir = path.resolve(here, '..', 'FE');
const isWin = process.platform === 'win32';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const keyFile = arg('key');
const sheetId = arg('sheet');
if (!keyFile || !sheetId) {
  console.error('Ví dụ: node deploy/vercel-env.mjs --key ./sa.json --sheet 1AbC...xyz --access-key MySecret');
  process.exit(1);
}
const sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
const targets = arg('targets', 'production').split(',').map((s) => s.trim()).filter(Boolean);

const vars = {
  GOOGLE_SHEET_ID: sheetId,
  GOOGLE_SHEET_TAB: arg('tab', 'Tasks'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: sa.client_email,
  GOOGLE_PRIVATE_KEY: sa.private_key,
};
const accessKey = arg('access-key');
if (accessKey) vars.APP_ACCESS_KEY = accessKey;
else console.warn('⚠ Không có --access-key: API sẽ mở công khai cho bất kỳ ai có URL.');

function vercel(args, input) {
  return spawnSync('vercel', args, { cwd: feDir, input, encoding: 'utf8', shell: isWin });
}

if (!fs.existsSync(path.join(feDir, '.vercel', 'project.json'))) {
  console.error('Chưa link project Vercel. Chạy: cd FE && vercel link');
  process.exit(1);
}

for (const target of targets) {
  for (const [name, value] of Object.entries(vars)) {
    vercel(['env', 'rm', name, target, '--yes']); // xoá giá trị cũ nếu có (bỏ qua lỗi)
    const r = vercel(['env', 'add', name, target], value);
    if (r.status !== 0) {
      console.error(`✖ ${name} (${target}):`, (r.stderr || r.stdout || '').trim());
      process.exit(1);
    }
    console.log(`✔ ${name} -> ${target}`);
  }
}
console.log('\nXong. Deploy lại để áp dụng biến môi trường mới: cd FE && vercel --prod');

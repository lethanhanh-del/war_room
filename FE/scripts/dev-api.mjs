// Dev API server: chạy các handler trong thư mục api/ giống Vercel, không cần Vercel CLI.
// Dùng: npm run dev:api  (đọc biến môi trường từ FE/.env nếu có)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.API_PORT || 3001);

export function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let [, key, value] = m;
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('Body quá lớn'));
        req.destroy();
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const m = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/i);
    const file = m && path.join(root, 'api', `${m[1]}.js`);
    if (!file || !fs.existsSync(file)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    try {
      const raw = await readBody(req);
      req.query = Object.fromEntries(url.searchParams);
      if (raw && String(req.headers['content-type'] || '').includes('application/json')) {
        try {
          req.body = JSON.parse(raw);
        } catch {
          req.body = raw;
        }
      } else {
        req.body = raw || undefined;
      }
      const mod = await import(pathToFileURL(file).href);
      await mod.default(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Lỗi máy chủ' }));
      }
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv(path.join(root, '.env'));
  createServer().listen(PORT, () => {
    const mode = process.env.MOCK_SHEETS === 'true' ? 'MOCK (dữ liệu giả)' : 'Google Sheets';
    console.log(`[dev-api] http://localhost:${PORT}/api  —  chế độ: ${mode}`);
  });
}

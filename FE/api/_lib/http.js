import { timingSafeEqual } from 'node:crypto';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Kiểm tra header x-access-key nếu APP_ACCESS_KEY được cấu hình.
 * Trả về true nếu hợp lệ, ngược lại tự trả 401 và trả về false.
 */
export function checkAccess(req, res) {
  const expected = process.env.APP_ACCESS_KEY;
  if (!expected) return true;
  const got = String(req.headers['x-access-key'] || '');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length === b.length && timingSafeEqual(a, b)) return true;
  send(res, 401, { error: 'Sai hoặc thiếu access key' });
  return false;
}

export function getBody(req) {
  // Vercel tự parse JSON vào req.body; dev server cũng làm tương tự.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  return body;
}

export function handleError(res, err) {
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[api]', err);
  // Không trả stack trace ra ngoài.
  send(res, status, { error: status >= 500 && !err?.status ? 'Lỗi máy chủ' : err.message });
}

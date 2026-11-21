// GET /api/health -> kiểm tra API sống và cấu hình đã đủ chưa (không lộ giá trị bí mật)
import { isMock, flowConfig } from './_lib/sheets.js';
import { send } from './_lib/http.js';

export default function handler(req, res) {
  const has = (k) => Boolean(process.env[k]);
  send(res, 200, {
    status: 'ok',
    mode: isMock() ? 'mock' : 'google-sheets',
    config: {
      GOOGLE_SHEET_ID: has('GOOGLE_SHEET_ID'),
      GOOGLE_SERVICE_ACCOUNT_EMAIL: has('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
      GOOGLE_PRIVATE_KEY: has('GOOGLE_PRIVATE_KEY'),
      APP_ACCESS_KEY: has('APP_ACCESS_KEY'),
    },
    flows: flowConfig().map((f) => f.sheet),
    authRequired: has('APP_ACCESS_KEY'),
  });
}

// GET /api/dashboard          -> dữ liệu 5 dòng tiền (đã chuẩn hoá) cho màn hình War Room
// GET /api/dashboard?force=1  -> bỏ qua cache, đọc lại Google Sheet ngay
import { getDashboardData } from './_lib/sheets.js';
import { todayVN } from './_lib/time.js';
import { checkAccess, handleError, send } from './_lib/http.js';

export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Method không được hỗ trợ' });
  }
  try {
    const force = new URL(req.url, 'http://x').searchParams.get('force') === '1';
    const data = await getDashboardData({ force });
    return send(res, 200, { ...data, today: todayVN() });
  } catch (err) {
    return handleError(res, err);
  }
}

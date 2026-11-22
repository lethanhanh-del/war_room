// Tải Excel bản chốt sổ KPI theo ngày, để đối soát (KPI-CLOSE). Chỉ admin (src/index.js đã chặn).
//   GET /api/admin/kpi-close                 -> danh sách ngày đã chốt (JSON)
//   GET /api/admin/kpi-close?day=YYYY-MM-DD  -> file chot-so-KPI-YYYY-MM-DD.xlsx
//
// File gồm 3 tab:
//   "Chốt sổ"  : từng task của ngày: lúc 05:00 (bản chốt trong D1, ghi 1 lần không sửa) | hiện tại trên Sheet | kết quả | lịch sử ô
//   "Tổng hợp" : đếm theo dòng tiền
//   "Nhật ký"  : nhật ký chốt sổ / lỗi / xác nhận của ngày đó
// Cột "Lúc chốt" là căn cứ đối soát; "Hiện tại" lấy theo lần đọc Sheet gần nhất (ghi ở đầu file).

import { log } from '../db.js';
import { json } from '../http.js';
import { LATE_TRACKING_START, activeConfirms, cellKey, ensureTables, findTask, obsMaps, readTime, tasksOfDay } from './close.js';
import { writeXlsx } from './xlsx-write.js';

const AT_CLOSE = { D: 'Đã tick', K: 'Chưa tick', U: 'Không xác định (tính đã tick)' };
const RESULT = { D: 'Hoàn thành', L: 'Hoàn thành trễ hạn', K: 'Tồn đọng' };
const BASIS = {
  exact: 'exact — trạng thái tick không đổi giữa lượt đọc trước và sau hạn (chính xác)',
  window: 'window — có ô đổi giữa 2 lượt đọc, lượt trước cách hạn ≤ 2 phút: tính theo lượt trước (sai số ±1 phút)',
  gap: 'gap — server ngừng chạy quanh giờ chốt; ô chỉ tick ở lượt sau ghi là không xác định (tính đã tick)',
  none: 'none — chưa có lượt đọc nào trước hạn (mới bật); ô đã tick tính là đã tick, trừ ô có giờ tick ghi sau hạn',
};

/** ISO -> "dd/mm/yyyy hh:mm:ss" giờ VN. */
const vn = (iso) => {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const s = new Date(t + 7 * 3600e3).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 19)}`;
};
const dmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Trạng thái cuối giống public/kpi-model.js › statusOf cho ngày đã chốt (chỉ tính trễ hạn từ LATE_TRACKING_START). */
const resultOf = (closed, ticked, day) => (ticked ? (closed === 'K' && (!day || day >= LATE_TRACKING_START) ? 'L' : 'D') : 'K');

/**
 * Dòng đối soát của 1 ngày (hàm thuần, để test).
 * @param close    { day, data: [[s,g,p,k,v,label?]] }
 * @param streams  dữ liệu Sheet đã lưu (kpi_sheet, chưa gắn người)
 * @param cellLog  [{ cell, at, change }] của ngày đó
 * @param labels   obsMaps(lượt đọc).labels (tên hiển thị) — dùng cho bản chốt cũ chưa lưu tên
 * @param confirms Map "day|cell" -> xác nhận đang hiệu lực
 */
export function reconcileRows(close, streams, cellLog, labels, confirms) {
  const day = close.day;
  const list = close.data.map(([s, g, p, k, v, label]) => ({ s, g, p, k, v, label, used: false }));
  const historyOf = (cell) => cellLog.filter((x) => x.cell === cell).map((x) => `${vn(x.at)} ${x.change === 'tick' ? 'tick' : 'bỏ tick'}`).join('; ');
  const rows = [];
  for (const t of tasksOfDay(streams, day)) {
    const c = t.cell;
    const [stream, group, person, kpi] = t.label;
    const hit = findTask(list, t);
    if (hit) hit.used = true;
    const key = cellKey(hit || t);
    const ok = hit && hit.v === 'K' ? confirms.get(`${day}|${key}`) : null;
    const closed = ok ? 'D' : hit ? hit.v : 'K';
    const ticked = c.res === 'D';
    const status = resultOf(closed, ticked, day);
    const notes = [];
    if (!hit) notes.push('Thêm vào Sheet sau khi chốt');
    if (hit && hit.v === 'D' && !ticked) notes.push('Đã tick lúc chốt, nay bị bỏ tick');
    if (ok) notes.push(`Admin ${ok.by} xác nhận đúng hạn lúc ${vn(ok.at)}: ${ok.reason}`);
    rows.push({
      stream, group, person, kpi,
      atClose: hit ? AT_CLOSE[hit.v] + (ok ? ' → admin xác nhận đúng hạn' : '') : 'Chưa có lúc chốt',
      now: ticked ? 'Đã tick' : 'Chưa tick',
      status, result: RESULT[status],
      tickAt: ticked && status === 'L' ? vn(c.at) : '',
      history: historyOf(key), note: notes.join('. '),
    });
  }
  // Task có trong bản chốt nhưng không còn trên Sheet (đã xoá dòng / sửa tên): vẫn liệt kê để đối soát.
  for (const x of list) {
    if (x.used) continue;
    const [stream, group, person, kpi] = x.label || labels?.[`${day}|${cellKey(x)}`] || [x.s, x.g, x.p, x.k];
    rows.push({
      stream, group, person, kpi, atClose: AT_CLOSE[x.v], now: 'Không còn trên Sheet', status: '', result: '',
      tickAt: '', history: historyOf(cellKey(x)), note: 'Dòng đã bị xoá hoặc đổi nội dung sau khi chốt',
    });
  }
  return rows;
}

/** Nội dung workbook (mảng tab cho writeXlsx). */
export function closeWorkbook({ close, rows, logs, sheetUrl, checkedAt, by, now }) {
  const head = ['STT', 'Dòng tiền', 'Nhóm', 'Người thực hiện', 'KPI', 'Lúc chốt sổ', 'Hiện tại trên Sheet', 'Kết quả', 'Giờ tick (trễ hạn)', 'Lịch sử ô', 'Ghi chú'];
  const info = [
    ['BẢN CHỐT SỔ KPI — ĐỐI SOÁT'],
    ['Ngày KPI', dmy(close.day)],
    ['Hạn chốt', vn(close.deadline)],
    ['Chốt lúc', vn(close.closed_at)],
    ['Căn cứ', BASIS[close.basis] || close.basis],
    ['Lượt đọc Sheet', typeof readTime(close.rev_b) === 'number' ? `phiên bản ${close.rev_a ?? '—'} / ${close.rev_b}` : `trước hạn: ${vn(readTime(close.rev_a)) || 'không có (mới bật)'} · sau hạn: ${vn(readTime(close.rev_b))}`],
    ['Google Sheet', sheetUrl],
    ['Sheet đọc lần cuối', vn(checkedAt)],
    ['Xuất lúc', `${vn(new Date(now).toISOString())} — ${by}`],
    ['Lưu ý', '"Lúc chốt" lấy từ bản chốt lưu trong hệ thống (ghi 1 lần, không sửa). "Hiện tại" và "Kết quả" theo lần đọc Sheet gần nhất ở trên.'],
    [],
  ];
  const main = [...info, head, ...rows.map((r, i) => [i + 1, r.stream, r.group, r.person, r.kpi, r.atClose, r.now, r.result, r.tickAt, r.history, r.note])];

  const by_ = new Map();
  for (const r of rows) {
    const c = by_.get(r.stream) || { total: 0, D: 0, L: 0, K: 0, gone: 0 };
    c.total++;
    if (r.status) c[r.status]++;
    else c.gone++;
    by_.set(r.stream, c);
  }
  const sum = { total: 0, D: 0, L: 0, K: 0, gone: 0 };
  for (const c of by_.values()) for (const k of Object.keys(sum)) sum[k] += c[k];
  const line = (name, c) => [name, c.total, c.D, c.L, c.K, c.gone];
  const summary = [
    [`Tổng hợp chốt sổ ngày ${dmy(close.day)}`],
    [],
    ['Dòng tiền', 'Tổng task', 'Hoàn thành', 'Hoàn thành trễ hạn', 'Tồn đọng', 'Không còn trên Sheet'],
    ...[...by_].map(([name, c]) => line(name, c)),
    line('Tổng', sum),
  ];
  const journal = [['Thời gian', 'Loại', 'Chi tiết'], ...logs.map((l) => [vn(l.at), l.kind, l.detail])];

  return [
    { name: 'Chốt sổ', rows: main, bold: [0, info.length], widths: [6, 24, 22, 22, 50, 26, 20, 20, 20, 40, 40] },
    { name: 'Tổng hợp', rows: summary, bold: [0, 2, summary.length - 1], widths: [30, 12, 14, 20, 12, 22] },
    { name: 'Nhật ký', rows: journal, bold: [0], widths: [22, 12, 100] },
  ];
}

/** GET /api/admin/kpi-close[?day=YYYY-MM-DD] */
export async function handleKpiCloseExport(request, env, url, user) {
  if (request.method !== 'GET') return json({ error: 'Chỉ hỗ trợ GET.' }, 405);
  const { kpiSheetId, kpiSourceKey } = await import('./index.js');
  const { sourceUrlOf } = await import('../excel/sharepoint.js');
  const rawId = kpiSheetId(env);
  const id = kpiSourceKey(env);
  if (!id) return json({ error: 'Đồng bộ KPI đang tắt.' }, 400);
  await ensureTables(env);
  const day = url.searchParams.get('day') || '';
  if (!day) {
    const { results } = await env.DB.prepare('SELECT day, closed_at, deadline, basis, rev_a, rev_b, data FROM kpi_close WHERE sheet = ? ORDER BY day DESC').bind(id).all();
    return json({
      days: results.map((c) => {
        const count = { D: 0, K: 0, U: 0 };
        try { for (const x of JSON.parse(c.data)) count[x[4]]++; } catch { /* bỏ qua */ }
        return { day: c.day, closedAt: c.closed_at, deadline: c.deadline, basis: c.basis, readBefore: readTime(c.rev_a), readAfter: readTime(c.rev_b), count };
      }),
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'Ngày không hợp lệ (YYYY-MM-DD).' }, 400);
  const close = await env.DB.prepare('SELECT day, closed_at, deadline, basis, rev_a, rev_b, data FROM kpi_close WHERE sheet = ? AND day = ?').bind(id, day).first();
  if (!close) return json({ error: `Ngày ${day} chưa chốt sổ.` }, 404);
  const [sheet, obs, cellLog, logs, confirms] = await Promise.all([
    env.DB.prepare('SELECT checked_at, data FROM kpi_sheet WHERE id = 1').first(),
    env.DB.prepare('SELECT data FROM kpi_close_obs WHERE id = 1').first(),
    env.DB.prepare('SELECT cell, at, change FROM kpi_cell_log WHERE sheet = ? AND day = ? ORDER BY id').bind(id, day).all(),
    env.DB.prepare('SELECT at, kind, detail FROM kpi_audit_log WHERE sheet = ? AND day = ? ORDER BY id').bind(id, day).all(),
    activeConfirms(env, id),
  ]);
  const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const rows = reconcileRows({ day, data: parse(close.data, []) }, parse(sheet?.data, []), cellLog.results, obsMaps(parse(obs?.data, {})).labels, confirms);
  const book = closeWorkbook({
    close, rows, logs: logs.results, sheetUrl: sourceUrlOf(rawId),
    checkedAt: sheet?.checked_at || '', by: user.username, now: Date.now(),
  });
  await log(env, request, user.username, 'kpi_close_export', `Tải Excel chốt sổ ${day}`);
  return new Response(writeXlsx(book), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="chot-so-KPI-${day}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

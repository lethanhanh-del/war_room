// Thời điểm hoàn thành KPI, để biết KPI nào "Hoàn thành trễ hạn".
//
// Google Sheet không lưu giờ tick ô Kết quả. Mỗi lần đồng bộ (cron mỗi phút, src/kpi/index.js), Worker so với lần đọc
// trước: ô vừa chuyển sang Đạt (res 'D') được ghi `at` = lúc Worker thấy lần đầu (trễ tối đa khoảng 1 phút so với lúc
// tick thật). Trình duyệt so `at` với ngày của KPI (public/kpi-model.js › isLateTick): tick sau khi hết ngày = trễ hạn.
//
// - Ô đã Đạt từ trước khi có tính năng này, hoặc đã Đạt ngay ở lần đầu đọc dòng tiền đó: không biết giờ tick ->
//   không có `at`, tính là đúng hạn.
// - Bỏ tick rồi tick lại: tính theo lần tick sau.
// - Nhận ra cùng 1 ô qua 2 lần đọc theo nội dung (dòng tiền + nhóm + người + ngày + KPI), không được thì theo vị trí
//   (dòng tiền + số dòng + ngày) — để chèn dòng hoặc sửa chữ KPI không làm mất giờ tick.

import { normKey } from '../worksuite/model.js';

const streamKey = (s) => normKey(s.name).replace(/^dong tien\s*[:\-–]?\s*/, '');
const contentKey = (s, g, r, date, cell) => [streamKey(s), normKey(g.name), normKey(r.person), date, normKey(cell.kpi)].join('|');
const rowKey = (s, r, date) => [streamKey(s), r.row, date].join('|');

/**
 * Gắn `at` (ISO) cho các ô Đạt của `streams` (sửa tại chỗ) dựa trên lần đọc trước `prev`.
 * @param {object[]} streams  kết quả parseKpiBook().streams của lần đọc này
 * @param {object[] | null} prev  dữ liệu đã lưu của lần đọc trước (null / [] = chưa đọc lần nào)
 * @param {number} now
 */
export function stampTicks(streams, prev, now = Date.now()) {
  const byContent = new Map();
  const byRow = new Map();
  for (const s of prev || []) {
    for (const g of s.groups || []) {
      for (const r of g.rows || []) {
        for (const [date, cell] of Object.entries(r.cells || {})) {
          byContent.set(contentKey(s, g, r, date, cell), cell);
          byRow.set(rowKey(s, r, date), cell);
        }
      }
    }
  }
  // Dòng tiền chưa có ở lần đọc trước (lần đọc đầu tiên, hoặc tab mới thêm): không biết các ô đã tick được tick lúc nào.
  const known = new Set((prev || []).map((s) => streamKey(s)));
  const stamp = new Date(now).toISOString();
  for (const s of streams) {
    const first = !known.has(streamKey(s));
    for (const g of s.groups || []) {
      for (const r of g.rows || []) {
        for (const [date, cell] of Object.entries(r.cells || {})) {
          if (cell.res !== 'D') continue;
          const old = byContent.get(contentKey(s, g, r, date, cell)) || byRow.get(rowKey(s, r, date));
          const at = old?.res === 'D' ? old.at || '' : first ? '' : stamp;
          if (at) cell.at = at;
        }
      }
    }
  }
  return streams;
}

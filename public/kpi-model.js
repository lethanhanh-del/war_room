// Mô hình dữ liệu trang "KPI & kết quả" (/kpi). Không đụng tới DOM: dùng chung cho trình duyệt và test Node.
//
// Mỗi ô (1 người, 1 ngày) có KPI và kết quả trên sheet: res 'D' = Đạt, 'K' = Không đạt, '' = chưa nhập, '?' = chữ khác.
// Trạng thái hiển thị:
//   D Đạt · K Không đạt · C Chưa cập nhật (ô kết quả trống, ngày đã qua hoặc hôm nay) · S Sắp tới (ngày chưa tới).
// Tồn đọng = Không đạt + Chưa cập nhật tính đến ngày đang xem.

export const STATUS_LABEL = { D: 'Đạt', K: 'Không đạt', C: 'Chưa cập nhật', S: 'Sắp tới' };
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "2026-11-23" -> "T2". */
export const weekday = (date) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] || '';

/** Trạng thái 1 ô KPI; null = ngày đó không có KPI. */
export function statusOf(cell, date, today) {
  if (!cell || (!cell.kpi && !cell.res)) return null;
  if (cell.res === 'D') return 'D';
  if (cell.res === 'K') return 'K';
  return date > today ? 'S' : 'C';
}

/**
 * Dữ liệu /api/kpi -> { today, days, streams, items }.
 * Mỗi item là 1 KPI của 1 người trong 1 ngày: { id, date, label, kpi, person, status, note, folder, rowKey, group, groupKey, stream, streamKey }.
 */
export function buildModel(data) {
  const today = data.today;
  const days = (data.days || []).map((d) => ({ ...d, weekday: weekday(d.date) }));
  const items = [];
  const streams = (data.streams || []).map((s) => {
    const sItems = [];
    const groups = (s.groups || []).map((g) => {
      const gItems = [];
      (g.rows || []).forEach((r, ri) => {
        for (const d of days) {
          const cell = r.cells?.[d.date];
          const status = statusOf(cell, d.date, today);
          if (!status) continue;
          const rowKey = `${s.key}/${g.key}/${ri}`;
          gItems.push({
            id: `${rowKey}@${d.date}`,
            date: d.date,
            label: d.label,
            kpi: cell.kpi || 'Chưa ghi nội dung KPI',
            person: r.person || g.pic?.name || '',
            status,
            unknown: cell.res === '?',
            note: r.note || '',
            folder: r.folder || '',
            rowKey,
            group: g.name,
            groupKey: g.key,
            stream: s.name,
            streamKey: s.key,
          });
        }
      });
      sItems.push(...gItems);
      return { ...g, items: gItems };
    });
    items.push(...sItems);
    return { ...s, groups, items: sItems };
  });
  return { today, days, streams, items };
}

/** Đếm theo trạng thái. */
export function count(items) {
  const c = { D: 0, K: 0, C: 0, S: 0, total: 0 };
  for (const it of items) { c[it.status]++; c.total++; }
  return c;
}

/** Phần trăm làm tròn; null khi mẫu số 0. */
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

export const onDate = (items, date) => items.filter((it) => it.date === date);
export const upTo = (items, date) => items.filter((it) => it.date <= date);
export const isOutstanding = (it) => it.status === 'K' || it.status === 'C';

/** Mỗi dòng (1 người) chỉ hiện ghi chú / vướng mắc ở KPI tồn đọng gần nhất tính đến ngày date. */
export function noteTargets(items, date) {
  const latest = new Map();
  for (const it of items) {
    if (!it.note || it.date > date || !isOutstanding(it)) continue;
    const cur = latest.get(it.rowKey);
    if (!cur || it.date > cur.date) latest.set(it.rowKey, it);
  }
  return new Set([...latest.values()].map((it) => it.id));
}

/** Ngày mặc định của bộ lọc: hôm nay nếu nằm trong 5 ngày, ngược lại "Cả 5 ngày". */
export const defaultDay = (model) => (model.days.some((d) => d.date === model.today) ? model.today : 'all');

/** Ngày dùng làm mốc "đến hôm nay": hôm nay, hoặc ngày cuối nếu đã qua War Room. */
export function refDate(model) {
  const last = model.days[model.days.length - 1]?.date;
  return last && model.today > last ? last : model.today;
}

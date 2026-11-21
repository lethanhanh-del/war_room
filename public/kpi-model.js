// Mô hình dữ liệu trang "KPI & kết quả" (/kpi). Không đụng tới DOM: dùng chung cho trình duyệt và test Node.
//
// Mỗi ô (1 người, 1 ngày) có KPI và kết quả trên sheet: res 'D' = Đạt (đã tick), 'K' = ghi Không đạt, '' = chưa tick /
// chưa nhập, '?' = chữ khác. Ô Đạt có thể kèm `at` = lúc Worker thấy ô được tick (src/kpi/ticks.js).
// Hạn của 1 KPI là 05:00 sáng hôm sau, giờ Việt Nam (KPI ngày 21 hết hạn lúc 05:00 ngày 22). Trạng thái hiển thị:
//   D Hoàn thành           đã tick trước hạn (hoặc không biết giờ tick); trên sheet có thể ghi Đạt
//   L Hoàn thành trễ hạn   đã tick, nhưng sau hạn
//   K Không đạt            ghi Không đạt, hoặc quá hạn mà chưa tick (tick sau đó -> Hoàn thành trễ hạn)
//   N Đang làm             đã tới ngày của KPI, chưa quá hạn, chưa tick
//   S Sắp tới              ngày chưa tới
// Đã hoàn thành = Hoàn thành (đúng hạn) + Hoàn thành trễ hạn. Tồn đọng = Không đạt tính đến ngày đang xem.

export const STATUS_LABEL = { D: 'Hoàn thành', L: 'Hoàn thành trễ hạn', K: 'Không đạt', N: 'Đang làm', S: 'Sắp tới' };
export const STATUSES = ['D', 'L', 'K', 'N', 'S'];
/** Giờ hết hạn (giờ Việt Nam) của KPI, tính vào sáng hôm sau ngày của KPI. */
export const DUE_HOUR = 5;
export const DUE_LABEL = '05:00';
/** Du di sau giờ hết hạn (KPI-CLOSE: 0 — ngày đã chốt sổ dùng bản chốt, xem statusOf). */
export const LATE_GRACE_MS = 0; // KPI-CLOSE: bỏ ân hạn, hạn đúng 05:00 (trước: 10 phút)

/** Thời điểm hết hạn (ms) của KPI ngày `date`: 05:00 sáng hôm sau giờ Việt Nam = 22:00 UTC của chính ngày đó. */
export const dueAt = (date) => Date.parse(`${date}T00:00:00Z`) + (24 + DUE_HOUR - 7) * 3600 * 1000;
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "2026-11-23" -> "T2". */
export const weekday = (date) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] || '';

/** Ô được tick lúc `at` (ISO) có trễ hạn không: sau hạn của KPI ngày `date` (05:00 sáng hôm sau, du di 10 phút). */
export function isLateTick(date, at) {
  const t = Date.parse(at || '');
  if (!t) return false;
  return t > dueAt(date) + LATE_GRACE_MS;
}

/**
 * Trạng thái 1 ô KPI; null = ngày đó không có KPI.
 * now (ms) = giờ hiện tại để biết KPI đã quá hạn chưa; không có thì coi quá hạn khi đã sang ngày khác.
 */
export function statusOf(cell, date, today, now) {
  if (!cell || (!cell.kpi && !cell.res)) return null;
  // KPI-CLOSE: ngày đã chốt sổ lúc 05:00 (src/kpi/close.js): lúc chốt chưa tick mà nay tick -> trễ hạn; chưa tick -> tồn đọng.
  if (cell.closed) return cell.res === 'D' ? (cell.closed === 'K' ? 'L' : 'D') : 'K';
  if (cell.res === 'D') return isLateTick(date, cell.at) ? 'L' : 'D';
  if (cell.res === 'K') return 'K';
  if (date > today) return 'S';
  const overdue = now ? now >= dueAt(date) : date < today;
  return overdue ? 'K' : 'N';
}

/**
 * Dữ liệu /api/kpi -> { today, days, streams, items }.
 * Mỗi item là 1 KPI của 1 người trong 1 ngày:
 * { id, date, label, kpi, person, status, doneAt, note, folder, rowKey, group, groupKey, stream, streamKey }.
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
          const status = statusOf(cell, d.date, today, data.now);
          if (!status) continue;
          const rowKey = `${s.key}/${g.key}/${ri}`;
          gItems.push({
            id: `${rowKey}@${d.date}`,
            date: d.date,
            label: d.label,
            kpi: cell.kpi || 'Chưa ghi nội dung KPI',
            person: r.person || g.pic?.name || '',
            status,
            doneAt: cell.res === 'D' ? cell.at || '' : '',
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
  const c = { D: 0, L: 0, K: 0, N: 0, S: 0, total: 0 };
  for (const it of items) { c[it.status]++; c.total++; }
  return c;
}

/** Số KPI đã hoàn thành của 1 kết quả count(): Hoàn thành (đúng hạn) + Hoàn thành trễ hạn. */
export const doneOf = (c) => c.D + c.L;
export const isDone = (it) => it.status === 'D' || it.status === 'L';

/** Phần trăm làm tròn; null khi mẫu số 0. */
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

export const onDate = (items, date) => items.filter((it) => it.date === date);
export const upTo = (items, date) => items.filter((it) => it.date <= date);
export const isOutstanding = (it) => it.status === 'K';

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

/**
 * Thành viên của 1 nhóm và số KPI của từng người tính đến ngày `cut` (YYYY-MM-DD):
 * [{ name, isPic, total, done, late, backlog, doing }] — PIC nhóm đứng đầu, rồi theo thứ tự trên sheet.
 *   total = số KPI đến ngày cut · done = đã hoàn thành (gồm cả trễ hạn) · late = hoàn thành trễ hạn ·
 *   backlog = còn tồn đọng (đã qua ngày, chưa hoàn thành) · doing = KPI hôm nay chưa tick.
 * Người có tên trong nhóm (dòng trên sheet, PIC, thành viên) mà chưa có KPI vẫn được liệt kê với total = 0.
 */
export function memberStats(group, cut) {
  const map = new Map();
  const get = (name) => {
    const n = String(name || '').trim();
    if (!n) return null;
    const k = n.toLocaleLowerCase('vi');
    if (!map.has(k)) map.set(k, { name: n, isPic: false, total: 0, done: 0, late: 0, backlog: 0, doing: 0 });
    return map.get(k);
  };
  const pic = get(group.pic?.name);
  if (pic) pic.isPic = true;
  for (const r of group.rows || []) get(r.person);
  for (const n of group.members || []) get(n);
  for (const it of group.items || []) {
    if (it.date > cut) continue;
    const m = get(it.person) || get('Chưa ghi người thực hiện');
    m.total++;
    if (isDone(it)) m.done++;
    if (it.status === 'L') m.late++;
    if (it.status === 'K') m.backlog++;
    if (it.status === 'N') m.doing++;
  }
  return [...map.values()];
}

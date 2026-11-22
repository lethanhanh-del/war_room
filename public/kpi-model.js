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
/** Chỉ ghi nhận "Hoàn thành trễ hạn" từ ngày 22/11/2026 trở đi (ngày 21/11 hoàn thành muộn vẫn tính là Hoàn thành). */
export const LATE_TRACKING_START = '2026-11-22';

/** Thời điểm hết hạn (ms) của KPI ngày `date`: 05:00 sáng hôm sau giờ Việt Nam = 22:00 UTC của chính ngày đó. */
export const dueAt = (date) => Date.parse(`${date}T00:00:00Z`) + (24 + DUE_HOUR - 7) * 3600 * 1000;
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "2026-11-23" -> "T2". */
export const weekday = (date) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] || '';

const hm = (h, m) => `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;

/**
 * Giờ thực hiện ghi trên sheet -> { start, end } ("HH:MM") hoặc null khi không đọc được.
 * Nhận "09:00-10:00", "9:00 - 10:30", "9h-10h", "8h30-9h", "09h00 đến 10h00", "14:00–15:00", "9-10";
 * chỉ 1 giờ ("10:00", "trước 10h") = hạn chót. Ngày ("21/11") không phải giờ.
 */
export function parseTimeWindow(s) {
  const t = String(s ?? '').trim();
  if (!t || /\d\s*\/\s*\d/.test(t)) return null;
  const found = [];
  for (const m of t.matchAll(/(\d{1,2})(?:\s*[:.]\s*(\d{2})|\s*(?:h|giờ|g)\s*(\d{2})?)?/giu)) {
    const h = Number(m[1]);
    const mi = Number(m[2] ?? m[3] ?? 0);
    if (h > 24 || mi > 59) continue;
    found.push(hm(h, mi));
    if (found.length === 2) break;
  }
  if (!found.length) return null;
  if (found.length === 1) return { start: '', end: found[0] };
  return found[0] <= found[1] ? { start: found[0], end: found[1] } : { start: found[1], end: found[0] };
}

/** Giờ "HH:MM" của ngày `date` (giờ Việt Nam) -> ms. */
export const atVN = (date, time) => Date.parse(`${date}T${time}:00Z`) - 7 * 3600 * 1000;

/**
 * Hạn chót (ms) của 1 ô KPI: giờ kết thúc ghi ở cột thời gian thực hiện (vd 09:00-10:00 -> 10:00 ngày đó, giờ Việt Nam);
 * không ghi / không đọc được -> 05:00 sáng hôm sau (dueAt).
 */
export function dueAtOf(cell, date) {
  const w = parseTimeWindow(cell?.time);
  return w?.end ? atVN(date, w.end) : dueAt(date);
}

/** Ô được tick lúc `at` (ISO) có trễ hạn không: sau hạn `due` (mặc định 05:00 sáng hôm sau ngày `date`), chỉ tính từ LATE_TRACKING_START. */
export function isLateTick(date, at, due = dueAt(date)) {
  if (date && date < LATE_TRACKING_START) return false;
  const t = Date.parse(at || '');
  if (!t) return false;
  return t > due + LATE_GRACE_MS;
}

/**
 * Trạng thái 1 ô KPI; null = ngày đó không có KPI.
 * now (ms) = giờ hiện tại để biết KPI đã quá hạn chưa; không có thì coi quá hạn khi đã sang ngày khác.
 */
export function statusOf(cell, date, today, now) {
  if (!cell || (!cell.kpi && !cell.res)) return null;
  const trackLate = !date || date >= LATE_TRACKING_START;
  // KPI-CLOSE: ngày đã chốt sổ lúc 05:00 (src/kpi/close.js): lúc chốt chưa tick mà nay tick -> trễ hạn (từ 22/11 trở đi); chưa tick -> tồn đọng.
  if (cell.closed) return cell.res === 'D' ? (cell.closed === 'K' && trackLate ? 'L' : 'D') : 'K';
  const due = dueAtOf(cell, date);
  if (cell.res === 'D') return isLateTick(date, cell.at, due) ? 'L' : 'D';
  if (cell.res === 'K') return 'K';
  if (date > today) return 'S';
  const overdue = now ? now >= due : date < today;
  return overdue ? 'K' : 'N';
}

/**
 * Dữ liệu /api/kpi -> { today, days, streams, items }.
 * Mỗi item là 1 KPI của 1 người trong 1 ngày:
 * { id, date, label, kpi, person, status, doneAt, note, folder, rowKey, group, groupKey, stream, streamKey,
 *   time (giờ thực hiện ghi trên sheet, '' nếu không có), due (ms, hạn chót: giờ kết thúc hoặc 05:00 hôm sau) }.
 */
export function buildModel(data) {
  const today = data.today;
  const days = (data.days || []).map((d) => ({ ...d, weekday: weekday(d.date) }));
  const items = [];
  const streams = (data.streams || []).map((s) => {
    const sItems = [];
    const groups = (s.groups || []).map((g) => {
      const approval = approvalOf(g, s);
      const gItems = [];
      // Chỉ tính KPI của nhóm đã được BOD duyệt; nhóm chưa trình / cần trình lại chỉ ghi chú trạng thái.
      if (approval.code !== 'A') return { ...g, approval, items: gItems };
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
            time: cell.time || '',
            due: dueAtOf(cell, d.date),
            person: r.person || g.pic?.name || '',
            taskPic: r.taskPic || '',
            bodApproved: true,
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
      return { ...g, approval, items: gItems };
    });
    items.push(...sItems);
    const approval = approvalSummary(groups);
    return { ...s, bodApproved: approval.pending === 0, approval, groups, items: sItems };
  });
  return { today, days, streams, items };
}

/** Trạng thái duyệt BOD của nhóm: 'A' BOD đã duyệt (xanh lá) · 'R' cần điều chỉnh, bổ sung và trình lại (vàng) · 'N' chưa trình BOD (đỏ). */
export const APPROVAL_LABEL = { A: 'BOD đã duyệt KPI', R: 'Cần điều chỉnh, bổ sung và trình lại KPI', N: 'Chưa trình KPI cho BOD' };
export const APPROVAL_ORDER = ['A', 'R', 'N'];

/** { code, label, source, directive?, note? } của 1 nhóm; dữ liệu cũ chưa có thì theo ô E1 của cả dòng tiền. */
export function approvalOf(g, s) {
  const a = g?.approval;
  if (a && APPROVAL_LABEL[a.code]) return { ...a, label: a.label || APPROVAL_LABEL[a.code] };
  const code = s?.bodApproved === false ? 'N' : 'A';
  return { code, label: APPROVAL_LABEL[code], source: 'e1' };
}

/** Đếm nhóm theo trạng thái duyệt: { A, R, N, total, pending (= R + N) }. */
export function approvalSummary(groups) {
  const c = { A: 0, R: 0, N: 0, total: 0, pending: 0 };
  for (const g of groups || []) { c[g.approval?.code || 'N']++; c.total++; }
  c.pending = c.R + c.N;
  return c;
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

/**
 * Trang "Zero Waiting Point" (/no-waiting-point): KPI đã được BOD duyệt (ô E1 trên sheet đã tick) nhưng đã QUÁ HẠN
 * mà chưa hoàn thành, gom theo từng người; kèm danh sách KPI SẮP ĐẾN HẠN (chưa tick, chưa quá hạn), hạn gần nhất trước.
 * Hạn của KPI = giờ kết thúc ở cột thời gian thực hiện (vd 09:00-10:00 -> 10:00), không ghi thì 05:00 sáng hôm sau.
 * @param {object} model  buildModel(data)
 * @param {number} now    giờ hiện tại (ms)
 * @returns {{ people: object[], total: number, upcoming: object[], unapproved: string[] }}
 *   people: [{ key, name, count, oldestDue, groups: ['Dòng tiền · Nhóm'], items }] xếp theo số KPI quá hạn giảm dần,
 *   bằng nhau thì người có hạn cũ nhất lên trước; mỗi item có thêm overdueMs.
 *   upcoming: KPI chưa hoàn thành, hạn còn ở phía trước (gồm cả KPI các ngày sau), mỗi item có leftMs; xếp theo hạn.
 *   unapproved: [{ stream, streamKey, group, code, label }] các nhóm chưa được BOD duyệt (KPI của các nhóm này không được tính).
 */
export function noWaitingPoint(model, now = Date.now()) {
  const people = new Map();
  const upcoming = [];
  const unapproved = [];
  for (const s of model.streams || []) {
    for (const g of s.groups || []) {
      const a = g.approval || approvalOf(g, s);
      if (a.code !== 'A') unapproved.push({ stream: s.name, streamKey: s.key, group: g.name, code: a.code, label: a.label });
    }
    for (const it of s.items || []) {
      if (isDone(it)) continue;
      const due = it.due ?? dueAt(it.date);
      if (now < due) { upcoming.push({ ...it, due, leftMs: due - now }); continue; } // ghi Không đạt trước hạn: chưa gọi là quá hạn
      const name = String(it.person || '').trim() || 'Chưa ghi người thực hiện';
      const key = name.toLocaleLowerCase('vi');
      if (!people.has(key)) people.set(key, { key, name, count: 0, oldestDue: due, groups: [], items: [] });
      const p = people.get(key);
      p.count++;
      p.oldestDue = Math.min(p.oldestDue, due);
      const g = `${it.stream} · ${it.group}`;
      if (!p.groups.includes(g)) p.groups.push(g);
      p.items.push({ ...it, due, overdueMs: Math.max(0, now - due) });
    }
  }
  const list = [...people.values()];
  for (const p of list) p.items.sort((a, b) => a.due - b.due || a.stream.localeCompare(b.stream, 'vi'));
  list.sort((a, b) => b.count - a.count || a.oldestDue - b.oldestDue || a.name.localeCompare(b.name, 'vi'));
  upcoming.sort((a, b) => a.due - b.due || a.person.localeCompare(b.person, 'vi'));
  return { people: list, total: list.reduce((n, p) => n + p.count, 0), upcoming, unapproved };
}

/** Hạn "05:00 23/11" (giờ Việt Nam) của KPI ngày `date`; truyền `due` (ms) để ghi đúng giờ kết thúc, vd "10:00 22/11". */
export function dueLabel(date, due = dueAt(date)) {
  const d = new Date(due + 7 * 3600 * 1000).toISOString();
  return `${d.slice(11, 16)} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Giờ thực hiện để hiển thị: "09:00–10:00", "đến 10:00", '' khi không có / không đọc được. */
export function timeLabel(time) {
  const w = parseTimeWindow(time);
  if (!w) return '';
  return w.start ? `${w.start}–${w.end}` : `đến ${w.end}`;
}

/** Đã quá hạn bao lâu: "2 ngày 3 giờ" · "5 giờ 20 phút" · "15 phút" · "vừa quá hạn". */
export function overdueText(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mi = m % 60;
  if (d) return h ? `${d} ngày ${h} giờ` : `${d} ngày`;
  if (h) return mi ? `${h} giờ ${mi} phút` : `${h} giờ`;
  return mi ? `${mi} phút` : 'vừa quá hạn';
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

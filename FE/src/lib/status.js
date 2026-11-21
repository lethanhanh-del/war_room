// Quy tắc trạng thái — đã thống nhất với người dùng:
//   Mỗi ngày của 1 dòng KPI là 1 TASK: ô "KPI" = nội dung việc phải làm (chữ), ô "Kết quả" = checkbox.
//   - Đạt            : đã tick
//   - Không đạt      : ngày đã qua mà chưa tick
//   - Đang làm       : là hôm nay, chưa tick
//   - Chưa đến hạn   : ngày trong tương lai, chưa tick
//   - (none)         : ngày đó không có task (ô KPI trống và chưa tick) -> không tính
// (Sheet không lưu thời điểm tick nên không phân biệt "tick muộn"; tick là Đạt.)

export const STATUS = {
  done: { label: 'Đạt', short: 'Đạt', icon: '✔' },
  late: { label: 'Không đạt', short: 'Không đạt', icon: '✖' },
  in_progress: { label: 'Đang làm (hôm nay)', short: 'Đang làm', icon: '●' },
  upcoming: { label: 'Chưa đến hạn', short: 'Chưa đến hạn', icon: '○' },
  none: { label: 'Không có task', short: 'Không có task', icon: '' },
};
export const STATUS_KEYS = ['done', 'late', 'in_progress', 'upcoming'];
// Thứ tự ưu tiên khi xếp danh sách chi tiết: việc cần xử lý lên trước
export const STATUS_ORDER = ['late', 'in_progress', 'upcoming', 'done', 'none'];

const hasTask = (d) => Boolean(d && (d.task || d.done === true));

/** Trạng thái 1 task (1 ngày của 1 dòng KPI) */
export function dayStatus(day, today) {
  if (!hasTask(day)) return 'none';
  if (day.done === true) return 'done';
  if (day.date < today) return 'late';
  if (day.date === today) return 'in_progress';
  return 'upcoming';
}

/** Trạng thái tổng của 1 dòng KPI trong cả kỳ: còn task Không đạt -> Không đạt; còn việc hôm nay -> Đang làm; ... */
export function aggregateStatus(statuses) {
  const s = statuses.filter((x) => x !== 'none');
  if (!s.length) return 'none';
  for (const k of ['late', 'in_progress', 'upcoming']) if (s.includes(k)) return k;
  return 'done';
}

/** Task "đến hạn" = ngày đã qua, hoặc đã tick. Việc hôm nay chưa tick chưa bị tính là trượt. */
const isDue = (s) => s === 'done' || s === 'late';
const emptyCounts = () => Object.fromEntries([...STATUS_KEYS, 'none'].map((k) => [k, 0]));

/**
 * Tính dữ liệu hiển thị theo bộ lọc.
 * @param {object} data  kết quả /api/dashboard
 * @param {{date:string, status:string, pic:string, flow?:string, group?:string}} filter
 *        date = 'all' | 'YYYY-MM-DD'; status = 'all' | key; các trường khác = 'all' | giá trị
 * @param {string} today 'YYYY-MM-DD'
 * Mỗi dòng trả về (row) là 1 dòng KPI; row.tasks là các task (ngày) nằm trong phạm vi lọc.
 */
export function buildView(data, filter, today) {
  const srcFlows = (data?.flows || []).filter((f) => !filter.flow || filter.flow === 'all' || f.key === filter.flow);
  const flows = srcFlows.map((flow) => {
    const counts = emptyCounts();
    let due = 0;
    let completed = 0;
    const rows = [];

    for (const item of flow.items) {
      if (filter.pic && filter.pic !== 'all' && item.pic !== filter.pic) continue;
      if (filter.group && filter.group !== 'all' && item.group !== filter.group) continue;

      const dayStatuses = item.days.map((d) => dayStatus(d, today));
      let idxs = item.days.map((_, i) => i);
      if (filter.date !== 'all') idxs = idxs.filter((i) => item.days[i].date === filter.date);
      if (!idxs.length) continue;

      const scope = idxs.map((i) => dayStatuses[i]);
      const status = filter.date === 'all' ? aggregateStatus(scope) : scope[0];
      const rowDue = scope.filter(isDue).length;
      const rowDone = scope.filter((s) => s === 'done').length;
      const rowTasks = scope.filter((s) => s !== 'none').length;

      // Số đếm / tỷ lệ không phụ thuộc bộ lọc trạng thái (để các ô số đếm luôn đủ)
      scope.forEach((s) => (counts[s] += 1));
      due += rowDue;
      completed += rowDone;

      // Lọc theo trạng thái: giữ dòng nếu có ít nhất 1 task mang trạng thái đó
      if (filter.status !== 'all' && !scope.includes(filter.status)) continue;

      const tasks = idxs
        .map((i) => ({ ...item.days[i], status: dayStatuses[i] }))
        .filter((t) => t.status !== 'none' && (filter.status === 'all' || t.status === filter.status));
      rows.push({
        item,
        status,
        dayStatuses,
        tasks,
        total: rowTasks,
        done: rowDone,
        due: rowDue,
        pct: rowDue ? rowDone / rowDue : null,
      });
    }

    const tasks = STATUS_KEYS.reduce((a, k) => a + counts[k], 0);
    return { ...flow, rows, counts, tasks, due, completed, rate: due ? completed / due : null };
  });

  const totals = emptyCounts();
  let due = 0;
  let completed = 0;
  for (const f of flows) {
    for (const k of Object.keys(totals)) totals[k] += f.counts[k];
    due += f.due;
    completed += f.completed;
  }
  const tasks = STATUS_KEYS.reduce((a, k) => a + totals[k], 0);
  const blockers = flows.reduce((a, f) => a + f.rows.filter((r) => r.item.note).length, 0);

  return { flows, totals, tasks, due, completed, rate: due ? completed / due : null, blockers };
}

/** Danh sách phẳng từng task (dòng KPI × ngày) cho màn chi tiết, việc cần xử lý lên trước */
export function flattenTasks(view) {
  const out = [];
  for (const f of view.flows) for (const r of f.rows) for (const t of r.tasks) out.push({ flow: f, row: r, item: r.item, task: t });
  const rank = Object.fromEntries(STATUS_ORDER.map((k, i) => [k, i]));
  return out.sort(
    (a, b) =>
      rank[a.task.status] - rank[b.task.status] ||
      a.task.date.localeCompare(b.task.date) ||
      a.item.row - b.item.row
  );
}

export function allDays(data) {
  return [...new Set((data?.flows || []).flatMap((f) => f.days))].sort();
}

export function allPics(data) {
  return [...new Set((data?.flows || []).flatMap((f) => f.items.map((i) => i.pic)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'vi')
  );
}

/** Danh sách nhóm nhỏ (theo dòng tiền, hoặc tất cả) */
export function allGroups(data, flowKey = 'all') {
  const flows = (data?.flows || []).filter((f) => flowKey === 'all' || f.key === flowKey);
  return [...new Set(flows.flatMap((f) => (f.groups || []).map((g) => g.name)).filter(Boolean))];
}

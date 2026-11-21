// Quy tắc tính trạng thái task (task = KPI của 1 PIC trong 1 ngày) — đã thống nhất với người dùng:
//  - Hoàn thành          : Kết quả ngày đó >= KPI ngày đó
//  - Hoàn thành trễ hạn  : trong ngày chưa đạt, nhưng ở một ngày sau đó lũy kế kết quả >= lũy kế KPI tính đến ngày đó
//  - Trễ hạn             : ngày đã qua và lũy kế vẫn chưa bù đủ
//  - Đang thực hiện      : là ngày hôm nay, chưa đạt
//  - Chưa đến hạn        : ngày trong tương lai, chưa đạt
//  - (none)              : ngày đó không có KPI (trống hoặc 0) -> không tính là task

export const STATUS = {
  done: { label: 'Hoàn thành', short: 'Hoàn thành' },
  done_late: { label: 'Hoàn thành trễ hạn', short: 'HT trễ hạn' },
  late: { label: 'Trễ hạn', short: 'Trễ hạn' },
  in_progress: { label: 'Đang thực hiện', short: 'Đang thực hiện' },
  upcoming: { label: 'Chưa đến hạn', short: 'Chưa đến hạn' },
  none: { label: 'Chưa có KPI', short: 'Chưa có KPI' },
};
export const STATUS_KEYS = ['done', 'done_late', 'late', 'in_progress', 'upcoming'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Trạng thái của ngày thứ idx trong mảng days [{date, kpi, result}] */
export function dayStatus(days, idx, today) {
  const d = days[idx];
  if (!d || !(num(d.kpi) > 0)) return 'none';
  if (num(d.result) >= num(d.kpi)) return 'done';

  let cumKpi = 0;
  for (let i = 0; i <= idx; i++) cumKpi += num(days[i].kpi);
  let cumRes = 0;
  for (let i = 0; i <= idx; i++) cumRes += num(days[i].result);
  for (let j = idx + 1; j < days.length; j++) {
    cumRes += num(days[j].result);
    if (cumRes >= cumKpi && days[j].result !== null && days[j].result !== undefined) return 'done_late';
  }
  if (d.date < today) return 'late';
  if (d.date === today) return 'in_progress';
  return 'upcoming';
}

/** Trạng thái tổng của 1 PIC trong cả kỳ (ưu tiên: trễ hạn > đang thực hiện > chưa đến hạn > HT trễ hạn > hoàn thành) */
export function aggregateStatus(statuses) {
  const s = statuses.filter((x) => x !== 'none');
  if (!s.length) return 'none';
  for (const k of ['late', 'in_progress', 'upcoming', 'done_late']) if (s.includes(k)) return k;
  return 'done';
}

const emptyCounts = () => Object.fromEntries([...STATUS_KEYS, 'none'].map((k) => [k, 0]));

/**
 * Tính dữ liệu hiển thị theo bộ lọc.
 * @param {object} data  kết quả /api/dashboard
 * @param {{date:string, status:string, pic:string}} filter  date='all' hoặc 'YYYY-MM-DD'; status='all' hoặc key; pic='all' hoặc tên
 * @param {string} today 'YYYY-MM-DD'
 */
export function buildView(data, filter, today) {
  const flows = (data?.flows || []).map((flow) => {
    const counts = emptyCounts();
    let due = 0;
    let completed = 0;
    const rows = [];

    for (const item of flow.items) {
      if (filter.pic !== 'all' && item.pic !== filter.pic) continue;
      const dayStatuses = item.days.map((_, i) => dayStatus(item.days, i, today));

      let status;
      let kpi = 0;
      let result = 0;
      let hasKpi = false;
      let scopeStatuses;
      if (filter.date === 'all') {
        scopeStatuses = dayStatuses;
        status = aggregateStatus(dayStatuses);
        item.days.forEach((d) => {
          kpi += num(d.kpi);
          result += num(d.result);
          if (num(d.kpi) > 0) hasKpi = true;
        });
      } else {
        const idx = item.days.findIndex((d) => d.date === filter.date);
        if (idx < 0) continue;
        status = dayStatuses[idx];
        scopeStatuses = [status];
        kpi = num(item.days[idx].kpi);
        result = num(item.days[idx].result);
        hasKpi = kpi > 0;
      }

      if (filter.status !== 'all' && status !== filter.status) continue;

      scopeStatuses.forEach((s, i) => {
        counts[s] += 1;
        if (s === 'none') return;
        // Task "đến hạn" = ngày đã qua, hoặc đã hoàn thành. Task hôm nay chưa xong chưa bị tính là trượt.
        const date = filter.date === 'all' ? item.days[i].date : filter.date;
        const finished = s === 'done' || s === 'done_late';
        if (date < today || finished) {
          due += 1;
          if (finished) completed += 1;
        }
      });

      rows.push({
        item,
        status,
        dayStatuses,
        kpi,
        result,
        pct: hasKpi ? result / kpi : null,
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

/** Danh sách ngày (hợp của các sheet), sắp xếp tăng dần */
export function allDays(data) {
  return [...new Set((data?.flows || []).flatMap((f) => f.days))].sort();
}

/** Danh sách PIC */
export function allPics(data) {
  return [...new Set((data?.flows || []).flatMap((f) => f.items.map((i) => i.pic)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'vi')
  );
}

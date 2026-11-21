// Chuyển dữ liệu thô từ CT Worksuite (Frappe) thành mô hình cho dashboard "Tiến độ dòng tiền".
// Hàm thuần, không gọi mạng — chạy được cả trên Cloudflare Worker lẫn Node.
//
// Cấu trúc trên Worksuite (dự án WAR ROOM, PROJ-0536):
//   - Mỗi dòng tiền = 1 task NHÓM cấp cao nhất, tiêu đề bắt đầu bằng "Dòng tiền …".
//   - PIC = người thực hiện (custom_assignee) của task nhóm đó.
//   - Nhân sự + task = các task con (mọi cấp) bên dưới, gom theo custom_assignee.
//   - Task cấp cao khác (vd "Nhóm hỗ trợ") không phải dòng tiền -> liệt kê riêng.
//   - Lưu ý: trên Worksuite mọi task đều có is_group = 1, nên "nhóm" được xác định bằng việc có task con hay không.
// Trạng thái Worksuite: Open · In Progress · Pending (có lý do chờ) · In Review · Overdue · Completed · Cancelled.

export const STATUS_ORDER = ['overdue', 'waiting', 'review', 'doing', 'todo', 'done'];
export const STATUS_LABEL = {
  overdue: 'Quá hạn',
  waiting: 'Đang chờ',
  review: 'Chờ duyệt',
  doing: 'Đang làm',
  todo: 'Chưa bắt đầu',
  done: 'Hoàn thành',
};

const HOUR = 3600000;
const DAY = 24 * HOUR;
const VN_OFFSET = 7 * HOUR;
const pad = (n) => String(n).padStart(2, '0');

/** Hạn của task (giờ Việt Nam). Chỉ có ngày -> hết ngày 23:59:59. */
export function parseDue(value) {
  if (value === null || value === undefined || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const hasTime = h !== undefined;
  const ms = hasTime
    ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) - VN_OFFSET
    : Date.UTC(+y, +mo - 1, +d, 23, 59, 59) - VN_OFFSET;
  return { ms, hasTime };
}

function fmtDate(due) {
  const d = new Date(due.ms + VN_OFFSET);
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
  return due.hasTime ? `${date} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

function lateBy(ms) {
  if (ms < HOUR) return 'vài phút';
  if (ms < DAY) return `${Math.floor(ms / HOUR)} giờ`;
  return `${Math.floor(ms / DAY)} ngày`;
}

const clampPct = (v) => Math.max(0, Math.min(100, Math.round(v)));
const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Phân loại 1 task. Trả về null nếu không tính (Cancelled/Template).
 * Thứ tự ưu tiên: Hoàn thành > Chờ duyệt > Quá hạn > Đang chờ > Đang làm > Chưa bắt đầu.
 */
export function classifyTask(task, now) {
  const raw = String(task.status || '').trim().toLowerCase();
  if (raw === 'cancelled' || raw === 'template') return null;
  const num = Number.parseFloat(task.progress);
  let progress = Number.isFinite(num) ? clampPct(num) : 0;
  const due = parseDue(task.exp_end_date);
  const blocker = plain(task.custom_blocker_reason);
  if (raw === 'completed') {
    const doneAt = parseDue(task.completed_on);
    return { status: 'done', progress: 100, due, dueLabel: doneAt ? `Xong ${fmtDate(doneAt)}` : 'Đã hoàn thành', blocker: '' };
  }
  let status;
  if (raw === 'in review' || raw === 'pending review') status = 'review';
  else if (raw === 'overdue' || (due && now > due.ms)) status = 'overdue';
  else if (raw === 'pending') status = 'waiting';
  else if (raw === 'in progress' || raw === 'working' || progress > 0) status = 'doing';
  else status = 'todo';
  let dueLabel;
  if (!due) dueLabel = 'Chưa có hạn';
  else if (status === 'overdue' && now > due.ms) dueLabel = `Quá hạn ${lateBy(now - due.ms)} · hạn ${fmtDate(due)}`;
  else dueLabel = `Hạn ${fmtDate(due)}`;
  return { status, progress, due, dueLabel, blocker: raw === 'pending' ? blocker : '' };
}

/** "Hoàng Thị Quỳnh Mai" -> "QM"; "Mr. Vinh" -> "MV". */
export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[words.length - 2][0] + words[words.length - 1][0]).toUpperCase();
}

/** Bỏ hậu tố công ty của Frappe: "Ban Kinh doanh - CTM" -> "Ban Kinh doanh". */
const cleanDept = (s) => String(s || '').replace(/\s+-\s+[A-Z0-9&.]{2,10}$/, '').trim();
/** "Nguyễn Thị Mai Thu" -> "nguyen thi mai thu" (so khớp tên không dấu, không phân biệt hoa thường). */
export const normKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đð]/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

const STREAM_RE = /^\s*dòng\s*tiền\b\s*[:\-–—.]?\s*/iu;
const CODE_RE = /(?:\bDT\s*|#\s*)0*(\d{1,2})\b/i;

/** "Dòng tiền bán 4 dự án" -> "Bán 4 dự án". */
export function streamTitle(subject) {
  const s = String(subject || '').trim();
  const rest = s.replace(STREAM_RE, '').replace(/^(?:DT\s*0*\d{1,2}|#\s*\d{1,2})\s*[:\-–—.]?\s*/i, '').trim();
  if (!rest) return s;
  return rest.charAt(0).toLocaleUpperCase('vi') + rest.slice(1);
}

export const isStreamSubject = (subject) => STREAM_RE.test(String(subject || ''));

function toneOf(counts) {
  if (counts.total > 0 && counts.done === counts.total) return 'success';
  if (counts.overdue >= 3) return 'danger';
  if (counts.overdue >= 1) return 'warning';
  return 'accent';
}

const emptyCounts = () => ({ total: 0, done: 0, doing: 0, review: 0, waiting: 0, overdue: 0, todo: 0 });

/**
 * Tính số liệu từng người (counts, % trung bình, màu) và sắp xếp: người có task quá hạn / đang chờ lên trước.
 * @param people  danh sách { key, name, isPic, unassigned?, tasks: [{status, progress, dueMs}] }
 */
export function finalizePeople(people) {
  const list = [...people].map((p) => {
    const pc = emptyCounts();
    let ps = 0;
    for (const t of p.tasks) { pc.total++; pc[t.status]++; ps += t.progress; }
    const tasks = [...p.tasks].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.dueMs ?? Infinity) - (b.dueMs ?? Infinity));
    return { ...p, tasks, counts: pc, percent: pc.total ? Math.round(ps / pc.total) : null, tone: toneOf(pc) };
  });
  list.sort((a, b) => b.counts.overdue - a.counts.overdue || b.counts.waiting - a.counts.waiting || (b.isPic - a.isPic) || b.counts.total - a.counts.total || a.name.localeCompare(b.name, 'vi'));
  return list;
}

/** Số liệu cả dòng tiền từ danh sách người đã finalizePeople. */
export function streamTotals(people) {
  const counts = emptyCounts();
  let sum = 0;
  for (const p of people) for (const t of p.tasks) { counts.total++; counts[t.status]++; sum += t.progress; }
  return {
    counts,
    percent: counts.total ? Math.round(sum / counts.total) : null,
    tone: toneOf(counts),
    headcount: people.filter((p) => !p.unassigned).length,
  };
}

/** Ô tổng quan đầu trang, tính từ các dòng tiền. */
export function buildSummary(streams) {
  const summary = emptyCounts();
  let sum = 0;
  const everyone = new Set();
  for (const s of streams) {
    for (const k of Object.keys(summary)) summary[k] += s.counts[k];
    sum += (s.percent ?? 0) * s.counts.total;
    for (const p of s.people) if (!p.unassigned) everyone.add(p.key);
  }
  return {
    ...summary,
    percent: summary.total ? Math.round(sum / summary.total) : null,
    people: everyone.size,
    streams: streams.length,
    pics: streams.filter((s) => s.pic).length,
    streamsWithOverdue: streams.filter((s) => s.counts.overdue > 0).length,
  };
}

/**
 * @param raw  { project: {name, project_name}, tasks: Task[], employees: Employee[] }
 * @param opts { now, worksuiteUrl }
 */
export function buildStreamsModel(raw, opts = {}) {
  const now = opts.now ?? Date.now();
  const base = opts.worksuiteUrl ? String(opts.worksuiteUrl).replace(/\/+$/, '') : '';
  const taskUrl = (id) => (base ? `${base}/tasks/${encodeURIComponent(id)}` : '');
  const empById = new Map((raw.employees || []).map((e) => [e.name, e]));

  const personOf = (id, fallbackName) => {
    const emp = id ? empById.get(id) : null;
    const name = emp?.employee_name || fallbackName || id || 'Chưa giao người';
    const designation = emp?.designation || '';
    const department = cleanDept(emp?.department);
    return {
      key: id || `n:${normKey(name)}`,
      name,
      designation,
      department,
      title: [designation, department].filter(Boolean).join(' · '),
      initials: initials(name),
    };
  };

  const tasks = [...(raw.tasks || [])].sort((a, b) => String(a.creation || '').localeCompare(String(b.creation || '')));
  const byId = new Map(tasks.map((t) => [t.name, t]));
  const children = new Map();
  for (const t of tasks) {
    if (t.parent_task && byId.has(t.parent_task)) {
      if (!children.has(t.parent_task)) children.set(t.parent_task, []);
      children.get(t.parent_task).push(t);
    }
  }
  const descendants = (root) => {
    const out = [];
    const seen = new Set([root.name]);
    const queue = [...(children.get(root.name) || [])];
    while (queue.length) {
      const t = queue.shift();
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push(t);
      queue.push(...(children.get(t.name) || []));
    }
    return out;
  };

  const hasChildren = (t) => children.has(t.name);
  const roots = tasks.filter((t) => !t.parent_task || !byId.has(t.parent_task));
  const streamRoots = roots.filter((t) => isStreamSubject(t.subject));
  const otherGroups = roots
    .filter((t) => !isStreamSubject(t.subject) && classifyTask(t, now))
    .map((t) => ({
      id: t.name,
      name: String(t.subject || '').trim(),
      taskCount: hasChildren(t) ? descendants(t).filter((d) => !hasChildren(d) && classifyTask(d, now)).length : 1,
      url: taskUrl(t.name),
    }));

  const streams = streamRoots.map((root) => {
    const own = classifyTask(root, now);
    const pic = root.custom_assignee || root.custom_assignee_name ? { ...personOf(root.custom_assignee, root.custom_assignee_name), isPic: true } : null;
    const people = new Map();
    if (pic) people.set(pic.key, { ...pic, tasks: [] });

    for (const t of descendants(root)) {
      const hasPerson = t.custom_assignee || t.custom_assignee_name;
      if (hasChildren(t)) {
        // Nhóm con: không tính là task, nhưng người phụ trách nhóm vẫn là nhân sự của dòng tiền.
        if (hasPerson) {
          const p = personOf(t.custom_assignee, t.custom_assignee_name);
          if (!people.has(p.key)) people.set(p.key, { ...p, isPic: false, tasks: [] });
        }
        continue;
      }
      const c = classifyTask(t, now);
      if (!c) continue;
      const person = hasPerson
        ? personOf(t.custom_assignee, t.custom_assignee_name)
        : { key: 'unassigned', name: 'Chưa giao người', title: 'Task chưa có người thực hiện', designation: '', department: '', initials: '?', unassigned: true };
      if (!people.has(person.key)) people.set(person.key, { ...person, isPic: false, tasks: [] });
      people.get(person.key).tasks.push({
        id: t.name,
        subject: String(t.subject || t.name).trim(),
        status: c.status,
        statusLabel: STATUS_LABEL[c.status],
        progress: c.progress,
        dueLabel: c.dueLabel,
        dueMs: c.due?.ms ?? null,
        blocker: c.blocker,
        url: taskUrl(t.name),
      });
    }

    const list = finalizePeople(people.values());
    const totals = streamTotals(list);
    const code = CODE_RE.exec(root.subject || '');
    return {
      id: root.name,
      code: code ? `DT${pad(+code[1])}` : '',
      name: streamTitle(root.subject),
      fullName: String(root.subject || '').trim(),
      url: taskUrl(root.name),
      own: own ? { status: own.status, statusLabel: STATUS_LABEL[own.status], dueLabel: own.dueLabel, blocker: own.blocker } : null,
      pic: pic ? { name: pic.name, title: pic.title, designation: pic.designation, department: pic.department, initials: pic.initials } : null,
      percent: totals.percent,
      counts: totals.counts,
      tone: totals.tone,
      headcount: totals.headcount,
      people: list,
    };
  });

  const project = raw.project
    ? { id: raw.project.name, name: String(raw.project.project_name || raw.project.name).trim(), url: base ? `${base}/projects/${encodeURIComponent(raw.project.name)}` : '' }
    : null;
  return { project, summary: buildSummary(streams), streams, otherGroups };
}

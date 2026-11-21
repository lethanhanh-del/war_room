// Ghép task nạp từ Excel vào mô hình dashboard (kết quả của buildStreamsModel / getStreams).
// Hàm thuần: không đọc D1, không gọi mạng. Không sửa đối tượng đầu vào (kết quả Worksuite đang được cache).
//
// - File Excel của 1 dòng tiền được gắn vào thẻ dòng tiền Worksuite tương ứng (theo id đã chọn lúc nạp,
//   hoặc theo tên "Banking" ↔ "Dòng tiền Banking"). Không tìm thấy -> thành 1 thẻ dòng tiền riêng.
// - Người phụ trách được so với danh sách thành viên War Room (bảng users, đồng bộ từ file nhân sự) để lấy
//   họ tên đầy đủ, chức danh, phòng ban: "Chị Thúy Hiền" -> "Mạc Thị Thúy Hiền · Trưởng Phòng Đối ngoại".
// - Mỗi task được kiểm theo nguyên tắc War Room (văn bản chỉ đạo của Chủ tịch):
//     ONE OWNER / ONE DEADLINE / ONE RESULT, STRICT TIME BOX (hạn không vượt ngày kết thúc War Room),
//     ZERO WAITING POINT (task đang chờ phải có bước xử lý tiếp), END-TO-END (hoàn thành phải có bằng chứng).

import { STATUS_LABEL, buildSummary, classifyTask, finalizePeople, initials, normKey, streamTotals } from '../worksuite/model.js';
import { excelStatus, isGroupOwner } from './tasks.js';

export const FLAG_LABEL = {
  owner: 'Chưa có 1 người chịu trách nhiệm chính',
  due: 'Thiếu deadline',
  timebox: 'Hạn vượt thời hạn War Room',
  result: 'Chưa có tiêu chí đầu ra',
  waiting: 'Đang chờ nhưng chưa có bước xử lý tiếp',
  proof: 'Hoàn thành nhưng chưa có link bằng chứng',
};

const ddmm = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/** Tra họ tên đầy đủ trong danh sách thành viên: khớp nguyên tên, hoặc khớp phần cuối tên (duy nhất 1 người). */
export function makeDirectory(users = []) {
  const list = users
    .filter((u) => u && u.full_name)
    .map((u) => ({ name: String(u.full_name).trim(), key: normKey(u.full_name), title: String(u.title || '').trim(), department: String(u.department || '').trim() }));
  return (name) => {
    const k = normKey(name);
    if (!k) return null;
    const exact = list.find((u) => u.key === k);
    if (exact) return exact;
    if (k.split(' ').length < 2) return null;
    const hits = list.filter((u) => u.key.endsWith(` ${k}`));
    return hits.length === 1 ? hits[0] : null;
  };
}

const words = (s) => normKey(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Tìm thẻ dòng tiền cùng tên. Khớp nguyên tên ("Banking" ↔ "Dòng tiền Banking", "thu trước hạn quá hạn" ↔
 * "thu trước hạn/quá hạn"), hoặc khớp phần đầu nếu chỉ có 1 thẻ ("Tài chính" ↔ "Tài chính phụ trách … 10 dòng tiền",
 * "Kiểm soát kỷ luật" ↔ "Kiểm soát kỷ luật War-Room").
 */
export function matchStream(streams, imp) {
  const n = words(imp.name);
  if (n) {
    const names = (s) => [words(s.name), words(s.fullName).replace(/^dong tien /, '')].filter(Boolean);
    const exact = streams.find((s) => names(s).includes(n));
    if (exact) return exact;
    if (n.length >= 4) {
      const prefix = streams.filter((s) => names(s).some((x) => x.startsWith(`${n} `) || n.startsWith(`${x} `)));
      if (prefix.length === 1) return prefix[0];
    }
  }
  return (imp.code && streams.find((s) => s.code === imp.code)) || null;
}

/** Người phụ trách 1 task Excel -> người trên dashboard. */
function resolveOwner(owner, lookup) {
  if (!owner) return { key: 'unassigned', name: 'Chưa giao người', title: 'Task chưa có người phụ trách', designation: '', department: '', initials: '?', unassigned: true };
  const hit = lookup(owner);
  if (hit) {
    return { key: `n:${hit.key}`, name: hit.name, designation: hit.title, department: hit.department, title: [hit.title, hit.department].filter(Boolean).join(' · '), initials: initials(hit.name) };
  }
  const group = isGroupOwner(owner);
  return {
    key: `n:${normKey(owner)}`,
    name: owner,
    designation: '',
    department: '',
    title: group ? 'Phòng ban / nhiều người — cần chốt 1 người chịu trách nhiệm' : '',
    initials: initials(owner),
    group,
  };
}

/**
 * 1 dòng Excel -> task dashboard (null nếu đã huỷ).
 * @param t    task đã đọc từ file (tasks.js)
 * @param ctx  { now, period: {start, end}, lookup, key }
 */
export function toDashboardTask(t, ctx) {
  const ws = excelStatus(t.status) ?? 'Open';
  const c = classifyTask({ status: ws, progress: t.progress ?? 0, exp_end_date: t.due }, ctx.now);
  if (!c) return null;
  const done = c.status === 'done';
  const owner = resolveOwner(t.owner, ctx.lookup);

  const flags = [];
  if (owner.unassigned) flags.push({ key: 'owner', label: 'Chưa giao người phụ trách' });
  else if (owner.group) flags.push({ key: 'owner', label: FLAG_LABEL.owner });
  if (!done && !t.due) flags.push({ key: 'due', label: FLAG_LABEL.due });
  const end = ctx.period?.end;
  if (!done && t.due && end && t.due.slice(0, 10) > end) {
    flags.push({ key: 'timebox', label: `Hạn ${ddmm(t.due)} vượt thời hạn War Room (${ddmm(end)})` });
  }
  if (!t.output) flags.push({ key: 'result', label: FLAG_LABEL.result });
  if (c.status === 'waiting' && !t.next) flags.push({ key: 'waiting', label: FLAG_LABEL.waiting });
  if (done && !t.link) flags.push({ key: 'proof', label: FLAG_LABEL.proof });

  const label = String(t.status || '').trim();
  return {
    owner,
    task: {
      id: `xl:${ctx.key}:${t.code || t.row}`,
      subject: t.subject,
      status: c.status,
      // Giữ nguyên chữ trong file ("Vướng mắc", "Chờ hồ sơ"…), trừ khi đã quá hạn theo deadline.
      statusLabel: c.status === 'overdue' || !label ? STATUS_LABEL[c.status] : label,
      excelStatus: label,
      progress: done ? 100 : t.progress ?? 0,
      dueLabel: !t.due && t.dueText ? `Hạn: ${t.dueText}` : c.dueLabel,
      dueMs: c.due?.ms ?? null,
      blocker: done ? '' : t.blocker,
      blockerLabel: 'Điểm nghẽn',
      next: done ? '' : t.next,
      support: t.support || '',
      output: t.output,
      note: t.note,
      code: t.code,
      group: t.group,
      priority: t.priority,
      url: t.link,
      source: 'excel',
      flags,
    },
  };
}

function issueCounts(tasks) {
  const out = {};
  for (const t of tasks) for (const f of t.flags) out[f.key] = (out[f.key] || 0) + 1;
  return out;
}

/** Xem trước 1 file trước khi nạp: task đã phân loại + các lỗi theo nguyên tắc War Room. */
export function previewImport(parsed, { now, period, users, key = 'preview' } = {}) {
  const lookup = makeDirectory(users);
  const rows = parsed.tasks.map((t) => toDashboardTask(t, { now, period, lookup, key })).filter(Boolean);
  const counts = { total: 0, done: 0, doing: 0, review: 0, waiting: 0, overdue: 0, todo: 0 };
  for (const r of rows) { counts.total++; counts[r.task.status]++; }
  return {
    counts,
    issues: issueCounts(rows.map((r) => r.task)),
    tasks: rows.map(({ owner, task }) => ({ ...task, ownerName: owner.name, ownerMatched: Boolean(owner.title && !owner.group) })),
  };
}

function attach(stream, imp, ctx) {
  const people = new Map(stream.people.map((p) => [p.key, { ...p, tasks: [...p.tasks] }]));
  const findPerson = (o) => {
    if (people.has(o.key)) return people.get(o.key);
    const k = normKey(o.name);
    const same = [...people.values()].find((p) => normKey(p.name) === k);
    if (same) return same;
    const tail = [...people.values()].filter((p) => !p.unassigned && normKey(p.name).endsWith(` ${k}`));
    return tail.length === 1 ? tail[0] : null;
  };

  let pic = stream.pic;
  if (!pic && imp.pic) {
    const o = resolveOwner(imp.pic, ctx.lookup);
    const p = findPerson(o) || { ...o, isPic: true, tasks: [] };
    p.isPic = true;
    people.set(p.key, p);
    pic = { name: p.name, title: p.title, designation: p.designation, department: p.department, initials: p.initials };
  }

  const added = [];
  for (const t of imp.tasks) {
    const r = toDashboardTask(t, { ...ctx, key: imp.key });
    if (!r) continue;
    let p = findPerson(r.owner);
    if (!p) {
      p = { ...r.owner, isPic: false, tasks: [] };
      people.set(p.key, p);
    }
    p.tasks.push(r.task);
    added.push(r.task);
  }

  const list = finalizePeople(people.values());
  const totals = streamTotals(list);
  return {
    ...stream,
    code: stream.code || imp.code,
    pic,
    ...totals,
    people: list,
    excel: {
      key: imp.key,
      title: imp.title,
      fileName: imp.fileName,
      asOf: imp.asOf,
      uploadedAt: imp.uploadedAt,
      uploadedBy: imp.uploadedByName || imp.uploadedBy,
      count: added.length,
      flagged: added.filter((t) => t.flags.length).length,
      issues: issueCounts(added),
    },
  };
}

function standalone(imp, ctx) {
  const base = {
    id: imp.key,
    code: imp.code,
    name: imp.name || imp.title,
    fullName: imp.title,
    url: '',
    own: null,
    pic: null,
    people: [],
    source: 'excel',
  };
  return attach(base, imp, ctx);
}

/**
 * @param data     kết quả getStreams() (không bị sửa)
 * @param imports  [{ key, title, code, name, pic, asOf, fileName, uploadedAt, uploadedBy, uploadedByName, tasks }]
 * @param opts     { now, period: {start, end}, users: [{full_name, title, department}] }
 */
export function mergeExcelImports(data, imports, opts = {}) {
  if (!imports || !imports.length) return data;
  const ctx = { now: opts.now ?? Date.now(), period: opts.period, lookup: makeDirectory(opts.users) };
  const streams = [...(data.streams || [])];
  const extra = [];
  const list = [];
  for (const imp of imports) {
    let idx = streams.findIndex((s) => s.id === imp.key);
    if (idx < 0 && !String(imp.key).startsWith('xl:')) {
      // Thẻ Worksuite đã chọn lúc nạp không còn (đổi id / Worksuite đang lỗi): thử theo tên.
      const m = matchStream(streams, imp);
      idx = m ? streams.indexOf(m) : -1;
    }
    let s;
    if (idx >= 0) {
      s = attach(streams[idx], imp, ctx);
      streams[idx] = s;
    } else {
      s = standalone(imp, ctx);
      extra.push({ no: Number(String(imp.code).replace(/\D/g, '')) || 99, s });
    }
    list.push({ key: imp.key, title: imp.title, fileName: imp.fileName, uploadedAt: imp.uploadedAt, uploadedBy: imp.uploadedByName || imp.uploadedBy, count: s.excel.count, streamId: s.id, streamName: s.name, attached: idx >= 0 });
  }
  extra.sort((a, b) => a.no - b.no);
  const all = streams.concat(extra.map((e) => e.s));
  return { ...data, streams: all, summary: buildSummary(all), excelImports: list };
}

// Mô hình dữ liệu trang "Điểm nghẽn" (/waiting-point). Không đụng DOM: dùng chung cho trình duyệt và test Node.
//
// Nguồn: tab "Điểm nghẽn" của file WR - MASTER TASK (CSV qua GET /api/waiting-point/sheet, đọc SharePoint / Google Sheet).
// Cột nhận theo TIÊU ĐỀ (từng ô, không gộp cả dòng: ô "HƯỚNG DẪN" phía trên cũng có chữ "Dòng tiền"). Layout tab trên file
// SharePoint WR - MASTER TASK (đọc lại 23/11/2026, dòng 1 = HƯỚNG DẪN, dòng 2 = tiêu đề, 13 cột A–M, không có ô gộp):
//   STT · Dòng tiền · Nhóm · Phân loại điểm nghẽn (Internal / External) · Nội dung điểm nghẽn · Người phụ trách ·
//   Đơn vị Người phụ trách · Người hỗ trợ · Đơn vị người hỗ trợ · Đơn vị hỗ trợ · Nội dung hỗ trợ · Trạng thái ·
//   Thời gian xử lý (Deadline)
// - Cột STT đánh số sẵn cho cả dòng chưa nhập: chỉ dòng có "Nội dung điểm nghẽn" mới là 1 điểm nghẽn. Dòng tiền / Nhóm /
//   Người phụ trách có thể để trống (hiện "Chưa ghi …"), không tự lấy theo dòng phía trên vì sheet không gộp ô.
// - Cột "Task" (task con, mỗi dòng trong ô hoặc cách nhau bởi ";") vẫn được đọc nếu sheet có, hiện tại sheet không có.
// - Trạng thái (ô gõ tự do): ô trống = Cần cập nhật trạng thái (vàng) · Chờ xử lý (xám) · Đang xử lý (xanh dương) · Chờ phối hợp (tím) ·
//   Cần quyết định (cam) · Đã xử lý (xanh lá, không nằm trong danh sách đang mở).
// - Thời gian xử lý: 1 ngày "25/11/2026" (hạn hết ngày đó, 23:59) · khoảng ngày "22/11/2026-25/11/2026" (hạn = ngày
//   cuối) · có giờ "23/11 17:30", "17h30 24/11", "17:30" (hôm nay) · hoặc thời lượng theo danh sách chọn của cột
//   ("30 phút", "1 giờ 30 phút", "1 ngày"): không có mốc bắt đầu nên không tính được hạn, chỉ hiện "Xử lý trong …".
// Mọi giờ tính theo giờ Việt Nam (UTC+7).

const VN = 7 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

/** Bỏ dấu, chữ thường, gọn khoảng trắng: "Nội dung điểm nghẽn" -> "noi dung diem nghen". */
export const nk = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

/** Ngày "YYYY-MM-DD" theo giờ Việt Nam. */
export const vnDay = (ms) => new Date(ms + VN).toISOString().slice(0, 10);

export const STATUS = {
  unset: { label: 'Cần cập nhật trạng thái', order: -1 }, // ô Trạng thái trên sheet đang trống
  new: { label: 'Chờ xử lý', order: 0 }, // chữ trên sheet
  doing: { label: 'Đang xử lý', order: 1 },
  coord: { label: 'Chờ phối hợp', order: 2 },
  decide: { label: 'Cần quyết định', order: 3 },
  done: { label: 'Đã xử lý', order: 4 },
};
export const OPEN_STATUSES = ['unset', 'new', 'doing', 'coord', 'decide'];

/** Ô Trạng thái -> mã. */
export function statusCode(raw) {
  const k = nk(raw);
  if (!k) return 'unset';
  if (/da xu ly|hoan thanh|da thao go|da giai quyet|xong|^done$|da xong|dong$/.test(k)) return 'done';
  if (/quyet dinh|phe duyet|cho duyet|xin y kien|chi dao/.test(k)) return 'decide';
  if (/phoi hop|cho ho tro|cho ben|cho don vi/.test(k)) return 'coord';
  if (/dang xu ly|dang lam|dang trien khai|dang thuc hien|dang go/.test(k)) return 'doing';
  return 'new';
}

/** CSV -> mảng dòng (RFC 4180, ô có xuống dòng trong ngoặc kép). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

/** "30 phút", "1 giờ 30 phút", "2 tiếng", "1 ngày" (danh sách chọn của cột Thời gian xử lý) -> số phút; không phải thời lượng -> null. */
export function parseDuration(raw) {
  const m = /^(?:(\d+)\s*ngày)?\s*(?:(\d+)\s*(?:giờ|tiếng))?\s*(?:(\d+)\s*phút)?$/i.exec(String(raw ?? '').replace(/\s+/g, ' ').trim());
  if (!m || (m[1] == null && m[2] == null && m[3] == null)) return null;
  return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

/**
 * Hạn xử lý ghi trên sheet -> { at (ms) | null, hasTime, from? (ms), duration? }.
 * "25/11/2026", "25/11", "23/11 17:30", "17h30 ngày 24/11", "17:30" (hôm nay theo `now`); không đọc được -> at = null.
 * Khoảng ngày "22/11/2026-25/11/2026", "22/11 đến 25/11", "22-25/11/2026": at = hết ngày cuối, from = đầu ngày đầu.
 * Thời lượng "30 phút", "1 giờ 30 phút", "1 ngày": at = null, duration = chữ trên sheet (không biết mốc bắt đầu).
 */
export function parseDeadline(raw, now = Date.now()) {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { at: null, hasTime: false };
  if (parseDuration(t) != null) return { at: null, hasTime: false, duration: t };
  const today = vnDay(now);
  const yNow = Number(today.slice(0, 4));
  const yOf = (v) => (v == null ? null : +v < 100 ? 2000 + +v : +v);
  const dayMs = (y, mo, d, hh = 0, mm = 0) => {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    const ms = Date.parse(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`) - VN;
    return Number.isFinite(ms) ? ms : null;
  };
  // Khoảng ngày: 2 ngày đầy đủ cách nhau bởi "-", "–", "~", "đến", "tới"; hoặc "22-25/11[/2026]".
  const two = /^(?:từ\s*)?(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*[/.]\s*(\d{2,4}))?\s*(?:[-–—~→]|đến|tới)\s*(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*[/.]\s*(\d{2,4}))?$/i.exec(t);
  const short = two ? null : /^(?:từ\s*)?(\d{1,2})\s*(?:[-–—~→]|đến|tới)\s*(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*[/.]\s*(\d{2,4}))?$/i.exec(t);
  if (two || short) {
    const [d1, m1, y1, d2, m2, y2] = two ? [+two[1], +two[2], yOf(two[3]), +two[4], +two[5], yOf(two[6])] : [+short[1], +short[3], yOf(short[4]), +short[2], +short[3], yOf(short[4])];
    const yEnd = y2 ?? y1 ?? yNow;
    const from = dayMs(y1 ?? yEnd, m1, d1);
    const at = dayMs(yEnd, m2, d2, 23, 59);
    if (from != null && at != null && from <= at) return { at, hasTime: false, from };
  }
  let y = yNow;
  let mo = 0;
  let d = 0;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  const dm = /(?:^|[^\d:])(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?(?![\d:])/.exec(t);
  if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; } else if (dm) { d = +dm[1]; mo = +dm[2]; if (dm[3]) y = yOf(dm[3]); }
  const rest = iso ? t.replace(iso[0], ' ') : dm ? t.replace(dm[0], ' ') : t;
  const tm = /(\d{1,2})\s*(?::|h|giờ|g)\s*(\d{2})?/i.exec(rest);
  const hasDate = mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  const hasTime = !!tm && +tm[1] <= 24 && (+tm[2] || 0) <= 59;
  if (!hasDate && !hasTime) return { at: null, hasTime: false };
  const day = hasDate ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : today;
  const hh = hasTime ? String(+tm[1]).padStart(2, '0') : '23';
  const mm = hasTime ? String(+tm[2] || 0).padStart(2, '0') : '59';
  const at = Date.parse(`${day}T${hh}:${mm}:00Z`) - VN;
  return Number.isFinite(at) ? { at, hasTime } : { at: null, hasTime: false };
}

/** "internal" / "External" -> "Internal" / "External" (sheet gõ tay, hoa thường lẫn lộn); chữ khác giữ nguyên. */
export function kindLabel(raw) {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const k = nk(t);
  return k === 'internal' ? 'Internal' : k === 'external' ? 'External' : t;
}

/**
 * Phần hỗ trợ của 1 điểm nghẽn phải có cả người hỗ trợ lẫn đơn vị hỗ trợ (cột "Đơn vị người hỗ trợ" hoặc "Đơn vị hỗ trợ").
 * -> '' (đủ) | 'unit' (thiếu đơn vị) | 'person' (thiếu người) | 'both' (thiếu cả hai).
 */
export function supportGap(it) {
  const person = !!String(it?.supporter ?? '').trim();
  const unit = !!mergeUnits(it?.supporterUnit, it?.supportUnit);
  return person && unit ? '' : person ? 'unit' : unit ? 'person' : 'both';
}
export const SUPPORT_GAP_LABEL = { unit: 'Cần cập nhật đơn vị hỗ trợ', person: 'Cần cập nhật người hỗ trợ', both: 'Cần cập nhật người/đơn vị hỗ trợ' };

/** Gộp tên đơn vị trùng nhau: ("DAIT", "Ban DAIT") -> "Ban DAIT"; ("Phòng Sales", "Ban DAIT") -> "Phòng Sales · Ban DAIT". */
export function mergeUnits(...units) {
  const out = [];
  for (const u of units.map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const k = nk(u);
    const i = out.findIndex((x) => nk(x).includes(k) || k.includes(nk(x)));
    if (i < 0) out.push(u); else if (u.length > out[i].length) out[i] = u;
  }
  return out.join(' · ');
}

/** "Dòng tiền 4: Dòng tiền thu trước hạn/quá hạn" -> { no: 4, short: "Thu trước hạn/quá hạn" }. */
export function streamParts(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { no: null, short: '' };
  const m = /^(?:\d+\s*[.)]\s*)?d[òo]ng\s*ti[ềe]n\s*(\d+)?\s*[:\-–]?\s*(.*)$/i.exec(s);
  if (!m) return { no: null, short: s };
  let rest = (m[2] || '').replace(/^d[òo]ng\s*ti[ềe]n\s*/i, '').trim();
  rest = rest ? rest.charAt(0).toLocaleUpperCase('vi') + rest.slice(1) : s;
  return { no: m[1] ? Number(m[1]) : null, short: rest };
}

/** Ô Task -> danh sách task con (mỗi dòng / mỗi đoạn cách bởi ";" là 1 task, bỏ gạch đầu dòng, số thứ tự). */
export function splitTasks(raw) {
  return String(raw ?? '')
    .split(/\r?\n|;/)
    .map((x) => x.replace(/^\s*(?:[-–•*+]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * CSV tab "Điểm nghẽn" -> { items, columns } — items: mọi dòng có nội dung điểm nghẽn.
 * item: { id, stt, row, stream, no, streamShort, group, kind, content, tasks, owner, ownerUnit, supporter, supporterUnit,
 *         supportUnit, supportContent, status, statusRaw, deadlineRaw, due (ms | null), dueHasTime, dueFrom (ms | null),
 *         duration ('' | "30 phút") }
 */
export function parseBlockers(csv, now = Date.now()) {
  const rows = parseCsv(csv);
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
    const keys = rows[i].map(nk);
    if (keys.includes('dong tien') && keys.some((k) => k.startsWith('noi dung') || k.startsWith('van de'))) h = i;
  }
  if (h < 0) return { items: [], columns: null, error: 'Không tìm thấy dòng tiêu đề có cột “Dòng tiền” và “Nội dung điểm nghẽn”.' };
  const keys = rows[h].map(nk);
  const col = (test) => keys.findIndex((k) => k && test(k));
  const c = {
    stt: col((k) => k === 'stt'),
    stream: col((k) => k === 'dong tien'),
    group: col((k) => k.startsWith('nhom')),
    kind: col((k) => k.includes('phan loai')),
    content: col((k) => (k.startsWith('noi dung') && !k.includes('ho tro')) || k.startsWith('van de')),
    task: col((k) => k === 'task' || k.startsWith('task') || k.includes('task con') || k.includes('dau viec') || k.includes('cong viec con')),
    // "Người phụ trách" / "Người hỗ trợ" là người; 3 cột "Đơn vị …" đọc riêng (tên cột cũng chứa "phụ trách" / "hỗ trợ").
    owner: col((k) => k.includes('phu trach') && !k.startsWith('don vi')),
    ownerUnit: col((k) => k.startsWith('don vi') && k.includes('phu trach')),
    supporter: col((k) => k.includes('ho tro') && !k.startsWith('don vi') && !k.startsWith('noi dung')),
    supporterUnit: col((k) => k.startsWith('don vi') && k.includes('nguoi ho tro')),
    supportUnit: col((k) => k === 'don vi ho tro'),
    supportContent: col((k) => k.startsWith('noi dung') && k.includes('ho tro')),
    status: col((k) => k.startsWith('trang thai') || k.startsWith('tinh trang')),
    deadline: col((k) => k.includes('thoi gian') || k.includes('deadline') || k.startsWith('han')),
  };
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').replace(/[ \t]+/g, ' ').trim() : '');
  const items = [];
  const seen = new Map();
  rows.slice(h + 1).forEach((r, k) => {
    const content = cell(r, c.content);
    if (!content) return;
    const stream = cell(r, c.stream);
    const { no, short } = streamParts(stream);
    const deadlineRaw = cell(r, c.deadline);
    const dl = parseDeadline(deadlineRaw, now);
    const statusRaw = cell(r, c.status);
    const base = `${nk(stream)}|${nk(cell(r, c.group))}|${nk(content)}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    items.push({
      id: `${base}#${n}`,
      stt: cell(r, c.stt),
      row: h + 2 + k,
      stream,
      no,
      streamShort: short,
      group: cell(r, c.group),
      kind: kindLabel(cell(r, c.kind)),
      content,
      tasks: splitTasks(c.task >= 0 ? r[c.task] : ''),
      owner: cell(r, c.owner),
      ownerUnit: cell(r, c.ownerUnit),
      supporter: cell(r, c.supporter),
      supporterUnit: cell(r, c.supporterUnit),
      supportUnit: cell(r, c.supportUnit),
      supportContent: cell(r, c.supportContent),
      status: statusCode(statusRaw),
      statusRaw,
      deadlineRaw,
      due: dl.at,
      dueHasTime: dl.hasTime,
      dueFrom: dl.from ?? null,
      duration: dl.duration || '',
    });
  });
  return { items, columns: { ...c, hasTask: c.task >= 0, hasStatus: c.status >= 0, hasSupportContent: c.supportContent >= 0 } };
}

/** Tình trạng hạn của 1 điểm nghẽn đang mở: 'overdue' | 'today' | 'later' | 'none'. */
export function dueState(it, now = Date.now()) {
  if (it.due == null) return 'none';
  if (it.due <= now) return 'overdue';
  return vnDay(it.due) === vnDay(now) ? 'today' : 'later';
}

/** Ô số "Sắp đến hạn": điểm nghẽn đang mở, chưa quá hạn, thời gian hoàn thành còn dưới 2 giờ. */
export const SOON_MS = 2 * 3600 * 1000;
export const isSoon = (it, now = Date.now()) => it.due != null && it.due > now && it.due - now < SOON_MS;

/** "Trễ 2 ngày" · "Trễ 5 giờ" · "Còn 9 giờ 47 phút" · "Ngày mai" · "Còn 2 ngày" · "Chưa có hạn". */
export function dueHint(it, now = Date.now()) {
  if (it.due == null) return it.duration ? `Xử lý trong ${it.duration}` : 'Chưa có hạn';
  const diff = it.due - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / DAY);
  const hours = Math.floor((abs % DAY) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  if (diff <= 0) return days ? `Trễ ${days} ngày` : hours ? `Trễ ${hours} giờ` : `Trễ ${Math.max(1, mins)} phút`;
  const dayGap = Math.round((Date.parse(`${vnDay(it.due)}T00:00:00Z`) - Date.parse(`${vnDay(now)}T00:00:00Z`)) / DAY);
  if (dayGap === 0) return hours ? `Còn ${hours} giờ ${mins} phút` : `Còn ${Math.max(1, mins)} phút`;
  if (dayGap === 1) return 'Ngày mai';
  return `Còn ${dayGap} ngày`;
}

/** "21/11 · 17:30", "25/11" khi sheet chỉ ghi ngày, "22/11 – 25/11" khi sheet ghi khoảng ngày. */
export function dueText(it) {
  if (it.due == null) return '';
  const s = new Date(it.due + VN).toISOString();
  if (it.dueFrom != null) { const f = new Date(it.dueFrom + VN).toISOString(); return `${f.slice(8, 10)}/${f.slice(5, 7)} – ${s.slice(8, 10)}/${s.slice(5, 7)}`; } // khoảng ngày
  return it.dueHasTime ? `${s.slice(8, 10)}/${s.slice(5, 7)} · ${s.slice(11, 16)}` : `${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

/**
 * Số liệu cho trang: đang mở (xếp quá hạn lên đầu rồi theo hạn gần nhất, chưa có hạn cuối cùng), đã xử lý, đếm theo
 * trạng thái / dòng tiền / người phụ trách.
 */
export function summarize(items, now = Date.now()) {
  const open = items.filter((it) => it.status !== 'done').map((it) => ({ ...it, dueState: dueState(it, now) }));
  const done = items.filter((it) => it.status === 'done');
  open.sort((a, b) => {
    const ao = a.dueState === 'overdue' ? 0 : a.due == null ? 2 : 1;
    const bo = b.dueState === 'overdue' ? 0 : b.due == null ? 2 : 1;
    return ao - bo || (a.due ?? 0) - (b.due ?? 0) || (Number(a.stt) || a.row) - (Number(b.stt) || b.row);
  });
  const byStatus = Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0]));
  for (const it of open) byStatus[it.status]++;
  const streams = new Map();
  const owners = new Map();
  for (const it of open) {
    const sk = it.no != null ? `no:${it.no}` : nk(it.streamShort || it.stream) || 'none';
    const s = streams.get(sk) || { key: sk, no: it.no, name: it.streamShort || it.stream || 'Chưa ghi dòng tiền', open: 0, overdue: 0 };
    s.open++;
    if (it.dueState === 'overdue') s.overdue++;
    streams.set(sk, s);
    const on = it.owner || 'Chưa ghi người phụ trách';
    const ok = nk(on);
    const o = owners.get(ok) || { key: ok, name: on, open: 0, overdue: 0, missing: !it.owner };
    o.open++;
    if (it.dueState === 'overdue') o.overdue++;
    owners.set(ok, o);
  }
  return {
    open,
    done,
    counts: {
      open: open.length,
      overdue: open.filter((it) => it.dueState === 'overdue').length,
      today: open.filter((it) => it.dueState === 'today').length,
      soon: open.filter((it) => isSoon(it, now)).length,
      noSupporter: open.filter((it) => !it.supporter && !it.supportUnit).length, // chưa có cả người lẫn đơn vị hỗ trợ
      noDue: open.filter((it) => it.due == null && !it.duration).length,
      done: done.length,
      streams: new Set(open.map((it) => (it.no != null ? it.no : nk(it.stream))).filter((x) => x !== '')).size,
    },
    byStatus,
    streams: [...streams.values()].sort((a, b) => (a.no ?? 99) - (b.no ?? 99) || a.name.localeCompare(b.name, 'vi')),
    owners: [...owners.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name, 'vi')),
  };
}

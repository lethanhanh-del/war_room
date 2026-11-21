// War Room dashboard — giao diện. Dữ liệu từ /api/dashboard, thao tác ghi cần PIN người vận hành.
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const fmtNum = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

// Lucide icons (ISC)
const ICONS = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userX: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  octagon: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  gavel: '<path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const STAGES = ['Nhận diện', 'Quyết định', 'Phân công', 'Hành động', 'Kiểm chứng', 'Đóng việc'];
const STATUS = ['Chưa bắt đầu', 'Đang triển khai', 'Nghẽn', 'Chờ kiểm chứng', 'Hoàn thành'];
const STATUS_BADGE = { 'Chưa bắt đầu': 'neutral', 'Đang triển khai': 'info', Nghẽn: 'danger', 'Chờ kiểm chứng': 'warning', 'Hoàn thành': 'success', 'Đã loại': 'neutral' };
const RESULT_BADGE = (r) => (/lỗi|từ chối/i.test(r) ? 'danger' : /cần xử lý|bỏ qua/i.test(r) ? 'warning' : /thành công|đã ghi|đã duyệt/i.test(r) ? 'success' : 'neutral');
// Gợi ý trên form — cùng quy tắc với server (src/logic.js)
const GROUP_RE = /[\/&,;+]|\s(và|với)\s|^(nhóm|ban|phòng|khối|bộ phận|team|các)(\s|$)/i;
const INTERMEDIATE_RE = /(phương án|tối ưu|tiếp tục|nghiên cứu|làm rõ)/i;
function looksLikeOnePerson(s) {
  s = String(s || '').trim();
  if (!s || GROUP_RE.test(s)) return false;
  const words = s.replace(/^(mr|ms|mrs|anh|chị|ông|bà)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 5 && words.every((w) => /^\p{Lu}[\p{Ll}]*$/u.test(w));
}

const S = { model: null, meta: null, tab: 'targets', filter: 'all', lastOk: 0, failing: false, timer: null };

// ------------------------------------------------------------------ phiên người vận hành
const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k) || ''; } catch { return ''; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { /* bộ nhớ trình duyệt bị chặn */ } },
  del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch { /* bỏ qua */ } },
};
const operator = {
  get name() { return store.get('wr_name'); },
  get pin() { return store.get('wr_pin', true); },
  get active() { return Boolean(this.name && this.pin); },
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (operator.active) {
    headers['x-operator-pin'] = operator.pin;
    headers['x-operator-name'] = encodeURIComponent(operator.name);
  }
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch { /* không có nội dung */ }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = `toast${isErr ? ' err' : ''}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ------------------------------------------------------------------ tải dữ liệu
async function load() {
  try {
    const { model, meta } = await api('/api/dashboard');
    S.model = model;
    S.meta = meta;
    S.lastOk = Date.now();
    S.failing = false;
    render();
    if (!S.timer) S.timer = setInterval(load, (meta.refreshSeconds || 30) * 1000);
  } catch (err) {
    S.failing = true;
    S.failMsg = err.message;
    renderLive();
    if (!S.timer) S.timer = setInterval(load, 15000);
  }
}

function renderLive() {
  const pill = $('livePill');
  pill.classList.remove('stale', 'offline');
  if (S.failing) {
    pill.classList.add('offline');
    $('liveText').textContent = 'MẤT KẾT NỐI';
    pill.title = S.failMsg || '';
    return;
  }
  if (!S.model) return;
  const age = Math.round((Date.now() - S.lastOk) / 1000);
  const realtime = S.model.rules.find((r) => r.key === 'realtime');
  if (realtime && !realtime.ok) pill.classList.add('stale');
  $('liveText').textContent = `${realtime && !realtime.ok ? 'DỮ LIỆU CŨ' : 'LIVE'} · ${age < 5 ? 'vừa tải' : `${age}s trước`}`;
  pill.title = realtime ? realtime.status : '';
}

// ------------------------------------------------------------------ vẽ giao diện
function render() {
  const m = S.model;
  document.body.classList.toggle('is-operator', operator.active);
  renderTop(m);
  renderRules(m);
  $('headline').innerHTML = `${icon('alert')}<div><div class="headline-label">Điều cần biết ngay · ${esc(S.meta.mode === 'demo' ? 'dữ liệu mẫu' : 'tự tổng hợp từ Sổ mục tiêu')}</div><p class="headline-text">${esc(m.headline)}</p></div>`;
  renderHero(m);
  renderDecisions(m);
  renderStreams(m);
  renderTabs(m);
  renderTargets(m);
  renderProposals(m);
  renderReport(m);
  renderLog(m);
  renderDuty(m);
  renderCollections(m);
  renderSystem(m);
  renderLive();
  const err = $('errorBanner');
  err.hidden = !S.meta.lastError;
  err.textContent = S.meta.lastError || '';
}

function renderTop(m) {
  const tb = m.timebox;
  $('tbLabel').textContent = `Time-box ${tb.rangeText}${tb.phase === 'running' ? ` · ngày ${tb.dayIndex}/${tb.totalDays}` : ''}`;
  $('tbValue').textContent = tb.text;
  $('shiftPill').textContent = `${m.shift.label} · ${m.shift.range}`;
  const sheet = $('sheetLink');
  sheet.hidden = !safeUrl(S.meta.sheetUrl);
  sheet.href = safeUrl(S.meta.sheetUrl) || '#';
  sheet.innerHTML = `${icon('sheet')}Sổ mục tiêu`;
  $('operatorBtn').innerHTML = operator.active ? `${icon('logout')}Thoát (${esc(operator.name)})` : `${icon('lock')}Người vận hành`;
  $('operatorBtn').hidden = document.documentElement.dataset.theme === 'tv';
  $('tvBtn').innerHTML = document.documentElement.dataset.theme === 'tv' ? `${icon('sun')}Giao diện sáng` : `${icon('monitor')}TV`;
  $('addDecisionBtn').innerHTML = `${icon('plus')}Thêm việc cần quyết`;
  $('addTargetBtn').innerHTML = `${icon('plus')}Thêm mục tiêu`;
  $('scanBtn').innerHTML = `${icon('sparkles')}Quét tài liệu ngay`;
  $('reportBtn').innerHTML = `${icon('file')}Tạo báo cáo mới`;
  $('copyReportBtn').innerHTML = `${icon('copy')}Sao chép`;
}

function renderRules(m) {
  const source = S.meta.mode === 'demo' ? 'Dữ liệu mẫu (demo)' : 'Google Sheet · Sổ mục tiêu';
  $('rules').innerHTML = m.rules.map((r) => `<span class="rule-chip ${r.ok ? 'ok' : 'fail'}" title="${esc(r.status)}">${icon(r.ok ? 'check' : 'x')}<b>${esc(r.name)}</b>${esc(r.status)}</span>`).join('')
    + `<span class="source">Nguồn: <b>${esc(source)}</b></span>`;
}

function renderHero(m) {
  const k = m.kpi;
  const money = m.money;
  const pct = money.moneyTarget ? Math.round((money.collected / money.moneyTarget) * 100) : null;
  const seg = (n, cls) => (n > 0 ? `<span class="${cls}" style="flex:${n}"></span>` : '');
  const doing = k.inProgress;
  const rest = Math.max(0, k.total - k.verified - k.reportedDone - doing);
  $('hero').innerHTML = `
    <article class="hero-tile">
      <div class="hero-label">Tiền đã thu về (có chứng từ)</div>
      <div class="hero-figure"><span class="hero-value num">${money.collected ? fmtNum(money.collected) : '—'}</span><span class="hero-unit">tỷ VNĐ</span></div>
      ${money.moneyTarget ? `<span class="chip info">${icon('check')}${pct}% chỉ tiêu ${fmtNum(money.moneyTarget)} tỷ</span>` : `<span class="chip warning">${icon('alert')}Chưa đặt chỉ tiêu tiền</span>`}
      <div class="hero-sub">Khai thông: ${money.unlocked ? `${fmtNum(money.unlocked)} tỷ` : 'chưa nhập'}${money.pendingCollected ? ` · ${fmtNum(money.pendingCollected)} tỷ chờ chứng từ` : ''}</div>
    </article>
    <article class="hero-tile">
      <div class="hero-label">Mục tiêu hoàn thành</div>
      <div class="hero-figure"><span class="hero-value num">${k.doneOrReported}/${k.total}</span><span class="hero-unit">${fmtNum(k.donePct)}%</span></div>
      <div class="segbar" role="img" aria-label="${k.verified} đã kiểm chứng, ${k.reportedDone} chờ chứng từ, ${doing} đang làm">${seg(k.verified, 'done')}${seg(k.reportedDone, 'reported')}${seg(doing, 'doing')}${seg(rest, 'rest')}</div>
      <div class="legend"><span><i style="background:var(--success)"></i>${k.verified} đã kiểm chứng</span><span><i style="background:var(--success);opacity:.55"></i>${k.reportedDone} chờ chứng từ</span><span><i style="background:var(--accent)"></i>${doing} đang làm</span></div>
      <div class="hero-sub">${icon('clock')} ${m.timebox.phase === 'running' ? `Đã qua ngày ${m.timebox.dayIndex}/${m.timebox.totalDays}` : esc(m.timebox.text)}${k.overdue ? ` · <b style="color:var(--danger)">${k.overdue} quá hạn</b>` : ''}</div>
    </article>
    <article class="hero-tile">
      <div class="hero-label">Điểm chờ đang mở</div>
      <div class="hero-figure"><span class="hero-value num">${m.waiting.total}</span></div>
      ${m.waiting.total ? `<span class="chip danger">${icon('octagon')}Vi phạm Zero Waiting</span>` : `<span class="chip success">${icon('check')}Không có điểm chờ</span>`}
      <div class="kv-list">${Object.entries(m.waiting.byKind).map(([kind, n]) => `<div><span>${esc(kind)}</span><b class="num">${n}</b></div>`).join('')}</div>
    </article>
    <article class="hero-tile">
      <div class="hero-label">Cần quyết định ngay</div>
      <div class="hero-figure"><span class="hero-value num">${m.decisions.open.length}</span><span class="hero-unit">việc</span></div>
      ${m.decisions.open.length ? `<span class="chip warning">${icon('clock')}Chờ Ban Điều hành</span>` : `<span class="chip success">${icon('check')}Không có việc tồn</span>`}
      <div class="hero-sub">Quyết ngay trong ca tại War Room — không chờ cuộc họp khác</div>
    </article>`;
}

function renderDecisions(m) {
  $('decisions').innerHTML = m.decisions.open.length ? m.decisions.open.map((d) => `
    <article class="decision">
      <div class="decision-top"><span class="tag-id">${esc(d.id)}</span><span class="muted">${esc(d.rule)}</span></div>
      <div class="decision-title">${esc(d.content)}</div>
      <dl><dt>Người quyết</dt><dd>${esc(d.decider || '—')}</dd><dt>Ảnh hưởng</dt><dd>${esc(d.impact || '—')}</dd></dl>
      <div class="decision-foot"><span>${icon('clock')} Mở từ ${esc(d.openedAt || '—')}</span>
        <button class="btn btn-sm" type="button" data-op data-action="resolve-decision" data-id="${esc(d.id)}">${icon('gavel')}Ghi quyết định</button></div>
    </article>`).join('') : '<p class="empty">Không còn việc nào chờ quyết định.</p>';
}

const STREAM_STATES = [
  ['running', 'users', 'Có owner', 'var(--success)'],
  ['noLead', 'alert', 'Chưa chốt owner', 'var(--warning)'],
  ['short', 'alert', 'Thiếu người', 'var(--warning)'],
  ['noPeople', 'userX', 'Chưa có người', 'var(--danger)'],
  ['undefined', 'x', 'Chưa xác định', 'var(--text-muted)'],
];
function renderStreams(m) {
  const iconOf = Object.fromEntries(STREAM_STATES.map(([s, i]) => [s, i]));
  $('streamLegend').innerHTML = STREAM_STATES.map(([, i, l, c]) => `<span style="color:${c}">${icon(i)} <span style="color:var(--text-2)">${l}</span></span>`).join('');
  $('streams').innerHTML = m.streams.map((s) => `
    <article class="stream ${s.state}" title="${esc(s.owner ? `Owner: ${s.owner}` : s.note || '')}">
      <span class="code">#${esc(s.code)}</span>
      <span class="name">${esc(s.name)}</span>
      <span class="money">${s.state === 'undefined' ? '—' : `Đã thu: ${s.collected ? `${fmtNum(s.collected)} tỷ` : '—'}`}</span>
      <span class="state">${icon(iconOf[s.state] || 'x')}${esc(s.state === 'running' ? s.owner : s.label)}</span>
    </article>`).join('');
}

function renderTabs(m) {
  const tabs = [
    ['targets', 'Mục tiêu', m.kpi.total, false],
    ['proposals', 'Đề xuất chờ duyệt', m.proposals.pending.length, m.proposals.pending.length > 0],
    ['report', 'Báo cáo ngày', m.reports.length, false],
    ['log', 'Nhật ký', m.log.length, false],
  ];
  $('tabs').innerHTML = tabs.map(([key, label, n, alert]) => `<button class="tab" role="tab" type="button" aria-selected="${S.tab === key}" data-action="tab" data-id="${key}">${label}<span class="count${alert ? ' alert' : ''}">${n}</span></button>`).join('');
  for (const [key] of tabs) $(`tab-${key}`).hidden = S.tab !== key;
}

const FILTERS = [
  ['all', 'Tất cả', (t) => true],
  ['active', 'Đang làm', (t) => t.active],
  ['waiting', 'Chờ chứng từ', (t) => t.reportedDone],
  ['violations', 'Thiếu điều kiện bắt buộc', (t) => t.violations > 0],
  ['overdue', 'Quá hạn', (t) => t.overdue],
  ['removed', 'Đã loại', null],
];

function ownerCell(t) {
  if (!t.owner) return `<div class="owner"><span class="avatar none">${icon('userX')}</span><div><div class="owner-name" style="color:var(--danger)">Chưa có owner</div><div class="owner-note bad">Cần chỉ định ngay</div></div></div>`;
  if (!t.checks.owner.ok) return `<div class="owner"><span class="avatar group">${icon('users')}</span><div><div class="owner-name">${esc(t.owner)}</div><div class="owner-note warn">Chưa có 1 owner</div></div></div>`;
  const initials = t.owner.split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  return `<div class="owner"><span class="avatar">${esc(initials)}</span><div><div class="owner-name">${esc(t.owner)}</div><div class="owner-note muted">${esc(t.unit)}</div></div></div>`;
}

function targetRow(t) {
  const steps = Array.from({ length: 6 }, (_, i) => `<span class="${t.stage && i < t.stage ? 'on' : ''}"></span>`).join('');
  const checkCell = t.removed ? `<span class="t-sub">${esc(t.removedReason)}</span>`
    : t.verified ? `<span class="chip success">${icon('check')}Đã kiểm chứng</span>`
      : t.reportedDone ? `<span class="chip warning">${icon('file')}Chờ chứng từ (Bước 5)</span>`
        : `<div class="checks">${[['owner', 'Owner'], ['output', 'Đầu ra'], ['deadline', 'Hạn'], ['criteria', 'Tiêu chí']].map(([k, l]) => `<span class="check ${t.checks[k].ok ? 'ok' : 'bad'}" title="${esc(t.checks[k].reason || 'Đạt')}">${icon(t.checks[k].ok ? 'check' : 'x')}${l}</span>`).join('')}</div>`;
  const deadline = t.deadline
    ? `<span class="${t.overdue ? 'late' : ''}">${esc(t.deadlineText || t.deadline)}</span>${t.overdue ? '<small class="late">Quá hạn</small>' : !t.checks.deadline.ok ? `<small class="warn">${esc(t.checks.deadline.reason)}</small>` : ''}`
    : '<span>—</span><small class="warn">Chưa có hạn</small>';
  const actions = t.removed
    ? `<button class="btn btn-sm" type="button" data-action="restore" data-id="${esc(t.id)}">${icon('undo')}Khôi phục</button>`
    : `<button class="btn btn-sm" type="button" data-action="edit" data-id="${esc(t.id)}">${icon('pencil')}Sửa</button><button class="btn btn-sm btn-danger" type="button" data-action="remove" data-id="${esc(t.id)}">${icon('archive')}Loại</button>`;
  return `<tr class="${t.removed ? 'removed' : ''}">
    <td><div class="t-meta"><span class="id">${esc(t.id)}</span><span>${esc(t.stream || '—')}</span><span class="badge ${STATUS_BADGE[t.status] || 'neutral'}">${esc(t.status)}</span></div>
      <div class="t-title">${esc(t.title)}</div>
      <div class="t-sub">${t.output ? `Đầu ra: ${esc(t.output)}` : '<span style="color:var(--warning)">Chưa có đầu ra đo được</span>'}</div>
      ${t.blocker ? `<div class="t-blocker">${icon('alert')}<span>${esc(t.blocker)}${t.escalateTo ? ` — cần: ${esc(t.escalateTo)}` : ''}</span></div>` : ''}</td>
    <td>${ownerCell(t)}</td>
    <td><div class="stepper"><div class="steps ${t.stage === 6 ? 'closed' : ''}">${steps}</div><small>${t.stage ? `${t.stage}/6 · ${esc(t.stageName)}` : 'Chưa xác định'}</small></div></td>
    <td class="deadline num">${deadline}</td>
    <td>${checkCell}</td>
    <td data-op><div class="row-actions">${actions}</div></td>
  </tr>`;
}

function renderTargets(m) {
  $('targetFilters').innerHTML = FILTERS.map(([key, label, fn]) => {
    const n = fn ? m.targets.filter(fn).length : m.removedTargets.length;
    return `<button class="filter" type="button" aria-pressed="${S.filter === key}" data-action="filter" data-id="${key}">${label} · ${n}</button>`;
  }).join('');
  const f = FILTERS.find(([k]) => k === S.filter) || FILTERS[0];
  const rows = f[2] ? m.targets.filter(f[2]) : m.removedTargets;
  $('targetRows').innerHTML = rows.length ? rows.map(targetRow).join('') : '<tr><td colspan="6" class="empty">Không có mục tiêu nào.</td></tr>';
}

function renderProposals(m) {
  const pending = m.proposals.pending;
  const recent = m.proposals.recent;
  const item = (p, done) => `
    <div class="proposal">
      <div>
        <div class="t-meta"><span class="id">${esc(p.target)}</span><span>${esc(p.field)}</span><span>· ${esc(p.createdAt)}</span>${done ? `<span class="badge ${p.status === 'Đã duyệt' ? 'success' : 'danger'}">${esc(p.status)}</span>` : ''}</div>
        <div class="proposal-diff">${p.current ? `<s>${esc(p.current)}</s>` : '<span class="muted">(trống)</span>'} <span aria-hidden="true">→</span> <b>${esc(p.proposed)}</b></div>
        ${p.quote ? `<div class="quote">“${esc(p.quote)}”</div>` : ''}
        <div class="t-sub" style="margin-top:6px">${icon('sparkles')} Nguồn: ${safeUrl(p.sourceUrl) ? `<a href="${esc(safeUrl(p.sourceUrl))}" target="_blank" rel="noopener">${esc(p.source)}</a>` : esc(p.source)} · Độ tin cậy: ${esc(p.confidence || '—')}${done && p.reviewer ? ` · ${esc(p.reviewer)}${p.reason ? `: ${esc(p.reason)}` : ''}` : ''}</div>
      </div>
      ${done ? '<div></div>' : `<div class="proposal-actions" data-op>
        <button class="btn btn-sm btn-success" type="button" data-action="approve" data-id="${esc(p.id)}">${icon('check')}Duyệt</button>
        <button class="btn btn-sm btn-danger" type="button" data-action="reject" data-id="${esc(p.id)}">${icon('x')}Từ chối</button></div>`}
    </div>`;
  $('proposalList').innerHTML = (pending.length ? pending.map((p) => item(p, false)).join('') : '<p class="empty" style="padding:16px 20px">Không có đề xuất nào đang chờ duyệt.</p>')
    + (recent.length ? `<div class="panel-head" style="border-top:1px solid var(--border)"><div><h2>Đã xử lý gần đây</h2></div></div>${recent.map((p) => item(p, true)).join('')}` : '');
}

function renderReport(m) {
  const r = m.reports[0];
  $('reportText').textContent = r ? r.content : 'Chưa có báo cáo. Bấm "Tạo báo cáo mới" (cần quyền người vận hành) hoặc chờ giờ tạo tự động.';
  $('reportMeta').textContent = r ? `${r.time} · ${r.kind} · ${r.model}` : `Tự tạo lúc ${S.meta.reportTime} mỗi ngày`;
}

function renderLog(m) {
  $('logRows').innerHTML = m.log.length ? m.log.map((l) => `
    <tr class="log-row">
      <td class="num">${esc(l.time)}</td>
      <td><b>${esc(l.actor)}</b><div class="muted">${esc(l.actorType)} · ${esc(l.channel)}</div></td>
      <td>${esc(l.action)}</td>
      <td>${esc(l.object)}${l.field ? `<div class="muted">${esc(l.field)}</div>` : ''}</td>
      <td class="log-change">${l.before ? `<s>${esc(l.before)}</s> → ` : ''}${esc(l.after)}${l.note ? `<div class="muted">${esc(l.note)}</div>` : ''}</td>
      <td><span class="badge ${RESULT_BADGE(l.result)}">${esc(l.result || '—')}</span></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Chưa có sự kiện nào.</td></tr>';
}

function renderDuty(m) {
  const sh = m.shift;
  $('dutyMeta').textContent = `${sh.label} · ${sh.range} · Hội trường Tầng 5 & GTS`;
  const people = sh.onDuty.length
    ? sh.onDuty.map((p) => `<div class="duty"><div><b>${esc(p.person)}</b><div class="muted">${esc(p.unit)}</div></div></div>`).join('')
    : `<span class="chip danger">${icon('userX')}Ca này chưa có người trực</span>`;
  const slots = sh.slots.map((s) => `<div class="slot ${s.count ? '' : 'empty'}" title="${esc(s.people.join(', ') || 'Chưa có người')}"><b>${s.count}</b>${esc(s.dayLabel)} ${s.name === 'Ngày' ? 'N' : 'Đ'}</div>`).join('');
  $('duty').innerHTML = `${people}<div class="hero-sub" style="margin-top:12px">Lịch trực time-box: ${sh.slotsCovered}/${sh.slots.length} ca có người</div><div class="slots">${slots}</div>`;
}

function renderCollections(m) {
  const list = m.money.collections;
  $('collections').innerHTML = list.length
    ? `<div class="sys-list">${list.slice(0, 8).map((c) => `<div><span>${esc(c.date)} · ${esc(c.stream)}${c.target ? ` · ${esc(c.target)}` : ''}</span><span><b class="num">${fmtNum(c.amount)} tỷ</b> ${c.evidence ? `<span class="badge success">Có chứng từ</span>` : '<span class="badge warning">Chờ chứng từ</span>'}</span></div>`).join('')}</div>`
    : '<p class="empty">Chưa có khoản thu nào được ghi. Kế toán ghi vào tab ThuTien (ngày, dòng tiền, số tiền, link chứng từ).</p>';
}

function renderSystem() {
  const meta = S.meta;
  const t = (ms) => (ms ? new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
  $('system').innerHTML = `<div class="sys-list">
      <div><span>Nguồn</span><span>${meta.mode === 'demo' ? 'Demo (dữ liệu mẫu, không lưu)' : 'Google Sheet'}</span></div>
      <div><span>Đọc Sổ lần cuối</span><span class="num">${t(meta.lastRefreshAt)}</span></div>
      <div><span>Sửa Sổ lần cuối</span><span>${esc(S.model.lastActivityText || '—')}</span></div>
      <div><span>AI (Claude)</span><span>${meta.aiEnabled ? `Bật · ${esc(meta.aiModelExtract)}` : 'Tắt — báo cáo dùng mẫu tự động'}</span></div>
      <div><span>Quét Drive</span><span>${meta.scanDocs || meta.scanEvidence ? `${meta.scanDocs ? 'Tài liệu' : ''}${meta.scanDocs && meta.scanEvidence ? ' + ' : ''}${meta.scanEvidence ? 'Chứng từ' : ''}` : 'Chưa cấu hình'}</span></div>
      <div><span>Lần quét gần nhất</span><span>${meta.lastScanAt ? `${t(meta.lastScanAt)} · ${esc(meta.lastScanResult)}` : '—'}</span></div>
    </div>
    ${meta.operatorEnabled ? '' : '<p class="hint warn" style="margin-top:12px">Chưa đặt OPERATOR_PIN — chế độ chỉ xem.</p>'}`;
}

// ------------------------------------------------------------------ hộp thoại & form
const dlg = $('dlg');
function openDialog({ title, body, submit, onSubmit, danger }) {
  dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-head"><h3 id="dlgTitle">${esc(title)}</h3><button class="btn btn-ghost btn-sm" type="button" data-close aria-label="Đóng">${icon('close')}</button></div>
      <div class="dlg-body">${body}<div class="form-error" hidden></div></div>
      <div class="dlg-foot"><button class="btn" type="button" data-close>Huỷ</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(submit)}</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const errBox = form.querySelector('.form-error');
    btn.disabled = true;
    errBox.hidden = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await onSubmit(values);
      dlg.close();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  dlg.showModal();
  const first = form.querySelector('input, select, textarea');
  if (first) first.focus();
  return form;
}

const field = (name, label, value = '', { type = 'text', wide = false, hint = '', required = false, options, textarea = false, list } = {}) => {
  const id = `f-${name}`;
  let control;
  if (options) control = `<select id="${id}" name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (textarea) control = `<textarea id="${id}" name="${name}"${required ? ' required' : ''}>${esc(value)}</textarea>`;
  else control = `<input id="${id}" name="${name}" type="${type}" value="${esc(value)}"${required ? ' required' : ''}${list ? ` list="${list}"` : ''} autocomplete="off" />`;
  return `<div class="field${wide ? ' wide' : ''}"><label for="${id}">${esc(label)}${required ? ' *' : ''}</label>${control}${hint !== null ? `<span class="hint" id="${id}-hint">${esc(hint)}</span>` : ''}</div>`;
};

function targetForm(t) {
  const streams = S.model.streams.filter((s) => s.state !== 'undefined').map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const body = `<datalist id="streamList">${streams}<option value="Hạ tầng điều hành"></option></datalist>
    ${field('title', 'Tên mục tiêu', t?.title, { wide: true, required: true })}
    ${field('stream', 'Dòng tiền', t?.stream, { list: 'streamList', hint: 'Mã DT01…DT10 hoặc nhóm hỗ trợ' })}
    ${field('unit', 'Đơn vị', t?.unit)}
    ${field('owner', 'Owner (1 người)', t?.owner, { hint: 'Họ tên một người chịu trách nhiệm cuối cùng' })}
    ${field('escalateTo', 'Cần ai quyết / hỗ trợ', t?.escalateTo)}
    ${field('output', 'Đầu ra cần đạt', t?.output, { wide: true, textarea: true, hint: 'Kết quả đo được (hợp đồng ký, tiền về, tỷ lệ đạt) — không phải "phương án" hay "tối ưu"' })}
    ${field('criteria', 'Tiêu chí kiểm chứng', t?.criteria, { wide: true, hint: 'Bằng chứng nào xác nhận hoàn thành (sao kê, hợp đồng, biên bản…)' })}
    ${field('start', 'Bắt đầu', t?.start, { hint: 'dd/mm/yyyy hh:mm' })}
    ${field('deadline', 'Hạn', t?.deadline, { hint: 'dd/mm/yyyy hh:mm — không vượt quá cuối time-box' })}
    ${field('stage', 'Bước (1-6)', t?.stage || 1, { options: STAGES.map((s, i) => [i + 1, `${i + 1}. ${s}`]) })}
    ${field('status', 'Trạng thái', t?.status || 'Chưa bắt đầu', { options: STATUS.map((s) => [s, s]), hint: 'Hoàn thành chỉ khi Bước 6 + có link chứng từ' })}
    ${field('blocker', 'Điểm nghẽn', t?.blocker, { wide: true, textarea: true })}
    ${field('moneyTarget', 'Chỉ tiêu tiền (tỷ)', t?.moneyTarget ?? '', { hint: 'VD: 3,5' })}
    ${field('unlocked', 'Khai thông (tỷ)', t?.unlocked ?? '')}
    ${field('evidence', 'Link chứng từ', t?.evidence, { wide: true, type: 'url' })}
    ${field('note', 'Ghi chú', t?.note, { wide: true, textarea: true })}`;
  const form = openDialog({
    title: t ? `Sửa ${t.id}` : 'Thêm mục tiêu mới',
    body,
    submit: t ? 'Lưu thay đổi' : 'Thêm mục tiêu',
    onSubmit: async (v) => {
      if (t) {
        const r = await api(`/api/targets/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: v });
        toast(r.changed ? `Đã lưu ${r.changed} thay đổi cho ${t.id}` : 'Không có gì thay đổi');
      } else {
        const r = await api('/api/targets', { method: 'POST', body: v });
        toast(`Đã thêm ${r.id}`);
      }
      await load();
    },
  });
  // Gợi ý tuân thủ ngay khi nhập
  const hint = (name, text, cls) => { const h = form.querySelector(`#f-${name}-hint`); h.textContent = text; h.className = `hint ${cls || ''}`; };
  const check = () => {
    const owner = form.owner.value.trim();
    hint('owner', !owner ? 'Họ tên một người chịu trách nhiệm cuối cùng' : looksLikeOnePerson(owner) ? 'Đạt: 1 người chịu trách nhiệm' : 'Đây là nhóm/đơn vị — One Owner yêu cầu họ tên 1 người', owner && !looksLikeOnePerson(owner) ? 'warn' : '');
    const output = form.output.value.trim();
    hint('output', !output ? 'Kết quả đo được (hợp đồng ký, tiền về, tỷ lệ đạt) — không phải "phương án" hay "tối ưu"' : INTERMEDIATE_RE.test(output) ? 'Đầu ra đang là bước trung gian — nên đổi thành kết quả đo được' : 'Đạt', output && INTERMEDIATE_RE.test(output) ? 'warn' : '');
  };
  form.addEventListener('input', check);
  check();
}

function loginDialog() {
  openDialog({
    title: 'Đăng nhập người vận hành',
    body: `${field('name', 'Họ tên người thao tác', operator.name, { required: true, wide: true, hint: 'Tên này được ghi vào Nhật ký cho mọi thao tác' })}
      ${field('pin', 'Mã PIN', '', { type: 'password', required: true, wide: true, hint: 'Do quản trị hệ thống cấp' })}`,
    submit: 'Đăng nhập',
    onSubmit: async (v) => {
      if (!v.name.trim() || !v.pin) throw new Error('Cần nhập họ tên và mã PIN');
      store.set('wr_name', v.name.trim());
      store.set('wr_pin', v.pin, true);
      try {
        await api('/api/operator/check', { method: 'POST' });
      } catch (err) {
        store.del('wr_pin', true);
        throw err;
      }
      toast(`Xin chào ${v.name.trim()} — đã bật chế độ vận hành`);
      render();
    },
  });
}

// ------------------------------------------------------------------ sự kiện
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const target = () => [...S.model.targets, ...S.model.removedTargets].find((t) => t.id === id);
  try {
    if (action === 'tab') { S.tab = id; renderTabs(S.model); return; }
    if (action === 'filter') { S.filter = id; renderTargets(S.model); return; }
    if (action === 'edit') return targetForm(target());
    if (action === 'remove') {
      const t = target();
      return openDialog({
        title: `Loại ${t.id} khỏi War Room`,
        body: `<p class="field wide">${esc(t.title)}</p>${field('reason', 'Lý do loại', '', { wide: true, textarea: true, required: true, hint: 'VD: Không hoàn thành được trong time-box, chuyển về kế hoạch thường. Mục tiêu không bị xoá — vẫn lưu trong Sổ và Nhật ký.' })}`,
        submit: 'Loại khỏi War Room',
        danger: true,
        onSubmit: async (v) => { await api(`/api/targets/${encodeURIComponent(t.id)}/remove`, { method: 'POST', body: v }); toast(`Đã loại ${t.id}`); await load(); },
      });
    }
    if (action === 'restore') { await api(`/api/targets/${encodeURIComponent(id)}/restore`, { method: 'POST' }); toast(`Đã khôi phục ${id}`); await load(); return; }
    if (action === 'approve') { el.disabled = true; const r = await api(`/api/proposals/${encodeURIComponent(id)}/approve`, { method: 'POST' }); toast(`Đã duyệt — cập nhật ${r.id}`); await load(); return; }
    if (action === 'reject') {
      return openDialog({
        title: 'Từ chối đề xuất', body: field('reason', 'Lý do', '', { wide: true, textarea: true, hint: 'Giúp AI và người vận hành sau hiểu vì sao không áp dụng' }), submit: 'Từ chối', danger: true,
        onSubmit: async (v) => { await api(`/api/proposals/${encodeURIComponent(id)}/reject`, { method: 'POST', body: v }); toast('Đã từ chối đề xuất'); await load(); },
      });
    }
    if (action === 'resolve-decision') {
      const d = S.model.decisions.open.find((x) => x.id === id);
      return openDialog({
        title: `Ghi quyết định ${d.id}`,
        body: `<p class="field wide">${esc(d.content)}</p>${field('status', 'Kết quả', 'Đã quyết', { options: [['Đã quyết', 'Đã quyết'], ['Huỷ', 'Huỷ (không cần quyết nữa)']] })}${field('result', 'Nội dung quyết định', '', { wide: true, textarea: true, required: true, hint: 'VD: Giao Ms X làm owner DT #5, hạn 22/11 17:00' })}`,
        submit: 'Ghi quyết định',
        onSubmit: async (v) => { await api(`/api/decisions/${encodeURIComponent(d.id)}/resolve`, { method: 'POST', body: v }); toast(`Đã ghi ${d.id}`); await load(); },
      });
    }
  } catch (err) {
    toast(err.message, true);
    el.disabled = false;
  }
});

$('operatorBtn').addEventListener('click', () => {
  if (operator.active) {
    store.del('wr_pin', true);
    toast('Đã thoát chế độ vận hành');
    render();
  } else loginDialog();
});
$('addTargetBtn').addEventListener('click', () => targetForm(null));
$('addDecisionBtn').addEventListener('click', () => openDialog({
  title: 'Thêm việc cần quyết định',
  body: `${field('content', 'Cần quyết định', '', { wide: true, textarea: true, required: true })}
    ${field('rule', 'Nguyên tắc liên quan', 'Zero Waiting', { options: ['Zero Waiting', 'One Owner', 'End-to-End', 'Strict Time Box', 'Đánh giá kết quả (Mục V)', 'Khác'].map((x) => [x, x]) })}
    ${field('decider', 'Người quyết', '')}
    ${field('impact', 'Ảnh hưởng nếu chưa quyết', '', { wide: true })}`,
  submit: 'Thêm',
  onSubmit: async (v) => { const r = await api('/api/decisions', { method: 'POST', body: v }); toast(`Đã thêm ${r.id}`); await load(); },
}));
$('scanBtn').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  try {
    const r = await api('/api/scan', { method: 'POST' });
    toast(r.skipped ? `Không quét: ${r.skipped}` : `Quét xong — ${r.proposals} đề xuất`);
    await load();
  } catch (err) { toast(err.message, true); } finally { e.currentTarget.disabled = false; }
});
$('reportBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Đang soạn…';
  try {
    await api('/api/report', { method: 'POST' });
    toast('Đã tạo báo cáo ngày');
    await load();
  } catch (err) { toast(err.message, true); } finally { btn.disabled = false; renderTop(S.model); }
});
$('copyReportBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('reportText').textContent);
    toast('Đã sao chép báo cáo — dán vào Zalo / email');
  } catch { toast('Trình duyệt chặn sao chép — hãy bôi đen và sao chép thủ công', true); }
});
$('tvBtn').addEventListener('click', () => {
  const tv = document.documentElement.dataset.theme !== 'tv';
  if (tv) document.documentElement.dataset.theme = 'tv'; else delete document.documentElement.dataset.theme;
  store.set('wr_theme', tv ? 'tv' : 'light');
  if (S.model) render();
});

// ------------------------------------------------------------------ khởi động
if (new URLSearchParams(location.search).get('tv') === '1' || store.get('wr_theme') === 'tv') document.documentElement.dataset.theme = 'tv';
setInterval(renderLive, 5000);
load();

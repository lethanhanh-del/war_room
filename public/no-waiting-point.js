// Trang "Zero Waiting Point" (/no-waiting-point): KPI của nhóm đã được BOD duyệt (cột "Trạng thái duyệt" của nhóm, hoặc ô E1 khi sheet chưa có cột) nhưng đã QUÁ HẠN
// mà chưa hoàn thành, và KPI SẮP ĐẾN HẠN (chưa tick, hạn còn ở phía trước).
// 3 thẻ chỉ số là 3 cách xem (bấm để đổi, ?xem=qua-han | nguoi | sap-den-han):
//   - KPI quá hạn chưa hoàn thành: theo từng nhóm của từng dòng tiền
//   - Người có KPI quá hạn: thẻ từng người + các KPI quá hạn của người đó
//   - Sắp đến hạn: tất cả KPI sắp đến hạn, theo từng nhóm của từng dòng tiền
// Hạn của KPI = giờ kết thúc ở cột thời gian thực hiện trên sheet (vd 09:00-10:00 -> 10:00), không ghi thì 05:00 sáng hôm sau.
// Dữ liệu: cùng GET /api/kpi với trang /kpi (src/kpi/); cách gom tính ở kpi-model.js › noWaitingPoint (có test Node).
// Dòng tiền chưa trình BOD (E1 chưa tick) không được tính, trang ghi rõ ở mục lưu ý.
import { DUE_LABEL, buildModel, dueLabel, noWaitingPoint, overdueText, timeLabel } from './kpi-model.js';
import { parseBlockers, summarize } from './diem-nghen-model.js';
const SOON_MS = 60 * 60 * 1000; // còn dưới 1 giờ: tô vàng

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);
const POLL_MS = 4000;

const ICON = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54Z"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const initials = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w.slice(-2).map((x) => x[0]).join('')).toUpperCase();
};
const streamBadgeNo = (s) => (s.no ? String(s.no) : s.kind === 'support' ? '9' : s.kind === 'liquidation' ? '8' : '');

// ---------- giao diện: dùng chung lựa chọn tối / sáng với các trang khác ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư */ } },
};
const prefs = { theme: store.get('wr-theme') === 'light' ? 'light' : 'dark' };
if (params.get('theme') === 'light' || params.get('theme') === 'dark') prefs.theme = params.get('theme');
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
const MOON = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  $('themeIcon').innerHTML = prefs.theme === 'dark' ? SUN : MOON;
  $('themeLabel').textContent = prefs.theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối';
}
$('themeBtn').addEventListener('click', () => { prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark'; store.set('wr-theme', prefs.theme); applyTheme(); });
applyTheme();

// ---------- trạng thái + tải dữ liệu ----------
const VIEWS = { 'qua-han': 'overdue', nguoi: 'people', 'sap-den-han': 'upcoming' };
const VIEW_PARAM = { overdue: 'qua-han', people: 'nguoi', upcoming: 'sap-den-han' };
const S = {
  data: null,
  model: null,
  stream: params.get('dong') || 'all',
  view: VIEWS[params.get('xem')] || 'overdue',
  timer: null,
  loading: false,
  stale: false,
  clockOffset: 0,
};
const nowMs = () => Date.now() + S.clockOffset;

let lastSig = '';
let pendingReload = false;
async function load({ force = false } = {}) {
  if (S.loading) { pendingReload = true; return; }
  S.loading = true;
  pendingReload = false;
  clearTimeout(S.timer);
  const btn = $('refreshBtn');
  const lbl = $('refreshLabel');
  if (force) { btn.disabled = true; lbl.textContent = 'Đang đồng bộ…'; }
  try {
    const res = await fetch(force ? '/api/kpi?force=1' : '/api/kpi', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!(res.headers.get('Content-Type') || '').includes('application/json')) { location.reload(); return; } // hết phiên đăng nhập
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const sig = JSON.stringify([data.today, data.days, data.streams, data.source?.error, data.source?.warnings, data.source?.off]);
    const changed = !S.model || force || sig !== lastSig;
    lastSig = sig;
    S.data = data;
    if (data.now) S.clockOffset = data.now - Date.now(); // giờ máy chủ, để "quá hạn bao lâu" không lệch theo đồng hồ máy xem
    S.model = buildModel(data);
    S.stale = false;
    if (S.stream !== 'all' && !S.model.streams.some((s) => s.key === S.stream)) S.stream = 'all';
    if (changed) render(); else renderSync();
  } catch (e) {
    S.stale = true;
    if (!S.model) renderFatal(e.message || String(e)); else renderSync();
  } finally {
    S.loading = false;
    btn.disabled = false;
    lbl.textContent = 'Cập nhật ngay';
    if (pendingReload) { pendingReload = false; load(); } else S.timer = setTimeout(() => load(), POLL_MS);
  }
}
$('refreshBtn').addEventListener('click', () => { load({ force: true }); if (S.tab === 'board') globalThis.DN_CONFIG?.reload?.(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
// "Quá hạn / còn bao lâu" chạy theo phút kể cả khi dữ liệu không đổi.
setInterval(() => { if (S.model && !document.hidden) render(); }, 60000);

// Realtime (src/live.js): máy chủ báo {type:"change", scope:"kpi"} khi sheet KPI đổi -> tải lại ngay.
(function live() {
  let delay = 2000;
  const connect = () => {
    let ws;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}/api/live/ws`); } catch { return; }
    ws.onopen = () => { delay = 2000; };
    ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.type === 'change' && m.scope === 'kpi') load(); } catch { /* bỏ qua */ } };
    ws.onclose = () => { setTimeout(connect, delay); delay = Math.min(delay * 2, 30000); };
  };
  connect();
})();

// ---------- vẽ trang ----------
function syncUrl() {
  const p = new URLSearchParams(location.search);
  if (S.tab === 'board') p.set('tab', BOARD_TAB_PARAM); else p.delete('tab');
  if (S.stream && S.stream !== 'all') p.set('dong', S.stream); else p.delete('dong');
  if (S.view !== 'overdue') p.set('xem', VIEW_PARAM[S.view]); else p.delete('xem');
  const q = p.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
}

function renderSync() {
  const src = S.data?.source || {};
  const at = Date.parse(src.checkedAt || '');
  const hhmm = at ? new Date(at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '';
  const srcLabel = src.provider === 'sharepoint' ? 'Excel SharePoint' : 'Google Sheet KPI';
  $('syncText').textContent = hhmm ? `${srcLabel} · cập nhật ${hhmm}` : srcLabel;
  $('sync').dataset.state = S.stale || src.error ? 'stale' : S.model ? 'live' : 'error';
}

function renderNotices(r) {
  const src = S.data?.source || {};
  const out = [];
  if (src.off) out.push(`<div class="notice">${icon('info')}<div class="grow">Đồng bộ Google Sheet KPI đang tắt (KPI_SHEET_URL=off).</div></div>`);
  if (src.error) out.push(`<div class="notice warn">${icon('alert')}<div class="grow"><b>Chưa đọc được dữ liệu KPI.</b> ${esc(src.error)} Đang hiển thị dữ liệu lần đọc trước.</div></div>`);
  if (r.unapproved.length) {
    const nR = r.unapproved.filter((u) => u.code === 'R').length;
    const nN = r.unapproved.length - nR;
    const list = r.unapproved.map((u) => `<span class="nw-ap ap-${u.code}" title="${esc(u.label)}"><i class="kd ap-${u.code}"></i>${esc(u.stream)} · ${esc(u.group)}</span>`).join('');
    out.push(`<details class="notice nw-ap-notice"><summary>${icon('info')}<span><b>Không tính ${r.unapproved.length} nhóm chưa được BOD duyệt</b>: ${nN} chưa trình BOD (đỏ) · ${nR} cần điều chỉnh, bổ sung và trình lại (vàng). Bấm để xem.</span></summary><div class="nw-ap-list">${list}</div></details>`);
  }
  $('notices').innerHTML = out.join('');
}

function renderFatal(message) {
  $('sync').dataset.state = 'error';
  $('syncText').textContent = 'Không tải được dữ liệu';
  $('notices').innerHTML = `<div class="notice err">${icon('alert')}<div class="grow"><b>Không tải được dữ liệu KPI.</b> ${esc(message)} Trang sẽ thử lại sau vài giây.</div></div>`;
  $('main').innerHTML = '';
}

function filtersHtml(all) {
  // Đếm KPI quá hạn / sắp đến hạn theo dòng tiền (trên toàn bộ, không theo bộ lọc) để ghi cạnh tên.
  const over = new Map();
  const up = new Map();
  for (const p of all.people) for (const it of p.items) over.set(it.streamKey, (over.get(it.streamKey) || 0) + 1);
  for (const it of all.upcoming) up.set(it.streamKey, (up.get(it.streamKey) || 0) + 1);
  const cnt = (o, u) => `${o} quá hạn · ${u} sắp đến hạn`;
  const opts = [`<option value="all">Tất cả dòng tiền & nhóm · ${cnt(all.total, all.upcoming.length)}</option>`, ...S.model.streams.filter((s) => s.approval?.A).map((s) => {
    const no = streamBadgeNo(s);
    return `<option value="${esc(s.key)}"${S.stream === s.key ? ' selected' : ''}>${no ? `${no}. ` : ''}${esc(s.name)} · ${cnt(over.get(s.key) || 0, up.get(s.key) || 0)}</option>`;
  })].join('');
  return `<div class="kf-bar">
      <span class="kf-lead">${icon('filter')}Lọc</span>
      <label class="kf-group"><span class="kf-label">Dòng tiền / Nhóm</span><select class="kf-select" id="streamSelect">${opts}</select></label>
    </div>`;
}

function render() {
  renderSync();
  const m = S.model;
  const now = nowMs();
  const all = noWaitingPoint(m, now);
  $('tabOverdueN').textContent = all.total;
  renderNotices(all);
  $('filters').innerHTML = m.streams.length ? filtersHtml(all) : '';
  $('streamSelect')?.addEventListener('change', (e) => { S.stream = e.target.value || 'all'; syncUrl(); render(); });

  if (!m.streams.length) {
    $('main').innerHTML = `<section class="k-panel k-empty"><h2>Chưa có dữ liệu KPI</h2><p class="hint">Sheet KPI cần có tab “Dòng tiền …” với cột Nhóm, PIC và 2 cột KPI | Kết quả cho từng ngày.</p></section>`;
    return;
  }
  // Lọc theo dòng tiền: chỉ giữ KPI của dòng tiền đã chọn.
  const streamName = S.stream === 'all' ? '' : m.streams.find((s) => s.key === S.stream)?.name || '';
  const people = S.stream === 'all' ? all.people : all.people
    .map((p) => { const items = p.items.filter((it) => it.streamKey === S.stream); return { ...p, items, count: items.length, oldestDue: items.length ? Math.min(...items.map((it) => it.due)) : 0 }; })
    .filter((p) => p.count)
    .sort((a, b) => b.count - a.count || a.oldestDue - b.oldestDue);
  const overdue = people.flatMap((p) => p.items);
  const upcoming = S.stream === 'all' ? all.upcoming : all.upcoming.filter((it) => it.streamKey === S.stream);

  let body;
  if (S.view === 'people') body = people.length ? `<section class="nw-grid" aria-label="Người có KPI quá hạn">${people.map((p, i) => personHtml(p, i + 1, now)).join('')}</section>` : clearHtml(streamName, all);
  else if (S.view === 'upcoming') body = groupedHtml(upcoming, 'upcoming', now) || `<section class="k-panel k-empty nw-clear"><span class="nw-clear-ic">${icon('check')}</span><h2>Không còn KPI chờ tới hạn</h2><p class="hint">Mọi KPI ${streamName ? `của ${esc(streamName)}` : 'đã được BOD duyệt'} đều đã tick kết quả, hoặc đã quá hạn.</p></section>`;
  else body = groupedHtml(overdue, 'overdue', now) || clearHtml(streamName, all);
  $('main').innerHTML = `${heroHtml(people, overdue.length, upcoming, now, streamName)}${body}${guideHtml()}`;
  $('main').querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; syncUrl(); render(); }));
}

function heroHtml(people, total, upcoming, now, streamName) {
  const scope = streamName ? esc(streamName) : 'Tất cả dòng tiền & nhóm';
  const streams = new Set(people.flatMap((p) => p.items.map((it) => it.stream)));
  const soon = upcoming.filter((it) => it.leftMs <= SOON_MS);
  const next = upcoming[0];
  const card = (view, cls, inner) => `<button type="button" class="k-card k-big nw-metric ${cls}" data-view="${view}" aria-pressed="${S.view === view}" title="Bấm để xem chi tiết">${inner}<span class="nw-metric-go">${S.view === view ? 'Đang xem' : 'Xem chi tiết'}</span></button>`;
  const card1 = card('overdue', `st-K${total ? '' : ' is-zero'}`, `<p class="k-over">KPI quá hạn chưa hoàn thành · ${scope}</p>
      <p class="k-num-xl">${total} <span>KPI</span></p>
      <p class="hint">${total ? `Đã được BOD duyệt, quá giờ kết thúc (hoặc ${DUE_LABEL} sáng hôm sau khi không ghi giờ) mà chưa tick kết quả${streams.size > 1 ? `, ở ${streams.size} dòng tiền / nhóm` : ''}` : 'Không có KPI nào quá hạn mà chưa hoàn thành'}</p>`);
  const card2 = card('people', `st-L${people.length ? '' : ' is-zero'}`, `<p class="k-over">Người có KPI quá hạn</p>
      <p class="k-num-xl">${people.length} <span>người</span></p>
      <p class="hint">${people.length ? `Nhiều nhất: ${esc(people[0].name)} · ${people[0].count} KPI` : 'Mọi người đều hoàn thành đúng hạn'}</p>`);
  const card3 = card('upcoming', `st-${soon.length ? 'L' : 'N'}${upcoming.length ? '' : ' is-zero'}`, `<p class="k-over">Sắp đến hạn</p>
      <p class="k-num-xl">${upcoming.length} <span>KPI chưa xong</span></p>
      <p class="hint">${next ? `${soon.length ? `<b>${soon.length} KPI còn dưới 1 giờ.</b> ` : ''}Gần nhất: ${esc(next.person)} · hạn ${esc(dueLabel(next.date, next.due))} (còn ${esc(overdueText(next.leftMs))})` : 'Không còn KPI nào đang chờ tới hạn'}</p>`);
  return `<section class="nw-hero" aria-label="Chỉ số chính · bấm để đổi cách xem">${card1}${card2}${card3}</section>`;
}

const timeTag = (it) => { const t = timeLabel(it.time); return t ? `<span class="kl-date nw-time" title="Giờ thực hiện ghi trên sheet">${esc(t)}</span>` : ''; };

/** 1 KPI quá hạn: ngày + giờ + nội dung, hạn chót, quá hạn bao lâu; withPerson: ghi thêm tên người (khi xem theo nhóm). */
function overdueItemHtml(it, now, withPerson) {
  return `<li class="nw-item" title="${esc(it.kpi)}">
      <span class="kmt-ic">${icon('x')}</span>
      <span class="kmt-body">
        <span class="kmt-title"><span class="kl-date" title="Ngày của KPI">${esc(it.label)}</span>${timeTag(it)}<b class="kl-kpi">${esc(it.kpi)}</b></span>
        <span class="nw-due">${icon('clock')}<span>Hạn chót <b class="num">${esc(dueLabel(it.date, it.due))}</b></span><span class="nw-over">Quá hạn <span class="num">${esc(overdueText(now - it.due))}</span></span></span>
        <span class="nw-meta">${withPerson ? `<b>${esc(it.person)}</b>` : `<b>${esc(it.stream)}</b> · ${esc(it.group)}`}${it.taskPic ? ` · PIC: ${esc(it.taskPic)}` : ''}${it.note ? ` · Vướng mắc: ${esc(it.note)}` : ''}</span>
      </span>
    </li>`;
}

/** 1 KPI sắp đến hạn: hạn chót + còn bao lâu, giờ + nội dung, người; còn dưới 1 giờ tô vàng. */
function upcomingItemHtml(it) {
  const soon = it.leftMs <= SOON_MS;
  return `<li class="nw-up${soon ? ' is-soon' : ''}" title="${esc(it.kpi)}">
      <span class="nw-up-when"><b class="num">${esc(dueLabel(it.date, it.due))}</b><small>còn <span class="num">${esc(overdueText(it.leftMs))}</span></small></span>
      <span class="nw-up-body"><span class="nw-up-title"><span class="kl-date" title="Ngày của KPI">${esc(it.label)}</span>${timeTag(it)}<b class="kl-kpi">${esc(it.kpi)}</b></span><span class="nw-meta"><b>${esc(it.person)}</b>${it.taskPic ? ` · PIC: ${esc(it.taskPic)}` : ''}${it.note ? ` · Vướng mắc: ${esc(it.note)}` : ''}</span></span>
      <span class="k-chip st-${soon ? 'L' : 'N'}">${icon('clock')}${soon ? 'Sắp hết giờ' : 'Đang làm'}</span>
    </li>`;
}

/** Danh sách KPI theo từng nhóm của từng dòng tiền (thứ tự như trên sheet). kind: 'overdue' | 'upcoming'. '' khi không có KPI. */
function groupedHtml(items, kind, now) {
  if (!items.length) return '';
  const blocks = [];
  for (const s of S.model.streams) {
    const sItems = items.filter((it) => it.streamKey === s.key);
    if (!sItems.length) continue;
    const no = streamBadgeNo(s);
    const groups = s.groups.map((g) => {
      const gItems = sItems.filter((it) => it.groupKey === g.key);
      if (!gItems.length) return '';
      const people = new Set(gItems.map((it) => it.person));
      const list = gItems.map((it) => (kind === 'overdue' ? overdueItemHtml(it, now, true) : upcomingItemHtml(it))).join('');
      return `<section class="nw-group">
          <header class="nw-ghead"><h4>${esc(g.name)}</h4><span class="nw-gsum">${g.pic?.name ? `PIC: <b>${esc(g.pic.name)}</b> · ` : ''}${people.size} người · <b>${gItems.length}</b> KPI</span></header>
          <ul class="${kind === 'overdue' ? 'nw-list' : 'nw-up-list'}">${list}</ul>
        </section>`;
    }).filter(Boolean).join('');
    blocks.push(`<section class="k-panel nw-stream st-${kind === 'overdue' ? 'K' : 'N'}" aria-label="${esc(s.name)}">
        <header class="nw-shead">${no ? `<span class="nw-sno">${esc(no)}</span>` : ''}<h3>${esc(s.name)}</h3><span class="nw-scount"><b>${sItems.length}</b> KPI ${kind === 'overdue' ? 'quá hạn' : 'sắp đến hạn'}</span></header>
        ${groups}
      </section>`);
  }
  return blocks.join('');
}

function personHtml(p, rank, now) {
  return `<article class="nw-person" aria-label="${esc(p.name)}">
      <header class="nw-person-head">
        <span class="nw-rank">${rank}</span>
        <span class="nw-av" aria-hidden="true">${esc(initials(p.name))}</span>
        <span class="nw-who"><b>${esc(p.name)}</b><small>${esc(p.groups.join(' · '))}</small></span>
        <span class="nw-count" title="Số KPI quá hạn chưa hoàn thành"><b>${p.count}</b> KPI quá hạn</span>
      </header>
      <ul class="nw-list">${p.items.map((it) => overdueItemHtml(it, now, false)).join('')}</ul>
    </article>`;
}

function clearHtml(streamName, all) {
  const where = streamName ? `ở ${esc(streamName)}` : 'ở các dòng tiền đã được BOD duyệt';
  return `<section class="k-panel k-empty nw-clear"><span class="nw-clear-ic">${icon('check')}</span><h2>Zero Waiting Point</h2>
      <p class="hint">Không có KPI nào quá hạn mà chưa hoàn thành ${where}.${all.unapproved.length && !streamName ? ` ${all.unapproved.length} nhóm chưa được BOD duyệt không được tính.` : ''}</p></section>`;
}

function guideHtml() {
  return `<section class="k-panel"><div class="k-phead"><h2>Cách tính</h2></div><ul class="km-legend">
      <li><i class="kd st-K"></i><span><b>KPI quá hạn</b>: quá giờ kết thúc ghi ở cột thời gian thực hiện (vd 09:00-10:00 → hạn 10:00) mà ô Kết quả chưa tick; không ghi giờ thì hạn là ${DUE_LABEL} sáng hôm sau ngày của KPI. Tick sau đó, KPI rời khỏi trang này và tính là Hoàn thành trễ hạn ở trang KPI & kết quả.</span></li>
      <li><i class="kd st-L"></i><span><b>Sắp đến hạn</b>: KPI chưa tick, hạn còn ở phía trước; còn dưới 1 giờ tô vàng.</span></li>
      <li><i class="kd ap-N"></i><span><b>Chưa trình BOD</b> (đỏ) / <b>Cần điều chỉnh, bổ sung và trình lại</b> (vàng): trạng thái duyệt của nhóm ở cột “Trạng thái duyệt” trên sheet. KPI của nhóm chỉ được tính khi <b>BOD đã duyệt</b> (xanh lá).</span></li>
      <li>${icon('users')}<span>Bấm vào 3 thẻ số phía trên để đổi cách xem: theo nhóm của từng dòng tiền, hoặc theo từng người (xếp theo số KPI quá hạn giảm dần).</span></li>
    </ul></section>`;
}

// ---------- 2 tab: "KPI quá hạn" (màn hình trên) · "Zero Waiting Point" (sheet "Zero Waiting Point") ----------
// Tab thứ hai dùng lại nguyên bảng của trang Điểm nghẽn (public/diem-nghen.js) cho sheet "Zero Waiting Point": cùng 13 cột, cùng
// cách đọc (diem-nghen-model.js). Bảng chỉ được nạp khi mở tab lần đầu, và tạm ngừng đọc sheet khi tab đang ẩn.
const BOARD_TAB_PARAM = 'diem-cho';
const PAGE_SUB = {
  overdue: 'KPI đã được BOD duyệt nhưng đã quá hạn mà chưa hoàn thành, theo từng người',
  board: 'Vướng mắc đang chờ người khác hỗ trợ xử lý, từ sheet “Zero Waiting Point”',
};
S.tab = params.get('tab') === BOARD_TAB_PARAM ? 'board' : 'overdue';
let boardMounted = false;

function showTab(tab) {
  S.tab = tab === 'board' ? 'board' : 'overdue';
  const board = S.tab === 'board';
  $('paneOverdue').hidden = board;
  $('paneBoard').hidden = !board;
  $('tabOverdue').setAttribute('aria-selected', String(!board));
  $('tabBoard').setAttribute('aria-selected', String(board));
  $('pageSub').textContent = PAGE_SUB[S.tab];
  if (!board) return;
  if (boardMounted) { globalThis.DN_CONFIG?.reload?.(); return; }
  boardMounted = true;
  globalThis.DN_CONFIG = {
    root: 'zwpBoard',
    embedded: true,
    sheetUrl: '/api/zero-waiting-point/sheet',
    stateUrl: '/api/zero-waiting-point',
    liveScope: 'zero-waiting-point',
    sheetName: 'Zero Waiting Point',
    noun: 'điểm chờ',
    Noun: 'Điểm chờ',
    isActive: () => S.tab === 'board',
    onCount: (n, loadedAt) => { if (loadedAt) $('tabBoardN').textContent = n; },
  };
  import('./diem-nghen.js').catch((e) => {
    boardMounted = false;
    $('zwpBoard').innerHTML = `<section class="k-panel k-empty"><h2>Chưa mở được tab này</h2><p class="hint">${esc(e.message || String(e))}</p></section>`;
  });
}
document.querySelectorAll('.nw-tab').forEach((b) => b.addEventListener('click', () => { showTab(b.dataset.tab); syncUrl(); }));

/** Số điểm chờ đang mở trên nhãn tab khi bảng chưa được mở (mở rồi thì bảng tự báo qua onCount). */
async function loadBoardCount() {
  if (boardMounted || document.hidden) return;
  try {
    const res = await fetch('/api/zero-waiting-point/sheet', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('Content-Type') || '').includes('csv')) return;
    const parsed = parseBlockers(await res.text(), Date.now());
    if (!parsed.error && !boardMounted) $('tabBoardN').textContent = summarize(parsed.items, Date.now()).counts.open;
  } catch { /* để "–" */ }
}

showTab(S.tab);
loadBoardCount();
setInterval(loadBoardCount, 60000);
load();

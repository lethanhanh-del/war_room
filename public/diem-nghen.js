// Trang "Điểm nghẽn" (/waiting-point), dựng theo Figma "War Room CT Homes · Dashboard KPI & Kết quả" › trang Điểm nghẽn
// (node 36:1033): 5 thẻ số (bấm để lọc: Đang mở · Quá hạn · Sắp đến hạn = còn dưới 2 giờ · Chưa có người hỗ trợ · Đã xử lý) · Danh sách điểm nghẽn (lọc theo trạng thái, quá hạn lên đầu) · cột phải: Dòng tiền, Người phụ
// trách, Đã tháo gỡ hôm nay.
// - Dữ liệu: tab "Điểm nghẽn" (GET /api/waiting-point/sheet, CSV), đọc lại mỗi 3 giây và khi máy chủ báo thay đổi.
// - Cách đọc cột / trạng thái / hạn: diem-nghen-model.js (có test Node), theo layout 13 cột của tab trên SharePoint: có đơn vị của
//   người phụ trách / người hỗ trợ, đơn vị hỗ trợ, nội dung hỗ trợ; hạn là 1 ngày, khoảng ngày hoặc thời lượng.
// - Điểm nghẽn bị xoá khỏi sheet (cách báo đã xong theo hướng dẫn trên sheet) hoặc chuyển "Đã xử lý" được ghi vào
//   "Đã tháo gỡ hôm nay", lưu chung trên máy chủ (POST /api/waiting-point › clearedItems, src/waiting-point-sync.js).
// Bản cũ dạng thẻ theo Người hỗ trợ: public/waiting-point.js (giữ cho test và các hàm dùng chung).
import { OPEN_STATUSES, STATUS, SUPPORT_GAP_LABEL, dueHint, dueText, isSoon, mergeUnits, nk, parseBlockers, summarize, supportGap, vnDay } from './diem-nghen-model.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const POLL_MS = 3000;
const KPI_MS = 60000;
const CONFIRM_POLLS = 2; // dòng biến mất 2 lượt đọc liên tiếp mới tính là đã tháo gỡ (tránh Ctrl+Z / sheet đang lưu dở)

const ICON = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  sort: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sub: '<path d="M6 3v12a3 3 0 0 0 3 3h9"/><path d="m15 15 3 3-3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const initials = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w.slice(-2).map((x) => x[0]).join('')).toUpperCase();
};
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- giao diện sáng / tối (dùng chung lựa chọn với các trang khác) ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư */ } },
};
let theme = store.get('wr-theme') === 'light' ? 'light' : 'dark';
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const b = $('dnTheme');
  if (b) b.innerHTML = `${icon(theme === 'dark' ? 'sun' : 'moon')}<span>${theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}</span>`;
}

// ---------- cấu hình ----------
// Mặc định là trang Điểm nghẽn. Trang khác dùng lại bảng này cho 1 sheet cùng 13 cột bằng cách đặt globalThis.DN_CONFIG
// TRƯỚC khi nạp file (import động): tab "Zero Waiting Point" của trang Zero Waiting Point (public/no-waiting-point.js).
//   embedded: true = nhúng trong trang khác: không vẽ thanh đầu trang riêng, không ghi bộ lọc lên URL.
//   isActive(): false thì tạm ngừng đọc sheet (tab đang ẩn). onCount(n): báo số đang mở. reload: hàm đọc lại ngay (file này gán).
const CFG = {
  root: 'dn-app',
  embedded: false,
  sheetUrl: '/api/waiting-point/sheet',
  stateUrl: '/api/waiting-point',
  liveScope: 'waiting-point',
  sheetName: 'Điểm nghẽn',
  noun: 'điểm nghẽn',
  Noun: 'Điểm nghẽn',
  isActive: () => true,
  onCount: null,
  ...(globalThis.DN_CONFIG || {}),
};
if (globalThis.DN_CONFIG) globalThis.DN_CONFIG.reload = () => { load(); loadHistory(); };

// ---------- trạng thái ----------
const params = CFG.embedded ? new URLSearchParams() : new URLSearchParams(location.search);
const S = {
  items: [],
  columns: null,
  error: '',
  loadedAt: 0,
  stale: false,
  kpiStreams: [], // [{ no, name }] 8 dòng tiền đánh số, từ /api/kpi
  history: [], // đã tháo gỡ hôm nay (máy chủ)
  // quick: ô số đang bấm ở hàng chỉ số ('' = tất cả đang mở · 'overdue' · 'soon' · 'nosup' · 'done')
  filter: { status: params.get('tt') || 'all', stream: params.get('dong') || '', owner: params.get('pt') || '', quick: params.get('xem') || '' },
  prevOpen: new Map(), // id -> item của lượt đọc trước (để nhận ra dòng bị xoá)
  missing: new Map(), // id -> số lượt đọc liên tiếp không thấy
  reported: new Set(), // id đã gửi "đã tháo gỡ"
};

function shell() {
  const syncHtml = `<div class="dn-sync"><p><i class="dot" id="dnDot"></i><span id="dnSyncText">Đang đọc sheet “${esc(CFG.sheetName)}”…</span></p><small id="dnSyncAt"></small></div>`;
  // Nhúng trong trang khác: trang đó đã có tiêu đề, nút giao diện; ở đây chỉ còn 1 dòng trạng thái đồng bộ của sheet.
  const top = CFG.embedded
    ? `<div class="dn-embed-top">${syncHtml}</div>`
    : `<header class="dn-top">
      <div class="dn-brand"><span class="dn-badge" aria-hidden="true">ĐN</span>
        <div><h1>Điểm nghẽn · War Room</h1><p id="dnSub">Vướng mắc cần tháo gỡ của các dòng tiền</p></div></div>
      <div class="dn-top-r">
        ${syncHtml}
        <button type="button" class="dn-btn" id="dnTheme"></button>
        <div class="dn-clock">${icon('clock')}<b id="dnClock">--:--</b></div>
      </div>
    </header>`;
  $(CFG.root).innerHTML = `
    ${top}
    <div class="dn-body">
      <div id="dnNotice"></div>
      <section class="dn-kpis" id="dnKpis" aria-label="Chỉ số chính"></section>
      <div class="dn-main">
        <section class="dn-panel dn-list" aria-labelledby="dnListT">
          <header class="dn-list-head">
            <div class="dn-list-title"><h2 id="dnListT">Danh sách ${CFG.noun}</h2><span class="dn-sort">${icon('sort')}Quá hạn lên đầu, sau đó theo hạn gần nhất</span></div>
            <div class="dn-chips" id="dnChips" role="group" aria-label="Lọc theo trạng thái"></div>
            <div id="dnActive"></div>
          </header>
          <div class="dn-table" role="table" aria-label="${CFG.Noun}">
            <div class="dn-tr dn-th" role="row"><span role="columnheader">STT</span><span role="columnheader">${CFG.Noun}</span><span role="columnheader">Phụ trách · Hỗ trợ</span><span role="columnheader">Trạng thái</span><span role="columnheader">Hạn xử lý</span></div>
            <div id="dnRows"></div>
          </div>
        </section>
        <aside class="dn-side">
          <section class="dn-panel" aria-labelledby="dnStreamT"><header class="dn-side-head"><h3 id="dnStreamT">Dòng tiền</h3><small>Đang mở</small></header><ul class="dn-side-list" id="dnStreams"></ul></section>
          <section class="dn-panel" aria-labelledby="dnOwnerT"><header class="dn-side-head"><h3 id="dnOwnerT">Người phụ trách</h3><small>Đang mở</small></header><ul class="dn-side-list" id="dnOwners"></ul></section>
          <section class="dn-panel" aria-labelledby="dnDoneT"><header class="dn-side-head"><h3 id="dnDoneT">Đã tháo gỡ hôm nay</h3><span class="dn-count ok" id="dnDoneN">0</span></header><ul class="dn-done" id="dnDone"></ul></section>
        </aside>
      </div>
    </div>`;
  if (!CFG.embedded) {
    $('dnTheme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; store.set('wr-theme', theme); applyTheme(); });
    applyTheme();
  }
  // Một bộ nghe cho mọi nút lọc (chip trạng thái, dòng tiền, người phụ trách, xoá lọc).
  $(CFG.root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const [k, v] = [b.dataset.f, b.dataset.v || ''];
    if (k === 'clear') S.filter = { status: 'all', stream: '', owner: '', quick: '' };
    else S.filter[k] = S.filter[k] === v && k !== 'status' ? '' : v;
    syncUrl();
    render();
  });
}

function syncUrl() {
  if (CFG.embedded) return; // URL thuộc về trang chứa
  const p = new URLSearchParams(location.search);
  const put = (k, v, def) => { if (v && v !== def) p.set(k, v); else p.delete(k); };
  put('tt', S.filter.status, 'all');
  put('dong', S.filter.stream, '');
  put('pt', S.filter.owner, '');
  put('xem', S.filter.quick, '');
  const q = p.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
}

// ---------- tải dữ liệu ----------
let loading = false;
let timer = null;
async function load() {
  if (loading) return;
  clearTimeout(timer);
  if (!CFG.isActive()) { timer = setTimeout(load, POLL_MS); return; } // tab đang ẩn: chưa cần đọc sheet
  loading = true;
  try {
    const res = await fetch(`${CFG.sheetUrl}?_t=${Date.now()}`, { cache: 'no-store' });
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/html')) { location.reload(); return; } // hết phiên đăng nhập
    if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`);
    const parsed = parseBlockers(await res.text(), Date.now());
    if (parsed.error) throw new Error(parsed.error);
    trackCleared(parsed.items);
    S.items = parsed.items;
    S.columns = parsed.columns;
    S.error = '';
    S.stale = false;
    S.loadedAt = Date.now();
  } catch (e) {
    S.error = e.message || String(e);
    S.stale = true;
  } finally {
    loading = false;
    render();
    timer = setTimeout(load, POLL_MS);
  }
}

async function loadKpiStreams() {
  try {
    const res = await fetch('/api/kpi', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok || !(res.headers.get('Content-Type') || '').includes('json')) return;
    const data = await res.json();
    S.kpiStreams = (data.streams || []).filter((s) => s.no && s.kind !== 'support').map((s) => ({ no: s.no, name: String(s.name || '').replace(/^dòng tiền\s*/i, '').replace(/^\w/, (c) => c.toLocaleUpperCase('vi')) })).sort((a, b) => a.no - b.no);
    render();
  } catch { /* để trống: cột Dòng tiền chỉ hiện dòng tiền có điểm nghẽn */ }
}

async function loadHistory() {
  try {
    const res = await fetch(CFG.stateUrl, { cache: 'no-store' });
    if (!res.ok) return;
    const st = await res.json();
    const list = st?.historyByDate?.[vnDay(Date.now())] || [];
    S.history = [...list].sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0));
    render();
  } catch { /* bỏ qua */ }
}

/** Ghi nhận điểm nghẽn đã tháo gỡ: bị xoá khỏi sheet (2 lượt đọc liên tiếp) hoặc chuyển sang "Đã xử lý". */
function trackCleared(items) {
  const now = Date.now();
  const openNow = new Map(items.filter((it) => it.status !== 'done').map((it) => [it.id, it]));
  const cleared = [];
  for (const it of items) {
    if (it.status === 'done' && S.prevOpen.has(it.id) && !S.reported.has(it.id)) cleared.push(it);
  }
  for (const [id, it] of S.prevOpen) {
    if (openNow.has(id) || items.some((x) => x.id === id)) { S.missing.delete(id); continue; }
    const n = (S.missing.get(id) || 0) + 1;
    if (n >= CONFIRM_POLLS) { S.missing.delete(id); if (!S.reported.has(id)) cleared.push(it); } else { S.missing.set(id, n); openNow.set(id, it); }
  }
  // Lượt đọc đầu tiên: chỉ ghi nhớ, chưa so sánh.
  if (S.loadedAt && cleared.length) {
    for (const it of cleared) S.reported.add(it.id);
    const payload = cleared.map((it) => ({ id: it.id, issue: it.content, group: it.group, stream: it.stream, owner: it.owner, supporter: it.supporter, clearedAt: now, date: vnDay(now) }));
    fetch(CFG.stateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clearedItems: payload }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((st) => { if (st?.historyByDate) { S.history = [...(st.historyByDate[vnDay(Date.now())] || [])].sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0)); render(); } })
      .catch(() => {});
  }
  S.prevOpen = openNow;
}

// ---------- vẽ ----------
function render() {
  const now = Date.now();
  const sum = summarize(S.items, now);
  renderTop(sum, now);
  renderKpis(sum, now);
  renderChips(sum);
  renderRows(sum, now);
  renderSide(sum, now);
}

function renderTop(sum, now) {
  const d = new Date(now + 7 * 3600e3).toISOString();
  const nStreams = S.kpiStreams.length || sum.counts.streams;
  if ($('dnClock')) $('dnClock').textContent = `${d.slice(11, 13)}:${d.slice(14, 16)}`;
  if ($('dnSub')) $('dnSub').textContent = `Vướng mắc cần tháo gỡ của ${pad2(nStreams)} dòng tiền`;
  CFG.onCount?.(sum.counts.open, S.loadedAt);
  const at = S.loadedAt ? new Date(S.loadedAt + 7 * 3600e3).toISOString() : '';
  $('dnDot').dataset.state = S.stale ? 'stale' : S.loadedAt ? 'live' : 'loading';
  $('dnSyncText').textContent = S.stale ? `Mất kết nối sheet “${CFG.sheetName}” · đang thử lại` : `Đồng bộ từ sheet “${CFG.sheetName}”`;
  $('dnSyncAt').textContent = at ? `Cập nhật ${at.slice(11, 19)} · ${at.slice(8, 10)}/${at.slice(5, 7)}/${at.slice(0, 4)}` : '';
  const notes = [];
  if (S.error && !S.items.length) notes.push(`<div class="dn-note bad">${icon('alert')}<span><b>Chưa đọc được sheet “${esc(CFG.sheetName)}”.</b> ${esc(S.error)}</span></div>`);
  else if (S.error) notes.push(`<div class="dn-note warn">${icon('alert')}<span><b>Lần đọc gần nhất bị lỗi</b>, đang hiển thị dữ liệu trước đó. ${esc(S.error)}</span></div>`);
  $('dnNotice').innerHTML = notes.join('');
}

function renderKpis(sum, now) {
  const c = sum.counts;
  const f = S.filter;
  const anyFilter = f.quick || f.status !== 'all' || f.stream || f.owner;
  // Ô số bấm được để lọc danh sách (bấm lại để bỏ). "Đang mở" = bỏ mọi bộ lọc. Ô đang có số 0 thì không bấm được.
  const card = (tone, label, n, hint, quick, cls = '') => {
    const on = quick === 'all' ? !anyFilter : f.quick === quick;
    const attrs = quick === 'all' ? 'data-f="clear"' : `data-f="quick" data-v="${quick}"`;
    return `<button type="button" class="dn-kpi ${tone}${n ? '' : ' is-zero'} ${cls}" ${attrs} aria-pressed="${on}"${n || on ? '' : ' disabled'} title="${on && quick !== 'all' ? 'Bấm lần nữa để bỏ lọc' : quick === 'all' ? `Xem tất cả ${CFG.noun} đang mở` : `Chỉ xem: ${label}`}"><span class="dn-kpi-l"><i class="dot"></i>${label}</span><b>${n}</b><small>${hint}</small></button>`;
  };
  $('dnKpis').innerHTML = [
    card('t-neutral', 'Đang mở', c.open, `Trên ${pad2(c.streams)} dòng tiền`, 'all'),
    card('t-bad', 'Quá hạn', c.overdue, 'Đã qua hạn xử lý', 'overdue', c.overdue ? 'is-alert' : ''),
    card('t-warn', 'Sắp đến hạn', c.soon, 'Thời gian hoàn thành còn dưới 2 giờ', 'soon'),
    card('t-warn', 'Chưa có người hỗ trợ', c.noSupporter, 'Chưa ghi người hoặc đơn vị hỗ trợ', 'nosup'),
    card('t-ok', 'Đã xử lý', S.history.length + c.done, `${CFG.Noun} đã tháo gỡ hôm nay`, 'done'),
  ].join('');
}

const QUICK_LABEL = { overdue: 'Quá hạn', soon: 'Sắp đến hạn', nosup: 'Chưa có người hỗ trợ', done: 'Đã xử lý' };
const QUICK_TEST = {
  overdue: (it) => it.dueState === 'overdue',
  soon: (it, now) => isSoon(it, now), // thời gian hoàn thành còn dưới 2 giờ
  nosup: (it) => !it.supporter && !it.supportUnit,
};

function renderChips(sum) {
  const f = S.filter;
  const chip = (v, label, n, cls = '') => `<button type="button" class="dn-chip ${cls}" data-f="status" data-v="${v}" aria-pressed="${f.quick !== 'done' && f.status === v}"${f.quick === 'done' ? ` disabled title="Đang xem ${CFG.noun} đã xử lý"` : ''}>${v !== 'all' ? '<i class="dot"></i>' : ''}${label}<span class="dn-chip-n">${n}</span></button>`;
  $('dnChips').innerHTML = chip('all', 'Tất cả', sum.counts.open) + OPEN_STATUSES.map((s) => chip(s, STATUS[s].label, sum.byStatus[s], `s-${s}`)).join('');
  const act = [];
  if (QUICK_LABEL[f.quick]) act.push(`Chỉ số: <b>${QUICK_LABEL[f.quick]}</b>`);
  if (f.stream) { const s = sum.streams.find((x) => x.key === f.stream) || S.kpiStreams.map((k) => ({ key: `no:${k.no}`, name: k.name })).find((x) => x.key === f.stream); act.push(`Dòng tiền: <b>${esc(s?.name || f.stream)}</b>`); }
  if (f.owner) { const o = sum.owners.find((x) => x.key === f.owner); act.push(`Phụ trách: <b>${esc(o?.name || f.owner)}</b>`); }
  $('dnActive').innerHTML = act.length ? `<p class="dn-active">Đang lọc · ${act.join(' · ')} <button type="button" class="dn-link" data-f="clear">${icon('x')}Bỏ lọc</button></p>` : '';
}

function streamKeyOf(it) { return it.no != null ? `no:${it.no}` : nk(it.streamShort || it.stream) || 'none'; }

function renderRows(sum, now) {
  const f = S.filter;
  const byStream = (it) => !f.stream || streamKeyOf(it) === f.stream;
  const byOwner = (it) => !f.owner || nk(it.owner || 'Chưa ghi người phụ trách') === f.owner;
  if (f.quick === 'done') { renderDoneRows(sum, byStream, byOwner); return; }
  const quick = QUICK_TEST[f.quick] || (() => true);
  const list = sum.open.filter((it) => (f.status === 'all' || it.status === f.status) && byStream(it) && byOwner(it) && quick(it, now));
  if (!list.length) {
    $('dnRows').innerHTML = `<div class="dn-empty">${icon('check')}<p>${sum.counts.open ? `Không có ${CFG.noun} nào khớp bộ lọc.` : S.loadedAt ? `Hiện không có ${CFG.noun} nào đang mở. Khi phát sinh vướng mắc, nhập vào sheet “${CFG.sheetName}” để hiện ngay tại đây.` : 'Đang tải…'}</p></div>`;
    return;
  }
  $('dnRows').innerHTML = list.map((it) => {
    const st = STATUS[it.status];
    const over = it.dueState === 'overdue';
    const meta = [
      it.no != null ? `<b>DT ${it.no} · ${esc(it.streamShort)}</b>` : it.stream ? `<b>${esc(it.streamShort || it.stream)}</b>` : '<b class="t-warn-t">Chưa ghi dòng tiền</b>',
      it.group ? `<span>${esc(it.group)}</span>` : '',
      it.kind ? `<span class="dn-tag${it.kind === 'Internal' ? ' k-int' : it.kind === 'External' ? ' k-ext' : ''}" title="Phân loại ${CFG.noun}">${esc(it.kind)}</span>` : '',
    ].filter(Boolean).join('<span class="dn-sep">·</span>');
    const tasks = it.tasks.length ? `<ul class="dn-tasks" aria-label="Task con">${it.tasks.map((t) => `<li>${icon('sub')}<span>${esc(t)}</span></li>`).join('')}</ul>` : '';
    const support = it.supportContent ? `<p class="dn-support">${icon('sub')}<span><b>Cần hỗ trợ:</b> ${esc(it.supportContent)}</span></p>` : '';
    // Người + đơn vị (cột "Đơn vị …" trên sheet). Chưa ghi người hỗ trợ nhưng có "Đơn vị hỗ trợ": hiện đơn vị.
    const person = (label, name, unit) => `<span class="dn-pl">${label}</span>${name
      ? `<span class="dn-pn"><span>${esc(name)}</span>${unit ? `<small>${esc(unit)}</small>` : ''}</span>`
      : `<span class="dn-pn is-none t-warn-t">${icon('alert')}Chưa có</span>`}`;
    // Hỗ trợ: phải có cả người lẫn đơn vị hỗ trợ; thiếu phần nào thì báo "Cần cập nhật …" ngay tại ô.
    const gap = supportGap(it);
    const sUnit = mergeUnits(it.supporterUnit, it.supportUnit);
    const need = gap ? `<small class="dn-need">${icon('alert')}${SUPPORT_GAP_LABEL[gap]}</small>` : '';
    const supportCell = `<span class="dn-pl">Hỗ trợ</span>${gap === 'both'
      ? `<span class="dn-pn is-gap">${need}</span>`
      : `<span class="dn-pn${gap ? ' is-gap' : ''}"><span>${esc(it.supporter || sUnit)}</span>${it.supporter && sUnit ? `<small>${esc(sUnit)}</small>` : ''}${need}</span>`}`;
    const due = it.due == null
      ? it.duration
        ? `<span class="dn-due-d">${esc(it.duration)}</span><span class="dn-due-h muted">${icon('clock')}Thời lượng xử lý</span>`
        : `<span class="dn-due-d muted">Chưa có hạn</span><span class="dn-due-h t-warn-t">${icon('alert')}Cần nhập hạn</span>`
      : `<span class="dn-due-d${over ? ' t-bad-t' : ''}">${esc(dueText(it))}${over ? '<span class="dn-over">QUÁ HẠN</span>' : ''}</span><span class="dn-due-h ${over ? 't-bad-t' : it.dueState === 'today' ? 't-warn-t' : 'muted'}">${it.dueState === 'today' ? icon('clock') : ''}${esc(dueHint(it, now))}</span>`;
    return `<div class="dn-tr${over ? ' is-over' : ''}" role="row" title="${esc(it.deadlineRaw ? `Thời gian xử lý trên sheet: ${it.deadlineRaw}` : '')}">
        <span class="dn-stt" role="cell">${esc(it.stt || '')}</span>
        <div class="dn-what" role="cell"><p class="dn-meta">${meta}</p><p class="dn-content">${esc(it.content)}</p>${support}${tasks}</div>
        <div class="dn-people" role="cell">${person('Phụ trách', it.owner, it.ownerUnit)}${supportCell}</div>
        <span role="cell"><span class="dn-status s-${it.status}" title="${esc(it.statusRaw || st.label)}"><i class="dot"></i>${st.label}</span></span>
        <div class="dn-due" role="cell">${due}</div>
      </div>`;
  }).join('');
}

/** Ô "Đã xử lý": dòng "Đã xử lý" còn trên sheet + điểm nghẽn đã tháo gỡ hôm nay (đã xoá khỏi sheet, lưu trên máy chủ). */
function renderDoneRows(sum, byStream, byOwner) {
  const rows = [
    ...sum.done.filter((it) => byStream(it) && byOwner(it)).map((it) => ({ stt: it.stt, no: it.no, stream: it.streamShort || it.stream, group: it.group, content: it.content, owner: it.owner, ownerUnit: it.ownerUnit, supporter: it.supporter, unit: mergeUnits(it.supporterUnit, it.supportUnit), at: '' })),
    ...S.history.map((h) => { const no = /(\d+)/.exec(h.stream || '')?.[1]; return { stt: '', no: no ? Number(no) : null, stream: String(h.stream || '').replace(/^d[òo]ng\s*ti[ềe]n\s*\d*\s*[:\-–]?\s*/i, '') || h.stream || '', group: h.group || '', content: h.issue, owner: h.owner || '', ownerUnit: '', supporter: h.supporter || '', unit: '', at: h.clearedAt ? new Date(h.clearedAt + 7 * 3600e3).toISOString().slice(11, 16) : '' }; })
      .filter((r) => (!S.filter.stream || `no:${r.no}` === S.filter.stream) && (!S.filter.owner || nk(r.owner || 'Chưa ghi người phụ trách') === S.filter.owner)),
  ];
  if (!rows.length) { $('dnRows').innerHTML = `<div class="dn-empty">${icon('check')}<p>Chưa có ${CFG.noun} nào được tháo gỡ hôm nay${S.filter.stream || S.filter.owner ? ' khớp bộ lọc' : ''}.</p></div>`; return; }
  const person = (label, name, unit) => `<span class="dn-pl">${label}</span>${name ? `<span class="dn-pn"><span>${esc(name)}</span>${unit ? `<small>${esc(unit)}</small>` : ''}</span>` : `<span class="dn-pn is-none muted">—</span>`}`;
  $('dnRows').innerHTML = rows.map((r) => `<div class="dn-tr is-done" role="row">
      <span class="dn-stt" role="cell">${esc(r.stt)}</span>
      <div class="dn-what" role="cell"><p class="dn-meta">${[r.no != null ? `<b>DT ${r.no}${r.stream ? ` · ${esc(r.stream)}` : ''}</b>` : r.stream ? `<b>${esc(r.stream)}</b>` : '', r.group ? `<span>${esc(r.group)}</span>` : ''].filter(Boolean).join('<span class="dn-sep">·</span>')}</p><p class="dn-content">${esc(r.content)}</p></div>
      <div class="dn-people" role="cell">${person('Phụ trách', r.owner, r.ownerUnit)}${person('Hỗ trợ', r.supporter, r.unit)}</div>
      <span role="cell"><span class="dn-status s-done"><i class="dot"></i>${STATUS.done.label}</span></span>
      <div class="dn-due" role="cell">${r.at ? `<span class="dn-due-d">${esc(r.at)}</span><span class="dn-due-h muted">Tháo gỡ hôm nay</span>` : '<span class="dn-due-h muted">Đã ghi “Đã xử lý” trên sheet</span>'}</div>
    </div>`).join('');
}

function renderSide(sum) {
  const f = S.filter;
  // Dòng tiền: đủ 8 dòng tiền đánh số (từ /api/kpi) + dòng tiền khác đang có điểm nghẽn.
  const rows = S.kpiStreams.map((k) => ({ key: `no:${k.no}`, no: k.no, name: k.name, open: 0, overdue: 0 }));
  for (const s of sum.streams) {
    const r = rows.find((x) => x.key === s.key);
    if (r) { r.open = s.open; r.overdue = s.overdue; } else rows.push({ ...s });
  }
  $('dnStreams').innerHTML = rows.length ? rows.map((s) => `<li><button type="button" class="dn-side-row${s.open ? '' : ' is-zero'}" data-f="stream" data-v="${esc(s.key)}" aria-pressed="${f.stream === s.key}">
      <span class="dn-no">${s.no ?? '–'}</span><span class="dn-sname">${esc(s.name)}</span>${s.overdue ? `<span class="dn-late">${s.overdue} trễ</span>` : ''}<b>${s.open}</b></button></li>`).join('')
    : `<li class="dn-side-empty">Chưa có ${CFG.noun}</li>`;
  $('dnOwners').innerHTML = sum.owners.length ? sum.owners.map((o) => `<li><button type="button" class="dn-side-row" data-f="owner" data-v="${esc(o.key)}" aria-pressed="${f.owner === o.key}">
      <span class="dn-av${o.missing ? ' warn' : ''}">${o.missing ? '?' : esc(initials(o.name))}</span><span class="dn-sname">${esc(o.name)}</span>${o.overdue ? `<span class="dn-late">${o.overdue} quá hạn</span>` : ''}<b>${o.open}</b></button></li>`).join('')
    : `<li class="dn-side-empty">Chưa có ${CFG.noun}</li>`;
  const done = [
    ...sum.done.map((it) => ({ issue: it.content, stream: it.stream, owner: it.owner, at: '', no: it.no })),
    ...S.history.map((h) => ({ issue: h.issue, stream: h.stream || '', owner: h.owner || h.supporter || '', at: h.clearedAt ? new Date(h.clearedAt + 7 * 3600e3).toISOString().slice(11, 16) : '' })),
  ];
  $('dnDoneN').textContent = done.length;
  $('dnDone').innerHTML = done.length ? done.slice(0, 30).map((d) => {
    const sp = d.stream ? (/(\d+)/.exec(d.stream)?.[1] ? `DT ${/(\d+)/.exec(d.stream)[1]}` : d.stream) : '';
    return `<li>${icon('check')}<div><p>${esc(d.issue)}</p><small>${[d.at, sp, d.owner].filter(Boolean).map(esc).join(' · ')}</small></div></li>`;
  }).join('') : `<li class="dn-side-empty">Chưa có ${CFG.noun} nào được tháo gỡ hôm nay</li>`;
}

// ---------- realtime ----------
(function live() {
  let delay = 2000;
  const connect = () => {
    let ws;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}/api/live/ws`); } catch { return; }
    ws.onopen = () => { delay = 2000; };
    ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.type === 'change' && m.scope === CFG.liveScope) { load(); loadHistory(); } } catch { /* bỏ qua */ } };
    ws.onclose = () => { setTimeout(connect, delay); delay = Math.min(delay * 2, 30000); };
  };
  connect();
})();

shell();
render();
load();
loadKpiStreams();
loadHistory();
setInterval(loadKpiStreams, KPI_MS);
setInterval(loadHistory, KPI_MS);
setInterval(() => { if (!document.hidden && CFG.isActive()) render(); }, 30000); // "Còn … / Trễ …" chạy theo phút
document.addEventListener('visibilitychange', () => { if (!document.hidden && CFG.isActive()) { load(); loadHistory(); } });

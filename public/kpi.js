// Trang "KPI & kết quả" (/kpi). Dữ liệu: GET /api/kpi (Google Sheet KPI, src/kpi/), trạng thái tính ở kpi-model.js.
// Bố cục theo bản Figma "War Room CT Homes · Dashboard KPI & Kết quả": bộ lọc → 4 thẻ chỉ số → Thành viên theo nhóm
// (số KPI đã hoàn thành / hoàn thành trễ hạn / còn tồn đọng của từng người) → Kết quả theo dòng tiền → Kế hoạch & kết quả
// theo nhóm (lọc 1 ngày: KPI của ngày + tồn đọng; Cả 5 ngày: Đã hoàn thành / Tồn đọng / Đang làm · sắp tới).
// Màn hình TV (?tv=1): 1 màn, không cuộn. ?demo=1: dữ liệu minh họa.
import { DUE_LABEL, STATUSES, STATUS_LABEL, buildModel, count, defaultDay, doneOf, isDone, isOutstanding, memberStats, noteTargets, onDate, pct, refDate, upTo } from './kpi-model.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const POLL_MS = 30000;

const ICON = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dot: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54Z"/>',
  down: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  up: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const STATUS_ICON = { D: 'check', L: 'clock', K: 'x', N: 'dot', S: 'calendar' };
const chip = (st) => `<span class="k-chip st-${st}">${icon(STATUS_ICON[st])}${STATUS_LABEL[st]}</span>`;
const initials = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w.slice(-2).map((x) => x[0]).join('')).toUpperCase();
};
const short = (n) => String(n || '').trim().split(/\s+/).slice(-2).join(' ');
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const ORDER = { D: 0, L: 1, K: 2, N: 3, S: 4 };
/** "2026-11-23T02:15:00Z" -> "09:15 23/11" (giờ Việt Nam). */
const tickTime = (iso) => {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const d = new Date(t + 7 * 3600 * 1000).toISOString();
  return `${d.slice(11, 16)} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
};
/** Màu % đạt theo style guide Night Ops: >= 100% xanh, >= 70% vàng, < 70% đỏ. */
const tone = (p) => (p == null ? '' : p >= 100 ? 'ok' : p >= 70 ? 'mid' : 'bad');

// ---------- giao diện: dùng chung lựa chọn tối / sáng / TV với trang Dòng tiền ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư */ } },
};
const prefs = (() => {
  const saved = store.get('wr-theme');
  let theme = saved === 'light' ? 'light' : 'dark';
  let tv = store.get('wr-tv') === '1' || saved === 'tv';
  if (params.get('theme') === 'light' || params.get('theme') === 'dark') theme = params.get('theme');
  if (params.get('tv') === '1') tv = true;
  if (params.get('tv') === '0') tv = false;
  return { theme, tv };
})();
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
const MOON = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = prefs.tv || prefs.theme === 'dark' ? 'dark' : 'light';
  if (prefs.tv) root.dataset.tv = '1'; else delete root.dataset.tv;
  $('tvBtn').setAttribute('aria-pressed', String(prefs.tv));
  $('tvLabel').textContent = prefs.tv ? 'Màn hình thường' : 'Màn hình TV';
  $('themeBtn').hidden = prefs.tv;
  $('themeIcon').innerHTML = prefs.theme === 'dark' ? SUN : MOON;
  $('themeLabel').textContent = prefs.theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối';
}
$('themeBtn').addEventListener('click', () => { prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark'; store.set('wr-theme', prefs.theme); applyTheme(); });
$('tvBtn').addEventListener('click', () => { prefs.tv = !prefs.tv; store.set('wr-tv', prefs.tv ? '1' : '0'); applyTheme(); if (S.model) render(); });
applyTheme();

// ---------- trạng thái + tải dữ liệu ----------
const parseTab = (v) => (v === 'ho-tro' ? 'support' : v === 'thanh-ly' ? 'liquidation' : 'cashflow');
const tabParam = (t) => (t === 'support' ? 'ho-tro' : t === 'liquidation' ? 'thanh-ly' : '');

const S = {
  data: null,
  model: null,
  filter: {
    tab: parseTab(params.get('tab')),
    day: params.get('ngay') || '',
    stream: params.get('dong') || 'all',
    result: params.get('kq') || 'all',
  },
  groupStream: '',
  timer: null,
  loading: false,
  stale: false,
};

const cashStreams = (m) => (m?.streams || []).filter((s) => s.kind !== 'support' && s.kind !== 'liquidation');
const supportStreams = (m) => (m?.streams || []).filter((s) => s.kind === 'support');
const liquidationStreams = (m) => (m?.streams || []).filter((s) => s.kind === 'liquidation');
const activePool = (m, tab) => (tab === 'support' ? supportStreams(m) : tab === 'liquidation' ? liquidationStreams(m) : cashStreams(m));
const isSpecialTab = (tab) => tab === 'support' || tab === 'liquidation';
const TAB_NAME = { cashflow: 'Dòng tiền', support: 'Nhóm hỗ trợ', liquidation: 'Nhóm thanh lý' };

async function load() {
  if (S.loading) return;
  S.loading = true;
  clearTimeout(S.timer);
  try {
    let data;
    if (DEMO) data = (await import('./kpi-demo.js')).DEMO;
    else {
      const res = await fetch('/api/kpi', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!(res.headers.get('Content-Type') || '').includes('application/json')) { location.reload(); return; } // hết phiên đăng nhập
      data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    }
    S.data = data;
    S.model = buildModel(data);
    S.stale = false;
    normalizeFilter();
    render();
  } catch (e) {
    S.stale = true;
    if (!S.model) renderFatal(e.message || String(e)); else renderSync();
  } finally {
    S.loading = false;
    if (!DEMO) S.timer = setTimeout(load, POLL_MS);
  }
}

function normalizeFilter() {
  const m = S.model;
  const f = S.filter;
  const pool = activePool(m, f.tab);
  if (f.day !== 'all' && !m.days.some((d) => d.date === f.day)) f.day = defaultDay(m);
  if (isSpecialTab(f.tab) || (f.stream !== 'all' && !pool.some((s) => s.key === f.stream))) f.stream = 'all';
  if (!['all', 'D', 'T', 'L'].includes(f.result)) f.result = 'all';
}

function syncUrl() {
  const p = new URLSearchParams(location.search);
  const f = S.filter;
  const put = (k, v, def) => { if (v && v !== def) p.set(k, v); else p.delete(k); };
  put('tab', tabParam(f.tab), '');
  put('ngay', f.day, defaultDay(S.model));
  put('dong', isSpecialTab(f.tab) ? 'all' : f.stream, 'all');
  put('kq', f.result, 'all');
  const q = p.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && !DEMO) load(); });

// Trang để mở lâu (màn hình treo tường, tab quên chưa tải lại) chỉ tự cập nhật dữ liệu, không tự lấy code mới.
// Cứ 5 phút, và mỗi khi quay lại tab, so ETag của các file của trang; file đổi (vừa deploy bản mới) thì tải lại trang.
// (Chỉ có tác dụng trên Cloudflare: ETag ở đó theo nội dung file. `wrangler dev` đặt ETag theo đường dẫn nên không đổi.)
const CODE_FILES = ['/kpi.js', '/kpi-model.js', '/kpi.css', '/dong-tien.css'];
const CODE_CHECK_MS = 5 * 60 * 1000;
let codeTag = '';
let codeCheckedAt = 0;
async function checkCode() {
  if (Date.now() - codeCheckedAt < 60000) return;
  codeCheckedAt = Date.now();
  try {
    const tags = await Promise.all(CODE_FILES.map(async (u) => {
      const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
      return r.ok ? r.headers.get('ETag') || r.headers.get('Last-Modified') || '' : null;
    }));
    if (tags.includes(null) || !tags.join('')) return; // mất mạng, hết phiên, máy chủ không gửi ETag: bỏ qua lượt này
    const tag = tags.join('|');
    if (codeTag && tag !== codeTag) location.reload();
    codeTag = tag;
  } catch { /* thử lại lượt sau */ }
}
checkCode();
setInterval(checkCode, CODE_CHECK_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkCode(); });
// Realtime (src/live.js): máy chủ báo {type:"change", scope:"kpi"} khi sheet KPI đổi -> tải lại ngay.
(function live() {
  if (DEMO) return;
  let ws = null;
  let delay = 2000;
  const connect = () => {
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}/api/live/ws`); } catch { return; }
    ws.onopen = () => { delay = 2000; };
    ws.onmessage = (ev) => {
      try { const m = JSON.parse(ev.data); if (m.type === 'change' && m.scope === 'kpi') load(); } catch { /* bỏ qua */ }
    };
    ws.onclose = () => { ws = null; setTimeout(connect, delay); delay = Math.min(delay * 2, 30000); };
  };
  connect();
})();

// ---------- vẽ trang ----------
const dayText = (date) => { const d = S.model.days.find((x) => x.date === date); return d ? `${d.weekday} ${d.label}` : date; };
const labelOf = (date) => S.model.days.find((x) => x.date === date)?.label || date;

function render() {
  renderSync();
  renderNotices();
  if (prefs.tv) {
    $('filters').innerHTML = '';
    $('main').innerHTML = tvHtml();
    return;
  }
  $('filters').innerHTML = filtersHtml();
  $('main').innerHTML = pageHtml();
}

function renderSync() {
  const src = S.data?.source || {};
  const el = $('sync');
  const at = Date.parse(src.checkedAt || '');
  const hhmm = at ? new Date(at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '';
  $('syncText').textContent = DEMO ? 'Dữ liệu minh họa' : hhmm ? `Google Sheet KPI · cập nhật ${hhmm}` : 'Google Sheet KPI';
  el.dataset.state = S.stale || src.error ? 'stale' : S.model?.items.length || DEMO ? 'live' : 'error';
  const url = safeUrl(src.sheetUrl);
  $('openSheet').hidden = !url;
  if (url) $('openSheet').href = url;
  const m = S.model;
  if (m && m.days.length) {
    const i = m.days.findIndex((d) => d.date === m.today);
    const now = i >= 0 ? ` · Hôm nay ${dayText(m.today)} (ngày ${i + 1}/${m.days.length})` : m.today > m.days[m.days.length - 1].date ? ' · War Room đã kết thúc' : ' · War Room chưa bắt đầu';
    $('pageSub').textContent = `KPI từng ngày của mỗi nhóm và người thực hiện · ${m.days[0].label} – ${m.days[m.days.length - 1].label}${now}`;
  }
}

function renderNotices() {
  const src = S.data?.source || {};
  const out = [];
  if (DEMO) out.push(`<div class="notice warn">${icon('info')}<div class="grow"><b>Đang xem dữ liệu minh họa.</b> Số liệu trên trang không phải số liệu thật. Bỏ <code>?demo=1</code> trên địa chỉ để xem dữ liệu từ Google Sheet KPI.</div></div>`);
  if (src.off) out.push(`<div class="notice">${icon('info')}<div class="grow">Đồng bộ Google Sheet KPI đang tắt (KPI_SHEET_URL=off).</div></div>`);
  if (src.error) out.push(`<div class="notice warn">${icon('alert')}<div class="grow"><b>Chưa đọc được Google Sheet KPI.</b> ${esc(src.error)} Đang hiển thị dữ liệu lần đọc trước.</div></div>`);
  if (src.warnings?.length) {
    out.push(`<details class="notice k-warn">${icon('info')}<div class="grow"><summary><b>Lưu ý từ Google Sheet KPI</b> · ${src.warnings.length} mục</summary><ul>${src.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></details>`);
  }
  $('notices').innerHTML = out.join('');
}

function renderFatal(message) {
  $('sync').dataset.state = 'error';
  $('syncText').textContent = 'Không tải được dữ liệu';
  $('notices').innerHTML = `<div class="notice err">${icon('alert')}<div class="grow"><b>Không tải được dữ liệu KPI.</b> ${esc(message)} Trang sẽ thử lại sau 30 giây.</div></div>`;
  $('main').innerHTML = '';
}

function view(override = {}) {
  const m = S.model;
  const f = { ...S.filter, ...override };
  const pool = activePool(m, f.tab);
  const streams = isSpecialTab(f.tab) || f.stream === 'all' ? pool : pool.filter((s) => s.key === f.stream);
  const groupOf = new Map(m.streams.flatMap((s) => s.groups.map((g) => [`${s.key}/${g.key}`, g])));
  return { m, f, today: m.today, ref: refDate(m), pool, streams, items: streams.flatMap((s) => s.items), groupOf };
}

function filtersHtml() {
  const m = S.model;
  const f = S.filter;
  const cash = cashStreams(m);
  const sup = supportStreams(m);
  const liq = liquidationStreams(m);
  const supKpiCount = sup.reduce((n, s) => n + s.items.length, 0);
  const liqKpiCount = liq.reduce((n, s) => n + s.items.length, 0);
  const badgeOf = (list, cnt) => (cnt ? `${cnt} KPI` : list.length ? 'Sheet' : '0');
  const tabBar = `<div class="k-mode-tabs" role="tablist" aria-label="Phân khu KPI">
      <button type="button" role="tab" class="k-mtab" data-tab="cashflow" aria-selected="${f.tab === 'cashflow'}">
        <span>Dòng tiền</span><b>${cash.length}</b>
      </button>
      <button type="button" role="tab" class="k-mtab" data-tab="liquidation" aria-selected="${f.tab === 'liquidation'}">
        ${icon('folder')}<span>Nhóm thanh lý</span><b>${badgeOf(liq, liqKpiCount)}</b>
      </button>
      <button type="button" role="tab" class="k-mtab" data-tab="support" aria-selected="${f.tab === 'support'}">
        ${icon('users')}<span>Nhóm hỗ trợ</span><b>${badgeOf(sup, supKpiCount)}</b>
      </button>
    </div>`;
  const opt = (val, label) => `<button type="button" class="kf-opt" data-day="${esc(val)}" aria-pressed="${f.day === val}">${label}</button>`;
  const days = m.days.map((d) => opt(d.date, `${d.weekday} ${esc(d.label)}${d.date === m.today ? ' · Hôm nay' : ''}`)).join('');
  const streams = [`<option value="all">Tất cả dòng tiền</option>`, ...cash.map((s) => `<option value="${esc(s.key)}"${f.stream === s.key ? ' selected' : ''}>${s.no ? `${s.no}. ` : ''}${esc(s.name)}</option>`)].join('');
  const streamSelect = f.tab === 'cashflow'
    ? `<span class="kf-sep" aria-hidden="true"></span><label class="kf-group"><span class="kf-label">Dòng tiền</span><select class="kf-select" data-stream-select>${streams}</select></label>`
    : '';
  const res = [['all', 'Tất cả', ''], ['D', 'Hoàn thành', 'D'], ['L', 'Hoàn thành trễ hạn', 'L'], ['T', 'Tồn đọng', 'K']]
    .map(([v, l, st]) => `<button type="button" class="kf-chip" data-result="${v}" aria-pressed="${f.result === v}">${st ? `<i class="kd st-${st}"></i>` : ''}${l}</button>`).join('');
  return `${tabBar}<div class="kf-bar">
      <span class="kf-lead">${icon('filter')}Lọc</span>
      <div class="kf-group"><span class="kf-label">Ngày</span><div class="kf-seg" role="group" aria-label="Lọc theo ngày">${opt('all', `Cả ${m.days.length} ngày`)}${days}</div></div>
      ${streamSelect}
      <span class="kf-sep" aria-hidden="true"></span>
      <div class="kf-group"><span class="kf-label">Kết quả</span><div class="kf-chips" role="group" aria-label="Lọc theo kết quả">${res}</div></div>
    </div>`;
}

function pageHtml() {
  const x = view();
  if (isSpecialTab(x.f.tab) && !x.streams.length) {
    const label = TAB_NAME[x.f.tab];
    const sample = x.f.tab === 'support' ? '9. Nhóm hỗ trợ' : '8. Nhóm thanh lý';
    return `<section class="k-panel k-empty"><h2>Chưa tìm thấy sheet ${esc(label)}</h2><p class="hint">Google Sheet KPI cần có tab “${esc(label)}” (hoặc “${esc(sample)}”) với cột Nhóm, PIC và 2 cột KPI | Kết quả cho từng ngày.</p></section>`;
  }
  if (!x.streams.length) {
    return `<section class="k-panel k-empty"><h2>Chưa có dữ liệu KPI</h2><p class="hint">Google Sheet KPI cần có tab “Dòng tiền …” với cột Nhóm, PIC và 2 cột KPI | Kết quả cho từng ngày.</p></section>`;
  }
  return `${heroHtml(x)}${tableHtml(x)}${streamsDetailHtml(x)}${guideHtml()}`;
}

// ----- 4 thẻ chỉ số -----
function donut(c) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const segs = STATUSES.map((st) => [st, c[st]]).filter(([, n]) => n > 0);
  const gap = segs.length > 1 ? 2.5 : 0;
  let off = 0;
  const arcs = segs.map(([st, n]) => {
    const len = (n / c.total) * C;
    const a = `<circle class="dn-seg st-${st}" r="${R}" cx="60" cy="60" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += len;
    return a;
  }).join('');
  const p = pct(doneOf(c), c.total);
  return `<div class="k-donut"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="dn-track" r="${R}" cx="60" cy="60"/>${arcs}</svg><div class="dn-center"><b>${p == null ? '–' : `${p}%`}</b><span>hoàn thành</span></div></div>`;
}

function heroHtml(x) {
  const { m, f, items, today, ref } = x;
  const isAll = f.day === 'all';
  const scope = isAll ? upTo(items, ref) : onDate(items, f.day);
  const c = count(scope);
  const future = !isAll && f.day > today;
  const title = isAll ? `Đến hôm nay · ${m.days[0]?.label} – ${labelOf(ref)}` : f.day === today ? `Hôm nay · ${dayText(f.day)}` : `Ngày ${dayText(f.day)}`;
  const legend = ['D', 'L', 'K', 'N'].filter((st) => st !== 'N' || c.N).map((st) => `<li class="st-${st}"><i class="kd st-${st}"></i><span>${STATUS_LABEL[st]}${st === 'D' ? ' (đúng hạn)' : ''}</span><b>${c[st]}</b></li>`).join('');
  const empty = `<article class="k-card k-today"><p class="k-over">${esc(title)}</p><div class="k-today-row">${donut(c)}<div class="k-today-info"><p class="k-num-m">0 <span>KPI</span></p><p class="hint">Chưa có KPI cho ${isAll ? 'các ngày đã qua' : 'ngày này'}. Nhập KPI và kết quả vào Google Sheet KPI, trang tự cập nhật.</p></div></div></article>`;
  const card1 = !c.total ? empty : future
    ? `<article class="k-card k-today"><p class="k-over">${esc(title)}</p><div class="k-today-row">${donut(c)}<div class="k-today-info"><p class="k-num-m">${c.total} <span>KPI kế hoạch</span></p><p class="hint">Ngày chưa tới. Kết quả được nhập vào đúng ngày.</p></div></div></article>`
    : `<article class="k-card k-today"><p class="k-over">${esc(title)}</p>
        <div class="k-today-row">${donut(c)}<div class="k-today-info"><p class="k-num-m">${doneOf(c)}/${c.total} <span>KPI hoàn thành</span></p><ul class="k-legend">${legend}</ul></div></div>
        ${c.N ? `<p class="k-remind info">${icon('dot')}${c.N} KPI chưa tick kết quả. Hạn là ${DUE_LABEL} sáng hôm sau; tick sau giờ đó tính là hoàn thành trễ hạn.</p>` : ''}
      </article>`;

  const due = upTo(items, ref);
  const cc = count(due);
  const sel = isAll ? ref : f.day;
  const bars = m.days.map((d) => {
    const dc = count(onDate(items, d.date));
    const p = d.date <= ref ? pct(doneOf(dc), dc.total) : null;
    const cls = [d.date === today ? 'is-today' : '', d.date === sel ? 'is-sel' : '', p == null ? 'is-empty' : ''].join(' ');
    return `<li class="${cls}"><span class="b-val">${p == null ? '–' : `${p}%`}</span><span class="b-slot"><i style="height:${p == null ? 0 : Math.max(4, p)}%"></i></span><span class="b-day">${esc(d.label)}</span></li>`;
  }).join('');
  const card2 = `<article class="k-card k-cum"><p class="k-over">Lũy kế ${esc(m.days[0]?.label || '')} – ${esc(labelOf(ref))}</p>
      <p class="k-num-l">${pct(doneOf(cc), cc.total) ?? '–'}${cc.total ? '%' : ''} <span>${doneOf(cc)}/${cc.total} lượt KPI hoàn thành</span></p>
      <ol class="k-bars">${bars}</ol></article>`;

  // Thẻ 3, 4 cộng dồn từ ngày đầu đến ngày đang xem: KPI của 1 ngày chỉ thành Không đạt / trễ hạn sau khi ngày đó qua.
  const cut = isAll || future ? ref : f.day;
  const upto = upTo(items, cut);
  const uc = count(upto);
  const until = cut === today ? 'đến hôm nay' : `đến ${labelOf(cut)}`;
  const failStreams = [...new Set(upto.filter((it) => it.status === 'K').map((it) => it.stream))];
  const card3 = `<article class="k-card k-big st-K${uc.K ? '' : ' is-zero'}"><p class="k-over">Không đạt · tồn đọng ${esc(until)}</p>
      <p class="k-num-xl">${uc.K} <span>KPI</span></p>
      <p class="hint">${failStreams.length ? `Quá hạn (${DUE_LABEL} sáng hôm sau) mà chưa hoàn thành, ở ${failStreams.length} dòng tiền: ${esc(failStreams.join(', '))}` : uc.total ? 'Không có KPI tồn đọng' : 'Chưa có KPI'}</p></article>`;
  const card4 = `<article class="k-card k-big st-L${uc.L ? '' : ' is-zero'}"><p class="k-over">Hoàn thành trễ hạn ${esc(until)}</p>
      <p class="k-num-xl">${uc.L} <span>KPI</span></p>
      <p class="hint">${uc.L ? `Đã hoàn thành, nhưng tick kết quả sau ${DUE_LABEL} sáng hôm sau ngày của KPI (áp dụng từ 22/11)` : uc.total ? 'Không có KPI hoàn thành trễ hạn (áp dụng từ 22/11)' : 'Chưa có KPI'}</p></article>`;
  return `<section class="k-hero" aria-label="Chỉ số chính">${card1}${card2}${card3}${card4}</section>`;
}

// ----- Hợp nhất: Dòng tiền → Nhóm → Thành viên → Task & Trạng thái -----
const TASK_ORDER = { K: 0, N: 1, L: 2, D: 3, S: 4 };

function personTasksForView(personItems, f) {
  const isAll = f.day === 'all';
  let list;
  if (isAll) {
    list = [...personItems].sort((a, b) => byDate(a, b) || TASK_ORDER[a.status] - TASK_ORDER[b.status]);
  } else {
    const D = f.day;
    const back = personItems.filter((it) => it.date < D && isOutstanding(it)).sort(byDate);
    const day = onDate(personItems, D).sort((a, b) => TASK_ORDER[a.status] - TASK_ORDER[b.status]);
    list = [...back, ...day];
  }
  if (f.result === 'D') list = list.filter((it) => it.status === 'D');
  else if (f.result === 'L') list = list.filter((it) => it.status === 'L');
  else if (f.result === 'T') list = list.filter(isOutstanding);
  return list;
}

function taskRowHtml(it, notes, showDate, isCarryOver) {
  const dateTag = showDate || isCarryOver
    ? `<span class="kl-date${isCarryOver ? ' is-back' : ''}" title="${isCarryOver ? `Tồn đọng từ ngày ${esc(it.label)}` : `Ngày ${esc(it.label)}`}">${esc(it.label)}</span>`
    : '';
  const extra = [
    notes.has(it.id) ? `<span class="kl-note">Vướng mắc: ${esc(it.note)}</span>` : '',
    lateNote(it),
  ].filter(Boolean).join('');
  return `<li class="kmt-item st-${it.status}">
      <span class="kmt-ic">${icon(STATUS_ICON[it.status])}</span>
      <span class="kmt-body"><span class="kmt-title">${dateTag}<b class="kl-kpi">${esc(it.kpi)}</b></span>${extra}</span>
      ${chip(it.status)}
    </li>`;
}

  function personFolderLinks(g, personName) {
    const key = personName.trim().toLocaleLowerCase('vi');
    const links = [];
    const seen = new Set();
    for (const r of g.rows || []) {
      if (r.person && r.person.trim().toLocaleLowerCase('vi') !== key) continue;
      const u = safeUrl(r.folder);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      links.push(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon('folder')}Thư mục</a>`);
    }
    return links.length ? `<p class="kg-links kpc-links">${links.join('')}</p>` : '';
  }

  function personCardHtml(card, f) {
    const { p, groupName, tasks, notes, folderHtml } = card;
    const isAll = f.day === 'all';
    const badges = [];
    if (p.total) {
      badges.push(`<span class="kmp-stat st-D" title="Đã hoàn thành / tổng KPI đến ngày đang xem"><b>${p.done}/${p.total}</b> xong</span>`);
      if (p.doing) badges.push(`<span class="kmp-stat st-N"><b>${p.doing}</b> đang làm</span>`);
      if (p.late) badges.push(`<span class="kmp-stat st-L"><b>${p.late}</b> trễ hạn</span>`);
      if (p.backlog) badges.push(`<span class="kmp-stat st-K"><b>${p.backlog}</b> tồn đọng</span>`);
    } else {
      badges.push(`<span class="kmp-stat is-idle">Chưa có KPI</span>`);
    }
    const emptyText = isAll ? 'Chưa có task nào' : `Không có task ngày ${esc(labelOf(f.day))}`;
    const taskHtml = tasks.length
      ? `<ul class="kmt-list">${tasks.map((it) => taskRowHtml(it, notes, isAll, !isAll && it.date < f.day)).join('')}</ul>`
      : `<p class="kmp-empty">${emptyText}</p>`;
  const hasBacklog = tasks.some((it) => it.status === 'K');
  const isIdleCard = !tasks.length;
  return `< article class="km-person-card${hasBacklog ? ' has-backlog' : ''}${isIdleCard ? ' is-idle-card' : ''}" >
      <header class="kpc-head">
        <span class="km-who">
          <span class="av${p.isPic ? ' pic' : ''}">${esc(initials(p.name))}</span>
          <span class="kp-name">
            <span class="kpc-title"><b>${esc(p.name)}</b><span class="kpc-sep"> - </span><span class="kpc-group">${esc(groupName)}</span></span>
            ${p.isPic ? '<small>PIC nhóm</small>' : ''}
          </span>
        </span>
        <span class="kmp-stats">${badges.join('')}</span>
      </header >
      ${ taskHtml }
      ${folderHtml}
    </article>`;
  }

  function masonryColCount() {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
    return w >= 1440 ? 3 : w >= 860 ? 2 : 1;
  }

  function packMasonry(cards, maxCols, f) {
    const colCount = Math.max(1, Math.min(maxCols, cards.length));
    const cols = Array.from({ length: colCount }, () => ({ weight: 0, html: [] }));
    for (const card of cards) {
      let best = 0;
      for (let i = 1; i < colCount; i++) {
        if (cols[i].weight < cols[best].weight) best = i;
      }
      cols[best].html.push(personCardHtml(card, f));
      cols[best].weight += card.weight;
    }
    return `<div class="km-masonry" style="--cols:${colCount}">${cols.map((c) => `<div class="km-col">${c.html.join('')}</div>`).join('')}</div>`;
  }

  function streamsDetailHtml(x) {
    const { m, f, streams, ref } = x;
    const isAll = f.day === 'all';
    const cut = isAll || f.day > ref ? ref : f.day;
    const first = m.days[0];
    const range = !first || cut <= first.date ? `ngày ${labelOf(cut)}` : `từ ${first.label} đến ${labelOf(cut)}`;
    const viewScope = isAll ? `Cả ${m.days.length} ngày` : dayText(f.day);
    const maxCols = masonryColCount();
    let groupCount = 0;
    const people = new Set();

    const blocks = streams.map((s, si) => {
      const sum = { done: 0, late: 0, backlog: 0, doing: 0, total: 0, groups: 0, people: new Set() };
        const personCards = [];
        for (const g of s.groups) {
          const allMembers = memberStats(g, cut);
          for (const p of allMembers) {
            sum.done += p.done; sum.late += p.late; sum.backlog += p.backlog; sum.doing += p.doing; sum.total += p.total;
            sum.people.add(p.name.toLocaleLowerCase('vi'));
          }
          const notes = noteTargets(g.items, isAll ? ref : f.day);
          const byPerson = new Map();
          for (const it of g.items) {
            const key = (it.person || 'Chưa ghi người thực hiện').trim().toLocaleLowerCase('vi');
            if (!byPerson.has(key)) byPerson.set(key, []);
            byPerson.get(key).push(it);
          }
          let groupHasMatch = false;
          for (const p of allMembers) {
            const key = p.name.toLocaleLowerCase('vi');
            const tasks = personTasksForView(byPerson.get(key) || [], f);
            if (f.result !== 'all' && !tasks.length) continue;
            groupHasMatch = true;
            people.add(key);
            personCards.push({
              p,
              groupName: g.name,
              tasks,
              notes,
              folderHtml: personFolderLinks(g, p.name),
              weight: tasks.length ? 3 + tasks.length * 1.4 : 2,
              order: personCards.length,
            });
          }
          if (groupHasMatch) {
            groupCount++;
            sum.groups++;
          }
        }
        if (!personCards.length && f.result !== 'all') return '';

      // Người có task hiển thị trước (giữ nguyên thứ tự dòng trên sheet), người chưa có task xếp gọn phía dưới.
      personCards.sort((a, b) => (b.tasks.length > 0) - (a.tasks.length > 0) || a.order - b.order);

      const stat = (n, st, label, extra = '') => `<span class="kms-stat st-${st}${n ? '' : ' is-zero'}"><b>${n}${extra}</b><small>${label}</small></span>`;
      const p = pct(sum.done, sum.total);
      const sheetNote = s.kpiSheet || s.sheet;
      const isSpecial = s.kind === 'support' || s.kind === 'liquidation';
      const meta = [
        s.pic ? `${isSpecial ? 'PIC' : 'PIC dòng tiền'} <b>${esc(s.pic)}</b>` : isSpecial && sheetNote ? `Đọc trực tiếp từ sheet <b>${esc(sheetNote)}</b>` : 'Chưa ghi PIC dòng tiền',
        `${sum.groups} nhóm`,
        `${sum.people.size} người`,
      ].join(' · ');
      const badgeNum = s.no ? String(s.no) : isSpecial ? '' : String(si + 1);
      const head = `<header class="km-stream">
        <div class="kms-id">${badgeNum ? `<span class="kms-code">${esc(badgeNum)}</span>` : ''}
          <div class="kms-name"><h3>${esc(s.name)}</h3>${s.desc ? `<p class="kms-desc">${esc(s.desc)}</p>` : ''}<p>${meta}</p></div></div>
        <div class="kms-stats">${stat(sum.done, 'D', 'Đã hoàn thành', `<i>/${sum.total}</i>`)}${stat(sum.doing, 'N', 'Đang làm')}${stat(sum.late, 'L', 'Trễ hạn')}${stat(sum.backlog, 'K', 'Tồn đọng')}${sum.total ? `<span class="kms-pct ${tone(p)}"><b>${p}%</b><small>hoàn thành</small></span>` : ''}</div>
      </header>`;
    const body = personCards.length
        ? packMasonry(personCards, maxCols, f)
        : isSpecial
          ? `<p class="k-none">Đã kết nối trực tiếp tab “${esc(sheetNote || s.name)}” trên Google Sheet nhưng chưa có dòng KPI nào được nhập. Nhập Nhóm, PIC và KPI theo ngày vào sheet, trang sẽ tự cập nhật sau 20–60 giây.</p>`
        : `<p class="k-none">Chưa có thành viên nào có KPI cho dòng tiền này trong Google Sheet.</p>`;
    return `<section class="km-block${personCards.length ? '' : ' is-empty'}" id="stream-${esc(s.key)}" aria-label="${esc(s.name)}">${head}${body}</section>`;
  }).join('');

  const scope = streams.length === 1 ? streams[0].name : 'Tất cả dòng tiền';
  const filterNote = f.result === 'all' ? '' : ` Đang lọc: chỉ hiện task ${f.result === 'D' ? 'hoàn thành đúng hạn' : f.result === 'L' ? 'hoàn thành trễ hạn' : 'tồn đọng'}.`;
  return `< section class="k-panel k-members" id = "k-groups" aria - labelledby="k-mem-t" ><header class="k-phead"><div><h2 id="k-mem-t">Theo dõi Dòng tiền · Thành viên &amp; Task · ${esc(viewScope)}</h2>
      <p class="hint">${esc(scope)} · ${people.size} người (${groupCount} nhóm). Tổng chỉ số tính ${esc(range)}.${filterNote}</p></div></header>
      <ul class="km-legend">
        <li class="st-D"><i class="kd st-D"></i><span><b>Hoàn thành</b>: đã tick ô Kết quả đúng hạn.</span></li>
        <li class="st-N"><i class="kd st-N"></i><span><b>Đang làm</b>: KPI hôm nay chưa tick (hạn ${DUE_LABEL} sáng hôm sau).</span></li>
        <li class="st-L"><i class="kd st-L"></i><span><b>Hoàn thành trễ hạn</b>: đã tick sau ${DUE_LABEL} sáng hôm sau (áp dụng từ 22/11).</span></li>
        <li class="st-K"><i class="kd st-K"></i><span><b>Không đạt / Tồn đọng</b>: quá hạn mà chưa tick.</span></li>
      </ul>
      ${ blocks || '<p class="k-none">Không có task hoặc thành viên nào khớp bộ lọc.</p>' }</section > `;
}

// ----- Màn hình TV: danh sách Không đạt và Hoàn thành trễ hạn -----
function picOf(x, it) { return x.groupOf.get(`${ it.streamKey }/${it.groupKey}`)?.pic?.name || '';
}

function failItems(x, list, notes, withDate) {
  if (!list.length) return `<p class="k-none ok">${icon('check')}Không có KPI không đạt</p>`;
  return `<ul class="k-fails">${list.map((it) => {
    const pic = picOf(x, it);
    const who = pic && pic !== it.person ? `${it.person} · PIC nhóm ${pic}` : it.person ? `PIC ${it.person}` : '';
    return `<li class="k-fail"><div class="kf-top">${withDate ? `<span class="kl-date">${esc(it.label)}</span>` : ''}<b>${esc(it.group)}</b>${chip('K')}</div>
      <p class="kf-meta">${esc(it.stream)}${who ? ` · ${esc(who)}` : ''}</p>
      <p class="kf-kpi">KPI: ${esc(it.kpi)}</p>${notes.has(it.id) ? `<p class="kf-note">Vướng mắc: ${esc(it.note)}</p>` : ''}</li>`;
  }).join('')}</ul>`;
}

function lateItems(list) {
  if (!list.length) return `<p class="k-none ok">${icon('check')}Không có KPI hoàn thành trễ hạn</p>`;
  return `<ul class="k-pends">${list.map((it) => `<li class="k-pend">${icon('clock')}<div class="kp-body"><b><span class="kl-date">${esc(it.label)}</span>${esc(it.group)}</b><span>${esc(it.stream)} · KPI: ${esc(it.kpi)}</span></div><span class="kp-who">${esc(it.person)}</span></li>`).join('')}</ul>`;
}

function actScope(x) {
  const { f, items, today, ref } = x;
  if (f.day !== 'all' && f.day > today) return null;
  const isAll = f.day === 'all';
  const upto = upTo(items, isAll ? ref : f.day); // cộng dồn đến ngày đang xem
  const desc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  return {
    isAll,
    fails: upto.filter((it) => it.status === 'K').sort(desc),
    lates: upto.filter((it) => it.status === 'L').sort(desc),
    notes: noteTargets(items, isAll ? ref : f.day),
  };
}

// ----- Kết quả theo dòng tiền -----
function tableHtml(x, { tv = false } = {}) {
  const { m, f, streams, today, ref } = x;
  const hl = f.day === 'all' ? today : f.day;
  const head = m.days.map((d) => `<div class="kt-c kt-day${d.date === hl ? ' is-hl' : ''}" role="columnheader">${esc(d.weekday)} ${esc(d.label)}${d.date === today ? ' <span class="k-today-tag">Hôm nay</span>' : ''}</div>`).join('');
  const rows = streams.map((s) => {
    const cells = m.days.map((d) => {
      const list = onDate(s.items, d.date).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
      const c = count(list);
      let label = '—';
      let cls = 'muted';
      if (c.total && d.date > today) { label = tv ? '' : `${c.total} KPI sắp tới`; }
      else if (c.total) {
        const done = doneOf(c);
        label = tv ? `${done}/${c.total}` : `${done}/${c.total} xong${c.L ? ` · ${c.L} trễ` : ''}`;
        cls = c.K ? 'bad' : c.L ? 'warn' : done === c.total ? 'ok' : 'muted';
      }
      return `<div class="kt-c kt-day${d.date === hl ? ' is-hl' : ''}" role="cell"><span class="k-dots">${list.map((it) => `<i class="kd st-${it.status}" title="${esc(`${it.group} · ${it.person}: ${it.kpi} (${STATUS_LABEL[it.status]})`)}"></i>`).join('')}</span>${label ? `<span class="kt-lab ${cls}">${esc(label)}</span>` : ''}</div>`;
    }).join('');
    const due = upTo(s.items, ref);
    const c = count(due);
    const p = pct(doneOf(c), c.total);
    const backlog = c.K;
    const name = tv ? `<b title="${esc(s.name)}">${s.no ? `${s.no}. ` : ''}${esc(s.name)}</b>` : `<button type="button" class="kt-name" data-pick-stream="${esc(s.key)}">${s.no ? `<span class="k-code">${esc(String(s.no))}</span>` : ''}<b>${esc(s.name)}</b></button>`;
    return `<div class="kt-row" role="row"><div class="kt-c kt-stream" role="rowheader">${name}${!tv && s.pic ? `<small>PIC ${esc(s.pic)}</small>` : ''}</div>${cells}
        <div class="kt-c kt-sum" role="cell">${s.items.length ? `<span class="k-bar ${tone(p)}"><i style="width:${p ?? 0}%"></i></span><b class="${tone(p)}">${p == null ? '–' : `${p}%`}</b><small>${doneOf(c)}/${c.total}${backlog ? ` · ${backlog} tồn đọng` : ''}</small>` : '<small>Chưa nhập KPI</small>'}</div></div>`;
  }).join('');
  const legend = STATUSES.map((st) => `<span><i class="kd st-${st}"></i>${STATUS_LABEL[st]}</span>`).join('');
  const isSp = isSpecialTab(f.tab);
  const tblTitle = isSp ? `Kết quả theo ngày · ${TAB_NAME[f.tab]}` : 'Kết quả theo dòng tiền';
  const tblCol = isSp ? 'Sheet nguồn' : 'Dòng tiền';
  return `<section class="k-panel k-streams" aria-labelledby="k-tbl-t"><header class="k-phead"><div><h2 id="k-tbl-t">${tblTitle}</h2>${tv ? '' : `<p class="hint">Mỗi ô vuông là 1 KPI của 1 người trong ngày.${isSp ? '' : ' Bấm tên dòng tiền để xem chi tiết từng nhóm.'}</p>`}</div>${tv ? '' : `<div class="k-legend-row">${legend}</div>`}</header>
      <div class="k-table" role="table" style="--days:${m.days.length}"><div class="kt-row kt-head" role="row"><div class="kt-c kt-stream" role="columnheader">${tblCol}</div>${head}<div class="kt-c kt-sum" role="columnheader">${tv ? 'Lũy kế' : 'Lũy kế đến hôm nay'}</div></div>${rows}</div></section>`;
}

// ----- Hỗ trợ hiển thị task & liên kết thư mục -----
/** Ghi chú giờ tick của KPI hoàn thành trễ hạn. */
function lateNote(it) {
  if (it.status !== 'L') return '';
  const at = tickTime(it.doneAt);
  return `<span class="kl-note">Hoàn thành trễ hạn${at ? `: tick lúc ${esc(at)}` : ''}, hạn là ${DUE_LABEL} sáng hôm sau ngày ${esc(it.label)}</span>`;
}

function folderLinks(g) {
  const links = [];
  const seen = new Set();
  for (const r of g.rows || []) {
    const u = safeUrl(r.folder);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    links.push(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon('folder')}Thư mục${(g.rows || []).length > 1 && r.person ? ` · ${esc(short(r.person))}` : ''}</a>`);
  }
  return links.length ? `<p class="kg-links">${links.join('')}</p>` : '';
}

function pill(text, cls) { return `<span class="k-pill ${cls}">${esc(text)}</span>`; }

function guideHtml() {
  return `<p class="k-guide">${icon('info')}<span>Cách đọc: tick ô Kết quả trên sheet khi hoàn thành KPI. Hạn của KPI là ${DUE_LABEL} sáng hôm sau ngày của KPI (KPI ngày 22 hết hạn lúc ${DUE_LABEL} ngày 23). Tick trước hạn là Hoàn thành; tick sau hạn là Hoàn thành trễ hạn (áp dụng từ ngày 22/11; ngày 21/11 hoàn thành muộn vẫn tính Hoàn thành). Chưa tick: chưa quá hạn là Đang làm, quá hạn là Không đạt / Tồn đọng, ngày chưa tới là Sắp tới. Bấm tên dòng tiền ở bảng tổng hợp để cuộn thẳng tới chi tiết Nhóm · Thành viên · Task của dòng tiền đó.</span></p>`;
}

// ----- Màn hình TV: 1 màn, hôm nay, tất cả dòng tiền -----
function tvHtml() {
  const x = view({ day: defaultDay(S.model), stream: 'all', result: 'all' });
  if (!x.m.streams.length) return pageHtml();
  const a = actScope(x) || { fails: [], lates: [], notes: new Set(), isAll: true };
  return `${heroHtml(x)}<div class="k-tv-bottom">${tableHtml(x, { tv: true })}
      <section class="k-panel st-K-line"><header class="k-phead"><h2>Tồn đọng đến hôm nay</h2><span class="k-badge st-K">${a.fails.length}</span></header>${failItems(x, a.fails.slice(0, 3), a.notes, true)}${a.fails.length > 3 ? `<p class="hint">và ${a.fails.length - 3} KPI khác</p>` : ''}</section>
      <section class="k-panel st-L-line"><header class="k-phead"><h2>Hoàn thành trễ hạn</h2><span class="k-badge st-L">${a.lates.length}</span></header>${lateItems(a.lates.slice(0, 6))}${a.lates.length > 6 ? `<p class="hint">và ${a.lates.length - 6} KPI khác</p>` : ''}</section></div>`;
}

// ---------- tương tác ----------
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab],[data-day],[data-result]');
  if (!b) return;
  if (b.dataset.tab) {
    S.filter.tab = b.dataset.tab;
    S.filter.stream = 'all';
    S.groupStream = '';
  } else if (b.dataset.day) S.filter.day = b.dataset.day;
  else S.filter.result = b.dataset.result;
  syncUrl();
  render();
});
$('filters').addEventListener('change', (e) => {
  if (!e.target.matches('[data-stream-select]')) return;
  S.filter.stream = e.target.value;
  syncUrl();
  render();
});
$('main').addEventListener('click', (e) => {
  const row = e.target.closest('[data-pick-stream]');
  if (row) {
    const target = document.getElementById(`stream-${row.dataset.pickStream}`) || document.getElementById('k-groups');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

let lastMasonryCols = masonryColCount();
window.addEventListener('resize', () => {
  const next = masonryColCount();
  if (next !== lastMasonryCols) {
    lastMasonryCols = next;
    if (S.model && !prefs.tv) render();
  }
});

load();

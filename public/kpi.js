// Trang "KPI & kết quả" (/kpi). Dữ liệu: GET /api/kpi (Google Sheet KPI, src/kpi/), trạng thái tính ở kpi-model.js.
// Bố cục theo bản Figma "War Room CT Homes · Dashboard KPI & Kết quả": bộ lọc → 4 thẻ chỉ số → Cần xử lý →
// Kết quả theo dòng tiền → Kế hoạch & kết quả theo nhóm (lọc 1 ngày: KPI của ngày + tồn đọng; Cả 5 ngày: Đã đạt /
// Tồn đọng / Kế hoạch sắp tới). Màn hình TV (?tv=1): 1 màn, không cuộn. ?demo=1: dữ liệu minh họa.
import { STATUS_LABEL, buildModel, count, defaultDay, isOutstanding, noteTargets, onDate, pct, refDate, upTo } from './kpi-model.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const DEADLINE = '18:00'; // hạn nhập kết quả trong ngày, chỉ để nhắc trên trang
const POLL_MS = 30000;

const ICON = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
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
const STATUS_ICON = { D: 'check', K: 'x', C: 'clock', S: 'calendar' };
const chip = (st) => `<span class="k-chip st-${st}">${icon(STATUS_ICON[st])}${STATUS_LABEL[st]}</span>`;
const initials = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w.slice(-2).map((x) => x[0]).join('')).toUpperCase();
};
const short = (n) => String(n || '').trim().split(/\s+/).slice(-2).join(' ');
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const ORDER = { D: 0, K: 1, C: 2, S: 3 };
const tone = (p) => (p == null ? '' : p >= 80 ? 'ok' : p >= 50 ? '' : 'bad');

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
const S = {
  data: null,
  model: null,
  filter: { day: params.get('ngay') || '', stream: params.get('dong') || 'all', result: params.get('kq') || 'all' },
  groupStream: '',
  timer: null,
  loading: false,
  stale: false,
};

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
  if (f.day !== 'all' && !m.days.some((d) => d.date === f.day)) f.day = defaultDay(m);
  if (f.stream !== 'all' && !m.streams.some((s) => s.key === f.stream)) f.stream = 'all';
  if (!['all', 'D', 'T', 'C'].includes(f.result)) f.result = 'all';
}

function syncUrl() {
  const p = new URLSearchParams(location.search);
  const f = S.filter;
  const put = (k, v, def) => { if (v && v !== def) p.set(k, v); else p.delete(k); };
  put('ngay', f.day, defaultDay(S.model));
  put('dong', f.stream, 'all');
  put('kq', f.result, 'all');
  const q = p.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && !DEMO) load(); });
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
  const streams = f.stream === 'all' ? m.streams : m.streams.filter((s) => s.key === f.stream);
  const groupOf = new Map(m.streams.flatMap((s) => s.groups.map((g) => [`${s.key}/${g.key}`, g])));
  return { m, f, today: m.today, ref: refDate(m), streams, items: streams.flatMap((s) => s.items), groupOf };
}

function filtersHtml() {
  const m = S.model;
  const f = S.filter;
  const opt = (val, label) => `<button type="button" class="kf-opt" data-day="${esc(val)}" aria-pressed="${f.day === val}">${label}</button>`;
  const days = m.days.map((d) => opt(d.date, `${d.weekday} ${esc(d.label)}${d.date === m.today ? ' · Hôm nay' : ''}`)).join('');
  const streams = [`<option value="all">Tất cả dòng tiền</option>`, ...m.streams.map((s) => `<option value="${esc(s.key)}"${f.stream === s.key ? ' selected' : ''}>${esc(s.name)}</option>`)].join('');
  const res = [['all', 'Tất cả', ''], ['D', 'Đạt', 'D'], ['T', 'Tồn đọng', 'K'], ['C', 'Chưa cập nhật', 'C']]
    .map(([v, l, st]) => `<button type="button" class="kf-chip" data-result="${v}" aria-pressed="${f.result === v}">${st ? `<i class="kd st-${st}"></i>` : ''}${l}</button>`).join('');
  return `<div class="kf-bar">
      <span class="kf-lead">${icon('filter')}Lọc</span>
      <div class="kf-group"><span class="kf-label">Ngày</span><div class="kf-seg" role="group" aria-label="Lọc theo ngày">${opt('all', `Cả ${m.days.length} ngày`)}${days}</div></div>
      <span class="kf-sep" aria-hidden="true"></span>
      <label class="kf-group"><span class="kf-label">Dòng tiền</span><select class="kf-select" data-stream-select>${streams}</select></label>
      <span class="kf-sep" aria-hidden="true"></span>
      <div class="kf-group"><span class="kf-label">Kết quả</span><div class="kf-chips" role="group" aria-label="Lọc theo kết quả">${res}</div></div>
    </div>`;
}

function pageHtml() {
  const x = view();
  if (!x.m.streams.length) {
    return `<section class="k-panel k-empty"><h2>Chưa có dữ liệu KPI</h2><p class="hint">Google Sheet KPI cần có tab “Dòng tiền …” với cột Nhóm, PIC và 2 cột KPI | Kết quả cho từng ngày.</p></section>`;
  }
  return `${heroHtml(x)}${actHtml(x)}${tableHtml(x)}${groupsHtml(x)}${guideHtml()}`;
}

// ----- 4 thẻ chỉ số -----
function donut(c) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const segs = [['D', c.D], ['K', c.K], ['C', c.C], ['S', c.S]].filter(([, n]) => n > 0);
  const gap = segs.length > 1 ? 2.5 : 0;
  let off = 0;
  const arcs = segs.map(([st, n]) => {
    const len = (n / c.total) * C;
    const a = `<circle class="dn-seg st-${st}" r="${R}" cx="60" cy="60" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += len;
    return a;
  }).join('');
  const p = pct(c.D, c.total);
  return `<div class="k-donut"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="dn-track" r="${R}" cx="60" cy="60"/>${arcs}</svg><div class="dn-center"><b>${p == null ? '–' : `${p}%`}</b><span>đạt KPI</span></div></div>`;
}

function heroHtml(x) {
  const { m, f, items, today, ref } = x;
  const isAll = f.day === 'all';
  const scope = isAll ? upTo(items, ref) : onDate(items, f.day);
  const c = count(scope);
  const future = !isAll && f.day > today;
  const title = isAll ? `Đến hôm nay · ${m.days[0]?.label} – ${labelOf(ref)}` : f.day === today ? `Hôm nay · ${dayText(f.day)}` : `Ngày ${dayText(f.day)}`;
  const legend = [['D', c.D], ['K', c.K], ['C', c.C]].map(([st, n]) => `<li class="st-${st}"><i class="kd st-${st}"></i><span>${STATUS_LABEL[st]}</span><b>${n}</b></li>`).join('');
  const empty = `<article class="k-card k-today"><p class="k-over">${esc(title)}</p><div class="k-today-row">${donut(c)}<div class="k-today-info"><p class="k-num-m">0 <span>KPI</span></p><p class="hint">Chưa có KPI cho ${isAll ? 'các ngày đã qua' : 'ngày này'}. Nhập KPI và kết quả vào Google Sheet KPI, trang tự cập nhật.</p></div></div></article>`;
  const card1 = !c.total ? empty : future
    ? `<article class="k-card k-today"><p class="k-over">${esc(title)}</p><div class="k-today-row">${donut(c)}<div class="k-today-info"><p class="k-num-m">${c.total} <span>KPI kế hoạch</span></p><p class="hint">Ngày chưa tới. Kết quả được nhập vào đúng ngày.</p></div></div></article>`
    : `<article class="k-card k-today"><p class="k-over">${esc(title)}</p>
        <div class="k-today-row">${donut(c)}<div class="k-today-info"><p class="k-num-m">${c.D}/${c.total} <span>KPI đạt</span></p><ul class="k-legend">${legend}</ul></div></div>
        ${c.C && (isAll || f.day === today) ? `<p class="k-remind">${icon('clock')}${c.C} KPI chưa có kết quả. Hạn cập nhật ${DEADLINE} hôm nay.</p>` : ''}
      </article>`;

  const due = upTo(items, ref);
  const cc = count(due);
  const sel = isAll ? ref : f.day;
  const bars = m.days.map((d) => {
    const dc = count(onDate(items, d.date));
    const p = d.date <= ref ? pct(dc.D, dc.total) : null;
    const cls = [d.date === today ? 'is-today' : '', d.date === sel ? 'is-sel' : '', p == null ? 'is-empty' : ''].join(' ');
    return `<li class="${cls}"><span class="b-val">${p == null ? '–' : `${p}%`}</span><span class="b-slot"><i style="height:${p == null ? 0 : Math.max(4, p)}%"></i></span><span class="b-day">${esc(d.label)}</span></li>`;
  }).join('');
  const card2 = `<article class="k-card k-cum"><p class="k-over">Lũy kế ${esc(m.days[0]?.label || '')} – ${esc(labelOf(ref))}</p>
      <p class="k-num-l">${pct(cc.D, cc.total) ?? '–'}${cc.total ? '%' : ''} <span>${cc.D}/${cc.total} lượt KPI đạt</span></p>
      <ol class="k-bars">${bars}</ol></article>`;

  let delta = '';
  if (!isAll && !future) {
    const i = m.days.findIndex((d) => d.date === f.day);
    if (i > 0) {
      const prev = count(onDate(items, m.days[i - 1].date)).K;
      const d = c.K - prev;
      delta = d === 0 ? `<p class="k-delta">Bằng hôm trước (${prev})</p>` : `<p class="k-delta ${d < 0 ? 'ok' : 'bad'}">${icon(d < 0 ? 'down' : 'up')}${d < 0 ? 'Giảm' : 'Tăng'} ${Math.abs(d)} so với hôm trước (${prev})</p>`;
    }
  }
  const failStreams = [...new Set(scope.filter((it) => it.status === 'K').map((it) => it.stream))];
  const card3 = `<article class="k-card k-big st-K${c.K ? '' : ' is-zero'}"><p class="k-over">${isAll ? 'Không đạt đến hôm nay' : 'Không đạt'}</p>
      <p class="k-num-xl">${c.K} <span>KPI</span></p>
      <p class="hint">${failStreams.length ? `Ở ${failStreams.length} dòng tiền: ${esc(failStreams.join(', '))}` : future ? 'Ngày chưa tới' : c.total ? 'Không có KPI không đạt' : 'Chưa có KPI'}</p>${delta}</article>`;
  const card4 = `<article class="k-card k-big st-C${c.C ? '' : ' is-zero'}"><p class="k-over">Chưa cập nhật</p>
      <p class="k-num-xl">${c.C} <span>KPI</span></p>
      <p class="hint">${c.C ? 'KPI chưa có kết quả trên sheet' : future ? 'Ngày chưa tới' : c.total ? 'Tất cả KPI đã có kết quả' : 'Chưa có KPI'}</p>
      ${c.C && (isAll || f.day === today) ? `<p class="k-delta warn">${icon('clock')}Hạn cập nhật ${DEADLINE}</p>` : ''}</article>`;
  return `<section class="k-hero" aria-label="Chỉ số chính">${card1}${card2}${card3}${card4}</section>`;
}

// ----- Cần xử lý -----
function picOf(x, it) { return x.groupOf.get(`${it.streamKey}/${it.groupKey}`)?.pic?.name || ''; }

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

function pendItems(x, list, withDate) {
  if (!list.length) return `<p class="k-none ok">${icon('check')}Tất cả KPI đã có kết quả</p>`;
  return `<ul class="k-pends">${list.map((it) => `<li class="k-pend">${icon('clock')}<div class="kp-body"><b>${withDate ? `<span class="kl-date">${esc(it.label)}</span>` : ''}${esc(it.group)}</b><span>${esc(it.stream)} · KPI: ${esc(it.kpi)}</span></div><span class="kp-who">${esc(it.person)}</span></li>`).join('')}</ul>`;
}

function actScope(x) {
  const { f, items, today, ref } = x;
  if (f.day !== 'all' && f.day > today) return null;
  const isAll = f.day === 'all';
  const scope = isAll ? upTo(items, ref) : onDate(items, f.day);
  const desc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  return {
    isAll,
    total: scope.length,
    fails: scope.filter((it) => it.status === 'K').sort(desc),
    pends: scope.filter((it) => it.status === 'C').sort(desc),
    notes: noteTargets(items, isAll ? ref : f.day),
  };
}

function actHtml(x) {
  const a = actScope(x);
  const r = x.f.result;
  if (!a || r === 'D') return '';
  const title = a.isAll ? 'Cần xử lý · tồn đọng đến hôm nay' : x.f.day === x.today ? 'Cần xử lý hôm nay' : `Cần xử lý · ${dayText(x.f.day)}`;
  if (!a.total) {
    return `<section class="k-panel" aria-labelledby="k-act-t"><header class="k-phead"><div><h2 id="k-act-t">${esc(title)}</h2></div></header><p class="k-none">Chưa có KPI nào cho ${a.isAll ? 'các ngày đã qua' : 'ngày này'}.</p></section>`;
  }
  const failCol = r === 'C' ? '' : `<div class="k-col"><h3 class="k-colhead">Không đạt <span class="k-badge st-K">${a.fails.length}</span></h3>${failItems(x, a.fails, a.notes, a.isAll)}</div>`;
  const pendCol = `<div class="k-col"><h3 class="k-colhead">Chưa cập nhật <span class="k-badge st-C">${a.pends.length}</span></h3>${pendItems(x, a.pends, a.isAll)}${a.pends.length ? `<p class="hint">Ô Kết quả còn trống sau ${DEADLINE} được tính là chưa cập nhật.</p>` : ''}</div>`;
  return `<section class="k-panel" aria-labelledby="k-act-t"><header class="k-phead"><div><h2 id="k-act-t">${esc(title)}</h2><p class="hint">KPI không đạt hoặc chưa có kết quả, kèm người thực hiện và PIC nhóm</p></div></header>
      <div class="k-cols">${failCol}${pendCol}</div></section>`;
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
      else if (c.total) { label = tv ? `${c.D}/${c.total}` : `${c.D}/${c.total} đạt${c.C ? ` · ${c.C} chờ` : ''}`; cls = c.K ? 'bad' : c.C ? 'warn' : 'ok'; }
      return `<div class="kt-c kt-day${d.date === hl ? ' is-hl' : ''}" role="cell"><span class="k-dots">${list.map((it) => `<i class="kd st-${it.status}" title="${esc(`${it.group} · ${it.person}: ${it.kpi} (${STATUS_LABEL[it.status]})`)}"></i>`).join('')}</span>${label ? `<span class="kt-lab ${cls}">${esc(label)}</span>` : ''}</div>`;
    }).join('');
    const due = upTo(s.items, ref);
    const c = count(due);
    const p = pct(c.D, c.total);
    const backlog = c.K + c.C;
    const name = tv ? `<b>${esc(s.name)}</b>` : `<button type="button" class="kt-name" data-pick-stream="${esc(s.key)}">${s.code ? `<span class="k-code">${esc(s.code)}</span>` : ''}<b>${esc(s.name)}</b></button>`;
    return `<div class="kt-row" role="row"><div class="kt-c kt-stream" role="rowheader">${name}${!tv && s.pic ? `<small>PIC ${esc(s.pic)}</small>` : ''}</div>${cells}
        <div class="kt-c kt-sum" role="cell">${s.items.length ? `<span class="k-bar ${tone(p)}"><i style="width:${p ?? 0}%"></i></span><b class="${tone(p)}">${p == null ? '–' : `${p}%`}</b><small>${c.D}/${c.total}${backlog ? ` · ${backlog} tồn đọng` : ''}</small>` : '<small>Chưa nhập KPI</small>'}</div></div>`;
  }).join('');
  const legend = ['D', 'K', 'C', 'S'].map((st) => `<span><i class="kd st-${st}"></i>${STATUS_LABEL[st]}</span>`).join('');
  return `<section class="k-panel k-streams" aria-labelledby="k-tbl-t"><header class="k-phead"><div><h2 id="k-tbl-t">Kết quả theo dòng tiền</h2>${tv ? '' : '<p class="hint">Mỗi ô vuông là 1 KPI của 1 người trong ngày. Bấm tên dòng tiền để xem chi tiết từng nhóm.</p>'}</div>${tv ? '' : `<div class="k-legend-row">${legend}</div>`}</header>
      <div class="k-table" role="table" style="--days:${m.days.length}"><div class="kt-row kt-head" role="row"><div class="kt-c kt-stream" role="columnheader">Dòng tiền</div>${head}<div class="kt-c kt-sum" role="columnheader">Lũy kế đến hôm nay</div></div>${rows}</div></section>`;
}

// ----- Kế hoạch & kết quả theo nhóm -----
function peopleHtml(g) {
  const pic = g.pic;
  const mem = g.members || [];
  const p = pic ? `<span class="kp-pic"><span class="av pic">${esc(initials(pic.name))}</span><span class="kp-name"><b>${esc(pic.name)}</b><small>PIC · chịu trách nhiệm chính${pic.title ? ` · ${esc(pic.title)}` : ''}</small></span></span>` : '<span class="kp-pic none">Chưa có PIC nhóm</span>';
  const m = mem.length ? `<span class="kp-sep" aria-hidden="true"></span><span class="kp-mem"><span class="av-stack">${mem.map((n) => `<span class="av" title="${esc(n)}">${esc(initials(n))}</span>`).join('')}</span><span class="kp-name"><small>${mem.length} người thực hiện</small><span>${esc(mem.map(short).join(', '))}</span></span></span>` : '';
  return `<div class="kg-people">${p}${m}</div>`;
}

function lineFull(it, notes) {
  const today = S.model.today;
  return `<li class="kl kl-full st-${it.status}"><span class="kl-ic">${icon(STATUS_ICON[it.status])}</span>
      <span class="kl-body"><b class="kl-kpi">${esc(it.kpi)}</b><span class="kl-who">${icon('user')}${esc(it.person || '—')}</span>
      ${notes.has(it.id) ? `<span class="kl-note">Vướng mắc: ${esc(it.note)}</span>` : ''}${it.status === 'C' ? `<span class="kl-note">Chưa có kết quả${it.date === today ? `, hạn cập nhật ${DEADLINE}` : ''}</span>` : ''}</span>${chip(it.status)}</li>`;
}

function lineCompact(it, notes) {
  return `<li class="kl kl-compact st-${it.status}"><span class="kl-date">${esc(it.label)}</span>
      <span class="kl-body"><b class="kl-kpi">${esc(it.kpi)}</b><span class="kl-who">${icon('user')}${esc(it.person || '—')}</span>${notes.has(it.id) ? `<span class="kl-note">Vướng mắc: ${esc(it.note)}</span>` : ''}</span>
      <span class="kl-st" title="${STATUS_LABEL[it.status]}">${icon(STATUS_ICON[it.status])}</span></li>`;
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

function dayCard(g, x) {
  const { f, today } = x;
  const D = f.day;
  let list = onDate(g.items, D);
  let back = g.items.filter((it) => it.date < D && isOutstanding(it)).sort(byDate);
  if (f.result === 'D') { list = list.filter((it) => it.status === 'D'); back = []; }
  if (f.result === 'T') list = list.filter(isOutstanding);
  if (f.result === 'C') { list = list.filter((it) => it.status === 'C'); back = back.filter((it) => it.status === 'C'); }
  if (f.result !== 'all' && !list.length && !back.length) return '';
  const notes = noteTargets(g.items, D);
  const all = onDate(g.items, D);
  const dc = count(all);
  const future = D > today;
  const top = future
    ? pill(`${dc.total} KPI sắp tới`, 'muted')
    : dc.total ? pill(`Đạt ${dc.D}/${dc.total} ngày ${labelOf(D)}`, dc.D === dc.total ? 'ok' : 'muted') : '';
  const backPill = back.length ? pill(`${back.length} tồn đọng`, 'bad') : future ? '' : pill('Không tồn đọng', 'ok-line');
  return `<article class="k-group"><header class="kg-top"><h3>${esc(g.name)}</h3><span class="kg-pills">${top}${backPill}</span></header>
      ${peopleHtml(g)}<hr />
      <p class="kg-label">KPI ngày ${esc(labelOf(D))} · ${list.length}</p>
      ${list.length ? `<ul class="kl-list">${list.map((it) => lineFull(it, notes)).join('')}</ul>` : `<p class="k-none">Không có KPI ngày ${esc(labelOf(D))}</p>`}
      ${back.length ? `<p class="kg-label bad">Tồn đọng từ ngày trước · ${back.length}</p><ul class="kl-list compact">${back.map((it) => lineCompact(it, notes)).join('')}</ul>` : future ? '' : `<p class="k-none ok">${icon('check')}Không có KPI tồn đọng từ ngày trước</p>`}
      ${folderLinks(g)}</article>`;
}

function planCard(g, x) {
  const { f, ref } = x;
  const notes = noteTargets(g.items, ref);
  const done = g.items.filter((it) => it.status === 'D').sort(byDate);
  let back = g.items.filter((it) => it.date <= ref && isOutstanding(it)).sort(byDate);
  const next = g.items.filter((it) => it.status === 'S').sort(byDate);
  if (f.result === 'C') back = back.filter((it) => it.status === 'C');
  const cols = [
    ['done', 'Đã đạt', 'check', 'D', done, 'Chưa có KPI nào đạt'],
    ['back', 'Tồn đọng', 'alert', 'K', back, 'Không có KPI tồn đọng'],
    ['next', 'Kế hoạch sắp tới', 'calendar', 'S', next, 'Không còn KPI sắp tới'],
  ].filter(([k]) => f.result === 'all' || (f.result === 'D' ? k === 'done' : k === 'back'));
  if (f.result !== 'all' && !cols.some((c) => c[4].length)) return '';
  const total = g.items.length;
  const seg = (n, st) => (n ? `<i class="st-${st}" style="flex:${n}"></i>` : '');
  return `<article class="k-plan"><header class="kpl-top"><div class="kpl-who"><h3>${esc(g.name)}</h3>${peopleHtml(g)}</div>
      <div class="kpl-sum"><b>Kế hoạch ${total} KPI</b><span class="k-stack is-mini">${seg(done.length, 'D')}${seg(back.length, 'K')}${seg(next.length, 'S')}</span><small>Đạt ${done.length} · Tồn đọng ${back.length} · Sắp tới ${next.length}</small></div></header>
      <div class="kpl-cols" style="--cols:${cols.length}">${cols.map(([k, title, ic, st, list, empty]) => `<div class="kpl-col kpl-${k}"><p class="kpl-head st-${st}">${icon(ic)}${title}<span class="k-badge st-${st}">${list.length}</span></p>
        ${list.length ? `<ul class="kl-list compact">${list.map((it) => lineCompact(it, notes)).join('')}</ul>` : `<p class="k-none${k === 'back' ? ' ok' : ''}">${k === 'back' ? icon('check') : ''}${empty}</p>`}</div>`).join('')}</div>
      ${folderLinks(g)}</article>`;
}

function groupsHtml(x) {
  const { m, f, today, ref } = x;
  const pool = f.stream === 'all' ? m.streams : m.streams.filter((s) => s.key === f.stream);
  const s = pool.find((v) => v.key === S.groupStream) || pool.find((v) => v.items.length) || pool[0];
  if (!s) return '';
  const isAll = f.day === 'all';
  const people = new Set(s.groups.flatMap((g) => [g.pic?.name, ...(g.members || [])].filter(Boolean)));
  const active = s.groups.filter((g) => g.items.length);
  const idle = s.groups.filter((g) => !g.items.length);
  const tabs = f.stream === 'all' && m.streams.length > 1
    ? `<div class="k-tabs" role="tablist" aria-label="Chọn dòng tiền">${m.streams.map((v) => {
      const c = count(upTo(v.items, ref));
      const p = pct(c.D, c.total);
      return `<button type="button" role="tab" data-gstream="${esc(v.key)}" aria-selected="${v.key === s.key}">${esc(v.name)}<b class="${tone(p)}">${p == null ? '–' : `${p}%`}</b></button>`;
    }).join('')}</div>`
    : '';
  const title = isAll ? `Kế hoạch ${m.days.length} ngày · ${s.name}` : `Kế hoạch & kết quả theo nhóm · ${dayText(f.day)}`;
  const desc = [isAll ? '' : s.name, s.pic ? `PIC ${s.pic}` : '', `${s.groups.length} nhóm`, `${people.size} người`].filter(Boolean).join(' · ');
  let body;
  if (isAll) {
    const c = count(s.items);
    const due = count(upTo(s.items, ref));
    const backlog = due.K + due.C;
    const seg = (n, st) => (n ? `<i class="st-${st}" style="flex:${n}"></i>` : '');
    const summary = `<div class="k-plan-sum"><div class="k-card"><p class="k-over">Kế hoạch ${m.days.length} ngày của dòng tiền</p><p class="k-num-l">${c.total} KPI <span>${active.length} nhóm có KPI</span></p>
        <span class="k-stack">${seg(c.D, 'D')}${seg(c.K, 'K')}${seg(c.C, 'C')}${seg(c.S, 'S')}</span>
        <ul class="k-legend inline">${['D', 'K', 'C', 'S'].map((st) => `<li><i class="kd st-${st}"></i>${STATUS_LABEL[st]} <b>${c[st]}</b></li>`).join('')}</ul></div>
        <div class="k-card k-big st-K${backlog ? '' : ' is-zero'}"><p class="k-over">Tồn đọng cần gỡ</p><p class="k-num-xl">${backlog} <span>KPI</span></p><p class="hint">${due.K} không đạt · ${due.C} chưa cập nhật, tính đến hôm nay</p></div>
        <div class="k-card"><p class="k-over">Tỷ lệ đạt đến hôm nay</p><p class="k-num-xl">${pct(due.D, due.total) ?? '–'}${due.total ? '%' : ''} <span>${due.D}/${due.total} KPI</span></p><p class="hint">Còn ${c.S} KPI kế hoạch cho các ngày tới</p></div></div>`;
    const cards = active.map((g) => planCard(g, x)).join('');
    body = `${summary}<div class="k-plans">${cards || '<p class="k-none">Không có nhóm nào khớp bộ lọc.</p>'}</div>`;
  } else {
    const D = f.day;
    const dc = count(onDate(s.items, D));
    const back = s.items.filter((it) => it.date < D && isOutstanding(it)).length;
    const strip = D > today
      ? `<p class="k-strip"><b>Ngày ${esc(labelOf(D))}: ${dc.total} KPI kế hoạch</b>${pill('Ngày chưa tới', 'muted')}</p>`
      : `<p class="k-strip"><b>Ngày ${esc(labelOf(D))}: ${dc.total} KPI</b>${pill(`Đạt ${dc.D}`, 'ok')}${pill(`Không đạt ${dc.K}`, 'bad')}${pill(`Chưa cập nhật ${dc.C}`, 'warn')}<span class="kf-sep" aria-hidden="true"></span>${pill(`Tồn đọng từ ngày trước ${back}`, back ? 'bad-line' : 'ok-line')}</p>`;
    const cards = active.map((g) => dayCard(g, x)).join('');
    body = `${strip}<div class="k-cards">${cards || '<p class="k-none">Không có nhóm nào khớp bộ lọc.</p>'}</div>`;
  }
  const idleNote = idle.length ? `<p class="hint">Chưa nhập KPI: ${esc(idle.map((g) => g.name).join(', '))}.</p>` : '';
  return `<section class="k-panel k-groups" id="k-groups" aria-labelledby="k-grp-t"><header class="k-phead"><div><h2 id="k-grp-t">${esc(title)}</h2><p class="hint">${esc(desc)}</p></div>${tabs}</header>${body}${idleNote}</section>`;
}

function guideHtml() {
  return `<p class="k-guide">${icon('info')}<span>Cách đọc: cột Kết quả trên sheet chỉ nhập Đạt hoặc Không đạt. Ô trống của ngày đã qua hoặc hôm nay là Chưa cập nhật; ngày chưa tới là Sắp tới. Tồn đọng = KPI Không đạt hoặc Chưa cập nhật tính đến ngày đang xem. Nhóm nhiều người: mỗi người 1 dòng cùng tên Nhóm trên sheet, cột PIC của dòng là người thực hiện; PIC nhóm lấy theo Đội trưởng trong DS nhân sự War-Room. Bộ lọc Ngày áp dụng cho cả trang.</span></p>`;
}

// ----- Màn hình TV: 1 màn, hôm nay, tất cả dòng tiền -----
function tvHtml() {
  const x = view({ day: defaultDay(S.model), stream: 'all', result: 'all' });
  if (!x.m.streams.length) return pageHtml();
  const a = actScope(x) || { fails: [], pends: [], notes: new Set(), isAll: true };
  return `${heroHtml(x)}<div class="k-tv-bottom">${tableHtml(x, { tv: true })}
      <section class="k-panel st-K-line"><header class="k-phead"><h2>Không đạt ${a.isAll ? 'đến hôm nay' : 'hôm nay'}</h2><span class="k-badge st-K">${a.fails.length}</span></header>${failItems(x, a.fails.slice(0, 4), a.notes, a.isAll)}${a.fails.length > 4 ? `<p class="hint">và ${a.fails.length - 4} KPI khác</p>` : ''}</section>
      <section class="k-panel st-C-line"><header class="k-phead"><h2>Chưa cập nhật kết quả</h2><span class="k-badge st-C">${a.pends.length}</span></header>${pendItems(x, a.pends.slice(0, 7), a.isAll)}${a.pends.length > 7 ? `<p class="hint">và ${a.pends.length - 7} KPI khác</p>` : ''}</section></div>`;
}

// ---------- tương tác ----------
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day],[data-result]');
  if (!b) return;
  if (b.dataset.day) S.filter.day = b.dataset.day; else S.filter.result = b.dataset.result;
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
  const tab = e.target.closest('[data-gstream]');
  if (tab) { S.groupStream = tab.dataset.gstream; render(); return; }
  const row = e.target.closest('[data-pick-stream]');
  if (row) {
    S.groupStream = row.dataset.pickStream;
    render();
    document.getElementById('k-groups')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

load();

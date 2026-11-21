// Dashboard "Tiến độ dòng tiền" (v4). Dữ liệu: GET /api/streams (task từ Google Sheet WR - MASTER TASK).
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');
  const params = new URLSearchParams(location.search);

  const ICONS = {
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    userX: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
    sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };
  const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const STATUS_RANK = { overdue: 0, waiting: 1, review: 2, doing: 3, todo: 4, done: 5 };

  const S = {
    data: null,
    scrollTo: null, // id dòng tiền cần cuộn tới sau lần tải kế tiếp (vừa nạp file)
    scrolled: false, // đã cuộn theo #DT02 trên URL chưa
    timer: null,
    loading: false,
    filters: new Map(), // id dòng tiền -> chỉ số đang lọc bảng task (METRICS), giữ qua các lần tự làm mới
    sheetLinks: null, // các link Google Sheet đang hiện ở nút "Mở Sheet"
  };

  // ---------- giao diện: tối (mặc định) / sáng, và màn hình TV (chữ lớn, luôn tối) ----------
  const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
  const MOON = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư: bỏ qua */ } },
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
  function applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = prefs.tv || prefs.theme === 'dark' ? 'dark' : 'light';
    if (prefs.tv) root.dataset.tv = '1'; else delete root.dataset.tv;
    $('tvBtn').setAttribute('aria-pressed', String(prefs.tv));
    $('tvLabel').textContent = prefs.tv ? 'Màn hình thường' : 'Màn hình TV';
    $('themeBtn').hidden = prefs.tv;
    const dark = root.dataset.theme === 'dark';
    $('themeIcon').innerHTML = dark ? SUN : MOON;
    $('themeLabel').textContent = dark ? 'Giao diện sáng' : 'Giao diện tối';
  }
  applyTheme();
  $('themeBtn').addEventListener('click', () => {
    prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
    store.set('wr-theme', prefs.theme);
    applyTheme();
  });
  $('tvBtn').addEventListener('click', () => {
    prefs.tv = !prefs.tv;
    store.set('wr-tv', prefs.tv ? '1' : '0');
    if (store.get('wr-theme') === 'tv') store.set('wr-theme', 'dark');
    applyTheme();
  });

  // ---------- data ----------
  async function load() {
    if (S.loading) { S.again = true; return; }
    S.loading = true;
    try {
      const res = await fetch('/api/streams', { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
      const type = res.headers.get('content-type') || '';
      if (!type.includes('application/json')) {
        // Phiên đăng nhập hết hạn: Worker trả trang đăng nhập.
        location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok && !data.streams) throw new Error(data.error || `HTTP ${res.status}`);
      S.data = data;
      render();
      schedule(data.refreshSeconds);
    } catch (e) {
      if (S.data) {
        S.data = { ...S.data, stale: true, error: `Không tải được dữ liệu mới: ${e.message || e}` };
        render();
      } else {
        renderFatal(e.message || String(e));
      }
      schedule(60);
    } finally {
      S.loading = false;
      if (S.again) { S.again = false; load(); }
    }
  }

  function schedule(seconds) {
    clearTimeout(S.timer);
    S.timer = setTimeout(load, Math.max(30, Number(seconds) || 60) * 1000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.data && Date.now() - (S.data.syncedAt || 0) > 90000) load();
  });

  // Realtime (src/live.js): máy chủ báo {type:"change", scope:"streams"} khi sheet/Excel đổi -> tải lại ngay.
  // Kéo định kỳ ở trên chỉ để dự phòng khi mất kết nối.
  let ws = null;
  let wsDelay = 1000;
  function connect() {
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/live/ws'); } catch { return; }
    ws.onopen = () => { if (wsDelay > 1000 && S.data) load(); wsDelay = 1000; }; // kết nối lại: tải bù thay đổi bị lỡ
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'change' && m.scope === 'streams') load();
    };
    ws.onclose = () => { ws = null; setTimeout(connect, wsDelay); wsDelay = Math.min(wsDelay * 2, 30000); };
  }
  connect();
  setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 30000);
  setInterval(() => { if (S.data) renderSync(); }, 30000);

  // ---------- helpers ----------
  const pctText = (p) => (p === null || p === undefined ? '—' : `${p}%`);
  const barWidth = (p) => `${Math.max(0, Math.min(100, Number(p) || 0))}%`;
  function ago(ms) {
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 60000) return 'vừa xong';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ trước`;
    return `${Math.floor(diff / 86400000)} ngày trước`;
  }
  function clock(ms) {
    const d = new Date(ms + 7 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  const stream = (id) => S.data?.streams?.find((s) => s.id === id) || null;
  const hashKey = (s) => s.code || s.id;
  const codeLabel = (s) => s.code || 'Dòng tiền';

  // ---------- render: page ----------
  function render() {
    const d = S.data;
    renderSync();
    renderNotices();
    renderXlList();
    if (d.mode === 'unconfigured' && !d.streams.length) {
      renderSetup();
      return;
    }
    if (!d.summary) {
      // Lần đọc đầu tiên đã lỗi, chưa có dữ liệu nào để hiển thị (thông báo lỗi ở trên).
      $('summary').hidden = true;
      $('unstaffed').hidden = true;
      document.querySelector('.section-head .legend').hidden = true;
      document.querySelector('.section-head .hint').hidden = true;
      $('gridTitle').textContent = 'Chưa có dữ liệu';
      $('grid').innerHTML = '';
      return;
    }
    const n = d.streams.length;
    $('pageTitle').textContent = n ? `Tiến độ ${n} dòng tiền` : 'Tiến độ dòng tiền';
    $('navCount').textContent = String(n);
    $('gridTitle').textContent = `${n} dòng tiền chính`;
    document.title = `Tiến độ ${n} dòng tiền · War Room`;
    $('summary').hidden = false;
    document.querySelector('.section-head .legend').hidden = false;
    document.querySelector('.section-head .hint').hidden = false;
    renderSummary(d.summary);
    renderGrid(d.streams);
    renderOthers(d.otherGroups);
    // Vừa nạp file, hoặc link có #DT02: cuộn tới dòng tiền đó (chỉ 1 lần, không cuộn lại mỗi lần tự làm mới).
    const want = S.scrollTo || (!S.scrolled && decodeURIComponent(location.hash.slice(1)));
    S.scrollTo = null;
    S.scrolled = true;
    if (want) scrollToStream(want);
  }

  function renderSync() {
    const d = S.data;
    const el = $('sync');
    let state = 'live';
    let label;
    // Giờ đọc sheet gần nhất (đồng bộ tự động); chưa có thì lấy giờ nạp file gần nhất.
    const sheetAt = Date.parse(d.sheetSync?.checkedAt || '') || Math.max(0, ...(d.excelImports || []).map((i) => Date.parse(i.uploadedAt) || 0));
    label = sheetAt ? `${sheetName()} · cập nhật ${clock(sheetAt).slice(6)}` : sheetName();
    if (d.stale && d.error) state = 'stale'; // trình duyệt không tải được lần mới, đang giữ dữ liệu cũ
    else if (d.sheetSync?.error) state = 'stale';
    else if (!d.streams?.length) state = 'error';
    renderSheetLinks((d.sheetSync?.sheetUrls || [d.sheetSync?.sheetUrl]).map(safeUrl).filter(Boolean));
    el.dataset.state = state;
    $('syncText').textContent = label;
  }

  // Đồng bộ nhiều Google Sheet (EXCEL_SHEET_URL): nhãn chung và mỗi sheet 1 nút "Mở Sheet n".
  const sheetCount = () => S.data?.sheetSync?.sheetUrls?.length || 1;
  const sheetName = () => (sheetCount() > 1 ? `${sheetCount()} Google Sheet` : 'Google Sheet WR - MASTER TASK');

  function renderSheetLinks(urls) {
    const key = urls.join(' ');
    if (S.sheetLinks === key) return;
    S.sheetLinks = key;
    const first = $('openSheet');
    document.querySelectorAll('a[data-sheet-extra]').forEach((a) => a.remove());
    first.hidden = !urls.length;
    if (!urls.length) return;
    first.href = urls[0];
    first.querySelector('.lbl').textContent = urls.length > 1 ? 'Mở Sheet 1' : 'Mở Google Sheet';
    let prev = first;
    urls.slice(1).forEach((url, i) => {
      const a = first.cloneNode(true);
      a.removeAttribute('id');
      a.dataset.sheetExtra = '';
      a.href = url;
      a.querySelector('.lbl').textContent = `Mở Sheet ${i + 2}`;
      prev.after(a);
      prev = a;
    });
  }

  function renderNotices() {
    const d = S.data;
    const out = [];
    if (d.error) {
      out.push(`<div class="notice err">${icon('alert')}<div class="grow">${esc(d.error)} Đang hiển thị dữ liệu lần tải trước.</div></div>`);
    }
    if (d.sheetSync?.error) {
      out.push(`<div class="notice warn">${icon('alert')}<div class="grow"><b>Chưa đọc được ${esc(sheetName())}.</b> ${esc(d.sheetSync.error)} Đang hiển thị dữ liệu lần đọc trước.</div></div>`);
    }
    if (d.sheetSync?.warnings?.length) {
      out.push(`<div class="notice">${icon('info')}<div class="grow"><b>Lưu ý từ ${esc(sheetName())}</b><ul>${d.sheetSync.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>`);
    }
    if (d.warnings && d.warnings.length) {
      out.push(`<div class="notice">${icon('info')}<div class="grow"><b>Lưu ý</b><ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>`);
    }
    $('notices').innerHTML = out.join('');
  }

  function renderSetup() {
    $('pageTitle').textContent = 'Tiến độ dòng tiền';
    $('navCount').textContent = '–';
    $('summary').hidden = true;
    $('unstaffed').hidden = true;
    document.querySelector('.section-head .legend').hidden = true;
    document.querySelector('.section-head .hint').hidden = true;
    $('gridTitle').textContent = 'Chưa có task';
    $('grid').innerHTML = `<div class="setup" style="grid-column:1/-1">
      <h2>Chưa có task nào trong Google Sheet WR - MASTER TASK</h2>
      <p class="hint">Thêm task vào sheet của từng dòng tiền (mỗi sheet “Dòng tiền …” là 1 dòng tiền). Dashboard tự cập nhật trong vòng 1 phút.</p>
    </div>`;
  }

  function renderFatal(message) {
    $('sync').dataset.state = 'error';
    $('syncText').textContent = 'Không tải được dữ liệu';
    $('notices').innerHTML = `<div class="notice err">${icon('alert')}<div class="grow"><b>Không tải được dữ liệu dashboard.</b> ${esc(message)} Thử lại sau 1 phút.</div></div>`;
    $('grid').innerHTML = '';
  }

  function renderSummary(s) {
    $('sumPct').textContent = pctText(s.percent);
    $('sumBar').style.width = barWidth(s.percent);
    $('sumDone').textContent = `${s.done}/${s.total} task hoàn thành`;
    $('sumPeople').textContent = String(s.people);
    $('sumPics').textContent = `${s.pics}/${s.streams} dòng tiền có PIC`;
    $('sumPics').classList.toggle('is-warn', s.pics < s.streams);
    $('sumDoing').textContent = String(s.doing);
    $('sumDoingSub').textContent = `${s.waiting} đang chờ · ${s.review} chờ duyệt · ${s.todo} chưa bắt đầu`;
    $('sumOverdue').textContent = String(s.overdue);
    $('sumOverdueSub').textContent = s.overdue ? `ở ${s.streamsWithOverdue} dòng tiền — cần xử lý ngay` : 'Không có task trễ hạn';
    $('sumOverdueCell').classList.toggle('is-danger', s.overdue > 0);
  }

  function statsHtml(c, own) {
    if (!c.total) {
      const ownTxt = own && own.status !== 'todo' ? `<span class="st ${own.status}"><i></i>${esc(own.statusLabel)} · ${esc(own.dueLabel)}</span>` : '';
      return `<span class="st todo"><i></i>Thêm task vào Google Sheet</span>${ownTxt}`;
    }
    if (c.done === c.total) return `<span class="st done"><i></i>${c.done} hoàn thành</span>`;
    const parts = [];
    if (c.doing) parts.push(`<span class="st"><i></i>${c.doing} đang làm</span>`);
    if (c.waiting) parts.push(`<span class="st waiting"><i></i>${c.waiting} đang chờ</span>`);
    if (c.review) parts.push(`<span class="st review"><i></i>${c.review} chờ duyệt</span>`);
    if (c.overdue) parts.push(`<span class="st overdue"><i></i>${c.overdue} quá hạn</span>`);
    if (c.todo) parts.push(`<span class="st todo"><i></i>${c.todo} chưa bắt đầu</span>`);
    return parts.join('');
  }

  function picHtml(pic, long) {
    if (!pic) {
      return `<span class="pic none"><span class="av">${icon('userX')}</span><span class="who"><span class="pic-name">Chưa có PIC</span><span class="pic-role">Cần chốt 1 người chịu trách nhiệm</span></span></span>`;
    }
    const role = long ? pic.title : (pic.designation || pic.department);
    return `<span class="pic"><span class="av">${esc(pic.initials)}</span><span class="who"><span class="pic-name">${esc(pic.name)}</span><span class="pic-role" title="${esc(pic.title)}">PIC${role ? ' · ' + esc(role) : ''}</span></span></span>`;
  }

  // ---------- mỗi dòng tiền: chỉ số, nhóm, task — hiện sẵn trên trang, không cần bấm ----------
  const sectionId = (s) => `dt-${String(hashKey(s)).replace(/[^\w-]+/g, '-')}`;

  function scrollToStream(key) {
    const target = S.data?.streams?.find((s) => s.id === key || hashKey(s) === key);
    if (target) document.getElementById(sectionId(target))?.scrollIntoView({ block: 'start' });
  }

  // Bấm 1 chỉ số -> bảng task của dòng tiền chỉ còn task thuộc chỉ số đó; bấm lại (hoặc "Task hiện có") -> hiện tất cả.
  const METRICS = {
    all: { label: 'Task hiện có', match: () => true },
    active: { label: 'Đang thực hiện', match: (t) => t.status === 'doing' || t.status === 'waiting' || t.status === 'review' },
    done: { label: 'Đã hoàn thành', match: (t) => t.status === 'done' },
    overdue: { label: 'Quá hạn', match: (t) => t.status === 'overdue' },
  };
  const filterOf = (s) => (METRICS[S.filters.get(s.id)] ? S.filters.get(s.id) : 'all');

  /** 4 chỉ số: task hiện có, đang thực hiện (đang làm + đang chờ + chờ duyệt), hoàn thành, quá hạn. */
  function metricsHtml(s) {
    const c = s.counts;
    const on = filterOf(s);
    const cell = (key, value, cls, sub) => `<button type="button" class="m-cell${cls}" data-metric="${key}" data-stream="${esc(s.id)}" aria-pressed="${on === key}" aria-controls="${sectionId(s)}-tasks" title="${key === 'all' ? 'Hiện tất cả task' : `Chỉ hiện task ${METRICS[key].label.toLowerCase()}`}">
          <span class="m-val">${value}</span><span class="m-lbl">${METRICS[key].label}</span>${sub ? `<span class="m-sub">${sub}</span>` : ''}
        </button>`;
    return `<div class="metrics" role="group" aria-label="Chỉ số task — bấm để lọc bảng task">
        ${cell('all', c.total, '', c.todo ? `${c.todo} chưa bắt đầu` : '')}
        ${cell('active', c.doing + c.waiting + c.review, ' is-doing', c.waiting ? `${c.waiting} đang chờ` : '')}
        ${cell('done', c.done, ' is-done', '')}
        ${cell('overdue', c.overdue, c.overdue ? ' is-overdue' : '', '')}
      </div>`;
  }

  function memberLine(m, groupTask) {
    if (m.placeholder) return `<li class="is-pending">Chờ bổ sung nhân sự<small>${esc(m.name)}</small></li>`;
    const role = m.role ? `<span class="tag">${esc(m.role)}</span>` : '';
    const task = m.task && m.task !== groupTask ? `<span class="m-task">${esc(m.task)}</span>` : '';
    return `<li><span class="nm">${esc(m.name)}</span>${role}${task}</li>`;
  }

  /** Bảng nhóm (file phân chia nhiệm vụ): Nhóm | PIC | Nhiệm vụ chính | Thành viên · nhiệm vụ từng người. */
  function teamsTableHtml(s) {
    const groups = s.teams?.groups || [];
    if (!groups.length) return '<p class="d-empty">Chưa có phân chia nhóm. Nạp file phân chia nhiệm vụ (DS nhân sự War-Room) bằng nút “Nạp task Excel”.</p>';
    const rows = groups.map((g, i) => {
      const people = g.members.filter((m) => !m.placeholder);
      const main = g.mainTask || (people.length === 1 ? people[0].task || '—' : 'Mỗi người một nhiệm vụ');
      const lead = g.lead
        ? `<span class="c-pic"><span class="nm">${esc(g.lead.name)}</span>${g.lead.title ? `<small>${esc(g.lead.title)}</small>` : ''}</span>`
        : '<span class="c-pic none">Chưa chốt PIC</span>';
      return `<div class="g-tr">
          <span class="c-name">Nhóm ${i + 1}</span>
          ${lead}
          <span class="c-task${g.mainTask ? '' : ' muted'}">${esc(main)}</span>
          <ul class="c-members">${g.members.map((m) => memberLine(m, g.mainTask)).join('')}</ul>
        </div>`;
    }).join('');
    return `<div class="g-tbl"><div class="g-th"><span>Nhóm</span><span>PIC</span><span>Nhiệm vụ chính</span><span>Thành viên · nhiệm vụ</span></div>${rows}</div>`;
  }

  /** Task của dòng tiền, giữ thứ tự nhóm như trên sheet. */
  function taskRows(s) {
    const rows = [];
    for (const p of s.people) for (const t of p.tasks) rows.push({ ...t, pic: p.unassigned ? '' : p.name });
    const first = new Map();
    for (const t of rows) {
      const g = t.group || '';
      const o = t.order ?? Infinity;
      if (!first.has(g) || o < first.get(g)) first.set(g, o);
    }
    const order = (t) => (Number.isFinite(t.order) ? t.order : Infinity);
    return rows.sort((a, b) => {
      const ga = first.get(a.group || '');
      const gb = first.get(b.group || '');
      return (ga === gb ? 0 : ga < gb ? -1 : 1)
        || String(a.group || '').localeCompare(String(b.group || ''), 'vi')
        || (order(a) === order(b) ? 0 : order(a) < order(b) ? -1 : 1)
        || STATUS_RANK[a.status] - STATUS_RANK[b.status];
    });
  }

  /** Bảng task: Nhóm | Nhiệm vụ | PIC | Tiến độ | Trạng thái. */
  function tasksTableHtml(s) {
    const all = taskRows(s);
    if (!all.length) return '<p class="d-empty">Chưa có task. Task nhập trên sheet WR - MASTER TASK sẽ tự hiện ở đây.</p>';
    const key = filterOf(s);
    const list = all.filter(METRICS[key].match);
    const bar = key === 'all' ? '' : `<div class="t-filter" role="status">
        <span>Đang lọc: <b>${METRICS[key].label}</b> · ${list.length}/${all.length} task</span>
        <button type="button" class="btn-link" data-metric="all" data-stream="${esc(s.id)}">Hiện tất cả</button>
      </div>`;
    if (!list.length) return `${bar}<p class="d-empty">Không có task ${METRICS[key].label.toLowerCase()}.</p>`;
    let prev = null;
    const rows = list.map((t) => {
      const g = t.group || '';
      const startsGroup = g !== prev;
      prev = g;
      const subject = safeUrl(t.url) ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.subject)}</a>` : esc(t.subject);
      const flag = t.flags?.length ? `<span class="t-flag" title="${esc(t.flags.map((x) => x.label).join('\n'))}" aria-label="${esc(`Chưa đạt nguyên tắc War Room: ${t.flags.map((x) => x.label).join('; ')}`)}">${icon('flag')}</span>` : '';
      const tone = t.status === 'done' ? 'success' : t.status === 'overdue' ? 'danger' : 'accent';
      return `<div class="t-tr${t.status === 'overdue' ? ' is-overdue' : ''}${startsGroup ? ' g-start' : ''}">
          <span class="c-group">${startsGroup ? esc(g || '—') : ''}</span>
          <span class="c-subj">${subject}${flag}</span>
          <span class="c-pic">${esc(t.pic || 'Chưa giao')}</span>
          <span class="c-prog"><span class="bar tone-${tone}"><i style="width:${barWidth(t.progress)}"></i></span><span class="pct">${t.progress}%</span></span>
          <span class="c-st"><span class="badge ${t.status}" title="${esc(t.dueLabel || '')}">${esc(t.statusLabel)}</span></span>
        </div>`;
    }).join('');
    return `${bar}<div class="t-tbl"><div class="t-th"><span>Nhóm</span><span>Nhiệm vụ</span><span>PIC</span><span>Tiến độ</span><span>Trạng thái</span></div>${rows}</div>`;
  }

  /**
   * Điểm nghẽn / cần hỗ trợ theo từng nhóm công việc (cột "Nhóm công việc" và "Điểm nghẽn / Cần hỗ trợ" trên sheet).
   * Task chưa xong có ghi điểm nghẽn, hoặc đang ở trạng thái chờ / vướng mắc. Nhóm có điểm nghẽn xếp trước.
   */
  function blockersHtml(s) {
    const list = taskRows(s);
    if (!list.length) return '';
    const groups = new Map();
    for (const t of list) {
      const g = t.group || '';
      if (!groups.has(g)) groups.set(g, []);
      if (t.status !== 'done' && (String(t.blocker || '').trim() || t.status === 'waiting')) groups.get(g).push(t);
    }
    const total = [...groups.values()].reduce((n, items) => n + items.length, 0);
    const head = `<h4>Điểm nghẽn · Cần hỗ trợ<span class="b-total${total ? ' is-on' : ''}">${total ? `${total} việc cần gỡ` : 'Không có điểm nghẽn'}</span></h4>`;
    if (!total) return `<div class="st-block">${head}<p class="b-none">Chưa nhóm công việc nào ghi điểm nghẽn hoặc đang chờ.</p></div>`;
    const name = (g) => esc(g || 'Chưa ghi nhóm công việc');
    const cards = [...groups].sort(([, a], [, b]) => (b.length > 0) - (a.length > 0)).map(([g, items]) => {
      if (!items.length) return `<div class="b-card is-clear"><div class="b-head"><span class="b-name">${name(g)}</span><span class="b-count">Không có điểm nghẽn</span></div></div>`;
      const li = items.map((t) => `<li>
          <span class="b-text${t.blocker ? '' : ' muted'}">${esc(t.blocker || 'Đang chờ — chưa ghi điểm nghẽn / cần hỗ trợ trên sheet')}</span>
          <span class="b-meta"><span class="b-task">${esc(t.subject)}</span> · ${esc(t.pic || 'Chưa giao')} · <span class="badge ${t.status}">${esc(t.statusLabel)}</span></span>
        </li>`).join('');
      return `<div class="b-card"><div class="b-head"><span class="b-name">${name(g)}</span><span class="b-count is-on">${items.length} điểm nghẽn</span></div><ul class="b-list">${li}</ul></div>`;
    }).join('');
    return `<div class="st-block">${head}<div class="b-grid">${cards}</div></div>`;
  }

  function streamHtml(s) {
    const id = sectionId(s);
    const flagged = s.excel?.flagged || 0;
    const rule = flagged ? `<span class="st rule" title="Task chưa đạt nguyên tắc War Room: 1 người chịu trách nhiệm, 1 deadline trong thời hạn War Room, 1 kết quả đầu ra">${icon('flag')}${flagged} task chưa đạt chuẩn War Room</span>` : '';
    const team = s.teams ? `${s.teams.groups.length} nhóm · ${s.teams.memberCount} nhân sự` : `${s.headcount} nhân sự`;
    return `<section class="stream tone-${s.tone}" id="${id}" aria-labelledby="${id}-t">
        <header class="st-head">
          <div class="st-id">
            <span class="code">${esc(codeLabel(s))}</span>
            <h3 id="${id}-t">${esc(s.name)}</h3>
            ${picHtml(s.pic, false)}
            <span class="st-team">${icon('users')}${esc(team)}${rule}</span>
          </div>
          <div class="st-progress"><span class="pct">${pctText(s.percent)}</span><span class="bar"><i style="width:${barWidth(s.percent)}"></i></span><span class="done">${s.counts.total ? `${s.counts.done}/${s.counts.total} task hoàn thành` : 'Chưa có task'}</span></div>
          ${metricsHtml(s)}
        </header>
        ${blockersHtml(s)}
        <div class="st-body">
          <div class="st-col"><h4>Nhóm</h4>${teamsTableHtml(s)}</div>
          <div class="st-col"><h4>Task</h4><div class="t-wrap" id="${id}-tasks">${tasksTableHtml(s)}</div></div>
        </div>
      </section>`;
  }

  function renderGrid(streams) {
    const grid = $('grid');
    if (!streams.length) {
      grid.innerHTML = '<div class="setup"><h2>Chưa có dòng tiền nào</h2><p class="hint">Mỗi sheet “Dòng tiền …” trong Google Sheet WR - MASTER TASK sẽ hiện thành 1 dòng tiền ở đây.</p></div>';
      return;
    }
    grid.innerHTML = streams.map(streamHtml).join('');
  }

  function renderOthers(list) {
    const el = $('unstaffed');
    if (!list || !list.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `${icon('info')}<span>Ngoài các dòng tiền, dự án còn: ${list.map((g) => esc(`${g.name} (${g.taskCount} task)`)).join(' · ')}</span>`;
  }

  // Nguyên tắc War Room (văn bản chỉ đạo): One owner · One deadline · One result · Strict time box · Zero waiting point · End-to-end.
  const ISSUE_TEXT = {
    timebox: (n) => `${n} task hạn vượt thời hạn War Room`,
    owner: (n) => `${n} task chưa có 1 người chịu trách nhiệm chính`,
    due: (n) => `${n} task thiếu deadline`,
    result: (n) => `${n} task chưa có tiêu chí đầu ra`,
    waiting: (n) => `${n} task đang chờ chưa có bước xử lý tiếp`,
    proof: (n) => `${n} task hoàn thành chưa có link bằng chứng`,
  };
  const ddmm = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

  function issuesHtml(issues, period) {
    const list = Object.entries(ISSUE_TEXT).filter(([k]) => issues?.[k]).map(([k, f]) => f(issues[k]));
    if (!list.length) return '';
    const range = period?.start && period?.end ? ` (War Room ${ddmm(period.start)}–${ddmm(period.end)})` : '';
    return `<div class="rules">${icon('flag')}<span><b>Chưa đạt nguyên tắc War Room${esc(range)}:</b> ${esc(list.join(' · '))}</span></div>`;
  }

  window.addEventListener('hashchange', () => scrollToStream(decodeURIComponent(location.hash.slice(1))));

  $('grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-metric]');
    const s = btn && S.data?.streams?.find((x) => x.id === btn.dataset.stream);
    if (!s) return;
    const key = btn.dataset.metric === filterOf(s) ? 'all' : btn.dataset.metric;
    if (key === 'all') S.filters.delete(s.id);
    else S.filters.set(s.id, key);
    const id = sectionId(s);
    document.querySelectorAll(`#${id} .metrics [data-metric]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === key)));
    const wrap = document.getElementById(`${id}-tasks`);
    if (!wrap) return;
    wrap.innerHTML = tasksTableHtml(s);
    // Màn hình hẹp: bảng task nằm dưới bảng nhóm -> cuộn tới để thấy ngay kết quả lọc.
    const r = wrap.getBoundingClientRect();
    if (key !== 'all' && (r.top > window.innerHeight - 120 || r.bottom < 0)) wrap.scrollIntoView({ block: 'start' });
  });

  // ---------- nạp task từ file Excel ----------
  const XL = { file: null, preview: null, busy: false };
  const MAX_XL_BYTES = 5 * 1024 * 1024;
  const dlg = $('xlDlg');

  function xlStatus(msg, kind) {
    const el = $('xlStatus');
    el.textContent = msg || '';
    el.dataset.kind = kind || '';
  }
  function xlBusy(on, msg) {
    XL.busy = on;
    $('xlSubmit').disabled = on || !XL.preview;
    $('xlFile').disabled = on;
    const sel = $('xlTarget');
    if (sel) sel.disabled = on;
    if (msg !== undefined) xlStatus(msg);
  }
  function resetXl() {
    XL.file = null;
    XL.preview = null;
    $('xlFile').value = '';
    $('xlFileName').textContent = 'Tối đa 5 MB';
    $('xlResult').innerHTML = '';
    xlStatus('');
    $('xlSubmit').disabled = true;
    $('xlSubmit').textContent = 'Đưa lên dashboard';
  }

  async function xlApi(method, url, body) {
    const init = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body instanceof Blob) {
      init.body = body;
      init.headers['Content-Type'] = 'application/octet-stream';
      init.headers['X-File-Name'] = encodeURIComponent(body.name || 'file.xlsx');
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, init);
    if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('Phiên đăng nhập đã hết hạn. Tải lại trang, đăng nhập rồi thử lại.');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /** Gửi file: xem trước (preview) hoặc lưu. */
  function xlSend(target, preview) {
    const q = new URLSearchParams();
    if (preview) q.set('preview', '1');
    if (target) q.set('target', target);
    return xlApi('POST', `/api/excel?${q}`, XL.file);
  }

  function xlTableHtml(tasks) {
    const rows = tasks.map((t) => `<tr>
        <td class="c-code">${esc(t.code || '')}</td>
        <td><span class="xl-subj">${esc(t.subject)}</span>${t.group ? `<span class="hint">${esc(t.group)}</span>` : ''}${t.flags.length ? `<span class="flags">${t.flags.map((f) => `<span class="flag">${icon('flag')}${esc(f.label)}</span>`).join('')}</span>` : ''}</td>
        <td>${esc(t.ownerName)}</td>
        <td class="c-due">${esc(t.dueLabel)}</td>
        <td><span class="badge ${t.status}">${esc(t.statusLabel)}</span></td>
      </tr>`).join('');
    return `<div class="xl-table"><table>
        <thead><tr><th>Mã</th><th>Nhiệm vụ</th><th>Phụ trách</th><th>Hạn</th><th>Trạng thái</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function xlSectionHtml(p, sec, single) {
    const meta = [`${sec.counts.total} task`, sec.pic && `PIC: ${sec.pic}`, sec.asOf && `kiểm soát ${sec.asOf}`, `sheet ${sec.sheet}`].filter(Boolean).join(' · ');
    let where;
    if (single) {
      const sel = sec.target.streamId || 'new';
      const options = p.choices.map((c) => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.fullName || c.name)}</option>`).join('')
        + `<option value="new"${sel === 'new' ? ' selected' : ''}>Tạo thẻ dòng tiền riêng từ file Excel</option>`;
      let note;
      if (sec.target.streamId) note = 'Tự nhận theo tên dòng tiền trong file — có thể chọn lại.';
      else if (p.choices.length) note = 'Không thấy dòng tiền cùng tên: chọn dòng tiền cần gắn, hoặc để thành thẻ riêng.';
      else note = 'Task sẽ hiện thành thẻ dòng tiền riêng.';
      where = `<label class="xl-field"><span>Gắn vào dòng tiền</span><select id="xlTarget">${options}</select><span class="hint">${esc(note)}</span></label>`;
    } else {
      where = `<span class="xl-where">${icon('arrowRight')}${sec.target.streamId ? `Thẻ “${esc(sec.target.streamName)}”` : 'Thẻ dòng tiền riêng'}</span>`;
    }
    let existing = '';
    if (sec.existing && sec.counts.total) {
      existing = `<div class="notice warn">${icon('alert')}<div class="grow">Dòng tiền này đã có <b>${sec.existing.count} task Excel</b> (file “${esc(sec.existing.fileName)}”, nạp bởi ${esc(sec.existing.uploadedBy)} lúc ${esc(clock(Date.parse(sec.existing.uploadedAt)))}). Đưa lên sẽ <b>thay toàn bộ</b> bằng file mới.</div></div>`;
    } else if (sec.existing) {
      existing = `<div class="notice warn">${icon('alert')}<div class="grow">Sheet trống: <b>${sec.existing.count} task Excel</b> đang có của dòng tiền này sẽ được gỡ khỏi dashboard.</div></div>`;
    }
    const body = sec.counts.total
      ? `<div class="stats">${statsHtml(sec.counts, null)}</div>${issuesHtml(sec.issues, p.warRoom)}${xlTableHtml(sec.tasks)}`
      : '<p class="hint">Sheet chưa có task.</p>';
    return `<section class="xl-sec${sec.counts.total ? '' : ' is-empty'}">
        <div class="xl-sum">
          <div class="xl-title">${sec.code ? `<span class="code">${esc(sec.code)}</span>` : ''}<b>${esc(sec.title)}</b><span class="hint">${esc(meta)}</span></div>
          ${where}
        </div>
        ${existing}
        ${body}
      </section>`;
  }

  function rosterPreviewHtml(p) {
    const groups = p.sections.reduce((n, x) => n + x.groups.length, 0);
    const members = p.sections.reduce((n, x) => n + x.memberCount, 0);
    const notes = [...p.warnings, ...(p.skipped.length ? [`Không gắn vào dashboard (không phải dòng tiền): ${p.skipped.join(', ')}.`] : [])];
    const head = `<div class="xl-overview"><b>Phân chia nhiệm vụ · ${p.sections.length} dòng tiền · ${groups} nhóm · ${members} nhân sự</b><span class="hint">Mỗi “Đội trưởng / Trưởng nhóm” là PIC của 1 nhóm. Nạp file này sẽ thay toàn bộ phân chia nhóm đang có${p.existing ? ` (${p.existing} dòng tiền)` : ''}; task vẫn lấy từ sheet WR - MASTER TASK.</span></div>`;
    const warn = notes.length ? `<div class="notice">${icon('info')}<div class="grow"><b>Lưu ý</b><ul>${notes.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>` : '';
    const secs = p.sections.map((x) => `<section class="xl-sec">
        <div class="xl-sum">
          <div class="xl-title">${x.code ? `<span class="code">${esc(x.code)}</span>` : ''}<b>${esc(x.raw)}</b><span class="hint">${x.groups.length} nhóm · ${x.memberCount} nhân sự</span></div>
          <span class="xl-where">${icon('arrowRight')}${x.target.streamId ? `Thẻ “${esc(x.target.streamName)}”` : 'Tạo thẻ dòng tiền mới'}</span>
        </div>
        <div class="xl-table"><table>
          <thead><tr><th>Nhóm</th><th>PIC</th><th>Nhiệm vụ chính</th><th>Thành viên</th></tr></thead>
          <tbody>${x.groups.map((g, i) => `<tr><td class="c-code">Nhóm ${i + 1}</td><td>${esc(g.lead?.name || 'Chưa chốt PIC')}</td><td>${esc(g.mainTask || 'Mỗi người một nhiệm vụ')}</td><td>${esc(g.members.filter((m) => !m.placeholder).map((m) => m.name).join(', '))}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>`).join('');
    return head + warn + secs;
  }

  function renderXlPreview() {
    const p = XL.preview;
    if (p.kind === 'roster') {
      $('xlResult').innerHTML = rosterPreviewHtml(p);
      return;
    }
    const single = p.sections.length === 1;
    const total = p.sections.reduce((n, s) => n + s.counts.total, 0);
    const flagged = p.sections.reduce((n, s) => n + s.tasks.filter((t) => t.flags.length).length, 0);
    const head = single ? '' : `<div class="xl-overview"><b>${p.sections.length} dòng tiền · ${total} task</b><span class="hint">Mỗi sheet “Dòng tiền …” được gắn vào thẻ dòng tiền cùng tên.${flagged ? ` ${flagged} task chưa đạt nguyên tắc War Room sẽ được đánh dấu để PIC chuẩn hoá.` : ''}</span></div>`;
    const warnings = p.warnings.length ? `<div class="notice">${icon('info')}<div class="grow"><b>Lưu ý khi đọc file</b><ul>${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>` : '';
    $('xlResult').innerHTML = `${head}${warnings}${p.sections.map((sec) => xlSectionHtml(p, sec, single)).join('')}`;
    $('xlTarget')?.addEventListener('change', (e) => xlPreview(e.target.value));
  }

  async function xlPreview(target) {
    xlBusy(true, 'Đang đọc file…');
    try {
      XL.preview = await xlSend(target, true);
      renderXlPreview();
      $('xlSubmit').textContent = XL.preview.kind === 'roster' ? 'Nạp phân chia nhóm' : 'Đưa lên dashboard';
      xlStatus('');
    } catch (e) {
      XL.preview = null;
      $('xlResult').innerHTML = `<div class="notice err">${icon('alert')}<div class="grow">${esc(e.message || e)}</div></div>`;
      xlStatus('');
    } finally {
      xlBusy(false);
    }
  }

  function pickXl(file) {
    if (!file || XL.busy) return;
    resetXl();
    if (!/\.xlsx$/i.test(file.name)) { xlStatus('Chỉ nhận file Excel .xlsx.', 'err'); return; }
    if (file.size > MAX_XL_BYTES) { xlStatus('File lớn hơn 5 MB.', 'err'); return; }
    XL.file = file;
    $('xlFileName').textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB · bấm để chọn file khác`;
    xlPreview('');
  }

  function renderXlList() {
    const list = S.data?.excelImports || [];
    const listHtml = list.length
      ? `<div class="xl-list"><h3>Đã nạp lên dashboard</h3><ul>${list.map((i) => `<li>
          <span class="grow"><b>${esc(i.title)}</b> → ${i.attached ? `thẻ “${esc(i.streamName)}”` : 'thẻ riêng'}
            <span class="hint">${esc([`${i.count} task`, i.fileName, i.uploadedBy, i.uploadedAt && clock(Date.parse(i.uploadedAt))].filter(Boolean).join(' · '))}</span></span>
          <button type="button" class="linkbtn danger" data-xl-remove="${esc(i.key)}" data-title="${esc(i.title)}" data-count="${i.count}">Gỡ khỏi dashboard</button>
        </li>`).join('')}</ul></div>`
      : '';
    const teams = S.data?.excelTeams || [];
    const teamsHtml = teams.length
      ? `<div class="xl-list"><h3>Phân chia nhóm</h3><ul><li>
          <span class="grow"><b>${esc((teams[0].fileName || 'File phân chia').replace(/\.xlsx$/i, ''))}</b>
            <span class="hint">${esc([`${teams.length} dòng tiền`, `${teams.reduce((n, x) => n + x.groups, 0)} nhóm`, teams[0].uploadedBy, teams[0].uploadedAt && clock(Date.parse(teams[0].uploadedAt))].filter(Boolean).join(' · '))}</span></span>
          <button type="button" class="linkbtn danger" data-teams-remove>Gỡ phân chia nhóm</button>
        </li></ul></div>`
      : '';
    $('xlList').innerHTML = teamsHtml + listHtml;
  }

  $('xlBtn').addEventListener('click', () => {
    resetXl();
    renderXlList();
    dlg.showModal();
  });
  $('xlFile').addEventListener('change', () => pickXl($('xlFile').files[0]));
  const drop = $('xlDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    pickXl(e.dataTransfer?.files?.[0]);
  });

  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg || e.target.closest('[data-xl-close]')) { if (!XL.busy) dlg.close(); return; }
    if (e.target.closest('[data-teams-remove]') && !XL.busy) {
      if (!confirm('Gỡ phân chia nhóm khỏi dashboard? Task không bị ảnh hưởng.')) return;
      xlBusy(true, 'Đang gỡ…');
      try {
        const r = await xlApi('DELETE', '/api/excel/teams');
        await load();
        xlStatus(`Đã gỡ phân chia nhóm của ${r.removed} dòng tiền.`, 'ok');
      } catch (err) {
        xlStatus(`Không gỡ được: ${err.message || err}`, 'err');
      } finally {
        xlBusy(false);
      }
      return;
    }
    const rm = e.target.closest('[data-xl-remove]');
    if (!rm || XL.busy) return;
    if (!confirm(`Gỡ ${rm.dataset.count} task Excel của “${rm.dataset.title}” khỏi dashboard?`)) return;
    xlBusy(true, 'Đang gỡ…');
    try {
      await xlApi('DELETE', `/api/excel?key=${encodeURIComponent(rm.dataset.xlRemove)}`);
      await load();
      xlStatus(`Đã gỡ task Excel của “${rm.dataset.title}”.`, 'ok');
    } catch (err) {
      xlStatus(`Không gỡ được: ${err.message || err}`, 'err');
    } finally {
      xlBusy(false);
    }
  });
  dlg.addEventListener('cancel', (e) => { if (XL.busy) e.preventDefault(); });

  $('xlSubmit').addEventListener('click', async () => {
    if (!XL.preview || XL.busy) return;
    xlBusy(true, 'Đang đưa lên dashboard…');
    try {
      const r = await xlSend($('xlTarget')?.value || '', false);
      if (r.kind === 'roster') {
        resetXl();
        await load();
        xlStatus(`Đã nạp phân chia nhóm cho ${r.results.length} dòng tiền (${r.results.reduce((n, x) => n + x.groups, 0)} nhóm).`, 'ok');
        return;
      }
      const added = r.results.filter((x) => !x.removed);
      if (added.length === 1 && r.results.length === 1) {
        // 1 dòng tiền: đóng hộp thoại và cuộn tới dòng tiền vừa nạp.
        xlBusy(false, '');
        dlg.close();
        S.scrollTo = added[0].key;
        await load();
        return;
      }
      resetXl();
      await load();
      const removed = r.results.length - added.length;
      xlStatus(`Đã nạp ${r.total} task vào ${added.length} dòng tiền${removed ? `, gỡ task Excel của ${removed} dòng tiền có sheet trống` : ''}.`, 'ok');
    } catch (e) {
      xlStatus(`Chưa đưa lên được: ${e.message || e}`, 'err');
    } finally {
      xlBusy(false);
    }
  });

  load();
})();

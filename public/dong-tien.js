// Dashboard "Tiến độ dòng tiền" (v4). Dữ liệu: GET /api/streams (CT Worksuite + task từ sheet WR - MASTER TASK).
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

  const FILTERS = [
    ['all', 'Tất cả'],
    ['doing', 'Đang làm'],
    ['waiting', 'Đang chờ'],
    ['review', 'Chờ duyệt'],
    ['overdue', 'Quá hạn'],
    ['todo', 'Chưa bắt đầu'],
    ['done', 'Hoàn thành'],
  ];
  const PEOPLE_PAGE = 6;

  const S = {
    data: null,
    openId: null,
    filter: 'all',
    expanded: new Map(), // streamId -> Set(personKey)
    showAll: false,
    lastFocus: null,
    timer: null,
    loading: false,
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
      $('gridTitle').textContent = 'Chưa có dữ liệu từ Worksuite';
      $('grid').innerHTML = '';
      return;
    }
    const n = d.streams.length;
    $('pageTitle').textContent = n ? `Tiến độ ${n} dòng tiền` : 'Tiến độ dòng tiền';
    $('navCount').textContent = String(n);
    $('gridTitle').textContent = `${n} dòng tiền chính`;
    const fromExcel = d.excelImports?.length ? ' và file Excel đã nạp' : '';
    if (d.project) {
      $('pageSub').textContent = `Task và tiến độ của từng người trong dự án ${d.project.name} trên CT Worksuite${fromExcel} · cập nhật tự động`;
      if (safeUrl(d.project.url)) $('openWs').href = d.project.url;
    } else if (fromExcel) {
      $('pageSub').textContent = 'Task và tiến độ của từng người theo sheet WR - MASTER TASK · War Room 21–25/11/2026';
    }
    document.title = `Tiến độ ${n} dòng tiền · War Room`;
    if (d.worksuiteUrl && !d.project?.url) $('openWs').href = safeUrl(d.worksuiteUrl) || $('openWs').href;
    $('summary').hidden = false;
    document.querySelector('.section-head .legend').hidden = false;
    document.querySelector('.section-head .hint').hidden = false;
    renderSummary(d.summary);
    renderGrid(d.streams);
    renderOthers(d.otherGroups);
    if (S.openAfterLoad && stream(S.openAfterLoad)) {
      // Vừa nạp file Excel: mở luôn dòng tiền vừa nạp.
      const id = S.openAfterLoad;
      S.openAfterLoad = null;
      S.expanded.delete(id);
      openDrawer(id, false);
    } else if (S.openId) {
      if (stream(S.openId)) renderDrawer();
      else closeDrawer(false);
    } else {
      const code = decodeURIComponent(location.hash.slice(1));
      const target = code && d.streams.find((s) => hashKey(s) === code || s.id === code);
      if (target) openDrawer(target.id, false);
    }
  }

  function renderSync() {
    const d = S.data;
    const el = $('sync');
    let state = 'live';
    let label;
    // Giờ đọc sheet gần nhất (đồng bộ tự động); chưa có thì lấy giờ nạp file gần nhất.
    const sheetAt = Date.parse(d.sheetSync?.checkedAt || '') || Math.max(0, ...(d.excelImports || []).map((i) => Date.parse(i.uploadedAt) || 0));
    if (d.mode === 'unconfigured' && d.streams?.length) {
      if (d.sheetSync?.error) state = 'stale';
      label = sheetAt ? `Google Sheet WR - MASTER TASK · cập nhật ${clock(sheetAt).slice(6)}` : 'Google Sheet WR - MASTER TASK';
    }
    else if (d.mode === 'unconfigured') { state = 'error'; label = 'Chưa kết nối Worksuite'; }
    else if (d.error && !d.syncedAt) { state = 'error'; label = 'Không đọc được Worksuite'; }
    else if (d.stale || d.error) { state = 'stale'; label = `Dữ liệu Worksuite lúc ${clock(d.syncedAt)}`; }
    else label = `Đã đồng bộ Worksuite · ${ago(d.syncedAt)}`;
    el.dataset.state = state;
    $('syncText').textContent = label;
  }

  function renderNotices() {
    const d = S.data;
    const out = [];
    if (d.error) {
      out.push(`<div class="notice err">${icon('alert')}<div class="grow"><b>Không đọc được CT Worksuite.</b> ${esc(d.error)}${d.syncedAt ? ` Đang hiển thị dữ liệu lúc ${clock(d.syncedAt)}.` : ''}${d.excelImports?.length ? ' Task nạp từ Excel vẫn hiển thị.' : ''}</div></div>`);
    }
    if (d.sheetSync?.error) {
      out.push(`<div class="notice warn">${icon('alert')}<div class="grow"><b>Chưa đọc được Google Sheet WR - MASTER TASK.</b> ${esc(d.sheetSync.error)} Đang hiển thị dữ liệu lần đọc trước.</div></div>`);
    }
    if (d.warnings && d.warnings.length) {
      out.push(`<div class="notice">${icon('info')}<div class="grow"><b>Lưu ý cấu hình Worksuite</b><ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>`);
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
    $('gridTitle').textContent = 'Chưa kết nối CT Worksuite';
    $('grid').innerHTML = `<div class="setup" style="grid-column:1/-1">
      <h2>Cần kết nối CT Worksuite để hiển thị tiến độ thật</h2>
      <ol>
        <li>Dùng 1 tài khoản Worksuite chỉ có quyền <b>xem</b> Project, Task, Employee.</li>
        <li>Đặt biến bí mật <code>WORKSUITE_API_KEY</code> + <code>WORKSUITE_API_SECRET</code> (mục API Access › Generate Keys), hoặc <code>WORKSUITE_USERNAME</code> + <code>WORKSUITE_PASSWORD</code> của tài khoản đó, cho Worker (Cloudflare › Settings › Variables and secrets) hoặc trong file <code>.env</code>.</li>
        <li>Dòng tiền được đọc từ dự án <b>WAR ROOM</b>: mỗi task cấp cao có tiêu đề “Dòng tiền …” là 1 dòng tiền, người thực hiện task đó là PIC. Có thể chỉ định dự án bằng <code>WORKSUITE_PROJECT=PROJ-0536</code>.</li>
      </ol>
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
      return `<span class="st todo"><i></i>Chưa có task con</span>${ownTxt}`;
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

  function cardHtml(s) {
    const staff = s.people.filter((p) => !p.unassigned);
    const avatars = staff.slice(0, 4).map((p) => `<span class="av s" title="${esc(p.name)}">${esc(p.initials)}</span>`).join('');
    const more = staff.length > 4 ? `<span class="av s more">+${staff.length - 4}</span>` : '';
    const open = S.openId === s.id;
    const flagged = s.excel?.flagged || 0;
    const rule = flagged ? `<span class="st rule" title="Task trong file Excel chưa đạt nguyên tắc War Room: 1 người chịu trách nhiệm, 1 deadline trong thời hạn War Room, 1 kết quả đầu ra">${icon('flag')}${flagged} task chưa đạt chuẩn War Room</span>` : '';
    return `<button type="button" class="card tone-${s.tone}" data-id="${esc(s.id)}" aria-haspopup="dialog" aria-expanded="${open}"
        aria-label="${esc(`Dòng tiền ${s.name}: ${pctText(s.percent)}, ${s.counts.overdue} task quá hạn. Xem task từng người`)}">
      <span class="card-head"><span class="titles"><span class="code">${esc(codeLabel(s))}${s.excel ? `<span class="src-tag">Excel</span>` : ''}</span><span class="name">${esc(s.name)}</span></span><span class="go">${icon('chevronRight')}</span></span>
      ${picHtml(s.pic, false)}
      <span class="prog"><span class="nums"><span class="pct">${pctText(s.percent)}</span><span class="done">${s.counts.done}/${s.counts.total} task hoàn thành</span></span><span class="bar"><i style="width:${barWidth(s.percent)}"></i></span></span>
      <span class="stats">${statsHtml(s.counts, s.own)}${rule}</span>
      <span class="divider"></span>
      <span class="foot"><span class="people">${icon('users')}${s.headcount} nhân sự<span class="stack">${avatars}${more}</span></span><span class="more-link">Xem task ${icon('arrowRight')}</span></span>
    </button>`;
  }

  function renderGrid(streams) {
    const grid = $('grid');
    if (!streams.length) {
      grid.innerHTML = `<div class="setup" style="grid-column:1/-1"><h2>Chưa có dòng tiền nào có nhân sự</h2><p class="hint">Khi project dòng tiền trên Worksuite có PIC hoặc task được giao, dòng tiền sẽ hiện ở đây.</p></div>`;
      return;
    }
    grid.innerHTML = streams.map(cardHtml).join('');
  }

  function renderOthers(list) {
    const el = $('unstaffed');
    if (!list || !list.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `${icon('info')}<span>Ngoài các dòng tiền, dự án còn: ${list.map((g) => esc(`${g.name} (${g.taskCount} task)`)).join(' · ')}</span>`;
  }

  $('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openDrawer(card.dataset.id, true);
  });

  // ---------- drawer ----------
  function defaultExpanded(s) {
    const set = new Set(s.people.filter((p) => p.counts.overdue > 0 || p.counts.waiting > 0 || p.isPic || p.unassigned).map((p) => p.key));
    if (!set.size && s.people[0]) set.add(s.people[0].key);
    return set;
  }

  function openDrawer(id, fromUser) {
    const s = stream(id);
    if (!s) return;
    if (fromUser) S.lastFocus = document.activeElement;
    S.openId = id;
    S.filter = 'all';
    S.showAll = false;
    if (!S.expanded.has(id)) S.expanded.set(id, defaultExpanded(s));
    $('scrim').hidden = false;
    $('drawer').hidden = false;
    document.body.classList.add('drawer-open');
    history.replaceState(null, '', `${location.pathname}${location.search}#${encodeURIComponent(hashKey(s))}`);
    renderDrawer();
    document.querySelectorAll('.card').forEach((c) => c.setAttribute('aria-expanded', String(c.dataset.id === id)));
    $('drawer').querySelector('[data-close]')?.focus();
  }

  function closeDrawer(restoreFocus = true) {
    const closedId = S.openId;
    S.openId = null;
    $('scrim').hidden = true;
    $('drawer').hidden = true;
    $('drawer').innerHTML = '';
    document.body.classList.remove('drawer-open');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    document.querySelectorAll('.card').forEach((c) => c.setAttribute('aria-expanded', 'false'));
    if (restoreFocus) {
      // Thẻ có thể đã được vẽ lại sau lần tự làm mới — tìm lại theo id.
      const target = S.lastFocus && document.contains(S.lastFocus)
        ? S.lastFocus
        : [...document.querySelectorAll('.card')].find((c) => c.dataset.id === closedId);
      target?.focus();
    }
    S.lastFocus = null;
  }

  function taskHtml(t) {
    const subject = safeUrl(t.url)
      ? `<a class="subject" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.subject)}</a>`
      : `<span class="subject">${esc(t.subject)}</span>`;
    const tone = t.status === 'done' ? 'success' : t.status === 'overdue' ? 'danger' : 'accent';
    let extra = '';
    if (t.source === 'excel') {
      const meta = [t.code, t.group, t.priority].filter(Boolean).map(esc);
      if (t.excelStatus && t.excelStatus !== t.statusLabel) meta.push(`File ghi: ${esc(t.excelStatus)}`);
      extra = `<span class="t-meta">${meta.join(' · ')}<span class="src-tag">Excel</span></span>`;
    }
    const lines = [];
    if (t.next) lines.push(`<span class="t-line">${icon('next')}Bước tiếp theo: ${esc(t.next)}</span>`);
    if (t.support) lines.push(`<span class="t-line">${icon('users')}Phối hợp: ${esc(t.support)}</span>`);
    if (t.output) lines.push(`<span class="t-line muted">${icon('check')}Đầu ra cần có: ${esc(t.output)}</span>`);
    const flags = t.flags?.length ? `<span class="flags">${t.flags.map((f) => `<span class="flag">${icon('flag')}${esc(f.label)}</span>`).join('')}</span>` : '';
    return `<div class="t-row${t.status === 'overdue' ? ' is-overdue' : ''}">
      <div class="t-info">${subject}${extra}<span class="due">${icon('calendar')}${esc(t.dueLabel)}</span>${t.blocker ? `<span class="blocker">${icon('alert')}${esc(t.blockerLabel || 'Lý do chờ')}: ${esc(t.blocker)}</span>` : ''}${lines.join('')}${flags}</div>
      <span class="badge ${t.status}">${esc(t.statusLabel)}</span>
      <span class="mini"><span class="bar tone-${tone}"><i style="width:${barWidth(t.progress)}"></i></span><span class="pct">${t.progress}%</span></span>
    </div>`;
  }

  function memberHtml(s, p, tasks, open) {
    const role = p.isPic ? (p.title || '') : p.title;
    return `<div class="member${open ? ' open' : ''}${p.unassigned ? ' unassigned' : ''}">
      <button type="button" class="m-row" data-person="${esc(p.key)}" aria-expanded="${open}">
        <span class="chev">${icon(open ? 'chevronDown' : 'chevronRight')}</span>
        <span class="av">${esc(p.initials)}</span>
        <span class="info"><span class="nm">${esc(p.name)}${p.isPic ? '<span class="tag">PIC</span>' : ''}</span>${role ? `<span class="role">${esc(role)}</span>` : ''}</span>
        ${p.counts.overdue ? `<span class="tag alert">${p.counts.overdue} quá hạn</span>` : ''}
        ${p.counts.waiting ? `<span class="tag waiting">${p.counts.waiting} đang chờ</span>` : ''}
        <span class="cnt">${p.counts.total} task</span>
        <span class="mini"><span class="bar tone-${p.tone}"><i style="width:${barWidth(p.percent)}"></i></span><span class="pct">${pctText(p.percent)}</span></span>
      </button>
      ${open ? `<div class="tasks">${tasks.length ? tasks.map(taskHtml).join('') : '<div class="t-empty">Chưa có task trong dòng tiền này.</div>'}</div>` : ''}
    </div>`;
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

  function excelInfoHtml(s) {
    const x = s.excel;
    if (!x) return '';
    const parts = [`${x.count} task từ file “${x.fileName}”`];
    if (x.uploadedBy) parts.push(`nạp bởi ${x.uploadedBy}`);
    if (x.uploadedAt) parts.push(`lúc ${clock(Date.parse(x.uploadedAt))}`);
    if (x.asOf) parts.push(`số liệu kiểm soát ${x.asOf}`);
    return `<div class="own src">${icon('sheet')}<span>${esc(parts.join(' · '))}</span></div>${issuesHtml(x.issues, S.data?.warRoom)}`;
  }

  function renderDrawer() {
    const s = stream(S.openId);
    if (!s) return;
    const drawer = $('drawer');
    const scrollTop = drawer.querySelector('.d-body')?.scrollTop || 0;
    const expanded = S.expanded.get(s.id) || new Set();
    const f = S.filter;
    const visible = s.people
      .map((p) => ({ p, tasks: f === 'all' ? p.tasks : p.tasks.filter((t) => t.status === f) }))
      .filter(({ tasks }) => f === 'all' || tasks.length);
    const shown = S.showAll ? visible : visible.slice(0, PEOPLE_PAGE);
    const hiddenCount = visible.length - shown.length;
    const allOpen = shown.length > 0 && shown.every(({ p }) => f !== 'all' || expanded.has(p.key));
    const tabs = FILTERS.filter(([k]) => k === 'all' || s.counts[k] > 0)
      .map(([k, label]) => `<button type="button" class="tab" data-filter="${k}" aria-pressed="${f === k}">${label} <span class="count">${k === 'all' ? s.counts.total : s.counts[k]}</span></button>`)
      .join('');
    const metaParts = [`${s.counts.done}/${s.counts.total} task hoàn thành`, `${s.headcount} nhân sự`];
    if (s.counts.overdue) metaParts.push(`${s.counts.overdue} task quá hạn`);
    if (s.counts.waiting) metaParts.push(`${s.counts.waiting} task đang chờ`);
    const wsLink = safeUrl(s.url) ? `<a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon('externalLink')}Mở trong Worksuite</a>` : '';

    drawer.innerHTML = `
      <div class="d-head tone-${s.tone}">
        <div class="d-top">
          <div><div class="code">${s.code ? `${esc(s.code)} · ` : ''}Dòng tiền</div><h2 id="dTitle">${esc(s.name)}</h2></div>
          <div class="d-actions">${wsLink}<button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('x')}</button></div>
        </div>
        ${picHtml(s.pic, true)}
        ${s.own ? `<div class="own"><span class="badge ${s.own.status}">${esc(s.own.statusLabel)}</span><span>Task nhóm trên Worksuite · ${esc(s.own.dueLabel)}</span>${s.own.blocker ? `<span class="blocker">${icon('alert')}Lý do chờ: ${esc(s.own.blocker)}</span>` : ''}</div>` : ''}
        ${excelInfoHtml(s)}
        <div class="d-prog"><span class="value">${pctText(s.percent)}</span><div class="col"><div class="bar"><i style="width:${barWidth(s.percent)}"></i></div><span class="meta">${esc(metaParts.join(' · '))}</span></div></div>
      </div>
      <div class="tabs" role="group" aria-label="Lọc theo trạng thái task">${tabs}</div>
      <div class="d-body">
        <div class="list-head"><span>${visible.length} nhân sự${f === 'all' ? ' · người có task quá hạn xếp trước' : ` có task “${esc(FILTERS.find(([k]) => k === f)[1].toLowerCase())}”`}</span>
          ${f === 'all' && shown.length ? `<button type="button" class="linkbtn" data-toggle-all>${allOpen ? 'Thu gọn tất cả' : 'Mở tất cả'}</button>` : ''}</div>
        <div class="members">${shown.map(({ p, tasks }) => memberHtml(s, p, tasks, f !== 'all' || expanded.has(p.key))).join('') || `<div class="no-match">${f === 'all' ? `Dòng tiền này chưa có task con trên Worksuite. Thêm task con (giao người, hạn) dưới task nhóm “${esc(s.fullName)}” để theo dõi tiến độ.` : 'Không có task nào ở trạng thái này.'}</div>`}</div>
        ${hiddenCount > 0 ? `<button type="button" class="show-more" data-show-all>Xem thêm ${hiddenCount} nhân sự ${icon('chevronDown')}</button>` : ''}
      </div>`;
    const body = drawer.querySelector('.d-body');
    if (body) body.scrollTop = scrollTop;
  }

  $('drawer').addEventListener('click', (e) => {
    const s = stream(S.openId);
    if (!s) return;
    if (e.target.closest('[data-close]')) { closeDrawer(); return; }
    const filterBtn = e.target.closest('[data-filter]');
    if (filterBtn) { S.filter = filterBtn.dataset.filter; S.showAll = false; renderDrawer(); $('drawer').querySelector(`[data-filter="${S.filter}"]`)?.focus(); return; }
    if (e.target.closest('[data-show-all]')) { S.showAll = true; renderDrawer(); return; }
    const expanded = S.expanded.get(s.id);
    if (e.target.closest('[data-toggle-all]')) {
      const shown = (S.showAll ? s.people : s.people.slice(0, PEOPLE_PAGE)).map((p) => p.key);
      const allOpen = shown.every((k) => expanded.has(k));
      shown.forEach((k) => (allOpen ? expanded.delete(k) : expanded.add(k)));
      renderDrawer();
      return;
    }
    const row = e.target.closest('[data-person]');
    if (row && S.filter === 'all') {
      const key = row.dataset.person;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      renderDrawer();
      $('drawer').querySelector(`[data-person="${CSS.escape(key)}"]`)?.focus();
    }
  });

  $('scrim').addEventListener('click', () => closeDrawer());
  document.addEventListener('keydown', (e) => {
    if (!S.openId) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key === 'Tab') {
      // Giữ focus trong panel khi đang mở.
      const items = [...$('drawer').querySelectorAll('a[href], button:not([disabled])')].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', () => {
    const code = decodeURIComponent(location.hash.slice(1));
    const target = code && S.data?.streams?.find((s) => hashKey(s) === code || s.id === code);
    if (target && target.id !== S.openId) openDrawer(target.id, false);
    else if (!code && S.openId) closeDrawer(false);
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
  }

  async function xlSend(target, preview) {
    const q = new URLSearchParams();
    if (preview) q.set('preview', '1');
    if (target) q.set('target', target);
    const res = await fetch(`/api/excel?${q}`, {
      method: 'POST',
      body: XL.file,
      headers: { 'X-File-Name': encodeURIComponent(XL.file.name), 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('Phiên đăng nhập đã hết hạn. Tải lại trang, đăng nhập rồi thử lại.');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
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
      else if (p.choices.length) note = 'Không thấy dòng tiền cùng tên trên Worksuite: chọn dòng tiền cần gắn, hoặc để thành thẻ riêng.';
      else note = `Chưa đọc được danh sách dòng tiền từ Worksuite${p.worksuiteError ? ` (${p.worksuiteError})` : ''}: task sẽ hiện thành thẻ riêng.`;
      where = `<label class="xl-field"><span>Gắn vào dòng tiền</span><select id="xlTarget">${options}</select><span class="hint">${esc(note)}</span></label>`;
    } else {
      where = `<span class="xl-where">${icon('arrowRight')}${sec.target.streamId ? `Thẻ “${esc(sec.target.streamName)}”` : 'Thẻ dòng tiền riêng (không thấy tên này trên Worksuite)'}</span>`;
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

  function renderXlPreview() {
    const p = XL.preview;
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
    $('xlList').innerHTML = list.length
      ? `<div class="xl-list"><h3>Đã nạp lên dashboard</h3><ul>${list.map((i) => `<li>
          <span class="grow"><b>${esc(i.title)}</b> → ${i.attached ? `thẻ “${esc(i.streamName)}”` : 'thẻ riêng'}
            <span class="hint">${esc([`${i.count} task`, i.fileName, i.uploadedBy, i.uploadedAt && clock(Date.parse(i.uploadedAt))].filter(Boolean).join(' · '))}</span></span>
          <button type="button" class="linkbtn danger" data-xl-remove="${esc(i.key)}" data-title="${esc(i.title)}" data-count="${i.count}">Gỡ khỏi dashboard</button>
        </li>`).join('')}</ul></div>`
      : '';
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
    const rm = e.target.closest('[data-xl-remove]');
    if (!rm || XL.busy) return;
    if (!confirm(`Gỡ ${rm.dataset.count} task Excel của “${rm.dataset.title}” khỏi dashboard?`)) return;
    xlBusy(true, 'Đang gỡ…');
    try {
      const res = await fetch(`/api/excel?key=${encodeURIComponent(rm.dataset.xlRemove)}`, { method: 'DELETE', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (S.openId === rm.dataset.xlRemove) closeDrawer(false);
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
      const added = r.results.filter((x) => !x.removed);
      if (added.length === 1 && r.results.length === 1) {
        // 1 dòng tiền: đóng hộp thoại và mở luôn dòng tiền vừa nạp.
        xlBusy(false, '');
        dlg.close();
        if (S.openId) closeDrawer(false);
        S.openAfterLoad = added[0].key;
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

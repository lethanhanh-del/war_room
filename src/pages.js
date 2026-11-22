// Trang HTML do Worker trả về: đăng nhập, đổi mật khẩu, và phần chèn vào dashboard.
import { esc } from "./http.js";

// Style War Room v5 "Night Ops" (docs/STYLE_GUIDE.md): nền gần đen, lime cho nút chính / điều hướng.
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&display=swap" />`;

const CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #060b15 radial-gradient(circle at 0% 0%, rgba(76, 195, 255, .05), transparent 40%) fixed; font-family: 'Roboto', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif; color: #eef2f8; -webkit-font-smoothing: antialiased; }
  form { width: min(380px, calc(100vw - 32px)); background: #0d1626; border: 1px solid #1e2b42; border-radius: 12px; padding: 28px; display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: #4cc3ff; }
  p { margin: 0; font-size: 13px; color: #7e8aa0; }
  p b { color: #eef2f8; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #7e8aa0; }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #2b3c58; border-radius: 8px; font-family: inherit; background: #121d30; color: #eef2f8; text-transform: none; letter-spacing: 0; }
  input:focus { outline: 2px solid #4cc3ff; outline-offset: 1px; }
  button { margin-top: 4px; width: 100%; padding: 10px; font-size: 15px; font-weight: 700; color: #04121e; background: #4cc3ff; border: 0; border-radius: 8px; cursor: pointer; font-family: inherit; }
  button:hover { filter: brightness(1.08); }
  .err { color: #ff6b5e; font-size: 13px; font-weight: 600; }
  .info { color: #ffc24d; background: rgba(255, 194, 77, .12); border: 1px solid rgba(255, 194, 77, .5); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
  a { color: #4cc3ff; font-size: 13px; }
`;

function page(title, body, status = 200) {
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
${FONTS}
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export function loginPage(error = "", username = "") {
  return page(
    "WAR ROOM – Đăng nhập",
    `<form method="POST" action="/login">
  <h1>WAR ROOM – 10 DÒNG TIỀN</h1>
  <p>Đăng nhập bằng tài khoản cá nhân. Tên đăng nhập là chữ cái đầu của họ, tên đệm và tên, viết liền không dấu (VD: Võ Đào Huy Hoàng → vdhhoang).</p>
  <label>Tên đăng nhập<input name="username" value="${esc(username)}" autocomplete="username" autocapitalize="none" spellcheck="false" ${username ? "" : "autofocus"} required /></label>
  <label>Mật khẩu<input type="password" name="password" autocomplete="current-password" ${username ? "autofocus" : ""} required /></label>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <button type="submit">Đăng nhập</button>
</form>`,
    401
  );
}

export function changePasswordPage(user, { error = "", info = "", forced = false } = {}) {
  if (user.role === "admin") {
    return page(
      "Đổi mật khẩu",
      `<form onsubmit="return false"><h1>Tài khoản quản trị</h1><div class="info">${esc(info)}</div><a href="/">← Về Dashboard</a></form>`
    );
  }
  return page(
    "Đổi mật khẩu",
    `<form method="POST" action="/doi-mat-khau">
  <h1>Đổi mật khẩu</h1>
  <p>Xin chào <b>${esc(user.fullName)}</b> (${esc(user.username)}).</p>
  ${forced ? `<div class="info">Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được reset. Vui lòng đặt mật khẩu mới để tiếp tục.</div>` : ""}
  <label>Mật khẩu hiện tại<input type="password" name="current" autocomplete="current-password" required autofocus /></label>
  <label>Mật khẩu mới (ít nhất 8 ký tự)<input type="password" name="next" autocomplete="new-password" minlength="8" required /></label>
  <label>Nhập lại mật khẩu mới<input type="password" name="confirm" autocomplete="new-password" minlength="8" required /></label>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <button type="submit">Lưu mật khẩu mới</button>
  ${forced ? `<a href="/logout">Đăng xuất</a>` : `<a href="/">← Về Dashboard</a>`}
</form>`
  );
}

// Thanh điều hướng chung của 4 trang chính (và trang Quản trị), chèn vào đầu <body> lúc phục vụ (HTMLRewriter, src/index.js)
// để không phải sửa từng trang và không mất khi ai đó ghi đè file HTML. Style Night Ops (docs/STYLE_GUIDE.md), màu ghi
// thẳng vì mỗi trang đặt tên biến màu khác nhau. Màn hình TV (/kpi ?tv=1, /lich-truc chế độ TV) ẩn thanh này.
export const NAV_PAGES = [
  ["/kpi", "KPI & kết quả"],
  ["/lich-truc", "Lịch trực 24/7"],
  ["/lich", "Hẹn lịch BOD"],
  ["/waiting-point", "Điểm nghẽn"],
  ["/no-waiting-point", "Zero Waiting Point"],
];

export const WP_SEC_PER_PERSON = 10;
export const BOOKING_ROTATE_SEC = 30;

/** Thời lượng hiển thị Điểm nghẽn (/waiting-point, giây): 0 người -> 0s (bỏ qua), mỗi người +10s. */
export function waitingPointRotateSec(peopleCount) {
  const n = Math.max(0, Math.floor(Number(peopleCount) || 0));
  return n * WP_SEC_PER_PERSON;
}

// Danh sách 3 tab hỗ trợ tự động chuyển luân phiên trên màn hình War Room:
// - KPI & kết quả: 3 phút (180s)
// - Điểm nghẽn (/waiting-point): 0 người -> bỏ qua / rời ngay về KPI; có người -> mỗi người +10s.
// - Hẹn lịch BOD: không có lịch họp sắp tới -> bỏ qua; có người đặt lịch họp -> tự bật lên 30s cho cấp trên xem.
export const AUTO_ROTATE_TABS = [
  { href: "/kpi", label: "KPI & kết quả", sec: 180 },
  { href: "/waiting-point", label: "Điểm nghẽn", sec: 0, secPerPerson: WP_SEC_PER_PERSON },
  { href: "/lich", label: "Hẹn lịch BOD", sec: BOOKING_ROTATE_SEC, whenHasData: true },
];

/** Tính tab kế tiếp khi bật tự động chuyển tab; tự bỏ qua Điểm nghẽn nếu 0 người và Hẹn lịch BOD nếu 0 lịch họp sắp tới. */
export function nextRotateTarget(currentPath, enabledMap = {}, wpPeopleCount = null, bookingCount = null) {
  const active = AUTO_ROTATE_TABS.filter((t) => enabledMap[t.href] !== false);
  if (active.length < 2) return null;
  const usable = active.filter((t) => {
    if (t.href === "/waiting-point" && wpPeopleCount === 0) return false;
    if (t.href === "/lich" && bookingCount === 0) return false;
    return true;
  });
  if (!usable.length) return null;
  const currentSkipped = !usable.some((t) => t.href === currentPath);
  if (currentSkipped) return usable[0];
  if (usable.length < 2) return usable[0].href === currentPath ? null : usable[0];
  const idx = usable.findIndex((t) => t.href === currentPath);
  return usable[(idx + 1) % usable.length];
}

const NAV_STYLE = `<style>
.wr-nav{position:relative;z-index:9000;display:flex;align-items:stretch;gap:2px;height:44px;margin:0;padding:0 16px;box-sizing:border-box;background:#0d1626;border-bottom:1px solid #1e2b42;color:#b4c0d2;font:500 13px/1.2 'Roboto','Segoe UI',system-ui,sans-serif;letter-spacing:0;text-transform:none;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-font-smoothing:antialiased}
.wr-nav::-webkit-scrollbar{display:none}
.wr-nav a{text-decoration:none}
.wr-brand{display:flex;align-items:center;gap:8px;margin-right:12px;color:#eef2f8;font-weight:800;letter-spacing:.04em;white-space:nowrap}
.wr-brand i{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:#4cc3ff;color:#04121e;font-size:10.5px;font-style:normal;font-weight:800;letter-spacing:0}
.wr-link{display:flex;align-items:center;padding:0 12px;border-bottom:2px solid transparent;color:#b4c0d2;white-space:nowrap}
.wr-link:hover{color:#eef2f8}
.wr-link[aria-current=page]{border-bottom-color:#4cc3ff;color:#eef2f8;font-weight:600}
.wr-sp{flex:1 0 12px}
.wr-auto{display:flex;align-items:center;gap:8px;margin:8px 8px 8px 0;padding:0 12px;border:1px solid #2b3c58;border-radius:999px;background:#121d30;color:#b4c0d2;font:inherit;font-size:12.5px;white-space:nowrap;cursor:pointer}
.wr-auto:hover{border-color:#4cc3ff;color:#eef2f8}
.wr-auto i{position:relative;width:28px;height:16px;border-radius:999px;background:#2b3c58;flex:none;transition:background .2s}
.wr-auto i::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#7e8aa0;transition:transform .2s,background .2s}
.wr-auto[aria-pressed=true]{border-color:#4cc3ff;color:#eef2f8}
.wr-auto[aria-pressed=true] i{background:color-mix(in srgb,#4cc3ff 30%,#121d30)}
.wr-auto[aria-pressed=true] i::after{transform:translateX(12px);background:#4cc3ff}
.wr-auto[hidden]{display:none}
.wr-rot-grp{display:inline-flex;align-items:stretch;margin:8px 12px 8px 0;border:1px solid #2b3c58;border-radius:999px;background:#121d30;overflow:hidden;flex:none}
.wr-rot-grp[data-on=true]{border-color:#4cc3ff}
.wr-rot-btn{display:flex;align-items:center;gap:7px;padding:0 10px 0 11px;border:0;background:transparent;color:#b4c0d2;font:inherit;font-size:12.5px;white-space:nowrap;cursor:pointer}
.wr-rot-btn:hover{color:#eef2f8}
.wr-rot-btn i{position:relative;width:28px;height:16px;border-radius:999px;background:#2b3c58;flex:none;transition:background .2s}
.wr-rot-btn i::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#7e8aa0;transition:transform .2s,background .2s}
.wr-rot-btn[aria-pressed=true]{color:#eef2f8}
.wr-rot-btn[aria-pressed=true] i{background:color-mix(in srgb,#4cc3ff 30%,#121d30)}
.wr-rot-btn[aria-pressed=true] i::after{transform:translateX(12px);background:#4cc3ff}
.wr-rot-cd{font-family:'Roboto',ui-monospace,Consolas,monospace;font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums;color:#4cc3ff}
.wr-rot-cd:empty{display:none}
.wr-rot-cfg{display:inline-flex;align-items:center;justify-content:center;width:26px;padding:0;border:0;border-left:1px solid #2b3c58;background:transparent;color:#7e8aa0;font:inherit;font-size:11px;cursor:pointer}
.wr-rot-cfg:hover,.wr-rot-cfg[aria-expanded=true]{background:#1a2740;color:#eef2f8}
.wr-rot-pop{position:fixed;top:48px;right:16px;z-index:9500;width:296px;padding:12px;border:1px solid #2b3c58;border-radius:12px;background:#0d1626;color:#eef2f8;font:500 13px/1.35 'Roboto','Segoe UI',system-ui,sans-serif;box-shadow:0 16px 36px rgba(0,0,0,.55);box-sizing:border-box}
.wr-rot-pop[hidden]{display:none}
.wr-rot-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e2b42}
.wr-rot-head b{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#eef2f8}
.wr-rot-head span{font-size:11px;color:#7e8aa0}
.wr-rot-list{display:flex;flex-direction:column;gap:6px}
.wr-rot-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid #1e2b42;border-radius:8px;background:#121d30;cursor:pointer;user-select:none}
.wr-rot-item:hover{border-color:#2b3c58;background:#1a2740}
.wr-rot-item-l{display:flex;align-items:center;gap:9px;min-width:0}
.wr-rot-item input{width:15px;height:15px;margin:0;accent-color:#4cc3ff;cursor:pointer;flex:none}
.wr-rot-item strong{font-size:13px;font-weight:600;color:#eef2f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-rot-item em{font-style:normal;font-family:'Roboto',ui-monospace,Consolas,monospace;font-size:11.5px;font-weight:600;color:#4cc3ff;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,#4cc3ff 12%,transparent);white-space:nowrap}
.wr-rot-item.is-off strong{color:#6b7790}
.wr-rot-item.is-off em{color:#6b7790;background:#1e2b42}
.wr-rot-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:9px;border-top:1px solid #1e2b42;font-size:11.5px;color:#7e8aa0}
.wr-rot-next{padding:4px 9px;border:1px solid #2b3c58;border-radius:6px;background:#121d30;color:#eef2f8;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.wr-rot-next:hover:not(:disabled){border-color:#4cc3ff;color:#4cc3ff}
.wr-rot-next:disabled{opacity:.4;cursor:default}
.wr-user{display:flex;align-items:center;gap:12px;color:#7e8aa0;font-size:12.5px;white-space:nowrap}
.wr-user b{color:#eef2f8;font-weight:600}
.wr-user a{color:#b4c0d2}
.wr-user a:hover,.wr-user a[aria-current=page]{color:#4cc3ff}
.wr-nav~#root{height:calc(100% - 44px)}.wr-nav~#root .wall{height:calc(100vh - 44px)}
.wr-bk-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9600;display:flex;align-items:center;gap:12px;max-width:min(760px,calc(100vw - 24px));padding:10px 16px;border:1px solid #4cc3ff;border-radius:12px;background:#0d1626;color:#eef2f8;font:500 13.5px/1.35 'Roboto','Segoe UI',system-ui,sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.65)}
.wr-bk-bar[hidden]{display:none}
.wr-bk-tag{padding:2px 8px;border-radius:999px;background:#4cc3ff;color:#04121e;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.wr-bk-txt{min-width:0;flex:1}
.wr-bk-txt b{color:#4cc3ff}
.wr-bk-cd{font-family:'Roboto',ui-monospace,Consolas,monospace;font-weight:800;color:#4cc3ff;white-space:nowrap}
.wr-bk-stay{padding:5px 10px;border:1px solid #2b3c58;border-radius:8px;background:#121d30;color:#eef2f8;font:600 12px inherit;cursor:pointer;white-space:nowrap}
.wr-bk-stay:hover{border-color:#4cc3ff;color:#4cc3ff}
:root[data-tv] .wr-nav,:root[data-theme=tv] .wr-nav,:root[data-tv] .wr-rot-pop,:root[data-theme=tv] .wr-rot-pop{display:none}
@media (max-width:760px){.wr-nav{padding:0 8px}.wr-brand span,.wr-name,.wr-auto span,.wr-rot-lbl{display:none}}
@media (prefers-reduced-motion:reduce){.wr-auto i,.wr-auto i::after,.wr-rot-btn i,.wr-rot-btn i::after{transition:none}}
</style>`;

// Nút "Tự cuộn": cuộn chậm từ đầu đến cuối trang, dừng 5 giây ở cuối, về đầu trang, dừng 5 giây rồi cuộn lại — cho màn hình
// treo tường. Bật / tắt nhớ theo từng trang (localStorage); thêm ?tucuon=1 trên địa chỉ để màn hình tự bật khi mở.
// Người xem tự cuộn, bấm phím hoặc chạm màn hình thì tạm dừng 15 giây. Trang không dài hơn màn hình (vd "/") thì ẩn nút.
const AUTO_SCROLL = `<script>(() => {
  const DEFAULT_SPEED = location.pathname === "/kpi" ? 14 : 28; // /kpi cuộn chậm hơn (14px/giây) để đọc kịp số liệu
  const qSpeed = Number(new URLSearchParams(location.search).get("tocdo"));
  const SPEED = Number.isFinite(qSpeed) && qSpeed >= 4 && qSpeed <= 200 ? qSpeed : DEFAULT_SPEED;
  const HOLD_MS = 5000, PAUSE_MS = 15000;
  const btn = document.getElementById("wrAuto");
  if (!btn) return;
  const key = "wr-autoscroll:" + location.pathname;
  const store = { get() { try { return localStorage.getItem(key) === "1"; } catch (e) { return false; } }, set(v) { try { localStorage.setItem(key, v ? "1" : "0"); } catch (e) {} } };
  const q = new URLSearchParams(location.search).get("tucuon");
  let on = q === "1" ? true : q === "0" ? false : store.get();
  let timer = 0, last = 0, carry = 0, holdUntil = 0, pausedUntil = 0;
  const docEl = document.scrollingElement || document.documentElement;
  const getBox = () => {
    const custom = document.querySelector("[data-wr-autoscroll]");
    if (custom && custom.scrollHeight - custom.clientHeight >= 24) return custom;
    return docEl;
  };
  const room = (box = getBox()) => (box === docEl ? box.scrollHeight - innerHeight : box.scrollHeight - box.clientHeight);
  function frame() {
    const t = performance.now();
    const dt = last ? Math.min(t - last, 1000) : 0; // trình duyệt chạy chậm lại (tab nền): vẫn giữ đúng tốc độ
    last = t;
    const now = Date.now();
    if (now < holdUntil || now < pausedUntil || document.hidden) return;
    const box = getBox();
    const r = room(box);
    if (r < 24) return; // trang chưa tải xong dữ liệu (còn ngắn): chờ, đừng coi là đã tới cuối
    if (box.scrollTop >= r - 1) { // tới cuối: dừng rồi về đầu
      holdUntil = now + HOLD_MS;
      setTimeout(() => {
        if (!on) return;
        const curBox = getBox();
        if (curBox === docEl) scrollTo({ top: 0, behavior: "smooth" });
        else curBox.scrollTo({ top: 0, behavior: "smooth" });
        holdUntil = Date.now() + HOLD_MS;
      }, HOLD_MS);
      holdUntil = now + HOLD_MS * 2 + 1500;
      return;
    }
    carry += (SPEED * dt) / 1000;
    const step = Math.floor(carry);
    if (step >= 1) {
      carry -= step;
      if (box === docEl) scrollBy(0, step);
      else box.scrollTop += step;
    }
  }
  function render() {
    const hasRoom = room() >= 24;
    btn.hidden = !hasRoom;
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "Đang tự cuộn. Bấm để tắt." : "Tự cuộn chậm từ đầu đến cuối, rồi lặp lại.";
    dispatchEvent(new CustomEvent("wr:autoscroll-state", { detail: { on, hasRoom } }));
  }
  function set(v) {
    on = v; store.set(v); render();
    clearInterval(timer); timer = 0; last = 0; carry = 0; holdUntil = 0; pausedUntil = 0;
    if (on) timer = setInterval(frame, 40); // 25 lần / giây, mỗi lần 1–2px: mượt mà vẫn chậm
  }
  btn.addEventListener("click", () => set(!on));
  const pause = () => { if (on) pausedUntil = Date.now() + PAUSE_MS; };
  addEventListener("wheel", pause, { passive: true });
  addEventListener("touchstart", pause, { passive: true });
  addEventListener("keydown", (e) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) pause(); });
  addEventListener("resize", render);
  addEventListener("wr:autoscroll-check", render);
  addEventListener("wr:autoscroll-toggle", () => set(!on));
  setInterval(render, 2000); // trang tải dữ liệu xong mới dài ra
  render();
  if (on) set(true);
})();</script>`;

// Nút "Tự chuyển tab": xoay vòng giữa KPI & kết quả (3p), Điểm nghẽn (10s/người; bỏ qua khi trống) và Hẹn lịch BOD (30s khi có lịch họp; bỏ qua khi trống).
// Khi có người vừa đặt lịch họp mới (WebSocket scope="bookings", event="created", kind="meeting"), màn hình đang bật Chuyển tab lập tức mở /lich trong 30 giây cho cấp trên thấy rồi tự quay lại.
const AUTO_ROTATE = `<script>(() => {
  const TABS = ${JSON.stringify(AUTO_ROTATE_TABS)};
  const WP_SEC_PER_PERSON = ${WP_SEC_PER_PERSON};
  const BOOKING_ROTATE_SEC = ${BOOKING_ROTATE_SEC};
  const KEY = "wr-autotab-v1";
  const FLASH_KEY = "wr-book-flash";
  const grp = document.getElementById("wrRotGrp");
  const btn = document.getElementById("wrRotToggle");
  const cdEl = document.getElementById("wrRotCd");
  const cfgBtn = document.getElementById("wrRotCfg");
  const pop = document.getElementById("wrRotPop");
  const statEl = document.getElementById("wrRotStat");
  const nextBtn = document.getElementById("wrRotNext");
  const bkBar = document.getElementById("wrBkBar");
  const bkTxt = document.getElementById("wrBkTxt");
  const bkCd = document.getElementById("wrBkCd");
  const bkStay = document.getElementById("wrBkStay");
  if (!btn || !pop) return;

  function defaultState() {
    const tabs = {};
    for (const t of TABS) tabs[t.href] = true;
    return { on: false, tabs };
  }
  function loadState() {
    const def = defaultState();
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && typeof raw === "object") {
        def.on = Boolean(raw.on);
        if (raw.tabs && typeof raw.tabs === "object") {
          for (const t of TABS) if (typeof raw.tabs[t.href] === "boolean") def.tabs[t.href] = raw.tabs[t.href];
        }
      }
    } catch (e) {}
    const q = new URLSearchParams(location.search).get("chuyentab");
    if (q === "1") def.on = true;
    else if (q === "0") def.on = false;
    return def;
  }
  function saveState(st) {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
  }
  function readFlash() {
    try {
      const f = JSON.parse(sessionStorage.getItem(FLASH_KEY) || "null");
      if (f && typeof f === "object" && Number(f.until) > Date.now()) return f;
      if (f) sessionStorage.removeItem(FLASH_KEY);
    } catch (e) {}
    return null;
  }
  function writeFlash(f) {
    try {
      if (!f) sessionStorage.removeItem(FLASH_KEY);
      else sessionStorage.setItem(FLASH_KEY, JSON.stringify(f));
    } catch (e) {}
  }
  function fmtSec(s) {
    const v = Math.max(0, Math.ceil(s));
    return String(Math.floor(v / 60)).padStart(2, "0") + ":" + String(v % 60).padStart(2, "0");
  }
  function getEnabled() {
    return TABS.filter((t) => st.tabs[t.href] !== false);
  }
  function getCurrentTab() {
    return TABS.find((t) => t.href === location.pathname) || null;
  }
  function getCandidateOrder() {
    const active = getEnabled();
    if (active.length < 2) return [];
    const idx = active.findIndex((t) => t.href === location.pathname);
    if (idx < 0) return active;
    const out = [];
    for (let i = 1; i < active.length; i++) out.push(active[(idx + i) % active.length]);
    return out;
  }
  function getNextTab() {
    return getCandidateOrder()[0] || null;
  }
  function goTab(href) {
    const sp = new URLSearchParams(location.search);
    sp.delete("chuyentab");
    const qs = sp.toString();
    location.assign(href + (qs ? "?" + qs : ""));
  }

  const st = loadState();
  saveState(st);
  const onWp = location.pathname === "/waiting-point";
  const onLich = location.pathname === "/lich";
  let wpPeople = null;
  let wpShowStats = false;
  let bkCount = null;
  let checkingNext = false;
  let skipNote = "";
  let flash = onLich ? readFlash() : null;
  if (!onLich) writeFlash(null);
  let remainSec = flash
    ? Math.max(1, Math.ceil((flash.until - Date.now()) / 1000))
    : onWp
      ? null
      : (getCurrentTab() || TABS[0]).sec;

  function resetCountdown() {
    skipNote = "";
    const cur = getCurrentTab();
    if (flash && onLich) remainSec = Math.max(1, Math.ceil((flash.until - Date.now()) / 1000));
    else if (onWp) remainSec = wpPeople != null ? wpPeople * WP_SEC_PER_PERSON : null;
    else remainSec = cur ? cur.sec : TABS[0].sec;
  }

  async function fetchWpStatus() {
    try {
      const res = await fetch("/api/waiting-point/status", { cache: "no-store" });
      if (!res.ok) return null;
      const d = await res.json();
      const n = Math.max(0, Math.floor(Number(d?.peopleCount) || 0));
      wpPeople = n;
      updateBadges();
      return n;
    } catch (e) {
      return null;
    }
  }

  async function fetchBookingStatus() {
    try {
      const res = await fetch("/api/bookings/status", { cache: "no-store" });
      if (!res.ok) return null;
      const d = await res.json();
      const n = Math.max(0, Math.floor(Number(d?.upcomingCount) || 0));
      bkCount = n;
      updateBadges();
      return n;
    } catch (e) {
      return null;
    }
  }

  function updateBadges() {
    const wpBadge = pop.querySelector('em[data-rot-badge="/waiting-point"]');
    if (wpBadge) {
      if (wpPeople === null) wpBadge.textContent = WP_SEC_PER_PERSON + "s / người";
      else if (wpPeople === 0) wpBadge.textContent = "Trống · bỏ qua";
      else wpBadge.textContent = wpPeople + " người · " + (wpPeople * WP_SEC_PER_PERSON) + "s";
    }
    const bkBadge = pop.querySelector('em[data-rot-badge="/lich"]');
    if (bkBadge) {
      if (bkCount === null) bkBadge.textContent = BOOKING_ROTATE_SEC + "s khi có lịch";
      else if (bkCount === 0) bkBadge.textContent = "Chưa có lịch · bỏ qua";
      else bkBadge.textContent = bkCount + " khung · " + BOOKING_ROTATE_SEC + "s";
    }
  }

  function renderFlashBar() {
    if (!bkBar) return;
    if (!flash || !onLich) { bkBar.hidden = true; return; }
    const left = Math.max(0, Math.ceil((flash.until - Date.now()) / 1000));
    const slotsTxt = Array.isArray(flash.slots) && flash.slots.length
      ? flash.slots.slice(0, 3).map((s) => String(s).slice(11, 16)).join(", ")
      : "";
    if (bkTxt) {
      bkTxt.innerHTML = (flash.by ? "<b>" + flash.by.replace(/[<>&]/g, "") + "</b> vừa đặt lịch họp" : "Vừa có lịch họp mới")
        + (slotsTxt ? " (" + slotsTxt + ")" : "")
        + (flash.note ? " — " + String(flash.note).replace(/[<>&]/g, "").slice(0, 80) : "");
    }
    if (bkCd) bkCd.textContent = "Quay lại sau " + left + "s";
    bkBar.hidden = false;
  }

  async function trySwitchNext(manual = false) {
    if (checkingNext) return;
    if (flash && onLich) {
      const ret = flash.returnTo || "/kpi";
      flash = null;
      writeFlash(null);
      goTab(ret === "/lich" ? "/kpi" : ret);
      return;
    }
    const candidates = getCandidateOrder();
    if (!candidates.length) return;
    checkingNext = true;
    render();
    const skipped = [];
    let chosen = null;
    for (const cand of candidates) {
      if (cand.href === "/waiting-point") {
        const n = await fetchWpStatus();
        if (n === 0) { skipped.push("Điểm nghẽn trống"); continue; }
        if (n === null && !manual) { skipped.push("chưa kiểm tra được Điểm nghẽn"); continue; }
      } else if (cand.href === "/lich") {
        const n = await fetchBookingStatus();
        if (n === 0) { skipped.push("chưa có lịch họp"); continue; }
        if (n === null && !manual) { skipped.push("chưa kiểm tra được Hẹn lịch"); continue; }
      }
      chosen = cand;
      break;
    }
    checkingNext = false;
    if (chosen) {
      goTab(chosen.href);
      return;
    }
    resetCountdown();
    skipNote = (skipped.length ? skipped.join(", ") : "Các tab khác trống") + " · giữ nguyên";
    render();
  }

  function applyWpPeople(n, showStats = false) {
    const prev = wpPeople;
    wpPeople = Math.max(0, Math.floor(Number(n) || 0));
    wpShowStats = Boolean(showStats);
    updateBadges();
    if (!onWp) { render(); return; }
    const active = getEnabled();
    const running = st.on && active.length >= 2 && st.tabs["/waiting-point"] !== false;
    if (wpPeople === 0) {
      remainSec = 0;
      render();
      if (running && !wpShowStats) trySwitchNext(false);
      return;
    }
    const targetSec = wpPeople * WP_SEC_PER_PERSON;
    if (prev === null || remainSec === null) remainSec = targetSec;
    else if (wpPeople > prev) remainSec += (wpPeople - prev) * WP_SEC_PER_PERSON;
    else if (wpPeople < prev) remainSec = Math.min(remainSec, targetSec);
    render();
  }

  // Lắng nghe WebSocket thời gian thực: khi đang bật Chuyển tab và có người vừa đặt lịch họp (kind="meeting"),
  // lập tức mở /lich trong 30 giây cho cấp trên thấy rồi tự quay lại.
  let rotWs = null;
  let rotWsRetry = 0;
  let rotWsTimer = 0;
  function stopBookingWatch() {
    clearTimeout(rotWsTimer);
    rotWsTimer = 0;
    if (rotWs) { try { rotWs.close(); } catch (e) {} rotWs = null; }
  }
  function ensureBookingWatch() {
    if (!st.on || st.tabs["/lich"] === false) { stopBookingWatch(); return; }
    if (rotWs && (rotWs.readyState === 0 || rotWs.readyState === 1)) return;
    try {
      const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/live/ws");
      rotWs = ws;
      ws.onopen = () => { rotWsRetry = 0; };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type !== "change" || m.scope !== "bookings") return;
        if (m.event === "created" && m.kind === "meeting") {
          const until = Date.now() + BOOKING_ROTATE_SEC * 1000;
          const nextFlash = {
            returnTo: onLich ? (flash?.returnTo || "/kpi") : location.pathname,
            until,
            by: m.name || "",
            slots: Array.isArray(m.slots) ? m.slots : [],
            note: m.note || "",
          };
          writeFlash(nextFlash);
          if (!onLich) {
            goTab("/lich");
          } else {
            flash = nextFlash;
            remainSec = BOOKING_ROTATE_SEC;
            renderFlashBar();
            render();
          }
        } else if (m.event === "cancelled" && onLich && !flash && st.on) {
          fetchBookingStatus().then((n) => { if (n === 0) trySwitchNext(false); });
        }
      };
      ws.onclose = () => {
        if (rotWs === ws) rotWs = null;
        if (!st.on || st.tabs["/lich"] === false) return;
        rotWsTimer = setTimeout(ensureBookingWatch, Math.min(30000, 1500 * Math.pow(2, rotWsRetry++)));
      };
    } catch (e) {}
  }

  function syncPopPos() {
    if (pop.hidden || !grp) return;
    const r = grp.getBoundingClientRect();
    const rightGap = Math.max(12, Math.round(window.innerWidth - r.right));
    pop.style.right = rightGap + "px";
    pop.style.top = Math.round(r.bottom + 6) + "px";
  }

  function render() {
    const active = getEnabled();
    const cur = getCurrentTab();
    const curEnabled = Boolean(cur && st.tabs[cur.href] !== false);
    const next = getNextTab();
    const running = (st.on && active.length >= 2 && curEnabled) || Boolean(flash && onLich);

    if (grp) grp.dataset.on = String(st.on && active.length >= 2);
    btn.setAttribute("aria-pressed", String(st.on));
    cdEl.textContent = running ? (checkingNext || remainSec === null ? "…" : fmtSec(remainSec)) : "";
    btn.title = running
      ? (skipNote || (flash && onLich ? "Lịch họp mới: tự quay lại sau " + fmtSec(remainSec) : "Đang tự chuyển sang " + (next?.label || "KPI") + (remainSec === null ? "" : " sau " + fmtSec(remainSec)) + ". Bấm để tắt."))
      : st.on && active.length < 2
        ? "Cần bật ít nhất 2 tab để tự chuyển."
        : "Tự chuyển: KPI (3p) ↔ Điểm nghẽn (10s/người) ↔ Hẹn lịch BOD (30s khi có lịch họp mới / sắp tới).";

    pop.querySelectorAll("input[data-rot-href]").forEach((cb) => {
      const h = cb.getAttribute("data-rot-href");
      const checked = st.tabs[h] !== false;
      cb.checked = checked;
      cb.closest(".wr-rot-item")?.classList.toggle("is-off", !checked);
    });
    updateBadges();
    renderFlashBar();

    if (statEl) {
      if (active.length < 2) statEl.textContent = "Chọn tối thiểu 2 tab để xoay vòng";
      else if (skipNote) statEl.textContent = skipNote;
      else if (running) statEl.textContent = "Kế tiếp: " + (next?.label || "KPI") + (remainSec === null ? " (đang kiểm tra…)" : " (" + fmtSec(remainSec) + ")");
      else if (st.on && !curEnabled) statEl.textContent = "Đang bật (" + active.length + " tab) · Ngoài vòng xoay";
      else statEl.textContent = "Đang tắt · " + active.length + "/" + TABS.length + " tab được chọn";
    }
    if (nextBtn) nextBtn.disabled = !next || checkingNext;
  }

  bkStay?.addEventListener("click", () => {
    flash = null;
    writeFlash(null);
    st.on = false;
    saveState(st);
    stopBookingWatch();
    render();
  });

  btn.addEventListener("click", async () => {
    st.on = !st.on;
    saveState(st);
    if (!st.on && flash) { flash = null; writeFlash(null); }
    resetCountdown();
    ensureBookingWatch();
    render();
    if (st.on) {
      const active = getEnabled();
      const cur = getCurrentTab();
      if (active.length >= 2 && onWp && wpPeople === 0 && !wpShowStats) {
        trySwitchNext(false);
      } else if (active.length >= 2 && onLich && !flash) {
        const n = await fetchBookingStatus();
        if (n === 0) trySwitchNext(false);
      } else if (active.length >= 2 && (!cur || st.tabs[cur.href] === false)) {
        goTab(active[0].href);
      } else if (active.length < 2) {
        pop.hidden = false;
        cfgBtn.setAttribute("aria-expanded", "true");
        syncPopPos();
      }
    }
  });

  cfgBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    cfgBtn.setAttribute("aria-expanded", String(open));
    if (open) { syncPopPos(); Promise.all([fetchWpStatus(), fetchBookingStatus()]).then(() => render()); }
  });

  pop.addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-rot-href]");
    if (!cb) return;
    const h = cb.getAttribute("data-rot-href");
    st.tabs[h] = cb.checked;
    saveState(st);
    resetCountdown();
    ensureBookingWatch();
    render();
  });

  nextBtn?.addEventListener("click", () => { trySwitchNext(true); });

  window.addEventListener("wr:wp-count", (e) => {
    const d = e?.detail;
    if (d && typeof d.peopleCount === "number") applyWpPeople(d.peopleCount, d.showStats);
  });

  if (onWp) {
    setTimeout(() => {
      if (wpPeople === null) fetchWpStatus().then((n) => { if (n !== null && wpPeople === null) applyWpPeople(n, false); });
    }, 4000);
  }
  if (onLich && st.on && !flash && st.tabs["/lich"] !== false && getEnabled().length >= 2) {
    fetchBookingStatus().then((n) => { if (n === 0) trySwitchNext(false); });
  }

  document.addEventListener("click", (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || (grp && grp.contains(e.target))) return;
    pop.hidden = true;
    cfgBtn.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      pop.hidden = true;
      cfgBtn.setAttribute("aria-expanded", "false");
    }
  });

  window.addEventListener("resize", syncPopPos);

  setInterval(() => {
    if (flash && onLich) {
      const left = Math.ceil((flash.until - Date.now()) / 1000);
      remainSec = Math.max(0, left);
      renderFlashBar();
      render();
      if (left <= 0) { trySwitchNext(false); }
      return;
    }
    const active = getEnabled();
    const cur = getCurrentTab();
    if (!st.on || active.length < 2 || !cur || st.tabs[cur.href] === false) return;
    if (document.hidden || !pop.hidden || checkingNext) return;
    if (onWp && (remainSec === null || wpShowStats)) return;
    remainSec -= 1;
    if (remainSec <= 0) {
      trySwitchNext(false);
      return;
    }
    render();
  }, 1000);

  ensureBookingWatch();
  render();
})();</script>`;

/** Thanh điều hướng cho trang `path` (đánh dấu trang đang mở), kèm tên người dùng, Quản trị / Đổi mật khẩu, Đăng xuất. */
export function navBar(user, path) {
  const cur = (href) => (href === path ? ' aria-current="page"' : "");
  const links = NAV_PAGES.map(([href, label]) => `<a class="wr-link" href="${href}"${cur(href)}>${label}</a>`).join("");
  const account = user.role === "admin" ? `<a href="/admin"${cur("/admin")}>Quản trị</a>` : `<a href="/doi-mat-khau">Đổi mật khẩu</a>`;
  const rotItems = AUTO_ROTATE_TABS.map((t) => {
    const badge = t.secPerPerson ? `${t.secPerPerson}s / người` : t.whenHasData ? `${t.sec}s khi có lịch` : `${Math.round(t.sec / 60)} phút`;
    return `<label class="wr-rot-item"><span class="wr-rot-item-l"><input type="checkbox" data-rot-href="${t.href}" checked /><strong>${esc(t.label)}</strong></span><em data-rot-badge="${t.href}">${badge}</em></label>`;
  }).join("");
  const rotControl = `<div class="wr-rot-grp" id="wrRotGrp" data-on="false"><button type="button" class="wr-rot-btn" id="wrRotToggle" aria-pressed="false"><i aria-hidden="true"></i><span class="wr-rot-lbl">Chuyển tab</span><b class="wr-rot-cd" id="wrRotCd"></b></button><button type="button" class="wr-rot-cfg" id="wrRotCfg" aria-expanded="false" aria-controls="wrRotPop" title="Chọn các tab tự chuyển">▾</button></div>`;
  const rotPopover = `<div class="wr-rot-pop" id="wrRotPop" hidden role="dialog" aria-label="Cấu hình tự chuyển tab"><div class="wr-rot-head"><b>Tự động chuyển tab</b><span>Bật / tắt từng tab</span></div><div class="wr-rot-list">${rotItems}</div><div class="wr-rot-foot"><span id="wrRotStat"></span><button type="button" class="wr-rot-next" id="wrRotNext">Chuyển ngay →</button></div></div>`;
  const bkBanner = `<div class="wr-bk-bar" id="wrBkBar" hidden role="status"><span class="wr-bk-tag">Lịch họp mới</span><span class="wr-bk-txt" id="wrBkTxt"></span><span class="wr-bk-cd" id="wrBkCd"></span><button type="button" class="wr-bk-stay" id="wrBkStay">Giữ trang này</button></div>`;
  return `${NAV_STYLE}<nav class="wr-nav" aria-label="Trang"><a class="wr-brand" href="/kpi" title="War Room CT Homes"><i>WR</i><span>WAR ROOM</span></a>${links}<span class="wr-sp"></span><button type="button" class="wr-auto" id="wrAuto" aria-pressed="false" hidden><i aria-hidden="true"></i><span>Tự cuộn</span></button>${rotControl}<span class="wr-user"><span class="wr-name">👤 <b>${esc(user.fullName)}</b></span>${account}<a href="/logout">Đăng xuất</a></span></nav>${rotPopover}${bkBanner}${AUTO_SCROLL}${AUTO_ROTATE}`;
}

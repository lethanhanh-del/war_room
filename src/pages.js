// Trang HTML do Worker trả về: đăng nhập, đổi mật khẩu, và phần chèn vào dashboard.
import { esc } from "./http.js";

// Style War Room v5 "Night Ops" (docs/STYLE_GUIDE.md): nền gần đen, lime cho nút chính / điều hướng.
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&display=swap" />`;

const CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07090d radial-gradient(circle at 0% 0%, rgba(200, 255, 77, .05), transparent 40%) fixed; font-family: 'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif; color: #f3f6fa; -webkit-font-smoothing: antialiased; }
  form { width: min(380px, calc(100vw - 32px)); background: #0e1218; border: 1px solid #1c232e; border-radius: 12px; padding: 28px; display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: #c8ff4d; }
  p { margin: 0; font-size: 13px; color: #8994a6; }
  p b { color: #f3f6fa; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #8994a6; }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #2a3442; border-radius: 8px; font-family: inherit; background: #151a23; color: #f3f6fa; text-transform: none; letter-spacing: 0; }
  input:focus { outline: 2px solid #c8ff4d; outline-offset: 1px; }
  button { margin-top: 4px; width: 100%; padding: 10px; font-size: 15px; font-weight: 700; color: #0a0d12; background: #c8ff4d; border: 0; border-radius: 8px; cursor: pointer; font-family: inherit; }
  button:hover { filter: brightness(1.08); }
  .err { color: #ff4d6d; font-size: 13px; font-weight: 600; }
  .info { color: #ffb020; background: rgba(255, 176, 32, .12); border: 1px solid rgba(255, 176, 32, .5); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
  a { color: #c8ff4d; font-size: 13px; }
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
  ["/", "Dòng tiền"], // màn hình War Room của Thành Anh (app React FE/)
  ["/kpi", "KPI & kết quả"],
  ["/lich-truc", "Lịch trực 24/7"],
  ["/lich", "Hẹn lịch BOD"],
  ["/waiting-point", "Waiting Point"],
];

const NAV_STYLE = `<style>
.wr-nav{position:relative;z-index:9000;display:flex;align-items:stretch;gap:2px;height:44px;margin:0;padding:0 16px;box-sizing:border-box;background:#0e1218;border-bottom:1px solid #1c232e;color:#b6c0ce;font:500 13px/1.2 'Be Vietnam Pro','Segoe UI',system-ui,sans-serif;letter-spacing:0;text-transform:none;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-font-smoothing:antialiased}
.wr-nav::-webkit-scrollbar{display:none}
.wr-nav a{text-decoration:none}
.wr-brand{display:flex;align-items:center;gap:8px;margin-right:12px;color:#f3f6fa;font-weight:800;letter-spacing:.04em;white-space:nowrap}
.wr-brand i{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:#c8ff4d;color:#0a0d12;font-size:10.5px;font-style:normal;font-weight:800;letter-spacing:0}
.wr-link{display:flex;align-items:center;padding:0 12px;border-bottom:2px solid transparent;color:#b6c0ce;white-space:nowrap}
.wr-link:hover{color:#f3f6fa}
.wr-link[aria-current=page]{border-bottom-color:#c8ff4d;color:#f3f6fa;font-weight:600}
.wr-sp{flex:1 0 12px}
.wr-auto{display:flex;align-items:center;gap:8px;margin:8px 12px 8px 0;padding:0 12px;border:1px solid #2a3442;border-radius:999px;background:#151a23;color:#b6c0ce;font:inherit;font-size:12.5px;white-space:nowrap;cursor:pointer}
.wr-auto:hover{border-color:#c8ff4d;color:#f3f6fa}
.wr-auto i{position:relative;width:28px;height:16px;border-radius:999px;background:#2a3442;flex:none;transition:background .2s}
.wr-auto i::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#8994a6;transition:transform .2s,background .2s}
.wr-auto[aria-pressed=true]{border-color:#c8ff4d;color:#f3f6fa}
.wr-auto[aria-pressed=true] i{background:color-mix(in srgb,#c8ff4d 30%,#151a23)}
.wr-auto[aria-pressed=true] i::after{transform:translateX(12px);background:#c8ff4d}
.wr-auto[hidden]{display:none}
.wr-user{display:flex;align-items:center;gap:12px;color:#8994a6;font-size:12.5px;white-space:nowrap}
.wr-user b{color:#f3f6fa;font-weight:600}
.wr-user a{color:#b6c0ce}
.wr-user a:hover,.wr-user a[aria-current=page]{color:#c8ff4d}
.wr-nav~#root{height:calc(100% - 44px)}.wr-nav~#root .wall{height:calc(100vh - 44px)}
:root[data-tv] .wr-nav,:root[data-theme=tv] .wr-nav{display:none}
@media (max-width:760px){.wr-nav{padding:0 8px}.wr-brand span,.wr-name,.wr-auto span{display:none}}
@media (prefers-reduced-motion:reduce){.wr-auto i,.wr-auto i::after{transition:none}}
</style>`;

// Nút "Tự cuộn": cuộn chậm từ đầu đến cuối trang, dừng 5 giây ở cuối, về đầu trang, dừng 5 giây rồi cuộn lại — cho màn hình
// treo tường. Bật / tắt nhớ theo từng trang (localStorage); thêm ?tucuon=1 trên địa chỉ để màn hình tự bật khi mở.
// Người xem tự cuộn, bấm phím hoặc chạm màn hình thì tạm dừng 15 giây. Trang không dài hơn màn hình (vd "/") thì ẩn nút.
const AUTO_SCROLL = `<script>(() => {
  const SPEED = 28; // px mỗi giây: chậm, đọc kịp
  const HOLD_MS = 5000, PAUSE_MS = 15000;
  const btn = document.getElementById("wrAuto");
  if (!btn) return;
  const key = "wr-autoscroll:" + location.pathname;
  const store = { get() { try { return localStorage.getItem(key) === "1"; } catch (e) { return false; } }, set(v) { try { localStorage.setItem(key, v ? "1" : "0"); } catch (e) {} } };
  const q = new URLSearchParams(location.search).get("tucuon");
  let on = q === "1" ? true : q === "0" ? false : store.get();
  let timer = 0, last = 0, carry = 0, holdUntil = 0, pausedUntil = 0;
  const el = document.scrollingElement || document.documentElement;
  const room = () => el.scrollHeight - innerHeight;
  function frame() {
    const t = performance.now();
    const dt = last ? Math.min(t - last, 1000) : 0; // trình duyệt chạy chậm lại (tab nền): vẫn giữ đúng tốc độ
    last = t;
    const now = Date.now();
    if (now < holdUntil || now < pausedUntil || document.hidden) return;
    if (room() < 40) return; // trang chưa tải xong dữ liệu (còn ngắn): chờ, đừng coi là đã tới cuối
    if (el.scrollTop >= room() - 1) { // tới cuối: dừng rồi về đầu trang
      holdUntil = now + HOLD_MS;
      setTimeout(() => { if (!on) return; scrollTo({ top: 0, behavior: "smooth" }); holdUntil = Date.now() + HOLD_MS; }, HOLD_MS);
      holdUntil = now + HOLD_MS * 2 + 1500;
      return;
    }
    carry += (SPEED * dt) / 1000;
    const step = Math.floor(carry);
    if (step >= 1) { carry -= step; scrollBy(0, step); }
  }
  function render() {
    btn.hidden = room() < 40;
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "Đang tự cuộn trang. Bấm để tắt." : "Tự cuộn chậm từ đầu đến cuối trang, rồi lặp lại.";
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
  setInterval(render, 3000); // trang tải dữ liệu xong mới dài ra
  render();
  if (on) set(true);
})();</script>`;

/** Thanh điều hướng cho trang `path` (đánh dấu trang đang mở), kèm tên người dùng, Quản trị / Đổi mật khẩu, Đăng xuất. */
export function navBar(user, path) {
  const cur = (href) => (href === path ? ' aria-current="page"' : "");
  const links = NAV_PAGES.map(([href, label]) => `<a class="wr-link" href="${href}"${cur(href)}>${label}</a>`).join("");
  const account = user.role === "admin" ? `<a href="/admin"${cur("/admin")}>Quản trị</a>` : `<a href="/doi-mat-khau">Đổi mật khẩu</a>`;
  return `${NAV_STYLE}<nav class="wr-nav" aria-label="Trang"><a class="wr-brand" href="/" title="War Room CT Homes"><i>WR</i><span>WAR ROOM</span></a>${links}<span class="wr-sp"></span><button type="button" class="wr-auto" id="wrAuto" aria-pressed="false" hidden><i aria-hidden="true"></i><span>Tự cuộn</span></button><span class="wr-user"><span class="wr-name">👤 <b>${esc(user.fullName)}</b></span>${account}<a href="/logout">Đăng xuất</a></span></nav>${AUTO_SCROLL}`;
}

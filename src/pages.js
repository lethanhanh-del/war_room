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
.wr-user{display:flex;align-items:center;gap:12px;color:#8994a6;font-size:12.5px;white-space:nowrap}
.wr-user b{color:#f3f6fa;font-weight:600}
.wr-user a{color:#b6c0ce}
.wr-user a:hover,.wr-user a[aria-current=page]{color:#c8ff4d}
.wr-nav~#root{height:calc(100% - 44px)}.wr-nav~#root .wall{height:calc(100vh - 44px)}
:root[data-tv] .wr-nav,:root[data-theme=tv] .wr-nav{display:none}
@media (max-width:760px){.wr-nav{padding:0 8px}.wr-brand span,.wr-name{display:none}}
</style>`;

/** Thanh điều hướng cho trang `path` (đánh dấu trang đang mở), kèm tên người dùng, Quản trị / Đổi mật khẩu, Đăng xuất. */
export function navBar(user, path) {
  const cur = (href) => (href === path ? ' aria-current="page"' : "");
  const links = NAV_PAGES.map(([href, label]) => `<a class="wr-link" href="${href}"${cur(href)}>${label}</a>`).join("");
  const account = user.role === "admin" ? `<a href="/admin"${cur("/admin")}>Quản trị</a>` : `<a href="/doi-mat-khau">Đổi mật khẩu</a>`;
  return `${NAV_STYLE}<nav class="wr-nav" aria-label="Trang"><a class="wr-brand" href="/" title="War Room CT Homes"><i>WR</i><span>WAR ROOM</span></a>${links}<span class="wr-sp"></span><span class="wr-user"><span class="wr-name">👤 <b>${esc(user.fullName)}</b></span>${account}<a href="/logout">Đăng xuất</a></span></nav>`;
}

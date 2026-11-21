// Trang HTML do Worker trả về: đăng nhập, đổi mật khẩu, và phần chèn vào dashboard.
import { esc } from "./http.js";

const CSS = `
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6f9; font-family: 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif; color: #0f172a; }
  form { width: min(380px, calc(100vw - 32px)); background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 24px rgba(12, 31, 58, .08); display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0; font-size: 18px; color: #17365d; }
  p { margin: 0; font-size: 13px; color: #64748b; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; color: #475569; }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; }
  input:focus { outline: 2px solid #1d4ed8; outline-offset: 1px; }
  button { margin-top: 4px; width: 100%; padding: 10px; font-size: 15px; font-weight: 600; color: #fff; background: #17365d; border: 0; border-radius: 8px; cursor: pointer; font-family: inherit; }
  button:hover { background: #1e477a; }
  .err { color: #dc2626; font-size: 13px; font-weight: 600; }
  .info { color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
  a { color: #1d4ed8; font-size: 13px; }
`;

function page(title, body, status = 200) {
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
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

// Chèn vào dashboard lúc phục vụ (HTMLRewriter) để không mất khi ai đó ghi đè public/index.html.
// Màn hình hẹp (điện thoại): nút lịch chỉ còn 📅, ô người dùng ẩn tên, để hai nút không đè nhau.
const STYLE = `<style>
.wr-pill{position:fixed;bottom:16px;z-index:9999;display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:#17365d;color:#fff;font:500 13px 'Segoe UI',system-ui,sans-serif;box-shadow:0 6px 20px rgba(12,31,58,.3);text-decoration:none;white-space:nowrap}
.wr-pill a,a.wr-pill{color:#fff;text-decoration:none;font-weight:600}
.wr-pill .wr-dim{opacity:.85}
.wr-cal{right:16px}
.wr-user{left:16px}
@media (max-width:600px){.wr-pill{padding:9px 12px;gap:6px}.wr-cal .wr-txt,.wr-user .wr-name{display:none}}
</style>`;

export const CHAIRMAN_LINK = `${STYLE}<a href="/lich" class="wr-pill wr-cal" title="Hẹn lịch BOD">📅<span class="wr-txt"> Hẹn lịch BOD</span></a>`;

export function userChip(user) {
  const links = user.role === "admin" ? `<a href="/admin">Quản trị</a>` : `<a href="/doi-mat-khau" class="wr-dim">Đổi mật khẩu</a>`;
  return `<div class="wr-pill wr-user">👤<span class="wr-name"> ${esc(user.fullName)}</span> · ${links} · <a href="/logout" class="wr-dim">Đăng xuất</a></div>`;
}

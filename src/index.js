// Cổng mật khẩu cho dashboard War Room.
// Mật khẩu ACCESS_PASSWORD đặt trên Cloudflare (không lưu trong repo), ở một trong hai chỗ:
//   - Settings > Variables and Secrets (runtime): ưu tiên dùng nếu có;
//   - Settings > Build > Variables and secrets: được băm lúc build (scripts/build-password.mjs),
//     đổi giá trị thì phải build lại (Retry build hoặc push).
// Đăng nhập đúng -> cookie phiên ký HMAC, hiệu lực 30 ngày.
// Đổi ACCESS_PASSWORD -> mọi phiên cũ tự mất hiệu lực.
// Dashboard nằm ở public/index.html.

import { BUILD_PASSWORD_HASH } from "../generated/password.js";

const COOKIE = "wr_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

export default {
  async fetch(request, env) {
    const pwHash = env.ACCESS_PASSWORD ? await sha256Hex(env.ACCESS_PASSWORD) : BUILD_PASSWORD_HASH;
    if (!pwHash) return new Response("ACCESS_PASSWORD chưa được cấu hình.", { status: 500 });

    const url = new URL(request.url);

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      if (await safeEqual(await sha256Hex(String(form.get("password") || "")), pwHash)) {
        const exp = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": `${COOKIE}=${exp}.${await sign(pwHash, exp)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          },
        });
      }
      return loginPage("Sai mật khẩu.");
    }

    if (!(await hasValidSession(request, pwHash))) return loginPage("");

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-cache");
    return out;
  },
};

async function hasValidSession(request, key) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]+)`));
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  return safeEqual(m[2], await sign(key, m[1]));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(secret, value) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// So sánh không lộ thời gian: băm cả hai về cùng độ dài rồi so.
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function loginPage(error) {
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>WAR ROOM – Đăng nhập</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6f9; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
  form { width: min(360px, calc(100vw - 32px)); background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 24px rgba(12, 31, 58, .08); }
  h1 { margin: 0 0 4px; font-size: 18px; color: #17365d; }
  p { margin: 0 0 20px; font-size: 13px; color: #64748b; }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #cbd5e1; border-radius: 8px; }
  input:focus { outline: 2px solid #1d4ed8; outline-offset: 1px; }
  button { margin-top: 14px; width: 100%; padding: 10px; font-size: 15px; font-weight: 600; color: #fff; background: #17365d; border: 0; border-radius: 8px; cursor: pointer; }
  button:hover { background: #1e477a; }
  .err { margin: 12px 0 0; color: #dc2626; font-size: 13px; }
</style>
</head>
<body>
<form method="POST" action="/login">
  <h1>WAR ROOM – 10 DÒNG TIỀN</h1>
  <p>Nhập mật khẩu để truy cập dashboard.</p>
  <input type="password" name="password" placeholder="Mật khẩu" autocomplete="current-password" autofocus required />
  <button type="submit">Đăng nhập</button>
  ${error ? `<div class="err">${error}</div>` : ""}
</form>
</body>
</html>`;
  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

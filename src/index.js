// Worker WAR ROOM: đăng nhập theo từng người (D1), phục vụ dashboard tĩnh (public/),
// API đặt lịch Chủ tịch và trang quản trị.
//
// Đăng nhập:
//   - Người dùng: tên kiểu vdhhoang (Võ Đào Huy Hoàng), mật khẩu mặc định CTG@2026,
//     bắt buộc đổi ở lần đăng nhập đầu. Tài khoản tạo từ trang Quản trị (đồng bộ từ dữ liệu dashboard).
//   - Quản trị: tên "admin", mật khẩu ACCESS_PASSWORD đặt trên Cloudflare, ở một trong hai chỗ:
//       Settings > Variables and Secrets (runtime): ưu tiên dùng nếu có;
//       Settings > Build > Variables and secrets: được băm lúc build (scripts/build-password.mjs),
//       đổi giá trị thì phải build lại (Retry build hoặc push).
// Mọi thao tác (đăng nhập, đổi/reset mật khẩu, đặt/hủy lịch, xem trang) ghi vào bảng audit_log.

import { BUILD_PASSWORD_HASH } from "../generated/password.js";
import { ensureSchema, log } from "./db.js";
import {
  DEFAULT_PASSWORD,
  adminVersion,
  clearCookie,
  hashPassword,
  isLocked,
  readSession,
  safeEqual,
  sessionCookie,
  sha256Hex,
  verifyPassword,
} from "./auth.js";
import { handleBookings } from "./bookings.js";
import { handleAdmin } from "./admin.js";
import { handleLive, LiveRoom } from "./live.js";
import { CHAIRMAN_LINK, changePasswordPage, loginPage, userChip } from "./pages.js";
import { json, redirect, text } from "./http.js";
import { getStreams } from "./worksuite/index.js";
import { handleExcel, withExcel } from "./excel/index.js";
import { handleSheetSync, sheetSyncStatus, syncSheet } from "./excel/sheet-sync.js";

// Durable Object đẩy thông báo thời gian thực (WebSocket) — xem src/live.js.
export { LiveRoom };

const VIEW_PAGES = new Set(["/", "/war-room", "/lich", "/admin"]);
// Trang được chèn nút "Hẹn lịch BOD" + ô người dùng: dashboard dòng tiền (/) và Bảng War Room live (/war-room).
const DASHBOARD_PAGES = new Set(["/", "/war-room"]);

export default {
  async fetch(request, env, ctx) {
    const adminHash = env.ACCESS_PASSWORD ? await sha256Hex(env.ACCESS_PASSWORD) : BUILD_PASSWORD_HASH;
    if (!adminHash) return text("ACCESS_PASSWORD chưa được cấu hình.", 500);
    if (!env.DB) return text("Chưa cấu hình database D1 (binding DB).", 500);
    await ensureSchema(env);

    const url = new URL(request.url);
    const path = url.pathname;
    // Chống CSRF: cookie SameSite=Lax vẫn được gửi khi một subdomain khác của ctgrouphitech.com POST tới đây,
    // nên mọi request ghi dữ liệu phải đến từ chính trang này (trình duyệt luôn gửi Origin khi POST/DELETE).
    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("Origin") !== url.origin) {
      return text("Yêu cầu không hợp lệ.", 403);
    }
    if (path === "/login" && request.method === "POST") return login(request, env, adminHash);

    const user = await readSession(env, request, adminHash);
    if (!user) return loginPage();
    if (path === "/login") return redirect("/");
    if (path === "/logout") {
      await log(env, request, user.username, "logout");
      return redirect("/", clearCookie());
    }
    if (path === "/doi-mat-khau") return changePassword(request, env, user);
    if (user.mustChange) {
      return path.startsWith("/api/") ? json({ error: "Bạn cần đổi mật khẩu trước.", mustChange: true }, 403) : redirect("/doi-mat-khau");
    }

    if (path === "/api/live" || path.startsWith("/api/live/")) return handleLive(request, env, url, user, ctx);
    if (path === "/api/bookings") return handleBookings(request, env, url, user, ctx);
    // Tiến độ dòng tiền từ CT Worksuite (src/worksuite/) + task Excel (src/excel/), kèm trạng thái đồng bộ Google Sheet.
    if (path === "/api/streams") {
      if (request.method !== "GET") return json({ error: "Chỉ hỗ trợ GET." }, 405);
      // Có người đang xem: đọc lại Google Sheet nếu lần trước đã quá 20 giây (chạy nền, không làm chậm trang).
      ctx.waitUntil(syncSheet(env).catch(() => {}));
      const data = await withExcel(env, await getStreams(env));
      data.sheetSync = await sheetSyncStatus(env);
      return json(data, data.error && !data.streams.length ? 502 : 200);
    }
    // Đồng bộ task từ Google Sheet WR - MASTER TASK (src/excel/sheet-sync.js): GET trạng thái, POST đồng bộ ngay.
    if (path === "/api/excel/sync") return handleSheetSync(request, env);
    // Nạp task từ file Excel (file tổng WR - MASTER TASK hoặc file 1 dòng tiền). Task Excel không qua cache Worksuite:
    // mọi màn hình (kể cả TV) thấy thay đổi ở lần tải /api/streams kế tiếp.
    if (path === "/api/excel") return handleExcel(request, env, url, user, (e) => getStreams(e));
    if (path.startsWith("/api/admin/") || path === "/admin" || path === "/admin.html") {
      if (user.role !== "admin") return text("Chỉ dành cho quản trị viên.", 403);
      if (path.startsWith("/api/admin/")) return handleAdmin(request, env, url, user);
    }

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-cache");
    if (res.ok && request.method === "GET" && VIEW_PAGES.has(path)) ctx.waitUntil(log(env, request, user.username, "view", path));
    if (DASHBOARD_PAGES.has(path) && res.ok) {
      return new HTMLRewriter()
        .on("body", {
          element: (el) => {
            el.append(CHAIRMAN_LINK, { html: true });
            el.append(userChip(user), { html: true });
          },
        })
        .transform(out);
    }
    return out;
  },

  // Cron mỗi phút (wrangler.jsonc › triggers): đọc lại Google Sheet WR - MASTER TASK — xem src/excel/sheet-sync.js.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncSheet(env));
  },
};

async function login(request, env, adminHash) {
  const form = await request.formData();
  const username = String(form.get("username") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");

  if (await isLocked(env, request, username)) {
    await log(env, request, username, "login_locked");
    return loginPage("Tài khoản tạm khóa 15 phút vì nhập sai quá nhiều lần.", username);
  }

  let pwVersion = null;
  let mustChange = false;
  if (username === "admin") {
    if (await safeEqual(await sha256Hex(password), adminHash)) pwVersion = adminVersion(adminHash);
  } else {
    const u = await env.DB.prepare("SELECT password_hash, pw_version, must_change FROM users WHERE username = ?").bind(username).first();
    if (u && (await verifyPassword(password, u.password_hash))) {
      pwVersion = u.pw_version;
      mustChange = !!u.must_change;
    }
  }
  if (pwVersion === null) {
    await log(env, request, username, "login_failed");
    return loginPage("Sai tên đăng nhập hoặc mật khẩu.", username);
  }

  if (username !== "admin") {
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE username = ?").bind(new Date().toISOString(), username).run();
  }
  await log(env, request, username, "login");
  return redirect(mustChange ? "/doi-mat-khau" : "/", await sessionCookie(env, username, pwVersion));
}

async function changePassword(request, env, user) {
  if (user.role === "admin") {
    return changePasswordPage(user, { info: "Mật khẩu admin là ACCESS_PASSWORD, đổi trên Cloudflare (Worker > Settings > Variables and secrets)." });
  }
  if (request.method !== "POST") return changePasswordPage(user, { forced: user.mustChange });

  const form = await request.formData();
  const current = String(form.get("current") || "");
  const next = String(form.get("next") || "");
  const confirm = String(form.get("confirm") || "");
  const u = await env.DB.prepare("SELECT password_hash, pw_version FROM users WHERE username = ?").bind(user.username).first();

  let error = "";
  if (!(await verifyPassword(current, u.password_hash))) error = "Mật khẩu hiện tại không đúng.";
  else if (next.length < 8) error = "Mật khẩu mới phải có ít nhất 8 ký tự.";
  else if (next === DEFAULT_PASSWORD || next === current) error = "Mật khẩu mới phải khác mật khẩu mặc định và mật khẩu hiện tại.";
  else if (next !== confirm) error = "Nhập lại mật khẩu mới không khớp.";
  if (error) {
    await log(env, request, user.username, "password_change_failed", error);
    return changePasswordPage(user, { error, forced: user.mustChange });
  }

  const pwVersion = u.pw_version + 1;
  await env.DB.prepare("UPDATE users SET password_hash = ?, must_change = 0, pw_version = ? WHERE username = ?")
    .bind(await hashPassword(next), pwVersion, user.username)
    .run();
  await log(env, request, user.username, "password_changed");
  return redirect("/", await sessionCookie(env, user.username, pwVersion));
}

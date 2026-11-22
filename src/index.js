// Worker WAR ROOM: đăng nhập theo từng người (D1), phục vụ 4 trang chính (mỗi trang có thanh điều hướng chung, src/pages.js),
// API đặt lịch Chủ tịch và trang quản trị.
//
// Trang:
//   /           Dòng tiền: màn hình War Room của Thành Anh (app React FE/, build vào public/app/ bằng scripts/build-fe.mjs,
//               dữ liệu GET /api/dashboard từ Google Sheet KPI, src/kpi/)
//   /kpi        KPI & kết quả (public/kpi.html)
//   /lich-truc  Lịch trực 24/7 (public/war-room.html; /war-room chuyển về đây)
//   /lich       Hẹn lịch BOD (public/lich.html)
//   /admin      Quản trị tài khoản & nhật ký (chỉ admin)
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
import { handleLive, LiveRoom, notifyLive } from "./live.js";
import { changePasswordPage, loginPage, navBar } from "./pages.js";
import { json, redirect, text } from "./http.js";
import { handleExcel, sheetOnlyBase, withExcel } from "./excel/index.js";
import { handleSheetSync, sheetSyncStatus, syncSheet } from "./excel/sheet-sync.js";
import { handleDashboard, handleKpi, syncKpi } from "./kpi/index.js";
import { handleKpiReview } from "./kpi/close.js"; // KPI-CLOSE: admin xác nhận đúng hạn
import { handleKpiCloseExport } from "./kpi/close-export.js"; // KPI-CLOSE: tải Excel chốt sổ
import { sharedLoader } from "./excel/gsheet.js";
import { countWaitingPointPeopleFromCsv, emptyWaitingPointState, mergeWaitingPointState } from "./waiting-point-sync.js";

// Durable Object đẩy thông báo thời gian thực (WebSocket) — xem src/live.js.
export { LiveRoom };

const VIEW_PAGES = new Set(["/", "/kpi", "/lich-truc", "/lich", "/waiting-point", "/admin"]);
// Trang được chèn thanh điều hướng chung (navBar) vào đầu <body>.
const NAV_PAGES = new Set(["/", "/kpi", "/lich-truc", "/lich", "/waiting-point", "/admin"]);
// Trang không trùng tên file trong public/: đường dẫn -> file phục vụ.
const PAGE_ASSET = { "/": "/app/", "/lich-truc": "/war-room" };

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
    if (path === "/login") return redirect("/kpi");
    if (path === "/logout") {
      await log(env, request, user.username, "logout");
      return redirect("/kpi", clearCookie());
    }
    if (path === "/doi-mat-khau") return changePassword(request, env, user);
    if (user.mustChange) {
      return path.startsWith("/api/") ? json({ error: "Bạn cần đổi mật khẩu trước.", mustChange: true }, 403) : redirect("/doi-mat-khau");
    }

    // Địa chỉ cũ: bảng War Room giờ chỉ còn lịch trực; bản build app React chỉ mở qua "/".
    if (path === "/war-room" || path === "/war-room.html") return redirect(`/lich-truc${url.search}`);
    if (path === "/index.html" || path === "/app" || path === "/app/" || path === "/app/index.html") return redirect("/");

    if (path === "/api/live" || path.startsWith("/api/live/")) return handleLive(request, env, url, user, ctx);
    if (path === "/api/bookings") return handleBookings(request, env, url, user, ctx);
    if (path === "/api/waiting-point") return handleWaitingPoint(request, env, ctx);
    if (path === "/api/waiting-point/status") return handleWaitingPointStatus(request);
    // Tiến độ dòng tiền từ CT Worksuite (src/worksuite/) + task Excel (src/excel/), kèm trạng thái đồng bộ Google Sheet.
    if (path === "/api/streams") {
      if (request.method !== "GET") return json({ error: "Chỉ hỗ trợ GET." }, 405);
      // Có người đang xem: đọc lại Google Sheet nếu lần trước đã quá 20 giây (chạy nền, không làm chậm trang).
      ctx.waitUntil(syncSheet(env).catch(() => {}));
      // Không kết nối CT Worksuite nữa: chỉ task từ Google Sheet + file Excel / phân chia nhóm đã nạp.
      const data = await withExcel(env, sheetOnlyBase());
      data.sheetSync = await sheetSyncStatus(env);
      return json(data, data.error && !data.streams.length ? 502 : 200);
    }
    // Đồng bộ task từ Google Sheet WR - MASTER TASK (src/excel/sheet-sync.js): GET trạng thái, POST đồng bộ ngay.
    if (path === "/api/excel/sync") return handleSheetSync(request, env);
    // KPI & kết quả 5 ngày từ Google Sheet KPI (src/kpi/): trang /kpi.
    if (path === "/api/kpi" || path === "/api/kpi/sync" || path === "/api/kpi/audit") return handleKpi(request, env, url, ctx); // KPI-CLOSE: + /api/kpi/audit
    // Màn hình War Room dòng tiền (app React FE/) ở trang "/": cùng dữ liệu KPI, theo định dạng của app.
    if (path === "/api/dashboard") return handleDashboard(request, env, url, ctx);
    // Nạp task từ file Excel (file tổng WR - MASTER TASK hoặc file 1 dòng tiền). Task Excel không qua cache Worksuite:
    // mọi màn hình (kể cả TV) thấy thay đổi ở lần tải /api/streams kế tiếp.
    if (path === "/api/excel" || path === "/api/excel/teams") return handleExcel(request, env, url, user, async () => sheetOnlyBase());
    if (path.startsWith("/api/admin/") || path === "/admin" || path === "/admin.html") {
      if (user.role !== "admin") return text("Chỉ dành cho quản trị viên.", 403);
      if (path === "/api/admin/kpi-review") return handleKpiReview(request, env, url, user); // KPI-CLOSE
      if (path === "/api/admin/kpi-close") return handleKpiCloseExport(request, env, url, user); // KPI-CLOSE: tải Excel chốt sổ
      if (path.startsWith("/api/admin/")) return handleAdmin(request, env, url, user);
    }

    const asset = PAGE_ASSET[path];
    const nav = NAV_PAGES.has(path);
    let assetReq = asset ? new Request(new URL(asset, url), request) : request;
    // Không trả 304 cho trang và file JS / CSS của trang (trừ file của app React có mã băm trong tên, /app/assets/):
    // - trang có thanh điều hướng (kèm tên người dùng) được dựng lại mỗi lần;
    // - `wrangler dev` đặt ETag theo đường dẫn chứ không theo nội dung, nên sửa kpi.js / kpi.css xong trình duyệt vẫn
    //   nhận 304 và chạy bản cũ (kể cả khi xem qua đường hầm cloudflared).
    if (nav || !path.startsWith("/app/assets/")) {
      const headers = new Headers(assetReq.headers);
      headers.delete("If-None-Match");
      headers.delete("If-Modified-Since");
      assetReq = new Request(assetReq.url, { method: assetReq.method, headers });
    }
    const res = await env.ASSETS.fetch(assetReq);
    if (path === "/" && res.status === 404) {
      return text("Màn hình Dòng tiền chưa được build: chạy `npm run build:fe` (wrangler deploy / dev tự chạy bước này).", 503);
    }
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-cache");
    if (res.ok && request.method === "GET" && VIEW_PAGES.has(path)) ctx.waitUntil(log(env, request, user.username, "view", path));
    if (nav && res.ok && /text\/html/.test(res.headers.get("Content-Type") || "")) {
      out.headers.delete("ETag");
      out.headers.delete("Last-Modified");
      out.headers.set("Cache-Control", "private, no-store");
      return new HTMLRewriter()
        .on("body", { element: (el) => el.prepend(navBar(user, path), { html: true }) })
        .transform(out);
    }
    return out;
  },

  // Cron mỗi phút (wrangler.jsonc › triggers): đọc lại Google Sheet task + phân chia nhóm (src/excel/sheet-sync.js)
  // và Google Sheet KPI (src/kpi/).
  async scheduled(event, env, ctx) {
    // Task và KPI cùng đọc file WR - MASTER TASK: tải + tách CSV 1 lần cho cả lượt (gói Free: 10 ms CPU / lượt).
    const load = sharedLoader();
    ctx.waitUntil(syncSheet(env, { load }));
    ctx.waitUntil(syncKpi(env, { load }));
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
  return redirect(mustChange ? "/doi-mat-khau" : "/kpi", await sessionCookie(env, username, pwVersion));
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
  return redirect("/kpi", await sessionCookie(env, user.username, pwVersion));
}

const WP_STATUS_SHEET_ID = "1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0";
const WP_STATUS_SHEET_NAME = "Điểm nghẽn";
const WP_STATUS_GID = "2043772221";
let wpStatusCache = { at: 0, data: null };

async function handleWaitingPointStatus(request) {
  if (request.method !== "GET") return json({ error: "Chỉ hỗ trợ GET." }, 405);
  const now = Date.now();
  if (wpStatusCache.data && now - wpStatusCache.at < 5000) {
    return json(wpStatusCache.data);
  }
  const urls = [
    `https://docs.google.com/spreadsheets/d/${WP_STATUS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(WP_STATUS_SHEET_NAME)}&_t=${now}`,
    `https://docs.google.com/spreadsheets/d/${WP_STATUS_SHEET_ID}/export?format=csv&gid=${WP_STATUS_GID}&_t=${now}`,
  ];
  for (const csvUrl of urls) {
    try {
      const res = await fetch(csvUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = countWaitingPointPeopleFromCsv(await res.text());
      wpStatusCache = { at: now, data };
      return json(data);
    } catch { /* thử nguồn dự phòng */ }
  }
  return json(wpStatusCache.data || { peopleCount: 0, itemCount: 0, sec: 0, error: true });
}

// Đồng bộ trạng thái đếm ngược & thống kê theo ngày của trang Waiting Point lưu trong bảng settings (D1).
async function handleWaitingPoint(request, env, ctx) {
  const KEY = "waiting_point_state";
  const readCurrent = async () => {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY).first();
    if (!row?.value) return emptyWaitingPointState();
    try {
      return mergeWaitingPointState(JSON.parse(row.value), {}, Date.now());
    } catch {
      return emptyWaitingPointState();
    }
  };

  if (request.method === "GET") {
    return json(await readCurrent());
  }
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const next = mergeWaitingPointState(await readCurrent(), body && typeof body === "object" ? body : {});
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
      .bind(KEY, JSON.stringify(next))
      .run();
    if (ctx) ctx.waitUntil(notifyLive(env, { scope: "waiting-point" }));
    return json(next);
  }
  return json({ error: "Chỉ hỗ trợ GET và POST." }, 405);
}

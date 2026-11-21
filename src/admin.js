// API quản trị (chỉ admin): danh sách user, đồng bộ user từ dữ liệu dashboard, reset mật khẩu, nhật ký.
//
//   GET  /api/admin/users
//   POST /api/admin/users/sync    tạo tài khoản cho người có trong dữ liệu dashboard (INITIAL_DATA, nạp từ Excel)
//   POST /api/admin/users/reset   {username} -> mật khẩu mặc định, bắt đổi lại
//   GET  /api/admin/logs?user=    500 dòng nhật ký mới nhất

import { log } from "./db.js";
import { DEFAULT_PASSWORD, hashPassword, makeUsername, normKey } from "./auth.js";
import { json } from "./http.js";

const PLACEHOLDER = ["them nguoi", "bo sung", "de xuat", "theo ca truc", "chua phan cong", "dang can nhac", "chua co ten", "tbd"];

export async function handleAdmin(request, env, url, user) {
  const path = url.pathname;

  if (path === "/api/admin/users" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT username, full_name, title, department, must_change, last_login_at, created_at FROM users ORDER BY full_name"
    ).all();
    return json({ users: results });
  }

  if (path === "/api/admin/users/sync" && request.method === "POST") return syncUsers(request, env, user);

  if (path === "/api/admin/users/reset" && request.method === "POST") {
    const username = String((await request.json().catch(() => ({}))).username || "");
    const { meta } = await env.DB.prepare("UPDATE users SET password_hash = ?, must_change = 1, pw_version = pw_version + 1 WHERE username = ?")
      .bind(await hashPassword(DEFAULT_PASSWORD), username)
      .run();
    if (!meta.changes) return json({ error: "Không tìm thấy tài khoản." }, 404);
    await log(env, request, user.username, "password_reset", username);
    return json({ ok: true });
  }

  if (path === "/api/admin/logs" && request.method === "GET") {
    const who = url.searchParams.get("user") || "";
    const sql = "SELECT id, ts, username, action, detail, ip FROM audit_log";
    const stmt = who
      ? env.DB.prepare(`${sql} WHERE username = ? ORDER BY id DESC LIMIT 500`).bind(who)
      : env.DB.prepare(`${sql} ORDER BY id DESC LIMIT 500`);
    return json({ logs: (await stmt.all()).results });
  }

  return json({ error: "Không tìm thấy." }, 404);
}

// Đọc danh sách thành viên từ INITIAL_DATA trong public/war-room.html (bảng War Room nạp từ Excel,
// trước đây là public/index.html) và tạo tài khoản cho người chưa có.
// Không đổi tài khoản đã có. Người mới dùng mật khẩu mặc định và phải đổi ở lần đăng nhập đầu.
async function syncUsers(request, env, user) {
  const html = await (await env.ASSETS.fetch(new Request(new URL("/war-room", request.url)))).text();
  const m = /const INITIAL_DATA = (\{.*\});\s*$/m.exec(html);
  if (!m) return json({ error: "Không đọc được dữ liệu dashboard (INITIAL_DATA)." }, 500);
  const tasks = JSON.parse(m[1]).tasks || [];

  const { results: existing } = await env.DB.prepare("SELECT username, full_name FROM users").all();
  const taken = new Set(existing.map((u) => u.username).concat("admin"));
  const names = new Set(existing.map((u) => normKey(u.full_name)));
  const created = [];
  for (const t of tasks) {
    const fullName = String(t.member || "").trim();
    const key = normKey(fullName);
    if (!key || t.isPlaceholder || PLACEHOLDER.some((p) => key.includes(p)) || names.has(key)) continue;
    const base = makeUsername(fullName);
    if (!base) continue;
    let username = base;
    for (let i = 2; taken.has(username); i++) username = base + i;
    taken.add(username);
    names.add(key);
    created.push({ username, fullName, title: t.title || "", department: t.department || "" });
  }

  if (created.length) {
    // Một mã băm mật khẩu mặc định dùng chung cho các tài khoản mới (băm 1 lần cho nhanh);
    // mỗi người đổi sang mật khẩu riêng (salt riêng) ở lần đăng nhập đầu.
    const hash = await hashPassword(DEFAULT_PASSWORD);
    const now = new Date().toISOString();
    await env.DB.batch(
      created.map((c) =>
        env.DB.prepare(
          "INSERT INTO users (username, full_name, title, department, password_hash, must_change, pw_version, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)"
        ).bind(c.username, c.fullName, c.title, c.department, hash, now)
      )
    );
  }
  await log(env, request, user.username, "users_synced", `+${created.length}: ${created.map((c) => c.username).join(", ")}`);
  return json({ created, total: existing.length + created.length });
}

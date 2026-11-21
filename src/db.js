// Schema D1 (tạo lần đầu mỗi isolate) và ghi nhật ký thao tác.

let ready = false;

export async function ensureSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        must_change INTEGER NOT NULL DEFAULT 1,
        pw_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_login_at TEXT
      )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT ''
      )`
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_audit_user_ts ON audit_log (username, ts)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_audit_ip_action_ts ON audit_log (ip, action, ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS chairman_bookings (
        slot TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT ''
      )`
    ),
  ]);
  // Bảng chairman_bookings tạo từ bản trước chưa có cột username.
  const { results } = await env.DB.prepare("PRAGMA table_info(chairman_bookings)").all();
  if (!results.some((c) => c.name === "username")) {
    await env.DB.prepare("ALTER TABLE chairman_bookings ADD COLUMN username TEXT NOT NULL DEFAULT ''").run();
  }
  ready = true;
}

export async function log(env, request, username, action, detail = "") {
  await env.DB.prepare("INSERT INTO audit_log (ts, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)")
    .bind(
      new Date().toISOString(),
      String(username || "").slice(0, 60),
      action,
      String(detail).slice(0, 1000),
      request.headers.get("CF-Connecting-IP") || ""
    )
    .run();
}

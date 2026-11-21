// Mật khẩu (PBKDF2-SHA256) và phiên đăng nhập (cookie ký HMAC, hiệu lực 30 ngày).
// Cookie: wr_session=<username>.<exp>.<chữ ký>. Chữ ký gồm pw_version nên khi đổi/reset mật khẩu,
// mọi phiên cũ của người đó mất hiệu lực. Khóa ký là chuỗi ngẫu nhiên lưu trong bảng settings.

export const DEFAULT_PASSWORD = "CTG@2026";
const ITERATIONS = 20000; // ~3 ms CPU mỗi lần băm, nằm trong giới hạn CPU của Workers gói Free
const COOKIE = "wr_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOCK_FAILS = 10;
const LOCK_MINUTES = 15;
const enc = new TextEncoder();
let sessionKey = null;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [alg, iterations, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2") return false;
  const expected = fromB64(hash);
  const actual = await derive(password, fromB64(salt), Number(iterations));
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

export async function sessionCookie(env, username, pwVersion) {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const sig = await hmacHex(await getSessionKey(env), `${username}|${exp}|${pwVersion}`);
  return `${COOKIE}=${username}.${exp}.${sig}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie() {
  return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// Trả về { username, fullName, role, mustChange } hoặc null nếu chưa đăng nhập / phiên không hợp lệ.
export async function readSession(env, request, adminHash) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-z0-9]+)\\.(\\d+)\\.([0-9a-f]{64})`));
  if (!m || Number(m[2]) < Date.now() / 1000) return null;
  const [, username, exp, sig] = m;
  const key = await getSessionKey(env);
  if (username === "admin") {
    const ok = await safeEqual(sig, await hmacHex(key, `admin|${exp}|${adminVersion(adminHash)}`));
    return ok ? { username: "admin", fullName: "Quản trị viên", role: "admin", mustChange: false } : null;
  }
  const u = await env.DB.prepare("SELECT full_name, must_change, pw_version FROM users WHERE username = ?").bind(username).first();
  if (!u || !(await safeEqual(sig, await hmacHex(key, `${username}|${exp}|${u.pw_version}`)))) return null;
  return { username, fullName: u.full_name, role: "user", mustChange: !!u.must_change };
}

// Phiên admin gắn với mật khẩu admin hiện tại: đổi ACCESS_PASSWORD thì phiên admin cũ hết hiệu lực.
export function adminVersion(adminHash) {
  return adminHash.slice(0, 16);
}

export async function isLocked(env, username) {
  const since = new Date(Date.now() - LOCK_MINUTES * 60e3).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE username = ? AND action = 'login_failed' AND ts > ?")
    .bind(username, since)
    .first();
  return row.n >= LOCK_FAILS;
}

export function normKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[đð]/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "Võ Đào Huy Hoàng" -> "vdhhoang": chữ cái đầu của họ và tên đệm + tên (bỏ dấu, bỏ Mr/Ms).
export function makeUsername(fullName) {
  const words = normKey(fullName)
    .replace(/[0-9]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["mr", "mrs", "ms"].includes(w));
  if (!words.length) return "";
  const last = words.pop();
  return words.map((w) => w[0]).join("") + last;
}

export async function sha256Hex(value) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
}

// So sánh chuỗi không lộ thời gian: băm cả hai về cùng độ dài rồi so.
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function getSessionKey(env) {
  if (sessionKey) return sessionKey;
  const fresh = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_key', ?)").bind(fresh).run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'session_key'").first();
  return (sessionKey = row.value);
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s || ""), (c) => c.charCodeAt(0));

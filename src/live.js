// Đồng bộ dashboard WAR ROOM giữa mọi người dùng theo thời gian thực.
// D1 là nơi lưu dữ liệu. Durable Object LiveRoom chỉ giữ các WebSocket đang mở (hibernation)
// và đẩy tín hiệu "có thay đổi" + danh sách người đang online; trình duyệt tự tải dữ liệu qua API.
//
//   GET  /api/live?since=<eventId>&baseAt=<iso>   trạng thái mới nhất ({unchanged:true} nếu không có gì mới)
//   GET  /api/live/ws                              WebSocket: {type:"change",scope,cursor} | {type:"presence",online}
//   POST /api/live/task       {id, fields, member, diffs}           cập nhật 1 đầu việc
//   POST /api/live/directive  {id, fields, title}                   cập nhật 1 chỉ đạo của Chủ tịch
//   POST /api/live/base       (chỉ admin) {data:{tasks,shiftColumns}, fileName, summary, diffs}   nạp dữ liệu từ file Excel
//   POST /api/live/reset      (chỉ admin) xóa mọi cập nhật, quay về dữ liệu gốc nhúng trong public/index.html
//
// Dữ liệu gốc (khi chưa ai nạp Excel) nằm trong public/index.html (INITIAL_DATA).
// Cập nhật trên dashboard lưu thành "override" theo từng đầu việc, áp lên dữ liệu gốc; "" nghĩa là xóa giá trị gốc.

import { DurableObject } from "cloudflare:workers";
import { json } from "./http.js";
import { log } from "./db.js";

const ID_RE = /^[\w-]{1,64}$/;
const STATUSES = ["not_started", "in_progress", "blocked", "verifying", "done"];
const TASK_FIELDS = ["status", "stage", "progress", "deadline", "cashflowValue", "blocker", "result", "note"];
const DIRECTIVE_FIELDS = ["status", "progress"];
const TASK_TEXT = ["id", "sheet", "groupType", "category", "streamKey", "streamShort", "streamName", "member", "title", "department", "task", "deadline", "blocker", "result", "cashflowValue", "note"];
let ready = false;

export async function handleLive(request, env, url, user, ctx) {
  const path = url.pathname;
  if (path === "/api/live/ws") return connect(request, env, user);

  await ensureLiveSchema(env);
  if (path === "/api/live" && request.method === "GET") return snapshot(env, url, user);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // Chống CSRF: cookie SameSite=Lax vẫn đi kèm request từ subdomain khác cùng site, nên chỉ nhận POST từ chính trang này.
  if (request.headers.get("Origin") !== url.origin) return json({ error: "Nguồn yêu cầu không hợp lệ." }, 403);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Dữ liệu gửi lên không hợp lệ." }, 400);

  let result;
  if (path === "/api/live/task") result = await saveOverride(env, user, "task", body);
  else if (path === "/api/live/directive") result = await saveOverride(env, user, "directive", body);
  else if (path === "/api/live/base") result = await saveBase(env, user, body);
  else if (path === "/api/live/reset") result = await reset(env, user);
  else return json({ error: "Không tìm thấy." }, 404);
  if (result.error) return json({ error: result.error }, result.status || 400);

  const wait = (p) => (ctx ? ctx.waitUntil(p) : p);
  wait(notifyLive(env, { scope: "dashboard", cursor: result.cursor }));
  wait(log(env, request, user.username, `dashboard_${path.split("/").pop()}`, result.summary).catch(() => {}));
  return json({ ok: true, cursor: result.cursor });
}

// Báo cho mọi trình duyệt đang mở rằng có thay đổi. Không bao giờ ném lỗi.
export async function notifyLive(env, payload) {
  try {
    if (!env.LIVE) return;
    await room(env).fetch("https://live/notify", { method: "POST", body: JSON.stringify({ ...payload, type: "change" }) });
  } catch (_) {}
}

// Một phòng duy nhất cho cả War Room.
export class LiveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Trả lời "ping" ngay tại runtime, không đánh thức object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/ws") {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        username: request.headers.get("X-Live-User") || "",
        fullName: decodeURIComponent(request.headers.get("X-Live-Name") || ""),
      });
      this.presence();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (pathname === "/notify") {
      this.broadcast(await request.text());
      return new Response("ok");
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage() {}

  webSocketClose(ws) {
    this.presence(ws);
  }

  webSocketError(ws) {
    this.presence(ws);
  }

  // Gửi danh sách người đang online (mỗi người một lần dù mở nhiều tab).
  presence(gone) {
    const online = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === gone) continue;
      const who = ws.deserializeAttachment();
      if (who && who.username) online.set(who.username, who.fullName);
    }
    const list = [...online].map(([username, fullName]) => ({ username, fullName }));
    this.broadcast(JSON.stringify({ type: "presence", online: list }), gone);
  }

  broadcast(message, skip) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      try {
        ws.send(message);
      } catch (_) {}
    }
  }
}

function room(env) {
  return env.LIVE.get(env.LIVE.idFromName("warroom"));
}

// Trả nguyên response 101 của Durable Object cho trình duyệt.
function connect(request, env, user) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ error: "Cần kết nối WebSocket." }, 426);
  // Chặn trang của tên miền khác (kể cả tên miền con) mở WebSocket bằng cookie của người dùng.
  if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "Nguồn kết nối không hợp lệ." }, 403);
  if (!env.LIVE) return json({ error: "Chưa cấu hình Durable Object LIVE." }, 501);
  const headers = new Headers(request.headers);
  headers.set("X-Live-User", user.username);
  headers.set("X-Live-Name", encodeURIComponent(user.fullName || user.username));
  return room(env).fetch(new Request("https://live/ws", { headers }));
}

async function ensureLiveSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS live_base (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        file_name TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS live_overrides (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS live_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        username TEXT NOT NULL,
        actor TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        file_name TEXT NOT NULL DEFAULT '',
        diffs TEXT NOT NULL DEFAULT '[]'
      )`
    ),
  ]);
  ready = true;
}

// Khi không có sự kiện mới chỉ đọc 1 dòng (MAX(id)), nên gọi thường xuyên vẫn rẻ.
async function snapshot(env, url, user) {
  const me = { username: user.username, fullName: user.fullName, role: user.role };
  const cursor = (await env.DB.prepare("SELECT MAX(id) AS id FROM live_events").first()).id || 0;
  let since = Number(url.searchParams.get("since")) || 0;
  if (since > cursor) since = 0; // database đã bị làm mới: gửi lại toàn bộ
  if (since && since === cursor) return json({ me, cursor, unchanged: true });

  const [ov, ev, base] = await env.DB.batch([
    env.DB.prepare("SELECT key, data, updated_by, updated_at FROM live_overrides"),
    env.DB.prepare("SELECT id, ts, username, actor, kind, summary, file_name, diffs FROM live_events WHERE id > ? ORDER BY id DESC LIMIT 60").bind(since),
    env.DB.prepare("SELECT file_name, updated_by, updated_at FROM live_base WHERE id = 1"),
  ]);
  let baseOut = null;
  const b = base.results[0];
  if (b) {
    baseOut = { at: b.updated_at, fileName: b.file_name, by: b.updated_by };
    if (url.searchParams.get("baseAt") !== b.updated_at) {
      baseOut.data = JSON.parse((await env.DB.prepare("SELECT data FROM live_base WHERE id = 1").first()).data);
    }
  }
  return json({
    me,
    cursor,
    full: since === 0,
    base: baseOut,
    overrides: ov.results.map((r) => ({ key: r.key, data: JSON.parse(r.data), by: r.updated_by, at: r.updated_at })),
    events: ev.results.map((r) => ({
      id: r.id,
      ts: r.ts,
      username: r.username,
      actor: r.actor,
      kind: r.kind,
      summary: r.summary,
      fileName: r.file_name,
      diffs: JSON.parse(r.diffs),
    })),
  });
}

async function saveOverride(env, user, kind, body) {
  const id = String(body.id || "");
  if (!ID_RE.test(id)) return { error: "Mã đầu việc không hợp lệ." };
  const fields = cleanFields(body.fields, kind === "task" ? TASK_FIELDS : DIRECTIVE_FIELDS);
  if (!fields) return { error: "Không có thay đổi hợp lệ." };
  const actor = user.fullName || user.username;
  const summary = kind === "task" ? `${actor} cập nhật cho ${clip(body.member, 80) || id}` : `${actor} cập nhật chỉ đạo: ${clip(body.title, 120) || id}`;
  const now = new Date().toISOString();
  // json_patch gộp các trường mới vào bản ghi cũ ngay trong SQLite, hai người sửa hai trường khác nhau không mất của nhau.
  const [, ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO live_overrides (key, data, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = json_patch(data, excluded.data), updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).bind(`${kind}:${id}`, JSON.stringify(fields), user.username, now),
    insertEvent(env, now, user, kind, summary, "Dashboard War Room", cleanDiffs(body.diffs)),
  ]);
  return { cursor: ins.meta.last_row_id, summary };
}

async function saveBase(env, user, body) {
  if (user.role !== "admin") return { error: "Chỉ quản trị viên được nạp file Excel.", status: 403 };
  const data = body.data || {};
  if (!Array.isArray(data.tasks) || !data.tasks.length || data.tasks.length > 3000) return { error: "File Excel không có đầu việc hợp lệ." };
  const tasks = data.tasks.map(cleanTask).filter(Boolean);
  if (!tasks.length) return { error: "File Excel không có đầu việc hợp lệ." };
  const shiftColumns = (Array.isArray(data.shiftColumns) ? data.shiftColumns : []).slice(0, 200).map(cleanShiftColumn).filter(Boolean);
  const text = JSON.stringify({ tasks, shiftColumns });
  if (text.length > 1_500_000) return { error: "Dữ liệu quá lớn.", status: 413 };

  const fileName = clip(body.fileName, 120) || "Excel";
  const actor = user.fullName || user.username;
  const summary = clip(body.summary, 200) || `${actor} nạp ${fileName} (${tasks.length} đầu việc)`;
  const now = new Date().toISOString();
  const [, ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO live_base (id, data, file_name, updated_by, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, file_name = excluded.file_name, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).bind(text, fileName, user.username, now),
    insertEvent(env, now, user, "excel", summary, fileName, cleanDiffs(body.diffs)),
  ]);
  return { cursor: ins.meta.last_row_id, summary };
}

async function reset(env, user) {
  if (user.role !== "admin") return { error: "Chỉ quản trị viên được khôi phục dữ liệu gốc.", status: 403 };
  const now = new Date().toISOString();
  const summary = `${user.fullName || user.username} khôi phục dữ liệu gốc (xóa mọi cập nhật trên dashboard)`;
  const [, , ins] = await env.DB.batch([
    env.DB.prepare("DELETE FROM live_overrides"),
    env.DB.prepare("DELETE FROM live_base"),
    insertEvent(env, now, user, "reset", summary, "Dashboard War Room", []),
  ]);
  return { cursor: ins.meta.last_row_id, summary };
}

function insertEvent(env, now, user, kind, summary, fileName, diffs) {
  return env.DB.prepare("INSERT INTO live_events (ts, username, actor, kind, summary, file_name, diffs) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
    now,
    user.username,
    user.fullName || user.username,
    kind,
    summary,
    fileName,
    JSON.stringify(diffs)
  );
}

function cleanFields(fields, allowed) {
  if (!fields || typeof fields !== "object") return null;
  const out = {};
  for (const k of allowed) {
    if (!(k in fields)) continue;
    const v = fields[k];
    if (k === "status") {
      if (!STATUSES.includes(v)) return null;
      out.status = v;
    } else if (k === "progress") out.progress = clampInt(v, 0, 100, 0);
    else if (k === "stage") out.stage = clampInt(v, 1, 6, 1);
    else out[k] = clip(v, 500);
  }
  return Object.keys(out).length ? out : null;
}

function cleanDiffs(diffs) {
  return (Array.isArray(diffs) ? diffs : []).slice(0, 25).map((d) => ({
    taskId: clip(d && d.taskId, 64),
    member: clip(d && d.member, 80),
    field: clip(d && d.field, 60),
    before: clip(d && d.before, 200),
    after: clip(d && d.after, 200),
  }));
}

// Dữ liệu Excel do trình duyệt gửi lên sẽ hiển thị cho mọi người: chỉ giữ các trường đã biết, đúng kiểu.
function cleanTask(t) {
  if (!t || typeof t !== "object") return null;
  const o = {};
  for (const k of TASK_TEXT) if (t[k] != null && t[k] !== "") o[k] = clip(t[k], 600);
  if (!o.id || !ID_RE.test(o.id) || !o.streamKey) return null;
  o.member = o.member || "Chưa phân công nhân sự";
  o.streamShort = o.streamShort || "Khác";
  o.streamName = o.streamName || "Chưa phân nhóm";
  o.row = clampInt(t.row, 0, 1e6, 0);
  if (t.streamNo != null && Number.isFinite(Number(t.streamNo))) o.streamNo = clampInt(t.streamNo, 0, 1000, 0);
  if (t.isPlaceholder) o.isPlaceholder = true;
  o.status = STATUSES.includes(t.status) ? t.status : "not_started";
  o.progress = clampInt(t.progress, 0, 100, 0);
  o.stage = clampInt(t.stage, 1, 6, 1);
  if (Array.isArray(t.activeShiftKeys) && t.activeShiftKeys.length) o.activeShiftKeys = t.activeShiftKeys.slice(0, 200).map((s) => clip(s, 40));
  return o;
}

function cleanShiftColumn(c) {
  if (!c || typeof c !== "object" || !c.key) return null;
  return {
    col: clampInt(c.col, 0, 1e5, 0),
    date: clip(c.date, 20),
    dateLabel: clip(c.dateLabel, 60),
    shift: c.shift === "night" ? "night" : "day",
    key: clip(c.key, 40),
    label: clip(c.label, 60),
  };
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function clip(v, max) {
  return String(v ?? "").trim().slice(0, max);
}

// API đặt lịch họp với Chủ tịch. Dữ liệu lưu trong D1 (bảng chairman_bookings, xem db.js).
// Mỗi lượt = 1 khung 30 phút; khóa chính là giờ bắt đầu (giờ Việt Nam, "YYYY-MM-DDTHH:MM"),
// nên hai người không thể đặt trùng một khung: người đến sau nhận lỗi 409.
// Ca Sáng 08:00–17:30, Ca Tối 18:00–03:30 (sang rạng sáng hôm sau).
// Tên người đặt lấy từ tài khoản đang đăng nhập. Chỉ người đặt hoặc admin được hủy.
//
//   GET    /api/bookings?from=<slot>&to=<slot>      danh sách trong khoảng [from, to) + người đang đăng nhập
//   POST   /api/bookings  {slots: [...], kind, note} kind: "meeting" (họp) | "block" (Chủ tịch bận)
//          (vẫn nhận {slot} cũ). Tất cả hoặc không: trùng một khung thì không ghi khung nào, trả 409 {taken}.
//   DELETE /api/bookings?slot=<slot>&slot=<slot>...  hủy; có một khung không được phép hủy thì không hủy khung nào (403)

import { log } from "./db.js";
import { json } from "./http.js";
import { notifyLive } from "./live.js";

const SLOT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const KINDS = ["meeting", "block"];
const MAX_SLOTS = 48; // đủ cả hai ca của một ngày (38 khung)

export async function handleBookings(request, env, url, user, ctx) {
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT slot, kind, name, note, username, created_at FROM chairman_bookings WHERE slot >= ? AND slot < ? ORDER BY slot"
    )
      .bind(url.searchParams.get("from") || "", url.searchParams.get("to") || "")
      .all();
    return json({ bookings: results, now: nowVN(), me: { username: user.username, fullName: user.fullName, role: user.role } });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const slots = uniqueSlots(Array.isArray(body.slots) ? body.slots : [body.slot]);
    const kind = String(body.kind || "");
    const note = String(body.note || "").trim().slice(0, 300);
    if (slots.length > MAX_SLOTS) return json({ error: `Mỗi lần tối đa ${MAX_SLOTS} ô. Vui lòng chia làm nhiều lần.` }, 400);
    if (!slots.length || !slots.every(isValidSlot)) return json({ error: "Khung giờ không hợp lệ." }, 400);
    if (!KINDS.includes(kind)) return json({ error: "Loại đặt lịch không hợp lệ." }, 400);
    const now = nowVN();
    if (slots.some((s) => addMinutes(s, 30) <= now)) return json({ error: "Có khung giờ đã qua." }, 400);

    // Một câu INSERT cho mọi khung: trùng khóa ở một khung thì cả câu thất bại, không khung nào được ghi.
    try {
      await env.DB.prepare(
        `INSERT INTO chairman_bookings (slot, kind, name, note, username, created_at)
         SELECT value, ?2, ?3, ?4, ?5, ?6 FROM json_each(?1)`
      )
        .bind(JSON.stringify(slots), kind, user.fullName, note, user.username, new Date().toISOString())
        .run();
    } catch (err) {
      const taken = await findBookings(env, slots);
      if (!taken.length) throw err;
      return json({ error: "Có khung giờ vừa có người đặt. Vui lòng bỏ các khung đó và thử lại.", taken: taken.map((b) => b.slot) }, 409);
    }
    await log(env, request, user.username, kind === "block" ? "booking_blocked" : "booking_created", `${slots.join(", ")}${note ? " · " + note : ""}`);
    ctx.waitUntil(notifyLive(env, { scope: "bookings" }));
    return json({ ok: true, slots }, 201);
  }

  if (request.method === "DELETE") {
    const slots = uniqueSlots(url.searchParams.getAll("slot"));
    if (slots.length > MAX_SLOTS) return json({ error: `Mỗi lần tối đa ${MAX_SLOTS} ô. Vui lòng chia làm nhiều lần.` }, 400);
    const rows = await findBookings(env, slots);
    if (!rows.length) return json({ ok: true, slots: [] });
    const isAdmin = user.role === "admin";
    if (!isAdmin && rows.some((r) => r.username !== user.username)) {
      return json({ error: "Chỉ người đặt hoặc quản trị viên được hủy lịch này." }, 403);
    }
    // Chỉ xóa đúng các dòng vừa kiểm tra; người thường chỉ xóa được dòng của mình (phòng khi khung vừa đổi chủ).
    await env.DB.prepare("DELETE FROM chairman_bookings WHERE slot IN (SELECT value FROM json_each(?1)) AND (?2 OR username = ?3)")
      .bind(JSON.stringify(rows.map((r) => r.slot)), isAdmin ? 1 : 0, user.username)
      .run();
    const detail = rows.map((r) => `${r.slot} · ${r.kind === "block" ? "chặn lịch" : "lịch của " + r.name}`).join("; ");
    await log(env, request, user.username, "booking_cancelled", detail);
    ctx.waitUntil(notifyLive(env, { scope: "bookings" }));
    return json({ ok: true, slots: rows.map((r) => r.slot) });
  }

  return json({ error: "Method not allowed" }, 405);
}

// Khung hợp lệ: phút 00/30, nằm trong Ca Sáng [08:00, 17:30) hoặc Ca Tối [18:00, 24:00) ∪ [00:00, 03:30).
function isValidSlot(slot) {
  const m = SLOT_RE.exec(slot);
  if (!m || (m[5] !== "00" && m[5] !== "30")) return false;
  if (new Date(`${slot}:00Z`).toISOString().slice(0, 16) !== slot) return false;
  const min = Number(m[4]) * 60 + Number(m[5]);
  return (min >= 480 && min < 1050) || min >= 1080 || min < 210;
}

function uniqueSlots(list) {
  return [...new Set(list.map(String))].sort();
}

async function findBookings(env, slots) {
  const { results } = await env.DB.prepare(
    "SELECT slot, kind, name, username FROM chairman_bookings WHERE slot IN (SELECT value FROM json_each(?)) ORDER BY slot"
  )
    .bind(JSON.stringify(slots))
    .all();
  return results;
}

function nowVN() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16);
}

function addMinutes(slot, minutes) {
  return new Date(Date.parse(`${slot}:00Z`) + minutes * 60e3).toISOString().slice(0, 16);
}

// API đặt lịch họp với Chủ tịch. Dữ liệu lưu trong D1 (bảng chairman_bookings, xem db.js).
// Mỗi lượt = 1 khung 30 phút; khóa chính là giờ bắt đầu (giờ Việt Nam, "YYYY-MM-DDTHH:MM"),
// nên hai người không thể đặt trùng một khung: người đến sau nhận lỗi 409.
// Ca Sáng 08:00–17:30, Ca Tối 18:00–03:30 (sang rạng sáng hôm sau).
// Tên người đặt lấy từ tài khoản đang đăng nhập. Chỉ người đặt hoặc admin được hủy.
//
//   GET    /api/bookings?from=<slot>&to=<slot>   danh sách trong khoảng [from, to) + người đang đăng nhập
//   POST   /api/bookings  {slot, kind, note}      kind: "meeting" (họp) | "block" (Chủ tịch bận)
//   DELETE /api/bookings?slot=<slot>              hủy

import { log } from "./db.js";
import { json } from "./http.js";
import { notifyLive } from "./live.js";

const SLOT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const KINDS = ["meeting", "block"];

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
    const slot = String(body.slot || "");
    const kind = String(body.kind || "");
    const note = String(body.note || "").trim().slice(0, 300);
    if (!isValidSlot(slot)) return json({ error: "Khung giờ không hợp lệ." }, 400);
    if (!KINDS.includes(kind)) return json({ error: "Loại đặt lịch không hợp lệ." }, 400);
    if (addMinutes(slot, 30) <= nowVN()) return json({ error: "Khung giờ này đã qua." }, 400);

    const { meta } = await env.DB.prepare(
      "INSERT INTO chairman_bookings (slot, kind, name, note, username, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(slot) DO NOTHING"
    )
      .bind(slot, kind, user.fullName, note, user.username, new Date().toISOString())
      .run();
    if (!meta.changes) return json({ error: "Khung giờ này vừa có người đặt. Vui lòng chọn khung khác." }, 409);
    await log(env, request, user.username, kind === "block" ? "booking_blocked" : "booking_created", `${slot}${note ? " · " + note : ""}`);
    ctx.waitUntil(notifyLive(env, { scope: "bookings" }));
    return json({ ok: true }, 201);
  }

  if (request.method === "DELETE") {
    const slot = url.searchParams.get("slot") || "";
    const row = await env.DB.prepare("SELECT kind, name, username FROM chairman_bookings WHERE slot = ?").bind(slot).first();
    if (!row) return json({ ok: true });
    if (user.role !== "admin" && row.username !== user.username) {
      return json({ error: "Chỉ người đặt hoặc quản trị viên được hủy lịch này." }, 403);
    }
    await env.DB.prepare("DELETE FROM chairman_bookings WHERE slot = ?").bind(slot).run();
    await log(env, request, user.username, "booking_cancelled", `${slot} · ${row.kind === "block" ? "chặn lịch" : "lịch của " + row.name}`);
    ctx.waitUntil(notifyLive(env, { scope: "bookings" }));
    return json({ ok: true });
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

function nowVN() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16);
}

function addMinutes(slot, minutes) {
  return new Date(Date.parse(`${slot}:00Z`) + minutes * 60e3).toISOString().slice(0, 16);
}

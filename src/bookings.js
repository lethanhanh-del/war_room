// API đặt lịch họp với Chủ tịch. Dữ liệu lưu trong D1 (binding DB).
// Mỗi lượt = 1 khung 30 phút; khóa chính là giờ bắt đầu (giờ Việt Nam, "YYYY-MM-DDTHH:MM"),
// nên hai người không thể đặt trùng một khung: người đến sau nhận lỗi 409.
// Ca Sáng 08:00–17:30, Ca Tối 18:00–03:30 (sang rạng sáng hôm sau).
//
//   GET    /api/bookings?from=<slot>&to=<slot>   danh sách trong khoảng [from, to)
//   POST   /api/bookings  {slot, kind, name, note} kind: "meeting" (họp) | "block" (Chủ tịch bận)
//   DELETE /api/bookings?slot=<slot>              hủy

const SLOT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const KINDS = ["meeting", "block"];
let schemaReady = false;

export async function handleBookings(request, env, url) {
  if (!env.DB) return json({ error: "Chưa cấu hình database D1 (binding DB)." }, 500);
  if (!schemaReady) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS chairman_bookings (
        slot TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`
    ).run();
    schemaReady = true;
  }

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT slot, kind, name, note, created_at FROM chairman_bookings WHERE slot >= ? AND slot < ? ORDER BY slot"
    )
      .bind(url.searchParams.get("from") || "", url.searchParams.get("to") || "")
      .all();
    return json({ bookings: results, now: nowVN() });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const slot = String(body.slot || "");
    const kind = String(body.kind || "");
    const name = String(body.name || "").trim().slice(0, 80);
    const note = String(body.note || "").trim().slice(0, 300);
    if (!isValidSlot(slot)) return json({ error: "Khung giờ không hợp lệ." }, 400);
    if (!KINDS.includes(kind)) return json({ error: "Loại đặt lịch không hợp lệ." }, 400);
    if (!name) return json({ error: "Vui lòng nhập tên." }, 400);
    if (addMinutes(slot, 30) <= nowVN()) return json({ error: "Khung giờ này đã qua." }, 400);

    const { meta } = await env.DB.prepare(
      "INSERT INTO chairman_bookings (slot, kind, name, note, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(slot) DO NOTHING"
    )
      .bind(slot, kind, name, note, new Date().toISOString())
      .run();
    if (!meta.changes) return json({ error: "Khung giờ này vừa có người đặt. Vui lòng chọn khung khác." }, 409);
    return json({ ok: true }, 201);
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM chairman_bookings WHERE slot = ?").bind(url.searchParams.get("slot") || "").run();
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

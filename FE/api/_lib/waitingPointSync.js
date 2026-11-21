// Đồng bộ trạng thái đếm ngược & lịch sử "Vừa hoàn thành" của Waiting Point giữa nhiều máy / trình duyệt.
// Thuần JS (không phụ thuộc Node hay trình duyệt) để dùng chung cho FE/api/waiting-point.js và test.

export function getTodayKey(nowMs = Date.now()) {
  // Theo múi giờ Việt Nam (UTC+7) để mọi máy đồng nhất cùng ngày
  const vn = new Date(nowMs + 7 * 3600 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function emptyWaitingPointState(nowMs = Date.now()) {
  return {
    date: getTodayKey(nowMs),
    timers: {},
    recentCleared: [],
    updatedAt: nowMs,
  };
}

/**
 * Hợp nhất trạng thái từ client gửi lên vào trạng thái chung (conflict-free):
 * - Nếu 2 máy cùng thấy 1 đơn mới: giữ mốc startedAt SỚM NHẤT -> mọi màn hình đếm giống hệt nhau.
 * - Nếu cột Thời gian xử lý bị sửa (rawTime khác): lấy bản có updatedAt mới hơn.
 * - Khi đơn bị xóa trên Sheet (removedIds): dọn khỏi timers.
 * - Khi nhiều máy cùng báo 1 đơn vừa xong (clearedItems): gộp trùng theo cửa sổ 30 giây.
 */
export function mergeWaitingPointState(currentInput, incoming = {}, nowMs = Date.now()) {
  const today = getTodayKey(nowMs);
  const cur = currentInput && typeof currentInput === 'object' ? currentInput : emptyWaitingPointState(nowMs);
  const timers = { ...(cur.timers && typeof cur.timers === 'object' ? cur.timers : {}) };
  let recentCleared = cur.date === today && Array.isArray(cur.recentCleared) ? [...cur.recentCleared] : [];

  // 1. Hợp nhất timers từ client
  if (incoming.timers && typeof incoming.timers === 'object') {
    for (const [id, inc] of Object.entries(incoming.timers)) {
      if (!id || !inc || typeof inc !== 'object') continue;
      const startedAt = Number(inc.startedAt);
      if (!Number.isFinite(startedAt) || startedAt <= 0) continue;

      const normalized = {
        startedAt,
        totalSec: Number.isFinite(Number(inc.totalSec)) ? Number(inc.totalSec) : null,
        endAt: Number.isFinite(Number(inc.endAt)) ? Number(inc.endAt) : null,
        rawTime: String(inc.rawTime || ''),
        updatedAt: Number.isFinite(Number(inc.updatedAt)) ? Number(inc.updatedAt) : nowMs,
      };

      const prev = timers[id];
      if (!prev) {
        timers[id] = normalized;
      } else if (prev.rawTime !== normalized.rawTime) {
        if (normalized.updatedAt >= (prev.updatedAt || 0)) {
          timers[id] = {
            ...normalized,
            startedAt: Math.min(prev.startedAt, normalized.startedAt),
          };
        }
      } else if (normalized.startedAt < prev.startedAt) {
        timers[id] = normalized;
      }
    }
  }

  // 2. Xóa các timer của dòng đã hoàn thành / bị xóa khỏi Sheet
  if (Array.isArray(incoming.removedIds)) {
    for (const id of incoming.removedIds) {
      if (typeof id === 'string') delete timers[id];
    }
  }

  // Dọn timer quá cũ (> 36 giờ)
  for (const [id, t] of Object.entries(timers)) {
    if (!t || nowMs - (t.startedAt || 0) > 36 * 3600 * 1000) {
      delete timers[id];
    }
  }

  // 3. Gộp danh sách Vừa hoàn thành (chống trùng khi nhiều máy cùng phát hiện xóa dòng)
  if (Array.isArray(incoming.clearedItems) && incoming.clearedItems.length > 0) {
    const existingBuckets = new Set(
      recentCleared.map((c) => c.dedupKey || `${c.id || c.issue}@${Math.floor((c.clearedAt || 0) / 30000)}`),
    );

    for (const item of incoming.clearedItems) {
      if (!item || !item.issue) continue;
      const clearedAt = Number.isFinite(Number(item.clearedAt)) ? Number(item.clearedAt) : nowMs;
      const baseKey = item.id || `${item.group || ''}|${item.issue}`;
      const bucket = Math.floor(clearedAt / 30000);
      if (
        existingBuckets.has(`${baseKey}@${bucket}`) ||
        existingBuckets.has(`${baseKey}@${bucket - 1}`) ||
        existingBuckets.has(`${baseKey}@${bucket + 1}`)
      ) {
        continue;
      }
      const dedupKey = `${baseKey}@${bucket}`;
      existingBuckets.add(dedupKey);
      recentCleared.unshift({
        dedupKey,
        id: String(item.id || ''),
        group: String(item.group || '').slice(0, 120),
        stream: String(item.stream || '').slice(0, 120),
        issue: String(item.issue || '').slice(0, 300),
        owner: String(item.owner || '').slice(0, 100),
        supporter: String(item.supporter || '').slice(0, 100),
        spentSec: Math.max(1, Number(item.spentSec) || 5),
        at: String(item.at || ''),
        clearedAt,
      });
    }

    recentCleared.sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0));
    recentCleared = recentCleared.slice(0, 100);
  }

  return {
    date: today,
    timers,
    recentCleared,
    updatedAt: nowMs,
  };
}

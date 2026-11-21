// Đồng bộ trạng thái đếm ngược & thống kê "Vừa hoàn thành" theo từng ngày giữa nhiều máy / trình duyệt.
// Thuần JS (không phụ thuộc Node hay trình duyệt) để dùng chung cho FE/api/waiting-point.js và test.

const MAX_HISTORY_DAYS = 30;
const MAX_ITEMS_PER_DAY = 200;

export function getTodayKey(nowMs = Date.now()) {
  // Theo múi giờ Việt Nam (UTC+7) để mọi máy đồng nhất cùng ngày
  const vn = new Date(nowMs + 7 * 3600 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function emptyWaitingPointState(nowMs = Date.now()) {
  const today = getTodayKey(nowMs);
  return {
    date: today,
    timers: {},
    removedTimers: {},
    recentCleared: [],
    historyByDate: {},
    updatedAt: nowMs,
  };
}

function normalizeHistoryByDate(cur, today) {
  const out = {};
  if (cur?.historyByDate && typeof cur.historyByDate === 'object') {
    for (const [dayKey, list] of Object.entries(cur.historyByDate)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey) && Array.isArray(list)) {
        out[dayKey] = [...list];
      }
    }
  }
  // Tương thích ngược với state cũ chỉ lưu recentCleared cho cur.date
  if (Array.isArray(cur?.recentCleared) && cur.recentCleared.length > 0) {
    const legacyDay = /^\d{4}-\d{2}-\d{2}$/.test(cur.date || '') ? cur.date : today;
    if (!out[legacyDay] || out[legacyDay].length === 0) {
      out[legacyDay] = [...cur.recentCleared];
    }
  }
  return out;
}

/**
 * Hợp nhất trạng thái từ client gửi lên vào trạng thái chung (conflict-free):
 * - Nếu 2 máy cùng thấy 1 đơn mới: giữ mốc startedAt SỚM NHẤT -> mọi màn hình đếm giống hệt nhau.
 * - Lưu lastSupporter / lastOwner trong timers để không bị mất tên khi người dùng xóa cột G trước cột D.
 * - Nếu cột Thời gian xử lý bị sửa (rawTime khác): lấy bản có updatedAt mới hơn.
 * - Khi đơn bị xóa trên Sheet (removedIds): dọn khỏi timers & ghi nhận vào removedTimers.
 * - Khi nhiều máy cùng báo 1 đơn vừa xong (clearedItems): gộp trùng theo cửa sổ 30 giây,
 *   đồng thời bổ sung (backfill) supporter/owner nếu bản đến sau có đầy đủ tên hơn.
 * - Lưu thống kê theo từng ngày trong historyByDate (giữ tối đa 30 ngày gần nhất).
 */
export function mergeWaitingPointState(currentInput, incoming = {}, nowMs = Date.now()) {
  const today = getTodayKey(nowMs);
  const cur = currentInput && typeof currentInput === 'object' ? currentInput : emptyWaitingPointState(nowMs);
  const timers = { ...(cur.timers && typeof cur.timers === 'object' ? cur.timers : {}) };
  const removedTimers = { ...(cur.removedTimers && typeof cur.removedTimers === 'object' ? cur.removedTimers : {}) };
  const historyByDate = normalizeHistoryByDate(cur, today);

  // 1. Hợp nhất timers từ client (kèm lastSupporter / lastOwner)
  if (incoming.timers && typeof incoming.timers === 'object') {
    for (const [id, inc] of Object.entries(incoming.timers)) {
      if (!id || !inc || typeof inc !== 'object') continue;
      const startedAt = Number(inc.startedAt);
      if (!Number.isFinite(startedAt) || startedAt <= 0) continue;

      const prev = timers[id];
      const incSupporter = String(inc.lastSupporter || inc.supporter || '').trim().slice(0, 100);
      const incOwner = String(inc.lastOwner || inc.owner || '').trim().slice(0, 100);

      const normalized = {
        startedAt,
        totalSec: Number.isFinite(Number(inc.totalSec)) ? Number(inc.totalSec) : null,
        endAt: Number.isFinite(Number(inc.endAt)) ? Number(inc.endAt) : null,
        rawTime: String(inc.rawTime || ''),
        updatedAt: Number.isFinite(Number(inc.updatedAt)) ? Number(inc.updatedAt) : nowMs,
        lastSupporter: incSupporter || prev?.lastSupporter || '',
        lastOwner: incOwner || prev?.lastOwner || '',
      };

      if (!prev) {
        timers[id] = normalized;
      } else if (prev.rawTime !== normalized.rawTime) {
        if (normalized.updatedAt >= (prev.updatedAt || 0)) {
          timers[id] = {
            ...normalized,
            startedAt: Math.min(prev.startedAt, normalized.startedAt),
          };
        } else {
          timers[id] = {
            ...prev,
            lastSupporter: incSupporter || prev.lastSupporter || '',
            lastOwner: incOwner || prev.lastOwner || '',
          };
        }
      } else if (normalized.startedAt < prev.startedAt) {
        timers[id] = normalized;
      } else {
        // Giữ mốc sớm hơn nhưng vẫn cập nhật lastSupporter / lastOwner nếu có tên mới
        timers[id] = {
          ...prev,
          lastSupporter: incSupporter || prev.lastSupporter || '',
          lastOwner: incOwner || prev.lastOwner || '',
        };
      }

      // Nếu đơn này vừa được tạo lại sau khi đã xóa trước đó -> bỏ khỏi removedTimers
      if (removedTimers[id] && startedAt > removedTimers[id]) {
        delete removedTimers[id];
      }
    }
  }

  // 2. Xóa các timer của dòng đã hoàn thành / bị xóa khỏi Sheet
  const removedMeta = new Map();
  if (Array.isArray(incoming.removedIds)) {
    for (const id of incoming.removedIds) {
      if (typeof id !== 'string') continue;
      if (timers[id]) {
        removedMeta.set(id, {
          lastSupporter: timers[id].lastSupporter || '',
          lastOwner: timers[id].lastOwner || '',
        });
      }
      delete timers[id];
      removedTimers[id] = nowMs;
    }
  }

  // Dọn timer quá cũ (> 36 giờ) và removedTimers quá cũ (> 24 giờ)
  for (const [id, t] of Object.entries(timers)) {
    if (!t || nowMs - (t.startedAt || 0) > 36 * 3600 * 1000) {
      delete timers[id];
    }
  }
  for (const [id, ts] of Object.entries(removedTimers)) {
    if (!Number.isFinite(ts) || nowMs - ts > 24 * 3600 * 1000) {
      delete removedTimers[id];
    }
  }

  // 3. Gộp danh sách Vừa hoàn thành theo từng ngày (chống trùng 30s + backfill supporter/owner)
  if (Array.isArray(incoming.clearedItems) && incoming.clearedItems.length > 0) {
    for (const item of incoming.clearedItems) {
      if (!item || !item.issue) continue;
      const clearedAt = Number.isFinite(Number(item.clearedAt)) ? Number(item.clearedAt) : nowMs;
      const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : getTodayKey(clearedAt);
      if (!historyByDate[dayKey]) historyByDate[dayKey] = [];
      const dayList = historyByDate[dayKey];

      const fallbackMeta = removedMeta.get(item.id) || {};
      const supporter = String(item.supporter || fallbackMeta.lastSupporter || '').trim().slice(0, 100);
      const owner = String(item.owner || fallbackMeta.lastOwner || '').trim().slice(0, 100);

      const baseKey = item.id || `${item.group || ''}|${item.issue}`;
      const bucket = Math.floor(clearedAt / 30000);
      const bucketCandidates = new Set([`${baseKey}@${bucket}`, `${baseKey}@${bucket - 1}`, `${baseKey}@${bucket + 1}`]);

      const dupIdx = dayList.findIndex((c) => {
        const key = c.dedupKey || `${c.id || c.issue}@${Math.floor((c.clearedAt || 0) / 30000)}`;
        return bucketCandidates.has(key);
      });

      if (dupIdx >= 0) {
        // Nếu bản đã lưu bị thiếu Người hỗ trợ / Người phụ trách mà bản đến sau có -> tự động điền bổ sung!
        const existing = dayList[dupIdx];
        if ((!existing.supporter && supporter) || (!existing.owner && owner)) {
          dayList[dupIdx] = {
            ...existing,
            supporter: existing.supporter || supporter,
            owner: existing.owner || owner,
          };
        }
        continue;
      }

      const dedupKey = `${baseKey}@${bucket}`;
      dayList.unshift({
        dedupKey,
        date: dayKey,
        id: String(item.id || ''),
        group: String(item.group || '').slice(0, 120),
        stream: String(item.stream || '').slice(0, 120),
        issue: String(item.issue || '').slice(0, 300),
        owner,
        supporter,
        spentSec: Math.max(1, Number(item.spentSec) || 5),
        at: String(item.at || ''),
        clearedAt,
      });
    }
  }

  // Sắp xếp và giới hạn 30 ngày gần nhất
  const sortedDates = Object.keys(historyByDate).sort((a, b) => b.localeCompare(a)).slice(0, MAX_HISTORY_DAYS);
  const prunedHistory = {};
  for (const d of sortedDates) {
    const arr = [...historyByDate[d]].sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0)).slice(0, MAX_ITEMS_PER_DAY);
    if (arr.length > 0 || d === today) prunedHistory[d] = arr;
  }

  return {
    date: today,
    timers,
    removedTimers,
    recentCleared: prunedHistory[today] || [],
    historyByDate: prunedHistory,
    updatedAt: nowMs,
  };
}

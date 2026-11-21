// Đồng bộ trạng thái đếm ngược & thống kê "Vừa hoàn thành" theo từng ngày của Waiting Point giữa nhiều máy / trình duyệt.
// Thuần JS (không phụ thuộc Node hay Worker) để dùng chung cho src/index.js (Cloudflare Worker D1), src/server.js và test.

const MAX_HISTORY_DAYS = 30;
const MAX_ITEMS_PER_DAY = 200;

function norm(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Loại khỏi danh sách hoàn thành trong ngày những dòng HIỆN VẪN CÒN NGUYÊN trên Google Sheet
 * (tránh lệch giữa bảng Thống kê với Sheet khi khôi phục Ctrl+Z hoặc từng bị chốt nhầm trước đó).
 */
export function pruneHistoryAgainstSheetRows(dayList = [], sheetRows = []) {
  if (!Array.isArray(dayList) || dayList.length === 0) return [];
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) return [...dayList];

  const exactSigs = new Set();
  const looseSigs = new Set();
  for (const r of sheetRows) {
    if (!r) continue;
    const issue = norm(r.issue);
    if (!issue) continue;
    const grp = norm(r.group);
    const owner = norm(r.owner);
    const sup = norm(r.supporter);
    exactSigs.add(`${grp}|${issue}|${owner}|${sup}`);
    looseSigs.add(`${grp}|${issue}`);
  }

  return dayList.filter((rec) => {
    const issue = norm(rec?.issue);
    if (!issue) return false;
    const grp = norm(rec?.group);
    const owner = norm(rec?.owner);
    const sup = norm(rec?.supporter);
    if (exactSigs.has(`${grp}|${issue}|${owner}|${sup}`)) return false;
    if ((!sup || !owner) && looseSigs.has(`${grp}|${issue}`)) return false;
    return true;
  });
}

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
    historyResetAt: 0,
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
 * - Giữ mốc startedAt SỚM NHẤT -> mọi màn hình đếm giống hệt nhau.
 * - Lưu lastSupporter / lastOwner trong timers để không bị mất tên khi xóa cột G/F trước cột D.
 * - Khi cột Thời gian xử lý bị sửa (rawTime khác): lấy bản có updatedAt mới hơn.
 * - Khi đơn bị xóa trên Sheet (removedIds): dọn timers & ghi removedTimers để tab khác không dùng lại timer cũ.
 * - Gộp clearedItems theo ngày (historyByDate, giữ 30 ngày), chống trùng 30s và tự điền bổ sung (backfill) supporter/owner.
 */
export function mergeWaitingPointState(currentInput, incoming = {}, nowMs = Date.now()) {
  const today = getTodayKey(nowMs);
  const cur = currentInput && typeof currentInput === 'object' ? currentInput : emptyWaitingPointState(nowMs);
  const timers = { ...(cur.timers && typeof cur.timers === 'object' ? cur.timers : {}) };
  const removedTimers = { ...(cur.removedTimers && typeof cur.removedTimers === 'object' ? cur.removedTimers : {}) };
  let historyResetAt = Math.max(
    Number.isFinite(Number(cur.historyResetAt)) ? Number(cur.historyResetAt) : 0,
    Number.isFinite(Number(incoming.historyResetAt)) ? Number(incoming.historyResetAt) : 0,
  );
  let historyByDate = normalizeHistoryByDate(cur, today);

  if (incoming.clearHistory === true) {
    historyResetAt = Math.max(historyResetAt, nowMs);
    historyByDate = {};
  } else if (historyResetAt > 0) {
    for (const [dKey, list] of Object.entries(historyByDate)) {
      historyByDate[dKey] = list.filter((rec) => (Number(rec?.clearedAt) || 0) > historyResetAt);
    }
  }

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
        timers[id] = {
          ...prev,
          lastSupporter: incSupporter || prev.lastSupporter || '',
          lastOwner: incOwner || prev.lastOwner || '',
        };
      }

      if (removedTimers[id] && startedAt > removedTimers[id]) {
        delete removedTimers[id];
      }
    }
  }

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

  for (const [id, t] of Object.entries(timers)) {
    if (!t || nowMs - (t.startedAt || 0) > 36 * 3600 * 1000) delete timers[id];
  }
  for (const [id, ts] of Object.entries(removedTimers)) {
    if (!Number.isFinite(ts) || nowMs - ts > 24 * 3600 * 1000) delete removedTimers[id];
  }

  if (Array.isArray(incoming.clearedItems) && incoming.clearedItems.length > 0) {
    for (const item of incoming.clearedItems) {
      if (!item || !item.issue) continue;
      const clearedAt = Number.isFinite(Number(item.clearedAt)) ? Number(item.clearedAt) : nowMs;
      if (historyResetAt > 0 && clearedAt <= historyResetAt) continue;
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

  // Đối chiếu bảng thống kê hôm nay với các dòng vẫn đang tồn tại trên Sheet:
  // dòng nào vẫn còn trên Sheet thì gỡ khỏi danh sách "Đã hoàn thành" hôm nay để luôn khớp 100%.
  if (Array.isArray(incoming.activeSheetRows) && Array.isArray(historyByDate[today])) {
    historyByDate[today] = pruneHistoryAgainstSheetRows(historyByDate[today], incoming.activeSheetRows);
  }

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
    historyResetAt,
    updatedAt: nowMs,
  };
}

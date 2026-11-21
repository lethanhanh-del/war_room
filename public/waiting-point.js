// Trang Waiting Point (/waiting-point) — đồng bộ UI Night Ops v5 + Light + TV với nhánh feat/kpi-plan.
// - Đọc trực tiếp tab "Waiting Point" (gid=2043772221) của WR - MASTER TASK mỗi 3 giây (chỉ đọc).
// - Gom thành từng thẻ theo Người hỗ trợ (dạng trục Timeline kiến trúc), việc gấp nhất lên đầu.
// - Đồng bộ mốc giờ, lastKnownSupporter/Owner và Thống kê theo ngày (30 ngày) qua /api/waiting-point + WebSocket /api/live/ws + BroadcastChannel.
// - Rung chuông đa hài Web Audio mỗi khi có task mới, gán người hỗ trợ, quá hạn hoặc hoàn thành.

export const WP_CONFIG = {
  SHEET_ID: '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0',
  SHEET_GID: '2043772221',
  POLL_INTERVAL_MS: 3000,
  WARNING_THRESHOLD_SEC: 300,
  CLEAR_ANIMATION_MS: 1200,
  NEW_HIGHLIGHT_MS: 9000,
  BURN_REMINDER_MS: 60000,
  DEFAULT_PAGE_SIZE: 10,
};

const STORAGE_TIMERS = 'warroom_oc_timers_v1';
const STORAGE_HISTORY = 'warroom_oc_history_v3';
const LEGACY_HISTORY = 'warroom_oc_history_v2';
const SYNC_CHANNEL_NAME = 'warroom_wp_sync_v1';

// ---------- Pure Helpers (exported for unit tests) ----------
export function normalizeText(str) {
  return String(str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function shortStreamName(stream) {
  const s = String(stream || '').trim();
  const stripped = s.replace(/^dòng\s*tiền\s*\d*\s*[:–-]?\s*/i, '').trim();
  return stripped || s || 'War Room';
}

export function todayKeyVN(nowMs = Date.now()) {
  const vn = new Date(nowMs + 7 * 3600 * 1000);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
}

export function parseTimeSpec(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return { kind: 'none', raw };

  const lower = raw.toLowerCase().normalize('NFC').replace(/,/g, '.').trim();

  const gvizDate = raw.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (gvizDate) {
    const y = parseInt(gvizDate[1], 10);
    const mo = parseInt(gvizDate[2], 10);
    const d = parseInt(gvizDate[3], 10);
    const h = parseInt(gvizDate[4] || '0', 10);
    const m = parseInt(gvizDate[5] || '0', 10);
    const s = parseInt(gvizDate[6] || '0', 10);
    if (y <= 1900) {
      if (h <= 6) {
        const secs = h * 3600 + m * 60 + s;
        if (secs > 0) return { kind: 'duration', durationSec: secs, raw };
      }
      return { kind: 'deadline', targetHour: h, targetMin: m, raw };
    }
    return { kind: 'timestamp', endAt: new Date(y, mo, d, h, m, s).getTime(), raw };
  }

  const dtMatch = lower.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(\d{1,2})\s*[:hg]\s*(\d{2})$/);
  if (dtMatch) {
    const now = new Date();
    const day = parseInt(dtMatch[1], 10);
    const mon = parseInt(dtMatch[2], 10) - 1;
    let yr = dtMatch[3] ? parseInt(dtMatch[3], 10) : now.getFullYear();
    if (yr < 100) yr += 2000;
    const h = parseInt(dtMatch[4], 10);
    const m = parseInt(dtMatch[5], 10);
    if (mon >= 0 && mon <= 11 && day >= 1 && day <= 31 && h <= 23 && m <= 59) {
      return { kind: 'timestamp', endAt: new Date(yr, mon, day, h, m, 0).getTime(), raw };
    }
  }

  const ampmMatch = lower.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(sa|ch|am|pm)\b/);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = parseInt(ampmMatch[2], 10);
    const mer = ampmMatch[3];
    if ((mer === 'ch' || mer === 'pm') && h < 12) h += 12;
    if ((mer === 'sa' || mer === 'am') && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { kind: 'deadline', targetHour: h, targetMin: m, raw };
    }
  }

  const explicitClock = lower.match(/(?:trước|truoc|đến|den|tới|toi|->|at)\s*(\d{1,2})\s*[:hg]\s*(\d{1,2})?/);
  if (explicitClock) {
    const h = parseInt(explicitClock[1], 10);
    const m = explicitClock[2] ? parseInt(explicitClock[2], 10) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { kind: 'deadline', targetHour: h, targetMin: m, raw };
    }
  }

  const dayMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:ngày|ngay|days|day|d)$/);
  if (dayMatch) {
    const days = parseFloat(dayMatch[1]);
    if (days > 0) return { kind: 'duration', durationSec: Math.round(days * 86400), raw };
  }

  const colonMatch = lower.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const a = parseInt(colonMatch[1], 10);
    const b = parseInt(colonMatch[2], 10);
    const c = colonMatch[3] !== undefined ? parseInt(colonMatch[3], 10) : null;
    if (c !== null) {
      if (a <= 6) {
        const secs = a * 3600 + b * 60 + c;
        if (secs > 0) return { kind: 'duration', durationSec: secs, raw };
      } else if (a <= 23 && b <= 59) {
        return { kind: 'deadline', targetHour: a, targetMin: b, raw };
      }
    } else {
      if (a >= 7 && a <= 23 && b <= 59) {
        return { kind: 'deadline', targetHour: a, targetMin: b, raw };
      }
      const secs = a === 0 ? b * 60 : a * 3600 + b * 60;
      if (secs > 0) return { kind: 'duration', durationSec: secs, raw };
    }
  }

  const hmMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:giờ|gio|tiếng|tieng|hr|hrs|h|g)\s*(\d+)?\s*(?:phút|phut|min|mins|p|m|')?$/);
  if (hmMatch) {
    const h = parseFloat(hmMatch[1]);
    const m = hmMatch[2] ? parseInt(hmMatch[2], 10) : 0;
    if (!hmMatch[1].includes('.') && h >= 7 && h <= 23 && m <= 59 && /\d\s*[hg]/.test(lower) && !/giờ|gio|tiếng|tieng/.test(lower)) {
      return { kind: 'deadline', targetHour: Math.floor(h), targetMin: m, raw };
    }
    const secs = Math.round(h * 3600 + m * 60);
    if (secs > 0) return { kind: 'duration', durationSec: secs, raw };
  }

  const minMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:phút|phut|mins|min|p|m|')?$/);
  if (minMatch) {
    const mins = parseFloat(minMatch[1]);
    if (mins > 0) return { kind: 'duration', durationSec: Math.round(mins * 60), raw };
  }

  const secMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:giây|giay|secs|sec|s)$/);
  if (secMatch) {
    const secs = Math.round(parseFloat(secMatch[1]));
    if (secs > 0) return { kind: 'duration', durationSec: secs, raw };
  }

  const anyNum = lower.match(/(\d+(?:\.\d+)?)/);
  if (anyNum) {
    const val = parseFloat(anyNum[1]);
    if (/ngày|ngay|\bd\b/.test(lower)) return { kind: 'duration', durationSec: Math.round(val * 86400), raw };
    if (/giờ|gio|tiếng|tieng|\bh\b/.test(lower)) return { kind: 'duration', durationSec: Math.round(val * 3600), raw };
    if (/giây|giay|\bs\b/.test(lower)) return { kind: 'duration', durationSec: Math.round(val), raw };
    if (val > 0) return { kind: 'duration', durationSec: Math.round(val * 60), raw };
  }

  return { kind: 'none', raw };
}

export function resolveDeadlineFromSpec(spec, startedAt) {
  if (!spec || spec.kind === 'none') return { totalSec: null, endAt: null };
  if (spec.kind === 'timestamp') {
    return { totalSec: Math.max(60, Math.round((spec.endAt - startedAt) / 1000)), endAt: spec.endAt };
  }
  if (spec.kind === 'duration') {
    return { totalSec: spec.durationSec, endAt: startedAt + spec.durationSec * 1000 };
  }
  if (spec.kind === 'deadline') {
    const target = new Date(startedAt);
    target.setHours(spec.targetHour, spec.targetMin, 0, 0);
    if (target.getTime() < startedAt - 12 * 3600 * 1000) target.setDate(target.getDate() + 1);
    return { totalSec: Math.max(60, Math.round((target.getTime() - startedAt) / 1000)), endAt: target.getTime() };
  }
  return { totalSec: null, endAt: null };
}

export function computeTiming(item, nowMs) {
  if (!item.endAt) {
    return {
      mode: 'elapsed',
      remainingSec: Number.POSITIVE_INFINITY,
      elapsedSec: Math.max(0, Math.floor((nowMs - item.startedAt) / 1000)),
      pct: 100,
      tier: 'none',
    };
  }
  const remainingSec = Math.ceil((item.endAt - nowMs) / 1000);
  const totalSec = Math.max(1, item.totalSec || 600);
  const pct = remainingSec <= 0 ? 100 : Math.max(4, Math.min(100, Math.round((remainingSec / totalSec) * 100)));
  const tier = remainingSec <= 0 ? 'burn' : remainingSec <= WP_CONFIG.WARNING_THRESHOLD_SEC ? 'warn' : 'ok';
  return {
    mode: 'countdown',
    remainingSec,
    elapsedSec: Math.max(0, Math.floor((nowMs - item.startedAt) / 1000)),
    pct,
    tier,
  };
}

export function formatClock(sec) {
  const neg = sec < 0;
  const abs = Math.abs(sec);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const core =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return neg ? `+${core}` : core;
}

export function isCompleteWaitingRow(row) {
  if (!row) return false;
  const stream = String(row.stream || '').trim();
  const group = String(row.group || '').trim();
  const issue = String(row.issue || '').trim();
  const timeRaw = String(row.timeRaw || '').trim();
  const owner = String(row.owner || '').trim();
  const supporter = String(row.supporter || '').trim();
  if (!stream || !group || !issue || !timeRaw || !owner || !supporter) return false;
  return parseTimeSpec(timeRaw).kind !== 'none';
}

function buildItemsFromRows(rawRows, picName) {
  let resolvedPic = picName || '';
  const dupCount = new Map();
  const activeItems = [];
  const sheetPresentRows = [];
  let incompleteCount = 0;

  for (const r of rawRows) {
    const combinedHeader = `${r.stt} ${r.stream} ${r.group} ${r.issue}`;
    if (!resolvedPic) {
      const pm = combinedHeader.match(/PIC[^:\n]*:\s*([^\n|]+)/i);
      if (pm) resolvedPic = pm[1].trim();
    }
    if (/^vấn\s*đề\s*gặp\s*phải$/i.test(r.issue) || (/^stt$/i.test(r.stt) && /^dòng\s*tiền$/i.test(r.stream))) {
      continue;
    }

    // Ghi nhận mọi dòng hiện vẫn còn tồn tại trên Sheet để đối chiếu bảng Thống kê hôm nay.
    if (r.issue) {
      sheetPresentRows.push({
        group: r.group,
        issue: r.issue,
        owner: r.owner,
        supporter: r.supporter,
      });
    }

    // Chỉ đẩy lên màn hình khi đã nhập đủ 6 thông tin bắt buộc trên dòng:
    // Dòng tiền, Nhóm công việc, Vấn đề gặp phải, Thời gian xử lý (hợp lệ), Người phụ trách, Người hỗ trợ.
    if (!isCompleteWaitingRow(r)) {
      if (r.issue || r.timeRaw || r.owner || r.supporter) incompleteCount += 1;
      continue;
    }

    const stream = r.stream;
    const group = r.group;

    const baseKey = `${normalizeText(stream)}|${normalizeText(group)}|${normalizeText(r.issue)}`;
    const occ = (dupCount.get(baseKey) || 0) + 1;
    dupCount.set(baseKey, occ);

    activeItems.push({
      id: `${baseKey}#${occ}`,
      stt: r.stt,
      stream,
      group,
      issue: r.issue,
      timeRaw: r.timeRaw,
      timeSpec: parseTimeSpec(r.timeRaw),
      owner: r.owner,
      supporter: r.supporter,
    });
  }

  return {
    picName: resolvedPic || 'Hoàng Thị Quỳnh Mai',
    totalSheetRows: rawRows.length,
    incompleteCount,
    sheetPresentRows,
    items: activeItems,
  };
}

export function pruneTodayHistoryBySheet(dayList = [], sheetRows = []) {
  if (!Array.isArray(dayList) || dayList.length === 0) return [];
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) return [...dayList];

  const exactSigs = new Set();
  const looseSigs = new Set();
  for (const r of sheetRows) {
    if (!r) continue;
    const issue = normalizeText(r.issue);
    if (!issue) continue;
    const grp = normalizeText(r.group);
    const owner = normalizeText(r.owner);
    const sup = normalizeText(r.supporter);
    exactSigs.add(`${grp}|${issue}|${owner}|${sup}`);
    looseSigs.add(`${grp}|${issue}`);
  }

  return dayList.filter((rec) => {
    const issue = normalizeText(rec?.issue);
    if (!issue) return false;
    const grp = normalizeText(rec?.group);
    const owner = normalizeText(rec?.owner);
    const sup = normalizeText(rec?.supporter);
    if (exactSigs.has(`${grp}|${issue}|${owner}|${sup}`)) return false;
    if ((!sup || !owner) && looseSigs.has(`${grp}|${issue}`)) return false;
    return true;
  });
}

export function parseGvizPayload(text) {
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\)\s*;?\s*$/);
  if (!match) throw new Error('Invalid gviz payload');
  const data = JSON.parse(match[1]);
  if (data.status !== 'ok' || !data.table) throw new Error('Sheet error status');

  const cols = data.table.cols || [];
  let picName = '';
  const picMatch = String(cols[0]?.label || '').match(/PIC[^:\n]*:\s*([^\n]+?)(?:\s+STT\s*$|$)/i);
  if (picMatch) picName = picMatch[1].trim();

  const hasIssueCol = cols.some((c) => /vấn\s*đề|van\s*de/i.test(String(c?.label || '')));
  const hasStreamCol = cols.some((c) => /dòng\s*tiền|dong\s*tien/i.test(String(c?.label || '')));
  if (!hasIssueCol || !hasStreamCol) throw new Error('Missing Waiting Point header columns');

  const findCol = (regex, fallback) => {
    const idx = cols.findIndex((c) => regex.test(String(c?.label || '')));
    return idx >= 0 ? idx : fallback;
  };

  const idxStt = findCol(/stt/i, 0);
  const idxStream = findCol(/dòng\s*tiền|dong\s*tien/i, 1);
  const idxGroup = findCol(/nhóm\s*công\s*việc|nhom\s*cong\s*viec/i, 2);
  const idxIssue = findCol(/vấn\s*đề|van\s*de/i, 3);
  const idxTime = findCol(/thời\s*gian|thoi\s*gian/i, 4);
  const idxOwner = findCol(/người\s*phụ\s*trách|nguoi\s*phu\s*trach/i, 5);
  const idxSupporter = findCol(/người\s*hỗ\s*trợ|nguoi\s*ho\s*tro/i, 6);

  const rawRows = (data.table.rows || []).map((row) => {
    const cells = row.c || [];
    const getCell = (idx) => {
      const cell = cells[idx];
      if (!cell || (cell.v === null && cell.f === undefined)) return '';
      return String(cell.f !== undefined && cell.f !== null ? cell.f : cell.v).trim();
    };
    return {
      stt: getCell(idxStt),
      stream: getCell(idxStream),
      group: getCell(idxGroup),
      issue: getCell(idxIssue),
      timeRaw: getCell(idxTime),
      owner: getCell(idxOwner),
      supporter: getCell(idxSupporter),
    };
  });

  return buildItemsFromRows(rawRows, picName);
}

export function parseCsvText(csv) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"' && csv[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur.replace(/\r$/, ''));
    rows.push(row);
  }

  let picName = '';
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const joined = rows[i].join(' ');
    if (!picName) {
      const m = joined.match(/PIC[^:,]*:\s*([^,\n]+)/i);
      if (m) picName = m[1].trim();
    }
    if (/vấn\s*đề|van\s*de/i.test(joined) && /dòng\s*tiền|dong\s*tien/i.test(joined)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('Missing Waiting Point header row');

  const headerRow = rows[headerIdx];
  const findCsvCol = (regex, fallback) => {
    const idx = headerRow.findIndex((h) => regex.test(String(h || '')));
    return idx >= 0 ? idx : fallback;
  };

  const iStt = findCsvCol(/stt/i, 0);
  const iStream = findCsvCol(/dòng\s*tiền|dong\s*tien/i, 1);
  const iGroup = findCsvCol(/nhóm\s*công\s*việc|nhom\s*cong\s*viec/i, 2);
  const iIssue = findCsvCol(/vấn\s*đề|van\s*de/i, 3);
  const iTime = findCsvCol(/thời\s*gian|thoi\s*gian/i, 4);
  const iOwner = findCsvCol(/người\s*phụ\s*trách|nguoi\s*phu\s*trach/i, 5);
  const iSupporter = findCsvCol(/người\s*hỗ\s*trợ|nguoi\s*ho\s*tro/i, 6);

  const rawRows = rows.slice(headerIdx + 1).map((r) => ({
    stt: String(r[iStt] || '').trim(),
    stream: String(r[iStream] || '').trim(),
    group: String(r[iGroup] || '').trim(),
    issue: String(r[iIssue] || '').trim(),
    timeRaw: String(r[iTime] || '').trim(),
    owner: String(r[iOwner] || '').trim(),
    supporter: String(r[iSupporter] || '').trim(),
  }));

  return buildItemsFromRows(rawRows, picName);
}

export async function fetchWaitingPoints() {
  const ts = Date.now();
  // Ưu tiên CSV export: giữ nguyên từng dòng văn bản gốc, tuyệt đối không bị Google gviz gộp nhầm dòng dữ liệu thành tiêu đề khi xóa hàng hoặc để trống STT/Dòng tiền.
  const csvUrl = `https://docs.google.com/spreadsheets/d/${WP_CONFIG.SHEET_ID}/export?format=csv&gid=${WP_CONFIG.SHEET_GID}&_t=${ts}`;
  try {
    const res = await fetch(csvUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCsvText(await res.text());
  } catch (csvErr) {
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${WP_CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&headers=2&gid=${WP_CONFIG.SHEET_GID}&_t=${ts}`;
    const res = await fetch(gvizUrl, { cache: 'no-store' });
    if (!res.ok) throw csvErr;
    return parseGvizPayload(await res.text());
  }
}

// Xác nhận dòng thật sự biến mất qua `confirmPolls` chu kỳ liên tiếp (mặc định 2 nhịp ~3–6s)
// để tránh lỡ xóa nhầm rồi Ctrl+Z hoặc mạng/Sheet cập nhật dở bị đánh hoàn thành oan.
export function reconcileMissingItems(prevLiveMap, nextMap, pendingMissing, confirmPolls = 2) {
  const confirmedRemoved = [];
  const heldItems = [];

  for (const id of [...pendingMissing.keys()]) {
    if (!prevLiveMap.has(id) || nextMap.has(id)) pendingMissing.delete(id);
  }

  for (const [id, prevItem] of prevLiveMap.entries()) {
    if (nextMap.has(id)) {
      pendingMissing.delete(id);
      continue;
    }
    const misses = (pendingMissing.get(id) || 0) + 1;
    if (misses < confirmPolls) {
      pendingMissing.set(id, misses);
      nextMap.set(id, prevItem);
      heldItems.push(prevItem);
    } else {
      pendingMissing.delete(id);
      confirmedRemoved.push(prevItem);
    }
  }

  return { confirmedRemoved, heldItems };
}

export function groupItemsByPerson(visibleItems) {
  const map = new Map();
  for (const item of visibleItems) {
    const rawName = String(item.supporter || '').trim();
    const isUnassigned = !rawName;
    const key = isUnassigned ? '__unassigned__' : normalizeText(rawName);
    if (!map.has(key)) {
      map.set(key, { key, name: isUnassigned ? 'Chưa có người hỗ trợ' : rawName, isUnassigned, tasks: [] });
    }
    map.get(key).tasks.push(item);
  }

  const groups = [...map.values()].map((g) => {
    g.tasks.sort((a, b) => {
      if (a.timing.remainingSec !== b.timing.remainingSec) return a.timing.remainingSec - b.timing.remainingSec;
      return a.startedAt - b.startedAt;
    });
    const activeTasks = g.tasks.filter((t) => !t.isClearing);
    const burnCount = activeTasks.filter((t) => t.timing.tier === 'burn').length;
    const warnCount = activeTasks.filter((t) => t.timing.tier === 'warn').length;
    const minRem = activeTasks.length ? Math.min(...activeTasks.map((t) => t.timing.remainingSec)) : Number.POSITIVE_INFINITY;
    const topTier =
      activeTasks.length === 0
        ? 'clear'
        : burnCount > 0
          ? 'burn'
          : warnCount > 0
            ? 'warn'
            : g.isUnassigned
              ? 'unassigned'
              : activeTasks.some((t) => t.timing.tier === 'ok')
                ? 'ok'
                : 'none';
    return { ...g, activeCount: activeTasks.length, burnCount, warnCount, minRemainingSec: minRem, topTier };
  });

  groups.sort((a, b) => {
    if (a.minRemainingSec !== b.minRemainingSec) return a.minRemainingSec - b.minRemainingSec;
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? -1 : 1;
    if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
    return a.name.localeCompare(b.name, 'vi');
  });

  return groups;
}

export function getPeopleGridLayout(peopleCount) {
  if (peopleCount <= 1) return 'cols-1';
  if (peopleCount === 2 || peopleCount === 4) return 'cols-2';
  if (peopleCount <= 6) return 'cols-3';
  return 'cols-4';
}

export function getTaskLimitForPeopleCount(peopleCount) {
  if (peopleCount <= 3) return 4;
  if (peopleCount <= 6) return 3;
  return 2;
}

export function buildDailyStats(items = []) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  if (total === 0) {
    return { total: 0, avgSec: 0, fastestSec: 0, totalSpentSec: 0, supporterCount: 0, bySupporter: [] };
  }

  let totalSpentSec = 0;
  let fastestSec = Number.POSITIVE_INFINITY;
  const supMap = new Map();

  for (const rec of list) {
    const sec = Math.max(1, Number(rec.spentSec) || 5);
    totalSpentSec += sec;
    if (sec < fastestSec) fastestSec = sec;

    const rawName = String(rec.supporter || '').trim();
    const isUnassigned = !rawName;
    const key = isUnassigned ? '__unassigned__' : normalizeText(rawName);
    if (!supMap.has(key)) {
      supMap.set(key, {
        key,
        name: isUnassigned ? 'Chưa phân công' : rawName,
        isUnassigned,
        count: 0,
        totalSec: 0,
        fastestSec: Number.POSITIVE_INFINITY,
      });
    }
    const entry = supMap.get(key);
    entry.count += 1;
    entry.totalSec += sec;
    if (sec < entry.fastestSec) entry.fastestSec = sec;
  }

  const bySupporter = [...supMap.values()]
    .map((e) => ({ ...e, avgSec: Math.round(e.totalSec / e.count) }))
    .sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.avgSec - b.avgSec;
    });

  return {
    total,
    avgSec: Math.round(totalSpentSec / total),
    fastestSec: Number.isFinite(fastestSec) ? fastestSec : 0,
    totalSpentSec,
    supporterCount: bySupporter.filter((s) => !s.isUnassigned).length,
    bySupporter,
  };
}

const WEEKDAYS_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export function formatDateLabelVN(iso, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const ddmm = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  if (iso === todayIso) return `Hôm nay · ${ddmm}`;
  const wd = WEEKDAYS_VN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} · ${ddmm}`;
}

// =========================================================================
// BROWSER RUNTIME (chỉ chạy khi mở trong trình duyệt, an toàn cho node --test)
// =========================================================================
if (typeof document !== 'undefined') {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const SVG = {
    bell: '<svg class="ic wp-bell-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    bellOff: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>',
    users: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.5"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a3.5 3.5 0 0 1 0 6.74"/></svg>',
    userPlus: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="3.5"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>',
    alert: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.29 3.86-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.71-3.14l-8-14a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    history: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3.5 2"/></svg>',
    check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.3 2.3 2.3 4.7-4.9"/></svg>',
    checkBig: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.3 2.3 2.3 4.7-4.9"/></svg>',
    x: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    left: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    wifiOff: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2 22 22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    sun: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    moon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    tv: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
  };

  // ---------- Giao diện tối / sáng / TV dùng chung wr-theme & wr-tv với /kpi ----------
  const params = new URLSearchParams(location.search);
  const storeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  const prefs = (() => {
    const saved = storeGet('wr-theme');
    let theme = saved === 'light' ? 'light' : 'dark';
    let tv = storeGet('wr-tv') === '1' || saved === 'tv';
    if (params.get('theme') === 'light' || params.get('theme') === 'dark') theme = params.get('theme');
    if (params.get('tv') === '1') tv = true;
    if (params.get('tv') === '0') tv = false;
    return { theme, tv };
  })();

  function applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = prefs.tv || prefs.theme === 'dark' ? 'dark' : 'light';
    if (prefs.tv) root.dataset.tv = '1';
    else delete root.dataset.tv;
  }
  applyTheme();

  // ---------- Multi-harmonic Web Audio Metallic Bell ----------
  let audioCtx = null;
  let audioUnlocked = false;
  let bellTimer = null;

  function unlockAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (!audioCtx) return null;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        if (audioCtx && audioCtx.state === 'running' && !audioUnlocked) {
          audioUnlocked = true;
          updateHeaderBell();
        }
      }).catch(() => {});
    } else if (audioCtx.state === 'running') {
      audioUnlocked = true;
    }
    return audioCtx;
  }

  function strikeBell(ctx, startAt, baseFreq, volume = 0.2, decay = 0.55) {
    const harmonics = [
      { mult: 1.0, amp: 1.0, dec: decay },
      { mult: 2.02, amp: 0.45, dec: decay * 0.65 },
      { mult: 3.18, amp: 0.2, dec: decay * 0.4 },
    ];
    for (const h of harmonics) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * h.mult, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(volume * h.amp, startAt + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + h.dec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + h.dec + 0.03);
    }
  }

  function ringBell(kind) {
    state.bellRinging = true;
    updateHeaderBell();
    clearTimeout(bellTimer);
    bellTimer = setTimeout(() => {
      state.bellRinging = false;
      updateHeaderBell();
    }, 1250);
    if (!state.soundEnabled) return;
    try {
      const ctx = unlockAudio();
      if (!ctx) return;
      const now = ctx.currentTime + 0.01;
      if (kind === 'new') {
        strikeBell(ctx, now, 880, 0.24, 0.55);
        strikeBell(ctx, now + 0.22, 1174.66, 0.26, 0.72);
      } else if (kind === 'assigned') {
        strikeBell(ctx, now, 783.99, 0.18, 0.4);
        strikeBell(ctx, now + 0.14, 1046.5, 0.2, 0.52);
      } else if (kind === 'burn') {
        strikeBell(ctx, now, 987.77, 0.24, 0.22);
        strikeBell(ctx, now + 0.18, 987.77, 0.24, 0.22);
        strikeBell(ctx, now + 0.36, 1318.51, 0.26, 0.55);
      } else if (kind === 'clear') {
        strikeBell(ctx, now, 783.99, 0.2, 0.38);
        strikeBell(ctx, now + 0.11, 1046.5, 0.22, 0.45);
        strikeBell(ctx, now + 0.22, 1318.51, 0.25, 0.72);
      } else {
        strikeBell(ctx, now, 1046.5, 0.2, 0.45);
      }
    } catch {
      // ignore autoplay block
    }
  }

  // ---------- Storage & Merge Helpers ----------
  function loadTimerStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_TIMERS) || '{}'); } catch { return {}; }
  }
  function saveTimerStore(store) {
    try { localStorage.setItem(STORAGE_TIMERS, JSON.stringify(store)); } catch {}
  }
  function loadHistoryByDate() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || 'null');
      if (saved && saved.historyByDate && typeof saved.historyByDate === 'object') return saved.historyByDate;
      const legacy = JSON.parse(localStorage.getItem(LEGACY_HISTORY) || 'null');
      if (legacy && /^\d{4}-\d{2}-\d{2}$/.test(legacy.date || '') && Array.isArray(legacy.recentCleared)) {
        return { [legacy.date]: legacy.recentCleared.slice(0, 200) };
      }
    } catch {}
    return {};
  }
  function saveHistoryByDate(h) {
    try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify({ historyByDate: h })); } catch {}
  }

  function mergeDayRecords(prevList = [], incomingList = []) {
    const out = [...prevList];
    for (const item of incomingList) {
      if (!item || !item.issue) continue;
      const clearedAt = Number(item.clearedAt) || Date.now();
      const baseKey = item.id || `${item.group || ''}|${item.issue}`;
      const bucket = Math.floor(clearedAt / 30000);
      const candidates = new Set([`${baseKey}@${bucket}`, `${baseKey}@${bucket - 1}`, `${baseKey}@${bucket + 1}`]);
      const idx = out.findIndex((c) => {
        const k = c.dedupKey || `${c.id || c.issue}@${Math.floor((c.clearedAt || 0) / 30000)}`;
        return candidates.has(k);
      });
      if (idx >= 0) {
        const ex = out[idx];
        if ((!ex.supporter && item.supporter) || (!ex.owner && item.owner)) {
          out[idx] = { ...ex, supporter: ex.supporter || item.supporter, owner: ex.owner || item.owner };
        }
        continue;
      }
      out.unshift({ ...item, dedupKey: item.dedupKey || `${baseKey}@${bucket}` });
    }
    return out.sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0)).slice(0, 200);
  }

  // ---------- App State ----------
  const state = {
    isOnline: true,
    isFirstFetchDone: false,
    isSyncing: false,
    pendingSync: false,
    soundEnabled: true,
    bellRinging: false,
    liveItems: new Map(),
    pendingMissing: new Map(),
    lastSheetPresentRows: [],
    clearingItems: new Map(),
    newHighlights: new Map(),
    burnedAlerted: new Set(),
    lastBurnReminderAt: 0,
    lastBoardStructSig: '',
    historyByDate: loadHistoryByDate(),
    showStats: false,
    selectedDate: todayKeyVN(),
    supporterFilter: 'all',
    statsPage: 0,
    statsPageSize: WP_CONFIG.DEFAULT_PAGE_SIZE,
    expandedPeople: new Set(),
    syncApiAvailable: true,
  };

  let bc = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(SYNC_CHANNEL_NAME);
      bc.onmessage = (ev) => {
        if (ev?.data?.type === 'state_sync') {
          applySharedState(ev.data.payload);
          render();
        }
      };
    } catch {
      bc = null;
    }
  }

  function fmtTimeVN(date = new Date()) {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  }

  function showToast(title, body, kind = 'clear') {
    const root = document.getElementById('wp-toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `wp-toast t-${kind}`;
    const ico = kind === 'burn' ? SVG.alert : kind === 'new' ? SVG.bell : kind === 'assigned' ? SVG.users : SVG.check;
    el.innerHTML = `${ico}<div class="wp-toast-body"><b>${esc(title)}</b><span>${esc(body)}</span></div>`;
    root.prepend(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 220ms ease';
      setTimeout(() => el.remove(), 230);
    }, 4500);
  }

  function applySharedState(shared) {
    if (!shared || typeof shared !== 'object') return;
    const localTimers = loadTimerStore();

    if (shared.removedTimers && typeof shared.removedTimers === 'object') {
      for (const [id, removedAt] of Object.entries(shared.removedTimers)) {
        const cur = localTimers[id];
        if (cur && (cur.startedAt || 0) <= Number(removedAt)) delete localTimers[id];
      }
    }

    if (shared.timers && typeof shared.timers === 'object') {
      for (const [id, st] of Object.entries(shared.timers)) {
        if (!st || !st.startedAt) continue;
        const cur = localTimers[id];
        const meta = {
          lastSupporter: st.lastSupporter || cur?.lastSupporter || '',
          lastOwner: st.lastOwner || cur?.lastOwner || '',
        };
        if (
          !cur ||
          (cur.rawTime === st.rawTime && st.startedAt < cur.startedAt) ||
          (cur.rawTime !== st.rawTime && (st.updatedAt || 0) >= (cur.updatedAt || 0))
        ) {
          localTimers[id] = { ...st, ...meta };
          const live = state.liveItems.get(id);
          if (live) {
            live.startedAt = st.startedAt;
            live.totalSec = st.totalSec;
            live.endAt = st.endAt;
            live.lastKnownSupporter = live.lastKnownSupporter || meta.lastSupporter;
            live.lastKnownOwner = live.lastKnownOwner || meta.lastOwner;
          }
        } else if (meta.lastSupporter !== cur.lastSupporter || meta.lastOwner !== cur.lastOwner) {
          localTimers[id] = { ...cur, ...meta };
        }
      }
      saveTimerStore(localTimers);
    }

    if (shared.historyByDate && typeof shared.historyByDate === 'object') {
      for (const [dKey, list] of Object.entries(shared.historyByDate)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dKey) && Array.isArray(list)) {
          state.historyByDate[dKey] = mergeDayRecords(state.historyByDate[dKey], list);
        }
      }
    } else if (shared.date && Array.isArray(shared.recentCleared)) {
      state.historyByDate[shared.date] = mergeDayRecords(state.historyByDate[shared.date], shared.recentCleared);
    }

    const curToday = todayKeyVN();
    if (Array.isArray(state.historyByDate[curToday]) && state.lastSheetPresentRows.length > 0) {
      state.historyByDate[curToday] = pruneTodayHistoryBySheet(state.historyByDate[curToday], state.lastSheetPresentRows);
    }
    saveHistoryByDate(state.historyByDate);
  }

  async function fetchSharedState() {
    if (!state.syncApiAvailable) return null;
    try {
      const res = await fetch('/api/waiting-point', { cache: 'no-store' });
      if (res.status === 404 || res.status === 405) {
        state.syncApiAvailable = false;
        return null;
      }
      if (!res.ok) return null;
      const ct = res.headers.get('Content-Type') || '';
      if (!ct.includes('application/json')) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function pushSharedDelta(delta) {
    if (bc) {
      try {
        bc.postMessage({
          type: 'state_sync',
          payload: { date: todayKeyVN(), timers: loadTimerStore(), historyByDate: state.historyByDate },
        });
      } catch {}
    }
    if (!state.syncApiAvailable) return;
    try {
      const res = await fetch('/api/waiting-point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(delta),
      });
      if (res.ok && (res.headers.get('Content-Type') || '').includes('application/json')) {
        applySharedState(await res.json());
      }
    } catch {}
  }

  async function syncFromSheet() {
    if (state.isSyncing) {
      state.pendingSync = true;
      return;
    }
    state.isSyncing = true;
    try {
      const [result, shared] = await Promise.all([fetchWaitingPoints(), fetchSharedState()]);
      if (shared) applySharedState(shared);

      const now = Date.now();
      const curToday = todayKeyVN(now);
      const wasOnline = state.isOnline;
      state.isOnline = true;
      state.lastSheetPresentRows = Array.isArray(result.sheetPresentRows) ? result.sheetPresentRows : [];

      // Đồng bộ ngược bảng Thống kê hôm nay với Sheet: dòng nào vẫn còn trên Sheet thì gỡ khỏi lịch sử hoàn thành hôm nay.
      let prunedBySheet = false;
      const beforeLocalLen = (state.historyByDate[curToday] || []).length;
      if (beforeLocalLen > 0 && state.lastSheetPresentRows.length > 0) {
        const cleaned = pruneTodayHistoryBySheet(state.historyByDate[curToday], state.lastSheetPresentRows);
        if (cleaned.length !== beforeLocalLen) {
          state.historyByDate[curToday] = cleaned;
          saveHistoryByDate(state.historyByDate);
          prunedBySheet = true;
        }
      }
      const serverTodayList = shared?.historyByDate?.[curToday] || (shared?.date === curToday ? shared?.recentCleared : null) || [];
      const serverNeedsPrune =
        Array.isArray(serverTodayList) &&
        serverTodayList.length > 0 &&
        state.lastSheetPresentRows.length > 0 &&
        pruneTodayHistoryBySheet(serverTodayList, state.lastSheetPresentRows).length !== serverTodayList.length;

      const timerStore = loadTimerStore();
      const sharedTimers = shared?.timers || {};
      const nextMap = new Map();
      const newEntries = [];
      const newlyAssigned = [];
      const deltaTimers = {};
      let hasTimerDelta = false;

      for (const rawItem of result.items) {
        const existing = state.liveItems.get(rawItem.id);
        const fromServer = sharedTimers[rawItem.id];
        const stored = fromServer || timerStore[rawItem.id];

        const startedAt = fromServer?.startedAt || existing?.startedAt || stored?.startedAt || now;
        let totalSec = fromServer?.totalSec ?? existing?.totalSec ?? stored?.totalSec ?? null;
        let endAt = fromServer?.endAt ?? existing?.endAt ?? stored?.endAt ?? null;
        let updatedAt = fromServer?.updatedAt || stored?.updatedAt || now;

        const prevRawTime = fromServer?.rawTime ?? existing?.timeRaw ?? stored?.rawTime;
        if (!existing && !stored) {
          const calc = resolveDeadlineFromSpec(rawItem.timeSpec, startedAt);
          totalSec = calc.totalSec;
          endAt = calc.endAt;
          updatedAt = now;
          hasTimerDelta = true;
        } else if (prevRawTime !== rawItem.timeRaw) {
          const calc = resolveDeadlineFromSpec(rawItem.timeSpec, now);
          totalSec = calc.totalSec;
          endAt = calc.endAt;
          updatedAt = now;
          hasTimerDelta = true;
        }

        const lastKnownSupporter = rawItem.supporter || existing?.lastKnownSupporter || stored?.lastSupporter || '';
        const lastKnownOwner = rawItem.owner || existing?.lastKnownOwner || stored?.lastOwner || '';
        if (
          (rawItem.supporter && rawItem.supporter !== stored?.lastSupporter) ||
          (rawItem.owner && rawItem.owner !== stored?.lastOwner)
        ) {
          hasTimerDelta = true;
        }

        const fullItem = { ...rawItem, startedAt, totalSec, endAt, lastKnownSupporter, lastKnownOwner };
        nextMap.set(fullItem.id, fullItem);

        const timerEntry = {
          startedAt,
          totalSec,
          endAt,
          rawTime: rawItem.timeRaw,
          updatedAt,
          lastSupporter: lastKnownSupporter,
          lastOwner: lastKnownOwner,
        };
        timerStore[fullItem.id] = timerEntry;
        deltaTimers[fullItem.id] = timerEntry;

        if (state.isFirstFetchDone && !existing) {
          newEntries.push(fullItem);
          state.newHighlights.set(fullItem.id, now + WP_CONFIG.NEW_HIGHLIGHT_MS);
        } else if (
          state.isFirstFetchDone &&
          existing &&
          normalizeText(existing.supporter) !== normalizeText(rawItem.supporter) &&
          rawItem.supporter
        ) {
          newlyAssigned.push(fullItem);
          state.newHighlights.set(fullItem.id, now + WP_CONFIG.NEW_HIGHLIGHT_MS);
        }
      }

      let removedEntries = [];
      if (state.isFirstFetchDone) {
        const reconciled = reconcileMissingItems(state.liveItems, nextMap, state.pendingMissing, 2);
        removedEntries = reconciled.confirmedRemoved;
        for (const item of removedEntries) {
          delete timerStore[item.id];
        }
      } else {
        state.pendingMissing.clear();
      }

      saveTimerStore(timerStore);
      state.liveItems = nextMap;
      state.isFirstFetchDone = true;

      const clearedPayload = [];
      if (removedEntries.length > 0) {
        for (const item of removedEntries) {
          const spentSec = Math.max(5, Math.floor((now - item.startedAt) / 1000));
          const resolvedSupporter = item.supporter || item.lastKnownSupporter || '';
          const resolvedOwner = item.owner || item.lastKnownOwner || '';
          state.clearingItems.set(item.id, { ...item, supporter: resolvedSupporter, owner: resolvedOwner, clearedAt: now });
          state.burnedAlerted.delete(item.id);
          state.newHighlights.delete(item.id);

          const rec = {
            date: curToday,
            id: item.id,
            group: item.group,
            stream: item.stream,
            issue: item.issue,
            owner: resolvedOwner,
            supporter: resolvedSupporter,
            spentSec,
            at: fmtTimeVN(new Date(now)).slice(0, 5),
            clearedAt: now,
          };
          clearedPayload.push(rec);
          const byWho = resolvedSupporter ? ` · ${resolvedSupporter}` : '';
          showToast(`ĐÃ HOÀN THÀNH (${formatClock(spentSec)})`, `${item.group}${byWho} — ${item.issue}`, 'clear');

          setTimeout(() => {
            state.clearingItems.delete(item.id);
            render();
          }, WP_CONFIG.CLEAR_ANIMATION_MS);
        }

        state.historyByDate[curToday] = mergeDayRecords(state.historyByDate[curToday], clearedPayload);
        state.statsPage = 0;
        saveHistoryByDate(state.historyByDate);
        ringBell('clear');
      }

      if (newEntries.length > 0) {
        ringBell('new');
        const first = newEntries[0];
        const who = first.supporter || 'Chưa phân công';
        showToast(
          newEntries.length === 1 ? `YÊU CẦU MỚI · ${who}` : `${newEntries.length} YÊU CẦU MỚI`,
          `${first.group} — ${first.issue}`,
          'new',
        );
      } else if (newlyAssigned.length > 0) {
        ringBell('assigned');
        const first = newlyAssigned[0];
        showToast(`ĐÃ PHÂN CÔNG · ${first.supporter}`, `${first.group} — ${first.issue}`, 'assigned');
      }

      if (
        hasTimerDelta ||
        newEntries.length > 0 ||
        removedEntries.length > 0 ||
        prunedBySheet ||
        serverNeedsPrune ||
        Object.keys(sharedTimers).length === 0
      ) {
        pushSharedDelta({
          timers: deltaTimers,
          removedIds: removedEntries.map((r) => r.id),
          clearedItems: clearedPayload,
          activeSheetRows: state.lastSheetPresentRows,
        });
      }

      if (state.showStats) {
        updateHeaderOnly();
        if ((removedEntries.length > 0 || prunedBySheet) && document.activeElement?.id !== 'wp-date-picker') {
          render();
        }
      } else {
        const snap = buildBoardSnapshot(now);
        if (
          !wasOnline ||
          snap.structSig !== state.lastBoardStructSig ||
          newEntries.length > 0 ||
          removedEntries.length > 0 ||
          newlyAssigned.length > 0 ||
          hasTimerDelta
        ) {
          render();
        } else {
          updateHeaderOnly();
        }
      }
    } catch {
      state.isOnline = false;
      updateHeaderOnly();
    } finally {
      state.isSyncing = false;
      if (state.pendingSync) {
        state.pendingSync = false;
        setTimeout(syncFromSheet, 250);
      }
    }
  }

  function checkOverdueAlerts(now) {
    if (!state.liveItems.size) return;
    let newlyBurned = null;
    let anyBurning = false;
    for (const item of state.liveItems.values()) {
      const t = computeTiming(item, now);
      if (t.tier === 'burn') {
        anyBurning = true;
        if (!state.burnedAlerted.has(item.id)) {
          state.burnedAlerted.add(item.id);
          newlyBurned = item;
        }
      }
    }
    if (newlyBurned) {
      state.lastBurnReminderAt = now;
      ringBell('burn');
      const who = newlyBurned.supporter || 'Chưa phân công';
      showToast(`QUÁ HẠN XỬ LÝ · ${who}`, `${newlyBurned.group} — ${newlyBurned.issue}`, 'burn');
    } else if (anyBurning && now - state.lastBurnReminderAt >= WP_CONFIG.BURN_REMINDER_MS) {
      state.lastBurnReminderAt = now;
      ringBell('burn');
    }
  }

  // ---------- Dynamic Pagination Sizing for Thống kê theo ngày ----------
  let statsRo = null;
  function measureStatsPageSize() {
    const wrap = document.getElementById('wp-stats-table-wrap');
    if (!wrap) return;
    const h = wrap.clientHeight;
    if (!h) return;
    const headH = wrap.querySelector('thead')?.getBoundingClientRect().height || 34;
    const rows = wrap.querySelectorAll('tbody tr');
    let rowH = 44;
    if (rows.length > 0) {
      let maxH = 0;
      for (const r of rows) maxH = Math.max(maxH, r.getBoundingClientRect().height);
      if (maxH > 18) rowH = maxH;
    }
    const fit = Math.max(5, Math.floor((h - headH - 4) / rowH));
    if (fit !== state.statsPageSize) {
      state.statsPageSize = fit;
      render();
    }
  }

  // ---------- Render Views ----------
  function renderPersonCard(person, idx, now, compact) {
    // Hiển thị đầy đủ tất cả đầu việc của từng người (gấp nhất ở trên cùng) và cuộn mượt trong thẻ khi nhiều việc.
    const shown = person.tasks;
    const hasNew = person.tasks.some((t) => (state.newHighlights.get(t.id) || 0) > now);
    const topTask = person.tasks.find((t) => !t.isClearing) || person.tasks[0];

    let heroClock = '–';
    let heroLabel = 'ĐANG CHỜ';
    let heroTier = 'none';
    if (topTask) {
      if (topTask.isClearing) {
        heroClock = 'Xong';
        heroLabel = 'HOÀN TẤT';
        heroTier = 'clear';
      } else if (topTask.timing.mode === 'elapsed') {
        heroClock = formatClock(topTask.timing.elapsedSec);
        heroLabel = 'ĐÃ CHỜ';
        heroTier = 'none';
      } else {
        heroClock = formatClock(topTask.timing.remainingSec);
        heroLabel = topTask.timing.tier === 'burn' ? 'QUÁ HẠN' : topTask.timing.tier === 'warn' ? 'SẮP HẾT' : 'GẤP NHẤT';
        heroTier = topTask.timing.tier;
      }
    }

    const cardCls = [
      'wp-card',
      compact ? 'compact' : '',
      person.topTier === 'burn' ? 'is-burn' : person.topTier === 'warn' ? 'is-warn' : person.isUnassigned ? 'is-unassigned' : '',
      hasNew ? 'is-new' : '',
    ].filter(Boolean).join(' ');

    const rowsHtml = shown.map((tk) => {
      const isNew = (state.newHighlights.get(tk.id) || 0) > now;
      const tier = tk.isClearing ? 'clear' : tk.timing.tier;
      const restMeta = [shortStreamName(tk.stream), tk.owner ? `PIC: ${tk.owner}` : ''].filter(Boolean).join(' · ');
      const clk = tk.isClearing
        ? 'Xong'
        : tk.timing.mode === 'elapsed'
          ? formatClock(tk.timing.elapsedSec)
          : formatClock(tk.timing.remainingSec);
      const sub = tk.isClearing
        ? 'Hoàn tất'
        : tk.timing.mode === 'elapsed'
          ? 'Đã chờ'
          : tk.timing.tier === 'burn'
            ? 'Quá hạn'
            : tk.timing.tier === 'warn'
              ? 'Sắp hết'
              : tk.timeRaw || 'Còn lại';

      return `
        <article class="wp-node" data-task-id="${esc(tk.id)}" title="${esc(`${tk.issue}\n${tk.group} · ${restMeta}${tk.timeRaw ? ` · SLA: ${tk.timeRaw}` : ''}`)}">
          <span class="wp-dot t-${tier}" aria-hidden="true"></span>
          ${tk.isClearing ? `<div class="wp-cleared-veil"><span>${SVG.check} Đã hoàn thành</span></div>` : ''}
          <div class="wp-node-main">
            <p class="wp-node-title">${isNew ? '<span class="wp-new-pill" style="margin-right:6px">MỚI</span>' : ''}${esc(tk.issue)}</p>
            <div class="wp-node-meta">
              ${tk.group ? `<span class="wp-cat" title="${esc(tk.group)}">${esc(tk.group)}</span>` : ''}
              ${restMeta ? `<span class="wp-rest" title="${esc(restMeta)}">${esc(restMeta)}</span>` : ''}
            </div>
            ${tk.timing.mode === 'countdown' && !tk.isClearing ? `<div class="wp-gauge t-${tier}"><i data-task-gauge="${esc(tk.id)}" style="width:${tk.timing.pct}%"></i></div>` : ''}
          </div>
          <div class="wp-node-right t-${tier}">
            <b data-task-clock="${esc(tk.id)}">${esc(clk)}</b>
            <span data-task-sub="${esc(tk.id)}" title="${esc(sub)}">${esc(sub)}</span>
          </div>
        </article>
      `;
    }).join('');

    return `
      <section class="${cardCls}" data-person-key="${esc(person.key)}">
        <header class="wp-card-top">
          <div class="wp-card-id">
            <span class="wp-idx ${person.isUnassigned ? 'is-unassigned' : ''}">${person.isUnassigned ? SVG.userPlus : String(idx).padStart(2, '0')}</span>
            <div class="wp-name-col">
              <div class="wp-name-row">
                <h2 title="${esc(person.name)}">${esc(person.name)}</h2>
                ${hasNew ? '<span class="wp-new-pill">MỚI</span>' : ''}
              </div>
              <div class="wp-sub">
                <span>${person.isUnassigned ? 'Chờ nhận hỗ trợ' : 'Người hỗ trợ'}</span>
                <span>·</span>
                <b class="wp-mono">${person.activeCount}</b> yêu cầu
                ${person.burnCount > 0 ? `<span>·</span><span class="wp-sub-burn"><b class="wp-mono">${person.burnCount}</b> quá hạn</span>` : person.warnCount > 0 ? `<span>·</span><span class="wp-sub-warn"><b class="wp-mono">${person.warnCount}</b> sắp hết</span>` : ''}
              </div>
            </div>
          </div>
          <div class="wp-timeblock t-${heroTier}" data-hero-person="${esc(person.key)}">
            <b data-hero-clock="${esc(person.key)}">${esc(heroClock)}</b>
            <span data-hero-label="${esc(person.key)}">${esc(heroLabel)}</span>
          </div>
        </header>
        <div class="wp-timeline">${rowsHtml}</div>
      </section>
    `;
  }

  function renderStatsPanel(todayKey) {
    const dates = [...new Set([todayKey, ...Object.keys(state.historyByDate || {})])]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort((a, b) => b.localeCompare(a));

    const activeDate = state.selectedDate || todayKey;
    const dayItems = Array.isArray(state.historyByDate[activeDate]) ? state.historyByDate[activeDate] : [];
    const stats = buildDailyStats(dayItems);

    const filtered = state.supporterFilter === 'all'
      ? dayItems
      : dayItems.filter((rec) => {
          const key = String(rec.supporter || '').trim() ? normalizeText(rec.supporter) : '__unassigned__';
          return key === state.supporterFilter;
        });

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.statsPageSize));
    const safePage = Math.min(Math.max(0, state.statsPage), totalPages - 1);
    const start = safePage * state.statsPageSize;
    const pageItems = filtered.slice(start, start + state.statsPageSize);

    const dateChips = dates.slice(0, 5).map((d) => {
      const cnt = (state.historyByDate[d] || []).length;
      return `<button type="button" class="wp-date-chip ${d === activeDate ? 'is-active' : ''}" data-pick-date="${esc(d)}"><span>${esc(formatDateLabelVN(d, todayKey))}</span><b>${cnt}</b></button>`;
    }).join('');

    const supChips = stats.bySupporter.length
      ? `
        <div class="wp-sup-bar">
          <span class="wp-sup-lbl">Theo người hỗ trợ</span>
          <button type="button" class="wp-sup-chip ${state.supporterFilter === 'all' ? 'is-active' : ''}" data-pick-sup="all"><span>Tất cả</span><b>${stats.total}</b></button>
          ${stats.bySupporter.map((s) => `
            <button type="button" class="wp-sup-chip ${state.supporterFilter === s.key ? 'is-active' : ''} ${s.isUnassigned ? 'is-unassigned' : ''}" data-pick-sup="${esc(s.key)}">
              <span>${esc(s.name)}</span>
              <b>${s.count}</b>
              <small>TB ${formatClock(s.avgSec)}</small>
            </button>
          `).join('')}
        </div>
      `
      : '';

    const tableHtml = !filtered.length
      ? `<div class="wp-empty" style="border:0"><h2>Chưa có yêu cầu nào hoàn thành trong ngày ${esc(formatDateLabelVN(activeDate, todayKey))}</h2></div>`
      : `
        <table class="wp-tbl">
          <thead>
            <tr>
              <th class="wp-c-at">Giờ xong</th>
              <th class="wp-c-sup">Người hỗ trợ</th>
              <th class="wp-c-grp">Nhóm công việc</th>
              <th class="wp-c-flow">Dòng tiền</th>
              <th class="wp-c-issue">Vấn đề đã xử lý</th>
              <th class="wp-c-spent">Thời lượng</th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map((rec) => `
              <tr>
                <td class="wp-c-at">${esc(rec.at || '–')}</td>
                <td class="wp-c-sup">
                  <div class="wp-sup-nm ${rec.supporter ? '' : 'muted'}" title="${esc(rec.supporter || 'Chưa phân công')}">${esc(rec.supporter || 'Chưa phân công')}</div>
                  ${rec.owner ? `<div class="wp-sup-pic" title="${esc(`PIC: ${rec.owner}`)}">PIC: ${esc(rec.owner)}</div>` : ''}
                </td>
                <td class="wp-c-grp" title="${esc(rec.group)}">${esc(rec.group || '–')}</td>
                <td class="wp-c-flow" title="${esc(rec.stream)}">${esc(shortStreamName(rec.stream))}</td>
                <td class="wp-c-issue" title="${esc(rec.issue)}">${esc(rec.issue)}</td>
                <td class="wp-c-spent"><span class="wp-spent-pill">${SVG.check} ${formatClock(rec.spentSec || 5)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    return `
      <section class="wp-stats-panel">
        <header class="wp-stats-head">
          <div>
            <span class="wp-kicker">Thống kê theo ngày</span>
            <h2>Lịch sử xử lý <small>· ${esc(formatDateLabelVN(activeDate, todayKey))}</small></h2>
          </div>
          <div class="wp-stats-controls">
            ${dateChips}
            <input type="date" class="wp-date-input" id="wp-date-picker" value="${esc(activeDate)}" max="${esc(todayKey)}" aria-label="Chọn ngày xem thống kê" />
            ${totalPages > 1 ? `
              <div class="wp-pager">
                <button type="button" class="wp-btn" id="wp-prev-page" ${safePage <= 0 ? 'disabled' : ''}>${SVG.left}<span>Trước</span></button>
                <span class="wp-pager-num">${safePage + 1} / ${totalPages}</span>
                <button type="button" class="wp-btn" id="wp-next-page" ${safePage >= totalPages - 1 ? 'disabled' : ''}><span>Sau</span>${SVG.right}</button>
              </div>
            ` : ''}
            <button type="button" class="wp-btn" id="wp-close-stats">${SVG.x}<span>Về bảng chờ</span></button>
          </div>
        </header>

        <div class="wp-kpi-strip">
          <div class="wp-kpi-tile t-done ${stats.total === 0 ? 'is-zero' : ''}"><span>Đã xử lý trong ngày</span><b>${stats.total}</b></div>
          <div class="wp-kpi-tile ${stats.supporterCount === 0 ? 'is-zero' : ''}"><span>Người hỗ trợ tham gia</span><b>${stats.supporterCount}</b></div>
          <div class="wp-kpi-tile t-warn ${stats.total === 0 ? 'is-zero' : ''}"><span>Thời gian xử lý TB</span><b>${stats.total ? formatClock(stats.avgSec) : '–'}</b></div>
          <div class="wp-kpi-tile t-dim ${stats.total === 0 ? 'is-zero' : ''}"><span>Xử lý nhanh nhất</span><b>${stats.total ? formatClock(stats.fastestSec) : '–'}</b></div>
        </div>

        ${supChips}

        <div class="wp-table-wrap" id="wp-stats-table-wrap">${tableHtml}</div>
      </section>
    `;
  }

  // ---------- Persistent Shell & Delegated Events (không bao giờ huỷ nút header mỗi giây) ----------
  let shellMounted = false;
  const ui = {};

  function mountShell() {
    const app = document.getElementById('wp-app');
    if (!app || shellMounted) return;
    shellMounted = true;

    app.innerHTML = `
      <header class="wp-head">
        <div class="wp-brand">
          <span class="wp-brand-badge" aria-hidden="true">WP</span>
          <h1>Waiting Point</h1>
        </div>
        <div class="wp-actions">
          <span class="wp-pill is-danger" id="wp-pill-offline" hidden>${SVG.wifiOff}<span>Mất kết nối Sheet</span></span>
          <span class="wp-pill is-danger" id="wp-pill-burn" hidden>${SVG.alert}<span>Quá hạn</span><b class="wp-mono" id="wp-burn-cnt">0</b></span>
          <span class="wp-pill is-zero" id="wp-pill-count">${SVG.users}<span class="wp-mono"><b id="wp-people-cnt">0</b> người · <b id="wp-active-cnt">0</b> việc</span></span>
          <button type="button" class="wp-btn" id="wp-btn-bell"><span id="wp-bell-ico-wrap">${SVG.bell}</span><span id="wp-bell-lbl">Chuông: Bật</span></button>
          <button type="button" class="wp-btn" id="wp-btn-stats">${SVG.history}<span>Thống kê</span><b class="wp-btn-cnt zero" id="wp-stats-cnt">0</b></button>
          <button type="button" class="wp-btn" id="wp-btn-theme" title="Đổi giao diện sáng / tối"><span id="wp-theme-ico">${SVG.sun}</span><span id="wp-theme-lbl">Sáng</span></button>
          <button type="button" class="wp-btn" id="wp-btn-tv" aria-pressed="false">${SVG.tv}<span id="wp-tv-lbl">TV</span></button>
          <div class="wp-clock" id="wp-clock" aria-label="Giờ hiện tại">${fmtTimeVN(new Date())}</div>
        </div>
      </header>
      <main class="wp-stage" id="wp-stage"></main>
    `;

    ui.offline = document.getElementById('wp-pill-offline');
    ui.burnPill = document.getElementById('wp-pill-burn');
    ui.burnCnt = document.getElementById('wp-burn-cnt');
    ui.countPill = document.getElementById('wp-pill-count');
    ui.peopleCnt = document.getElementById('wp-people-cnt');
    ui.activeCnt = document.getElementById('wp-active-cnt');
    ui.bellBtn = document.getElementById('wp-btn-bell');
    ui.bellIco = document.getElementById('wp-bell-ico-wrap');
    ui.bellLbl = document.getElementById('wp-bell-lbl');
    ui.statsBtn = document.getElementById('wp-btn-stats');
    ui.statsCnt = document.getElementById('wp-stats-cnt');
    ui.themeBtn = document.getElementById('wp-btn-theme');
    ui.themeIco = document.getElementById('wp-theme-ico');
    ui.themeLbl = document.getElementById('wp-theme-lbl');
    ui.tvBtn = document.getElementById('wp-btn-tv');
    ui.tvLbl = document.getElementById('wp-tv-lbl');
    ui.clock = document.getElementById('wp-clock');
    ui.stage = document.getElementById('wp-stage');

    // Gắn sự kiện ủy quyền 1 lần duy nhất lên #wp-app -> bấm nút luôn ăn ngay phát đầu tiên.
    app.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target || target.disabled) return;
      const todayKey = todayKeyVN();

      if (target.id === 'wp-btn-bell') {
        const wasLocked = !audioUnlocked;
        unlockAudio();
        audioUnlocked = true;
        if (wasLocked && state.soundEnabled) {
          ringBell('test');
          updateHeaderBell();
          return;
        }
        state.soundEnabled = !state.soundEnabled;
        if (state.soundEnabled) ringBell('test');
        updateHeaderBell();
        return;
      }

      if (target.id === 'wp-btn-stats') {
        state.showStats = !state.showStats;
        state.selectedDate = todayKey;
        state.supporterFilter = 'all';
        state.statsPage = 0;
        render();
        return;
      }

      if (target.id === 'wp-open-stats-empty') {
        state.showStats = true;
        state.selectedDate = todayKey;
        state.supporterFilter = 'all';
        state.statsPage = 0;
        render();
        return;
      }

      if (target.id === 'wp-close-stats') {
        state.showStats = false;
        render();
        return;
      }

      if (target.id === 'wp-btn-theme') {
        prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
        storeSet('wr-theme', prefs.theme);
        applyTheme();
        updateHeaderOnly();
        return;
      }

      if (target.id === 'wp-btn-tv') {
        prefs.tv = !prefs.tv;
        storeSet('wr-tv', prefs.tv ? '1' : '0');
        applyTheme();
        updateHeaderOnly();
        return;
      }

      if (target.id === 'wp-prev-page') {
        state.statsPage = Math.max(0, state.statsPage - 1);
        render();
        return;
      }

      if (target.id === 'wp-next-page') {
        state.statsPage += 1;
        render();
        return;
      }

      const toggleKey = target.getAttribute('data-toggle-person');
      if (toggleKey) {
        if (state.expandedPeople.has(toggleKey)) state.expandedPeople.delete(toggleKey);
        else state.expandedPeople.add(toggleKey);
        render();
        return;
      }

      const pickDate = target.getAttribute('data-pick-date');
      if (pickDate) {
        state.selectedDate = pickDate || todayKey;
        state.supporterFilter = 'all';
        state.statsPage = 0;
        render();
        return;
      }

      const pickSup = target.getAttribute('data-pick-sup');
      if (pickSup) {
        state.supporterFilter = state.supporterFilter === pickSup && pickSup !== 'all' ? 'all' : pickSup;
        state.statsPage = 0;
        render();
      }
    });

    app.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'wp-date-picker' && e.target.value) {
        state.selectedDate = e.target.value;
        state.supporterFilter = 'all';
        state.statsPage = 0;
        render();
      }
    });
  }

  function updateHeaderBell() {
    if (!shellMounted) return;
    const bellLabel = !state.soundEnabled ? 'Chuông: Tắt' : !audioUnlocked ? 'Bấm bật chuông' : 'Chuông: Bật';
    const bellCls = !state.soundEnabled
      ? 'wp-btn is-muted'
      : state.bellRinging
        ? 'wp-btn is-ringing'
        : !audioUnlocked
          ? 'wp-btn is-attention'
          : 'wp-btn';
    ui.bellBtn.className = bellCls;
    ui.bellLbl.textContent = bellLabel;
    const desiredIcon = state.soundEnabled ? 'on' : 'off';
    if (ui.bellIco.dataset.ico !== desiredIcon) {
      ui.bellIco.dataset.ico = desiredIcon;
      ui.bellIco.innerHTML = state.soundEnabled ? SVG.bell : SVG.bellOff;
    }
  }

  function buildBoardSnapshot(now) {
    const visible = [];
    const liveIds = new Set();
    for (const item of state.liveItems.values()) {
      liveIds.add(item.id);
      visible.push({ ...item, isClearing: false, timing: computeTiming(item, now) });
    }
    for (const item of state.clearingItems.values()) {
      if (!liveIds.has(item.id)) {
        visible.push({
          ...item,
          isClearing: true,
          timing: { mode: 'countdown', remainingSec: 999999, elapsedSec: 0, pct: 100, tier: 'ok' },
        });
      }
    }
    const people = groupItemsByPerson(visible);
    const activeCount = visible.filter((v) => !v.isClearing).length;
    const burnCount = visible.filter((v) => !v.isClearing && v.timing.tier === 'burn').length;
    const structSig = people
      .map((p) => {
        const tasksSig = p.tasks
          .map((t) => `${t.id}:${t.owner || ''}:${t.timeRaw || ''}:${t.isClearing ? 'c' : t.timing.tier}:${(state.newHighlights.get(t.id) || 0) > now ? 'n' : 'o'}`)
          .join(',');
        return `${p.key}[${p.topTier}:${tasksSig}]`;
      })
      .join('|');
    return { visible, people, activeCount, burnCount, structSig };
  }

  function updateHeader(now, peopleCount, activeCount, burnCount, todayClearedCount) {
    if (!shellMounted) return;
    ui.offline.hidden = state.isOnline;
    ui.burnPill.hidden = burnCount <= 0;
    ui.burnCnt.textContent = String(burnCount);
    ui.countPill.className = activeCount === 0 ? 'wp-pill is-zero' : 'wp-pill';
    ui.peopleCnt.textContent = String(peopleCount);
    ui.activeCnt.textContent = String(activeCount);
    updateHeaderBell();
    ui.statsBtn.className = state.showStats ? 'wp-btn is-active' : 'wp-btn';
    ui.statsCnt.className = todayClearedCount === 0 ? 'wp-btn-cnt zero' : 'wp-btn-cnt';
    ui.statsCnt.textContent = String(todayClearedCount);
    ui.themeBtn.hidden = prefs.tv;
    const themeIcon = prefs.theme === 'dark' ? 'sun' : 'moon';
    if (ui.themeIco.dataset.ico !== themeIcon) {
      ui.themeIco.dataset.ico = themeIcon;
      ui.themeIco.innerHTML = prefs.theme === 'dark' ? SVG.sun : SVG.moon;
    }
    ui.themeLbl.textContent = prefs.theme === 'dark' ? 'Sáng' : 'Tối';
    ui.tvBtn.className = prefs.tv ? 'wp-btn is-active' : 'wp-btn';
    ui.tvBtn.setAttribute('aria-pressed', String(prefs.tv));
    ui.tvLbl.textContent = prefs.tv ? 'Thường' : 'TV';
    ui.clock.textContent = fmtTimeVN(new Date(now));
  }

  function updateHeaderOnly() {
    mountShell();
    const now = Date.now();
    const todayKey = todayKeyVN(now);
    const todayCleared = state.historyByDate[todayKey] || [];
    const snap = buildBoardSnapshot(now);
    updateHeader(now, snap.people.length, snap.activeCount, snap.burnCount, todayCleared.length);
  }

  function tickInPlace(now) {
    if (!shellMounted) return;
    ui.clock.textContent = fmtTimeVN(new Date(now));
    if (state.showStats) return;

    const snap = buildBoardSnapshot(now);
    const todayKey = todayKeyVN(now);
    const todayCleared = state.historyByDate[todayKey] || [];
    updateHeader(now, snap.people.length, snap.activeCount, snap.burnCount, todayCleared.length);

    // Chỉ dựng lại bảng nếu thứ tự người/task, mức cảnh báo (ok->warn->burn) hoặc nhãn MỚI thực sự thay đổi.
    if (snap.structSig !== state.lastBoardStructSig) {
      render();
      return;
    }

    // Cập nhật đồng hồ đếm ngược & thanh SLA tại chỗ -> không phá DOM, không mất click.
    for (const person of snap.people) {
      const topTask = person.tasks.find((t) => !t.isClearing) || person.tasks[0];
      if (topTask) {
        const heroClockEl = ui.stage.querySelector(`[data-hero-clock="${CSS.escape(person.key)}"]`);
        if (heroClockEl) {
          heroClockEl.textContent = topTask.isClearing
            ? 'Xong'
            : topTask.timing.mode === 'elapsed'
              ? formatClock(topTask.timing.elapsedSec)
              : formatClock(topTask.timing.remainingSec);
        }
      }
      for (const tk of person.tasks) {
        if (tk.isClearing) continue;
        const escId = CSS.escape(tk.id);
        const clkEl = ui.stage.querySelector(`[data-task-clock="${escId}"]`);
        if (clkEl) {
          clkEl.textContent = tk.timing.mode === 'elapsed'
            ? formatClock(tk.timing.elapsedSec)
            : formatClock(tk.timing.remainingSec);
        }
        const gaugeEl = ui.stage.querySelector(`[data-task-gauge="${escId}"]`);
        if (gaugeEl && tk.timing.mode === 'countdown') {
          gaugeEl.style.width = `${tk.timing.pct}%`;
        }
      }
    }
  }

  function render() {
    mountShell();
    if (!ui.stage) return;

    const now = Date.now();
    const todayKey = todayKeyVN(now);
    const todayCleared = state.historyByDate[todayKey] || [];
    const { people, activeCount, burnCount, structSig } = buildBoardSnapshot(now);

    updateHeader(now, people.length, activeCount, burnCount, todayCleared.length);

    // Bảo toàn vị trí cuộn bên trong từng thẻ người
    const prevScrolls = new Map();
    ui.stage.querySelectorAll('.wp-card').forEach((card) => {
      const k = card.getAttribute('data-person-key');
      const sc = card.querySelector('.wp-timeline');
      if (k && sc) prevScrolls.set(k, sc.scrollTop);
    });

    let stageHtml = '';
    if (state.showStats) {
      stageHtml = renderStatsPanel(todayKey);
    } else if (people.length === 0) {
      stageHtml = `
        <section class="wp-empty">
          <div class="wp-empty-ring">${SVG.checkBig}</div>
          <h2>Hiện không có điểm chờ cần hỗ trợ</h2>
          <div class="wp-empty-bar">
            <span class="wp-empty-status">
              <span class="wp-live-dot ${state.isOnline ? '' : 'offline'}"></span>
              <span>${state.isOnline ? 'Đang đồng bộ trực tiếp với bảng điều phối' : 'Đang kết nối lại nguồn dữ liệu…'}</span>
            </span>
            ${todayCleared.length > 0 ? `<button type="button" class="wp-empty-stat-btn" id="wp-open-stats-empty">${SVG.history}<span>Thống kê hôm nay: <b class="wp-mono">${todayCleared.length}</b> đã xử lý</span></button>` : ''}
          </div>
        </section>
      `;
    } else {
      const gridCls = getPeopleGridLayout(people.length);
      const compact = people.length >= 7;
      const rowsCls = people.length <= 3 ? 'rows-1' : people.length <= 8 ? 'rows-2' : 'rows-auto';
      stageHtml = `
        <div class="wp-grid ${gridCls} ${rowsCls}">
          ${people.map((p, i) => renderPersonCard(p, i + 1, now, compact)).join('')}
        </div>
      `;
    }

    state.lastBoardStructSig = state.showStats ? '' : structSig;
    ui.stage.innerHTML = stageHtml;

    ui.stage.querySelectorAll('.wp-card').forEach((card) => {
      const k = card.getAttribute('data-person-key');
      const sc = card.querySelector('.wp-timeline');
      if (k && sc) {
        if (prevScrolls.has(k)) sc.scrollTop = prevScrolls.get(k);
        wireCardScroll(card, sc, k);
      }
    });

    if (state.showStats) {
      statsRo?.disconnect();
      const wrap = document.getElementById('wp-stats-table-wrap');
      if (wrap && typeof ResizeObserver !== 'undefined') {
        statsRo = new ResizeObserver(() => measureStatsPageSize());
        statsRo.observe(wrap);
      }
      requestAnimationFrame(measureStatsPageSize);
    } else {
      statsRo?.disconnect();
      requestAnimationFrame(syncAllCardOverflow);
    }
  }

  // ---------- Tự cuộn mượt trong từng thẻ người khi có nhiều task (tạm dừng khi rê chuột / tự cuộn) ----------
  const cardScrollMeta = new Map();
  const CARD_SCROLL_SPEED = 24; // px mỗi giây — đọc thoải mái trên màn hình TV
  const CARD_HOLD_MS = 3500;
  const CARD_MANUAL_PAUSE_MS = 10000;
  const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getCardScrollState(key) {
    if (!cardScrollMeta.has(key)) {
      cardScrollMeta.set(key, { carry: 0, holdUntil: Date.now() + CARD_HOLD_MS, pauseUntil: 0, hovered: false });
    }
    return cardScrollMeta.get(key);
  }

  function updateCardOverflowClass(card, sc) {
    const room = sc.scrollHeight - sc.clientHeight;
    card.classList.toggle('has-overflow', room > 8);
    card.classList.toggle('at-bottom', room <= 8 || sc.scrollTop >= room - 2);
  }

  function syncAllCardOverflow() {
    if (!ui.stage || state.showStats) return;
    ui.stage.querySelectorAll('.wp-card').forEach((card) => {
      const sc = card.querySelector('.wp-timeline');
      if (sc) updateCardOverflowClass(card, sc);
    });
  }

  function wireCardScroll(card, sc, key) {
    const meta = getCardScrollState(key);
    sc.addEventListener('mouseenter', () => { meta.hovered = true; });
    sc.addEventListener('mouseleave', () => {
      meta.hovered = false;
      meta.pauseUntil = Math.max(meta.pauseUntil, Date.now() + 1500);
    });
    const onManual = () => { meta.pauseUntil = Date.now() + CARD_MANUAL_PAUSE_MS; };
    sc.addEventListener('wheel', onManual, { passive: true });
    sc.addEventListener('touchstart', onManual, { passive: true });
    sc.addEventListener('scroll', () => updateCardOverflowClass(card, sc), { passive: true });
    updateCardOverflowClass(card, sc);
  }

  let lastCardScrollFrame = 0;
  function stepCardAutoScroll() {
    const t = performance.now();
    const dt = lastCardScrollFrame ? Math.min(t - lastCardScrollFrame, 500) : 0;
    lastCardScrollFrame = t;
    if (reducedMotion || state.showStats || document.hidden || !ui.stage) return;

    const now = Date.now();
    const cards = ui.stage.querySelectorAll('.wp-card');
    for (const card of cards) {
      const key = card.getAttribute('data-person-key');
      const sc = card.querySelector('.wp-timeline');
      if (!key || !sc) continue;
      const room = sc.scrollHeight - sc.clientHeight;
      updateCardOverflowClass(card, sc);
      if (room <= 8) continue;

      const meta = getCardScrollState(key);
      if (meta.hovered || now < meta.pauseUntil || now < meta.holdUntil) continue;

      if (sc.scrollTop >= room - 1) {
        meta.holdUntil = now + CARD_HOLD_MS * 2 + 800;
        meta.carry = 0;
        setTimeout(() => {
          if (state.showStats || meta.hovered || Date.now() < meta.pauseUntil) return;
          const curCard = ui.stage?.querySelector(`.wp-card[data-person-key="${CSS.escape(key)}"]`);
          const curSc = curCard?.querySelector('.wp-timeline');
          if (!curSc) return;
          curSc.scrollTo({ top: 0, behavior: 'smooth' });
          meta.holdUntil = Date.now() + CARD_HOLD_MS;
        }, CARD_HOLD_MS);
        continue;
      }

      meta.carry += (CARD_SCROLL_SPEED * dt) / 1000;
      const step = Math.floor(meta.carry);
      if (step >= 1) {
        meta.carry -= step;
        sc.scrollTop = Math.min(room, sc.scrollTop + step);
        updateCardOverflowClass(card, sc);
      }
    }
  }

  function connectLiveWs() {
    if (typeof WebSocket === 'undefined' || location.protocol === 'file:') return;
    let delay = 1000;
    const open = () => {
      try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${location.host}/api/live/ws`);
        ws.onopen = () => { delay = 1000; };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m?.type === 'change' && m.scope === 'waiting-point') syncFromSheet();
          } catch {}
        };
        ws.onclose = () => {
          setTimeout(open, delay);
          delay = Math.min(delay * 2, 30000);
        };
      } catch {}
    };
    open();
  }

  render();
  syncFromSheet();
  connectLiveWs();
  setInterval(syncFromSheet, WP_CONFIG.POLL_INTERVAL_MS);
  setInterval(stepCardAutoScroll, 40);
  setInterval(() => {
    const now = Date.now();
    checkOverdueAlerts(now);
    tickInPlace(now);
  }, 1000);

  window.addEventListener('resize', syncAllCardOverflow);

  window.addEventListener('pointerdown', () => {
    if (!audioUnlocked) {
      unlockAudio();
      audioUnlocked = true;
      updateHeaderBell();
    }
  }, { once: true });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.showStats) {
      state.showStats = false;
      render();
    }
  });
}

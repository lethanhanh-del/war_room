// Đọc dữ liệu realtime từ tab "Waiting Point" của Google Sheet WR - MASTER TASK,
// phân tích mốc thời gian xử lý và gom task theo từng Người hỗ trợ.

export const WP_CONFIG = {
  SHEET_ID: '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0',
  SHEET_GID: '2043772221',
  POLL_INTERVAL_MS: 3000,
  WARNING_THRESHOLD_SEC: 300,
  CLEAR_ANIMATION_MS: 1200,
  NEW_HIGHLIGHT_MS: 9000,
  CLEARED_PAGE_SIZE: 8,
  BURN_REMINDER_MS: 60000,
};

export function normalizeText(str) {
  return String(str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function shortStreamName(stream) {
  const s = String(stream || '').trim();
  const stripped = s.replace(/^dòng\s*tiền\s*\d*\s*[:–-]?\s*/i, '').trim();
  return stripped || s || 'War Room';
}

export function parseTimeSpec(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return { kind: 'none', raw };

  const lower = raw.toLowerCase().normalize('NFC').replace(/,/g, '.').trim();

  // Định dạng Date(...) do gviz trả về khi Google Sheet tự ép kiểu ngày/giờ
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

  // Ngày giờ đầy đủ: 21/11/2026 15:30 hoặc 21/11 15:30
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

  // Mốc giờ SA / CH / AM / PM: 2:30 CH, 10:15 SA
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

  // Mốc giờ có từ khóa rõ ràng: trước 16:30, đến 17h
  const explicitClock = lower.match(/(?:trước|truoc|đến|den|tới|toi|->|at)\s*(\d{1,2})\s*[:hg]\s*(\d{1,2})?/);
  if (explicitClock) {
    const h = parseInt(explicitClock[1], 10);
    const m = explicitClock[2] ? parseInt(explicitClock[2], 10) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { kind: 'deadline', targetHour: h, targetMin: m, raw };
    }
  }

  // Thời lượng theo ngày: 1 ngày, 0.5 ngày, 2d
  const dayMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:ngày|ngay|days|day|d)$/);
  if (dayMatch) {
    const days = parseFloat(dayMatch[1]);
    if (days > 0) return { kind: 'duration', durationSec: Math.round(days * 86400), raw };
  }

  // Dạng HH:MM hoặc HH:MM:SS
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

  // Thời lượng giờ + phút: 1 giờ, 1 giờ 30 phút, 1h30, 14h30
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

  // Thời lượng phút: 5 phút, 15, 20p
  const minMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:phút|phut|mins|min|p|m|')?$/);
  if (minMatch) {
    const mins = parseFloat(minMatch[1]);
    if (mins > 0) return { kind: 'duration', durationSec: Math.round(mins * 60), raw };
  }

  // Thời lượng giây: 45s, 90 giây
  const secMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:giây|giay|secs|sec|s)$/);
  if (secMatch) {
    const secs = Math.round(parseFloat(secMatch[1]));
    if (secs > 0) return { kind: 'duration', durationSec: secs, raw };
  }

  // Dự phòng chuỗi tự do có chứa số
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
    return {
      totalSec: Math.max(60, Math.round((spec.endAt - startedAt) / 1000)),
      endAt: spec.endAt,
    };
  }
  if (spec.kind === 'duration') {
    return { totalSec: spec.durationSec, endAt: startedAt + spec.durationSec * 1000 };
  }
  if (spec.kind === 'deadline') {
    const target = new Date(startedAt);
    target.setHours(spec.targetHour, spec.targetMin, 0, 0);
    if (target.getTime() < startedAt - 12 * 3600 * 1000) {
      target.setDate(target.getDate() + 1);
    }
    return {
      totalSec: Math.max(60, Math.round((target.getTime() - startedAt) / 1000)),
      endAt: target.getTime(),
    };
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

function buildItemsFromRows(rawRows, picName) {
  let lastStream = '';
  let lastGroup = '';
  let resolvedPic = picName || '';
  const dupCount = new Map();
  const activeItems = [];

  for (const r of rawRows) {
    const combinedHeader = `${r.stt} ${r.stream} ${r.group} ${r.issue}`;
    if (!resolvedPic) {
      const pm = combinedHeader.match(/PIC[^:\n]*:\s*([^\n|]+)/i);
      if (pm) resolvedPic = pm[1].trim();
    }
    if (/^vấn\s*đề\s*gặp\s*phải$/i.test(r.issue) || (/^stt$/i.test(r.stt) && /^dòng\s*tiền$/i.test(r.stream))) {
      continue;
    }

    if (r.stream) lastStream = r.stream;
    if (r.group) lastGroup = r.group;
    if (!r.issue) continue;

    const stream = r.stream || lastStream || 'War Room';
    const group = r.group || lastGroup || 'Chung';

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
      owner: r.owner || '',
      supporter: r.supporter || '',
    });
  }

  return {
    picName: resolvedPic || 'Hoàng Thị Quỳnh Mai',
    totalSheetRows: rawRows.length,
    items: activeItems,
  };
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
    if (/vấn\s*đề/i.test(joined) || /dòng\s*tiền/i.test(joined)) {
      headerIdx = i;
      break;
    }
  }

  const headerRow = headerIdx >= 0 ? rows[headerIdx] : [];
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

  const start = headerIdx >= 0 ? headerIdx + 1 : 2;
  const rawRows = rows.slice(start).map((r) => ({
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
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${WP_CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&gid=${WP_CONFIG.SHEET_GID}&_t=${ts}`;
  try {
    const res = await fetch(gvizUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGvizPayload(await res.text());
  } catch (gvizErr) {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${WP_CONFIG.SHEET_ID}/export?format=csv&gid=${WP_CONFIG.SHEET_GID}&_t=${ts}`;
    const res = await fetch(csvUrl, { cache: 'no-store' });
    if (!res.ok) throw gvizErr;
    return parseCsvText(await res.text());
  }
}

/**
 * Gom các Waiting Point thành từng ô theo NGƯỜI HỖ TRỢ.
 * Task ít thời gian nhất / quá hạn xếp lên đầu trong mỗi ô; người có task gấp nhất xếp đầu lưới.
 */
export function groupItemsByPerson(visibleItems) {
  const map = new Map();

  for (const item of visibleItems) {
    const rawName = String(item.supporter || '').trim();
    const isUnassigned = !rawName;
    const key = isUnassigned ? '__unassigned__' : normalizeText(rawName);

    if (!map.has(key)) {
      map.set(key, {
        key,
        name: isUnassigned ? 'Chưa có người hỗ trợ' : rawName,
        isUnassigned,
        tasks: [],
      });
    }
    map.get(key).tasks.push(item);
  }

  const groups = [...map.values()].map((g) => {
    g.tasks.sort((a, b) => {
      if (a.timing.remainingSec !== b.timing.remainingSec) {
        return a.timing.remainingSec - b.timing.remainingSec;
      }
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

    return {
      ...g,
      activeCount: activeTasks.length,
      burnCount,
      warnCount,
      minRemainingSec: minRem,
      topTier,
    };
  });

  groups.sort((a, b) => {
    if (a.minRemainingSec !== b.minRemainingSec) return a.minRemainingSec - b.minRemainingSec;
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? -1 : 1;
    if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
    return a.name.localeCompare(b.name, 'vi');
  });

  return groups;
}

/**
 * Chọn số cột lưới hợp lý theo tổng số người hỗ trợ (cân đối 1 màn hình, tránh hàng lẻ):
 * 1 người -> cols-1 | 2 hoặc 4 người -> cols-2 | 3, 5, 6 người -> cols-3 | 7+ người -> cols-4
 */
export function getPeopleGridLayout(peopleCount) {
  if (peopleCount <= 1) return 'cols-1';
  if (peopleCount === 2 || peopleCount === 4) return 'cols-2';
  if (peopleCount <= 6) return 'cols-3';
  return 'cols-4';
}

/**
 * Số task gấp nhất hiển thị mặc định trong mỗi ô người để bố cục cân đối, không bị 1 ô quá dài.
 */
export function getTaskLimitForPeopleCount(peopleCount) {
  if (peopleCount <= 3) return 4;
  if (peopleCount <= 6) return 3;
  return 2;
}

/**
 * Thống kê kết quả xử lý trong 1 ngày cụ thể:
 * - Tổng số yêu cầu đã đóng, thời gian xử lý trung bình, nhanh nhất, tổng thời lượng
 * - Bảng phân bổ theo từng Người hỗ trợ (xếp số việc nhiều nhất lên đầu)
 */
export function buildDailyStats(items = []) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  if (total === 0) {
    return {
      total: 0,
      avgSec: 0,
      fastestSec: 0,
      totalSpentSec: 0,
      supporterCount: 0,
      bySupporter: [],
    };
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
    .map((e) => ({
      ...e,
      avgSec: Math.round(e.totalSec / e.count),
    }))
    .sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.avgSec - b.avgSec;
    });

  const supporterCount = bySupporter.filter((s) => !s.isUnassigned).length;

  return {
    total,
    avgSec: Math.round(totalSpentSec / total),
    fastestSec: Number.isFinite(fastestSec) ? fastestSec : 0,
    totalSpentSec,
    supporterCount,
    bySupporter,
  };
}

const WEEKDAYS_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** '2026-11-22' -> 'Hôm nay · 22/11' hoặc 'T7 · 21/11' */
export function formatDateLabelVN(iso, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const ddmm = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  if (iso === todayIso) return `Hôm nay · ${ddmm}`;
  const wd = WEEKDAYS_VN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} · ${ddmm}`;
}

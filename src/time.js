// Thời gian theo giờ Việt Nam (GMT+7, không có giờ mùa hè).
export const VN_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export const pad = (n, w = 2) => String(n).padStart(w, '0');

export function vnParts(ms) {
  const d = new Date(ms + VN_OFFSET_MS);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay(),
  };
}

/** Mốc 00:00 (giờ VN) của ngày chứa `ms`. */
export function vnStartOfDay(ms) {
  const p = vnParts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d) - VN_OFFSET_MS;
}

export function vnDayKey(ms) {
  const p = vnParts(ms);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/**
 * Đọc ngày giờ kiểu Việt Nam: "25/11/2026 17:00", "25/11/2026", "25/11 17h00", ISO, số ms.
 * Không có giờ + endOfDay=true -> 23:59:59.
 */
export function parseVnDateTime(value, { endOfDay = false, defaultYear } = {}) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:[\s,]+(\d{1,2})\s*[:hH]\s*(\d{2})?(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, mi, ss] = m;
  let year = defaultYear || vnParts(Date.now()).y;
  if (yy) year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const hasTime = hh !== undefined;
  const H = hasTime ? Number(hh) : endOfDay ? 23 : 0;
  const M = hasTime ? Number(mi || 0) : endOfDay ? 59 : 0;
  const S = hasTime ? Number(ss || 0) : endOfDay ? 59 : 0;
  const month = Number(mm) - 1;
  const day = Number(dd);
  if (month < 0 || month > 11 || day < 1 || day > 31 || H > 23 || M > 59) return null;
  return Date.UTC(year, month, day, H, M, S) - VN_OFFSET_MS;
}

export function hasTimePart(value) {
  return /\d\s*[:hH]\s*\d/.test(String(value || '')) || /T\d{2}:/.test(String(value || ''));
}

/** "21/11/2026 09:36" (withSeconds -> "21/11/2026 09:36:52"). */
export function fmtVn(ms, { time = true, seconds = false, year = true } = {}) {
  if (ms === null || ms === undefined) return '';
  const p = vnParts(ms);
  let out = `${pad(p.d)}/${pad(p.mo)}${year ? `/${p.y}` : ''}`;
  if (time) out += ` ${pad(p.h)}:${pad(p.mi)}${seconds ? `:${pad(p.s)}` : ''}`;
  return out;
}

export function fmtClock(ms, seconds = true) {
  const p = vnParts(ms);
  return `${pad(p.h)}:${pad(p.mi)}${seconds ? `:${pad(p.s)}` : ''}`;
}

export function humanDuration(ms) {
  const abs = Math.max(0, ms);
  const d = Math.floor(abs / DAY_MS);
  const h = Math.floor((abs % DAY_MS) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  if (d > 0) return `${d} ngày ${h} giờ`;
  if (h > 0) return `${h} giờ ${m} phút`;
  return `${m} phút`;
}

export function humanAgo(ms) {
  if (ms < 60000) return 'vừa xong';
  return `${humanDuration(ms)} trước`;
}

/** "HH:MM" -> số phút từ 0h. */
export function minutesOfDay(hhmm, fallback) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

export { DAY_MS };

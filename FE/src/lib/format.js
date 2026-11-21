const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

/** Số gọn: 1.250.000.000 -> "1,3 tỷ"; 45.000.000 -> "45 tr"; 1234 -> "1.234" */
export function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '–';
  const n = Number(v);
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return `${nf.format(n / 1e9)} tỷ`;
  if (a >= 1e6) return `${nf.format(n / 1e6)} tr`;
  return nf.format(n);
}

export function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${Math.round(v * 100)}%`;
}

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/** '2026-11-21' -> 'T7 21/11' */
export function fmtDay(iso, withWeekday = true) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withWeekday ? `${wd} ` : ''}${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function fmtTime(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function fmtDateLong(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function todayVN(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

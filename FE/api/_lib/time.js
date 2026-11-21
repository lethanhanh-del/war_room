// Ngày hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD
export function todayVN(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Các thành phần nhỏ dùng chung giữa ô dòng tiền và màn chi tiết
import { STATUS } from '../lib/status.js';
import { fmtPct } from '../lib/format.js';

/**
 * Ô 1 ngày (1 task): màu + biểu tượng theo trạng thái. Di chuột để xem nội dung task.
 * mini=true: ô vuông nhỏ tô đặc (bố cục hẹp).
 */
export function DayCell({ day, status, mini = false }) {
  if (!day || status === 'none') return <span className={`cell none ${mini ? 'mini' : ''}`} />;
  const title = `${STATUS[status].label}${day.task ? ` — ${day.task}` : ''}`;
  return (
    <span className={`cell st-${status} ${mini ? 'mini' : ''}`} title={title}>
      {STATUS[status].icon}
    </span>
  );
}

/** % đạt + thanh nhỏ (xanh = 100%, vàng >= 70%, đỏ < 70%) */
export function Pct({ v }) {
  if (v === null) return <span className="muted">–</span>;
  const cls = v >= 1 ? 'ok' : v >= 0.7 ? 'mid' : 'bad';
  return (
    <span className={`pct ${cls}`}>
      <b>{fmtPct(v)}</b>
      <span className="track">
        <i style={{ width: `${Math.min(100, v * 100)}%` }} />
      </span>
    </span>
  );
}

/** Nhãn kết quả: ✔ Đạt / ✖ Không đạt / ● Đang làm / ○ Chưa đến hạn */
export function StatusTag({ status, short = false }) {
  const s = STATUS[status] || STATUS.none;
  return (
    <span className={`tag st-${status}`}>
      {s.icon && <i>{s.icon}</i>}
      {short ? s.short : s.label}
    </span>
  );
}

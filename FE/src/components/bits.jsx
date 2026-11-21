// Các thành phần nhỏ dùng chung giữa ô dòng tiền và màn chi tiết
import { STATUS, VERDICT } from '../lib/status.js';
import { fmtNum, fmtPct } from '../lib/format.js';

/** Ô 1 ngày: Kết quả / KPI, tô màu theo trạng thái. mini=true: chỉ còn ô màu (bố cục hẹp) */
export function DayCell({ day, status, mini = false }) {
  if (!day || status === 'none') return <span className={`cell none ${mini ? 'mini' : ''}`}>{mini ? '' : '–'}</span>;
  const title = `${STATUS[status].label}: ${fmtNum(day.result)} / ${fmtNum(day.kpi)}`;
  if (mini) return <span className={`cell mini st-${status}`} title={title} />;
  return (
    <span className={`cell st-${status}`} title={title}>
      <b>{day.result === null ? '–' : fmtNum(day.result)}</b>
      <small>/{fmtNum(day.kpi)}</small>
    </span>
  );
}

/** % đạt + thanh nhỏ (xanh >= 100%, vàng >= 70%, đỏ < 70%) */
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

/** Nhãn kết luận Đạt / Không đạt */
export function Verdict({ v }) {
  const d = VERDICT[v] || VERDICT.none;
  return (
    <span className={`verdict vd-${v}`}>
      <i>{d.icon}</i>
      {d.label}
    </span>
  );
}

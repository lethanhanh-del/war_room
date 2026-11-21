import { isOverdue, STATUSES, STATUS_LABEL } from '../api.js';

export default function Stats({ tasks }) {
  const count = (s) => tasks.filter((t) => t.status === s).length;
  const overdue = tasks.filter(isOverdue).length;
  const done = count('Done');
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <section className="stats">
      <div className="stat">
        <span className="label">Tổng task</span>
        <span className="value">{tasks.length}</span>
        <span className="hint">Hoàn thành {pct}%</span>
      </div>
      {STATUSES.map((s) => (
        <div className={`stat s-${s.replace(' ', '-').toLowerCase()}`} key={s}>
          <span className="label">{STATUS_LABEL[s]}</span>
          <span className="value">{count(s)}</span>
        </div>
      ))}
      <div className={`stat ${overdue ? 'danger' : ''}`}>
        <span className="label">Quá hạn</span>
        <span className="value">{overdue}</span>
      </div>
    </section>
  );
}

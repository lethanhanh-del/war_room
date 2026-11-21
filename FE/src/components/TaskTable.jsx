import { STATUS_LABEL, PRIORITY_LABEL, isOverdue, formatDate } from '../api.js';

export default function TaskTable({ tasks, onOpen, onDelete }) {
  if (!tasks.length) return <p className="empty">Không có task nào khớp bộ lọc.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Tiêu đề</th>
            <th>Người phụ trách</th>
            <th>Trạng thái</th>
            <th>Ưu tiên</th>
            <th>Hạn</th>
            <th>Cập nhật</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={isOverdue(t) ? 'overdue' : ''}>
              <td>
                <button className="link strong" onClick={() => onOpen(t)}>{t.title}</button>
              </td>
              <td>{t.assignee || '—'}</td>
              <td><span className={`tag s-${t.status.replace(' ', '-').toLowerCase()}`}>{STATUS_LABEL[t.status] || t.status}</span></td>
              <td><span className={`pill p-${t.priority.toLowerCase()}`}>{PRIORITY_LABEL[t.priority] || t.priority}</span></td>
              <td>{formatDate(t.due_date)}</td>
              <td className="muted">{t.updated_at ? new Date(t.updated_at).toLocaleString('vi-VN') : '—'}</td>
              <td className="right">
                <button className="link danger" onClick={() => onDelete(t)}>Xoá</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

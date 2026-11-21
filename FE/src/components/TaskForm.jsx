import { useEffect, useState } from 'react';
import { STATUSES, PRIORITIES, STATUS_LABEL, PRIORITY_LABEL } from '../api.js';

const EMPTY = { title: '', description: '', assignee: '', status: 'Todo', priority: 'Medium', due_date: '' };

export default function TaskForm({ task, assignees, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState({ ...EMPTY, ...pick(task) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return setError('Vui lòng nhập tiêu đề');
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={submit}>
        <h2>{task.id ? 'Chi tiết task' : 'Tạo task mới'}</h2>
        {error && <div className="alert">{error}</div>}

        <label className="field">
          <span>Tiêu đề *</span>
          <input className="input" value={form.title} onChange={set('title')} maxLength={200} autoFocus />
        </label>
        <label className="field">
          <span>Mô tả</span>
          <textarea className="input" rows={4} value={form.description} onChange={set('description')} maxLength={5000} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Người phụ trách</span>
            <input className="input" list="assignee-list" value={form.assignee} onChange={set('assignee')} maxLength={100} />
            <datalist id="assignee-list">
              {assignees.map((a) => <option key={a} value={a} />)}
            </datalist>
          </label>
          <label className="field">
            <span>Hạn hoàn thành</span>
            <input className="input" type="date" value={form.due_date} onChange={set('due_date')} />
          </label>
          <label className="field">
            <span>Trạng thái</span>
            <select className="input" value={form.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Ưu tiên</span>
            <select className="input" value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
        </div>

        {task.id && (
          <p className="muted small">
            Tạo: {new Date(task.created_at).toLocaleString('vi-VN')} · Cập nhật: {new Date(task.updated_at).toLocaleString('vi-VN')}
          </p>
        )}

        <div className="modal-actions">
          {onDelete && (
            <button type="button" className="btn danger-ghost" onClick={onDelete} disabled={saving}>
              Xoá
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onCancel} disabled={saving}>Huỷ</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </form>
    </div>
  );
}

function pick(task) {
  const out = {};
  for (const k of Object.keys(EMPTY)) if (task?.[k] !== undefined) out[k] = task[k];
  return out;
}

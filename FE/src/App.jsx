import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAccessKey, setAccessKey, isOverdue, STATUSES, PRIORITIES, STATUS_LABEL, PRIORITY_LABEL } from './api.js';
import Stats from './components/Stats.jsx';
import Board from './components/Board.jsx';
import TaskTable from './components/TaskTable.jsx';
import TaskForm from './components/TaskForm.jsx';
import AccessKeyGate from './components/AccessKeyGate.jsx';

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needKey, setNeedKey] = useState(false);
  const [mode, setMode] = useState('');
  const [view, setView] = useState('board');
  const [editing, setEditing] = useState(null); // null | {} (tạo mới) | task
  const [filters, setFilters] = useState({ q: '', status: '', priority: '', assignee: '', overdue: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTasks(await api.list());
      setNeedKey(false);
    } catch (e) {
      if (e.status === 401) setNeedKey(true);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.health().then((h) => setMode(h.mode)).catch(() => {});
    load();
  }, [load]);

  const assignees = useMemo(
    () => [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')),
    [tasks]
  );

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return tasks
      .filter((t) => !q || `${t.title} ${t.description} ${t.assignee}`.toLowerCase().includes(q))
      .filter((t) => !filters.status || t.status === filters.status)
      .filter((t) => !filters.priority || t.priority === filters.priority)
      .filter((t) => !filters.assignee || t.assignee === filters.assignee)
      .filter((t) => !filters.overdue || isOverdue(t))
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
          (a.due_date || '9999').localeCompare(b.due_date || '9999')
      );
  }, [tasks, filters]);

  async function handleSave(data) {
    if (editing?.id) {
      const updated = await api.update(editing.id, data);
      setTasks((ts) => ts.map((t) => (t.id === updated.id ? updated : t)));
    } else {
      const created = await api.create(data);
      setTasks((ts) => [...ts, created]);
    }
    setEditing(null);
  }

  async function handleDelete(task) {
    if (!window.confirm(`Xoá task "${task.title}"? Thao tác này không thể hoàn tác.`)) return;
    try {
      await api.remove(task.id);
      setTasks((ts) => ts.filter((t) => t.id !== task.id));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleMove(task, status) {
    if (task.status === status) return;
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status } : t)));
    try {
      const updated = await api.update(task.id, { status });
      setTasks((ts) => ts.map((t) => (t.id === updated.id ? updated : t)));
    } catch (e) {
      setTasks(prev);
      setError(e.message);
    }
  }

  if (needKey) {
    return (
      <AccessKeyGate
        onSubmit={(k) => {
          setAccessKey(k);
          load();
        }}
        hadKey={Boolean(getAccessKey())}
      />
    );
  }

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>▤</span>
          <div>
            <h1>War Room</h1>
            <p className="sub">Theo dõi task / issue dự án</p>
          </div>
          {mode === 'mock' && <span className="badge warn">Dữ liệu giả (MOCK)</span>}
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={load} disabled={loading}>
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
          <button className="btn primary" onClick={() => setEditing({})}>
            + Task mới
          </button>
        </div>
      </header>

      {error && (
        <div className="alert" role="alert">
          {error}
          <button className="link" onClick={() => setError('')}>Đóng</button>
        </div>
      )}

      <Stats tasks={tasks} />

      <section className="toolbar">
        <input className="input search" placeholder="Tìm theo tiêu đề, mô tả, người phụ trách…" value={filters.q} onChange={setF('q')} />
        <select className="input" value={filters.status} onChange={setF('status')}>
          <option value="">Tất cả trạng thái</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input" value={filters.priority} onChange={setF('priority')}>
          <option value="">Tất cả ưu tiên</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="input" value={filters.assignee} onChange={setF('assignee')}>
          <option value="">Tất cả người phụ trách</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={filters.overdue} onChange={setF('overdue')} /> Quá hạn
        </label>
        <div className="seg">
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Bảng Kanban</button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Danh sách</button>
        </div>
      </section>

      {loading && !tasks.length ? (
        <p className="empty">Đang tải dữ liệu từ Google Sheet…</p>
      ) : view === 'board' ? (
        <Board tasks={visible} onOpen={setEditing} onMove={handleMove} />
      ) : (
        <TaskTable tasks={visible} onOpen={setEditing} onDelete={handleDelete} />
      )}

      {editing && (
        <TaskForm
          task={editing}
          assignees={assignees}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
          onDelete={editing.id ? () => handleDelete(editing) : undefined}
        />
      )}
    </div>
  );
}

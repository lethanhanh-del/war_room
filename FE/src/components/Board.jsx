import { useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, isOverdue, formatDate } from '../api.js';

export function TaskCard({ task, onOpen, draggable, onDragStart }) {
  const overdue = isOverdue(task);
  return (
    <article
      className={`card ${overdue ? 'overdue' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={() => onOpen(task)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(task)}
    >
      <div className="card-top">
        <span className={`pill p-${task.priority.toLowerCase()}`}>{PRIORITY_LABEL[task.priority] || task.priority}</span>
        {overdue && <span className="pill danger">Quá hạn</span>}
      </div>
      <h3>{task.title}</h3>
      {task.description && <p className="desc">{task.description}</p>}
      <div className="meta">
        <span>{task.assignee || 'Chưa giao'}</span>
        <span>{formatDate(task.due_date)}</span>
      </div>
    </article>
  );
}

export default function Board({ tasks, onOpen, onMove }) {
  const [over, setOver] = useState('');

  return (
    <section className="board">
      {STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div
            key={s}
            className={`column ${over === s ? 'drop' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s);
            }}
            onDragLeave={() => setOver('')}
            onDrop={(e) => {
              e.preventDefault();
              setOver('');
              const id = e.dataTransfer.getData('text/plain');
              const task = tasks.find((t) => t.id === id);
              if (task) onMove(task, s);
            }}
          >
            <header className={`col-head s-${s.replace(' ', '-').toLowerCase()}`}>
              <span>{STATUS_LABEL[s]}</span>
              <span className="count">{col.length}</span>
            </header>
            <div className="col-body">
              {col.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onOpen={onOpen}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                />
              ))}
              {!col.length && <p className="col-empty">Kéo thả task vào đây</p>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

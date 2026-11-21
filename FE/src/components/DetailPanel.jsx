import { useMemo } from 'react';
import { STATUS, buildView, flattenTasks, allGroups } from '../lib/status.js';
import { fmtDay } from '../lib/format.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';
import { StatusTag } from './bits.jsx';

const shortFlow = (label) => label.replace(/^dòng tiền\s*/i, '').replace(/^./, (c) => c.toUpperCase());
const SUM_KEYS = ['late', 'in_progress', 'upcoming', 'done'];

/**
 * Chế độ chi tiết: liệt kê TỪNG TASK (1 dòng KPI × 1 ngày) — ngày nào, ai làm, KPI gì, task gì, Đạt hay Không đạt.
 * Bộ lọc lồng nhau: Dòng tiền -> Nhóm nhỏ -> Người làm (+ Ngày, Trạng thái dùng chung với ô tổng quan).
 */
export default function DetailPanel({ data, filter, setFilter, detail, setDetail, pics, today, onClose, idleSec }) {
  const flows = data?.flows || [];
  const groups = useMemo(() => allGroups(data, detail.flow), [data, detail.flow]);

  const view = useMemo(
    () => buildView(data, { ...filter, flow: detail.flow, group: detail.group }, today),
    [data, filter, detail.flow, detail.group, today]
  );
  const tasks = useMemo(() => flattenTasks(view), [view]);

  const scrollRef = useAutoScroll([tasks.length, detail.flow, detail.group, filter.date, filter.status]);
  const setD = (patch) => setDetail((d) => ({ ...d, ...patch }));
  const singleFlow = detail.flow !== 'all';

  return (
    <section className="panel detail">
      <header className="dt-head">
        <div className="dt-title">
          <span className="dt-kicker">Chi tiết task</span>
          <h2>
            {singleFlow ? flows.find((f) => f.key === detail.flow)?.label : 'Tất cả dòng tiền'}
            <span className="dt-scope">
              {' · '}
              {filter.date === 'all' ? 'Cả kỳ' : fmtDay(filter.date)}
              {filter.status !== 'all' && <> · {STATUS[filter.status].label}</>}
              {filter.pic !== 'all' && <> · {filter.pic}</>}
            </span>
          </h2>
        </div>
        <div className="dt-sum">
          {SUM_KEYS.map((k) => (
            <button
              key={k}
              className={`vsum st-${k} ${view.totals[k] ? '' : 'zero'} ${filter.status === k ? 'on' : ''}`}
              onClick={() => setFilter((f) => ({ ...f, status: f.status === k ? 'all' : k }))}
            >
              <b>{view.totals[k]}</b>
              {STATUS[k].short}
            </button>
          ))}
        </div>
        <button className="btn-close" onClick={onClose}>
          ✕ Về tổng quan
        </button>
      </header>

      <div className="filters dt-filters">
        <div className="frow">
          <span className="flabel">Dòng tiền</span>
          <button className={`chip ${detail.flow === 'all' ? 'on' : ''}`} onClick={() => setD({ flow: 'all', group: 'all' })}>
            Tất cả
          </button>
          {flows.map((f) => (
            <button
              key={f.key}
              className={`chip ${detail.flow === f.key ? 'on' : ''}`}
              onClick={() => setD({ flow: f.key, group: 'all' })}
            >
              {shortFlow(f.label)}
            </button>
          ))}
        </div>
        {groups.length > 0 && (
          <div className="frow">
            <span className="flabel">Nhóm</span>
            <button className={`chip ${detail.group === 'all' ? 'on' : ''}`} onClick={() => setD({ group: 'all' })}>
              Tất cả
            </button>
            {groups.map((g) => (
              <button key={g} className={`chip ${detail.group === g ? 'on' : ''}`} onClick={() => setD({ group: g })}>
                {g}
              </button>
            ))}
          </div>
        )}
        <div className="frow">
          <span className="flabel">Người làm</span>
          <select className="select" value={filter.pic} onChange={(e) => setFilter((f) => ({ ...f, pic: e.target.value }))}>
            <option value="all">Tất cả</option>
            {pics.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span className="muted small-note">
            {tasks.length} task · Không đạt xếp lên đầu
            {idleSec > 0 && <> · tự về tổng quan sau {Math.round(idleSec / 60)} phút không thao tác</>}
          </span>
        </div>
      </div>

      <div className="dt-body" ref={scrollRef}>
        {!tasks.length ? (
          <p className="fl-empty">Không có task nào phù hợp bộ lọc</p>
        ) : (
          <table className="grid dgrid">
            <thead>
              <tr>
                <th className="c-date">Ngày</th>
                {!singleFlow && <th className="c-flow">Dòng tiền</th>}
                <th className="c-grp">Nhóm</th>
                <th className="c-who">Người làm</th>
                <th className="c-kpi">KPI</th>
                <th className="c-task">Task phải làm</th>
                <th className="c-vd">Kết quả</th>
                <th className="c-note">Vướng mắc</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(({ flow, item, task }) => (
                <tr key={`${flow.key}-${item.row}-${task.date}`} className={`row st-${task.status}`}>
                  <td className={`c-date ${task.date === today ? 'is-today' : ''}`}>
                    {task.date === today ? 'Hôm nay' : fmtDay(task.date)}
                  </td>
                  {!singleFlow && <td className="c-flow">{shortFlow(flow.label)}</td>}
                  <td className="c-grp">{item.group || '–'}</td>
                  <td className="c-who">
                    <div className="nm">{item.pic || '–'}</div>
                    {item.lead && item.lead !== item.pic && <div className="pic">TN: {item.lead}</div>}
                  </td>
                  <td className="c-kpi">{item.kpi || item.group || '–'}</td>
                  <td className="c-task">
                    {task.task ? <span title={task.task}>{task.task}</span> : <span className="muted">(không ghi nội dung)</span>}
                  </td>
                  <td className="c-vd"><StatusTag status={task.status} /></td>
                  <td className="c-note">{item.note ? <span title={item.note}>⚠ {item.note}</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

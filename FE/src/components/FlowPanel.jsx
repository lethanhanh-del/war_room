import { Fragment } from 'react';
import { STATUS } from '../lib/status.js';
import { fmtDay, fmtPct } from '../lib/format.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';
import { DayCell, Pct, StatusTag } from './bits.jsx';

const SUMMARY_KEYS = ['done', 'late', 'in_progress', 'upcoming'];

/**
 * Ô dòng tiền (ô 2..n). Mỗi dòng là 1 dòng KPI, mỗi ngày là 1 task (✔ đã tick / ✖ quá hạn chưa tick ...).
 *  - compact=false: bảng đầy đủ (ô rộng, bố cục 3x2)
 *  - compact=true : dạng gọn cho ô hẹp (bố cục B)
 * Các dòng được nhóm theo "nhóm nhỏ" (dòng có Stt trên sheet).
 */
export default function FlowPanel({ index, flow, date, days, today, compact, onOpen }) {
  const scrollRef = useAutoScroll([flow?.rows?.length, date, compact]);

  if (!flow) {
    return (
      <section className="panel flow">
        <header className="fl-head">
          <em className="num">{index}</em>
          <h2 className="muted">Đang tải…</h2>
        </header>
      </section>
    );
  }

  const weekMode = date === 'all';
  const colCount = weekMode ? 1 + days.length + (compact ? 1 : 2) : compact ? 2 : 3;

  return (
    <section className={`panel flow ${compact ? 'compact' : ''}`}>
      <header className="fl-head clickable" onClick={onOpen} title="Bấm để xem chi tiết từng task">
        <em className="num">{index}</em>
        <div className="fl-title">
          <h2 title={flow.label}>{flow.label}</h2>
          <div className="fl-counts">
            {SUMMARY_KEYS.map((k) => (
              <span key={k} className={`cnt st-${k} ${flow.counts[k] ? '' : 'zero'}`} title={STATUS[k].label}>
                <i className={`dot st-${k}`} />
                {!compact && <>{STATUS[k].short} </>}
                <b>{flow.counts[k]}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="fl-rate">
          <b>{fmtPct(flow.rate)}</b>
          <span>đạt {flow.completed}/{flow.due}</span>
        </div>
      </header>

      <div className="fl-body" ref={scrollRef}>
        {flow.error ? (
          <p className="fl-empty err">⚠ {flow.error}</p>
        ) : !flow.items.length ? (
          <p className="fl-empty">Sheet chưa có dữ liệu</p>
        ) : !flow.rows.length ? (
          <p className="fl-empty">Không có task phù hợp bộ lọc</p>
        ) : (
          <table className={`grid ${weekMode ? 'week' : 'day'} ${compact ? 'compact' : ''}`}>
            <thead>
              <tr>
                <th className="c-name">KPI · Người làm</th>
                {weekMode ? (
                  <>
                    {days.map((d) => (
                      <th key={d} className={`c-day ${d === today ? 'today' : ''}`}>
                        {!compact && <span className="wd">{d === today ? 'Hôm nay' : fmtDay(d).split(' ')[0]}</span>}
                        {compact ? fmtDay(d, false).slice(0, 2) : fmtDay(d, false)}
                      </th>
                    ))}
                    {!compact && <th className="c-num">Đạt</th>}
                    <th className="c-pct">% đạt</th>
                  </>
                ) : (
                  <>
                    {!compact && <th className="c-task">Task trong ngày</th>}
                    <th className="c-st">{compact ? 'KQ' : 'Kết quả'}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {flow.rows.map((r, i) => {
                const it = r.item;
                const newGroup = i === 0 || flow.rows[i - 1].item.groupKey !== it.groupKey;
                const dayTask = weekMode ? null : it.days.find((x) => x.date === date);
                return (
                  <Fragment key={`${it.groupKey}-${it.row}`}>
                    {newGroup && (it.group || it.lead) && (
                      <tr className="grp">
                        <td colSpan={colCount}>
                          {it.stt && <em>{it.stt}</em>}
                          <span className="g-name">{it.group}</span>
                          {it.lead && <span className="g-lead">· {it.lead}</span>}
                        </td>
                      </tr>
                    )}
                    <tr className={`row st-${r.status}`}>
                      <td className="c-name">
                        <div className={`nm ${it.placeholder ? 'muted' : ''}`}>
                          {it.kpi || (it.placeholder ? 'Chưa có dòng KPI' : it.group)}
                        </div>
                        <div className="pic">
                          {it.pic}
                          {it.taskPic && <span className="task-pic"> · PIC: {it.taskPic}</span>}
                        </div>
                        {compact && !weekMode && dayTask?.task && <div className="tsk" title={dayTask.task}>{dayTask.task}</div>}
                        {it.note && !compact && <div className="note" title={it.note}>⚠ {it.note}</div>}
                      </td>
                      {weekMode ? (
                        <>
                          {days.map((d) => {
                            const idx = it.days.findIndex((x) => x.date === d);
                            return (
                              <td key={d} className={`c-day ${d === today ? 'today' : ''}`}>
                                <DayCell day={it.days[idx]} status={idx < 0 ? 'none' : r.dayStatuses[idx]} mini={compact} />
                              </td>
                            );
                          })}
                          {!compact && (
                            <td className="c-num">
                              {r.total ? <>{r.done}<small> / {r.total}</small></> : '–'}
                            </td>
                          )}
                          <td className="c-pct"><Pct v={r.pct} /></td>
                        </>
                      ) : (
                        <>
                          {!compact && (
                            <td className="c-task">
                              {dayTask?.task ? <span title={dayTask.task}>{dayTask.task}</span> : <span className="muted">–</span>}
                            </td>
                          )}
                          <td className="c-st">
                            {r.status === 'none' ? <span className="muted">–</span> : compact ? (
                              <DayCell day={dayTask} status={r.status} />
                            ) : (
                              <StatusTag status={r.status} short />
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

import { STATUS } from '../lib/status.js';
import { fmtDay, fmtNum, fmtPct } from '../lib/format.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';

const SUMMARY_KEYS = ['done', 'done_late', 'late', 'in_progress'];

export default function FlowPanel({ index, flow, date, days, today }) {
  const scrollRef = useAutoScroll([flow?.rows?.length, date]);

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

  return (
    <section className="panel flow">
      <header className="fl-head">
        <em className="num">{index}</em>
        <div className="fl-title">
          <h2>{flow.label}</h2>
          <div className="fl-counts">
            {SUMMARY_KEYS.map((k) => (
              <span key={k} className={`cnt st-${k} ${flow.counts[k] ? '' : 'zero'}`}>
                <i className={`dot st-${k}`} />
                {STATUS[k].short} <b>{flow.counts[k]}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="fl-rate">
          <b>{fmtPct(flow.rate)}</b>
          <span>{flow.completed}/{flow.due} task</span>
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
          <table className={`grid ${weekMode ? 'week' : 'day'}`}>
            <thead>
              <tr>
                <th className="c-stt">#</th>
                <th className="c-name">Nhóm · PIC</th>
                {weekMode ? (
                  <>
                    {days.map((d) => (
                      <th key={d} className={`c-day ${d === today ? 'today' : ''}`}>
                        <span className="wd">{d === today ? 'Hôm nay' : fmtDay(d).split(' ')[0]}</span>
                        {fmtDay(d, false)}
                      </th>
                    ))}
                    <th className="c-num">Lũy kế<span className="wd">/ KPI tuần</span></th>
                    <th className="c-pct">% đạt</th>
                  </>
                ) : (
                  <>
                    <th className="c-num">KPI</th>
                    <th className="c-num">Kết quả</th>
                    <th className="c-pct">% đạt</th>
                    <th className="c-st">Trạng thái</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {flow.rows.map((r) => (
                <tr key={r.item.row} className={`row st-${r.status}`}>
                  <td className="c-stt">{r.item.stt}</td>
                  <td className="c-name">
                    <div className="nm">{r.item.group}</div>
                    <div className="pic">{r.item.pic}</div>
                    {r.item.note && <div className="note" title={r.item.note}>⚠ {r.item.note}</div>}
                  </td>
                  {weekMode ? (
                    <>
                      {days.map((d) => {
                        const i = r.item.days.findIndex((x) => x.date === d);
                        const dd = r.item.days[i];
                        const st = i < 0 ? 'none' : r.dayStatuses[i];
                        return (
                          <td key={d} className={`c-day ${d === today ? 'today' : ''}`}>
                            {st === 'none' ? (
                              <span className="cell none">–</span>
                            ) : (
                              <span className={`cell st-${st}`} title={`${STATUS[st].label}: ${fmtNum(dd.result)} / ${fmtNum(dd.kpi)}`}>
                                <b>{dd.result === null ? '–' : fmtNum(dd.result)}</b>
                                <small>/{fmtNum(dd.kpi)}</small>
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="c-num">
                        {r.pct === null ? '–' : <>{fmtNum(r.result)}<small> / {fmtNum(r.kpi)}</small></>}
                      </td>
                      <td className="c-pct"><Pct v={r.pct} /></td>
                    </>
                  ) : (
                    <>
                      <td className="c-num">{r.pct === null ? '–' : fmtNum(r.kpi)}</td>
                      <td className="c-num">{r.pct === null ? '–' : fmtNum(r.result)}</td>
                      <td className="c-pct"><Pct v={r.pct} /></td>
                      <td className="c-st"><span className={`badge st-${r.status}`}>{STATUS[r.status].label}</span></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Pct({ v }) {
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

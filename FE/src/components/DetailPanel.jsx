import { useMemo } from 'react';
import { STATUS, VERDICT, VERDICT_ORDER, buildView, allGroups } from '../lib/status.js';
import { fmtDay, fmtNum } from '../lib/format.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';
import { DayCell, Pct, Verdict } from './bits.jsx';

const shortFlow = (label) => label.replace(/^dòng tiền\s*/i, '').replace(/^./, (c) => c.toUpperCase());

/**
 * Chế độ chi tiết: liệt kê từng dòng KPI — ai làm, KPI gì, chỉ tiêu, kết quả, Đạt / Không đạt.
 * Bộ lọc lồng nhau: Dòng tiền -> Nhóm nhỏ -> Người làm (+ Ngày, Trạng thái dùng chung với ô tổng quan).
 */
export default function DetailPanel({ data, filter, setFilter, detail, setDetail, pics, today, onClose, idleSec }) {
  const flows = data?.flows || [];
  const weekMode = filter.date === 'all';
  const days = useMemo(() => [...new Set(flows.flatMap((f) => f.days))].sort(), [flows]);
  const groups = useMemo(() => allGroups(data, detail.flow), [data, detail.flow]);

  const rows = useMemo(() => {
    const v = buildView(data, { ...filter, flow: detail.flow, group: detail.group }, today);
    const out = [];
    for (const f of v.flows) for (const r of f.rows) out.push({ ...r, flow: f });
    const rank = Object.fromEntries(VERDICT_ORDER.map((k, i) => [k, i]));
    return out.sort(
      (a, b) => rank[a.verdict] - rank[b.verdict] || (a.pct ?? 9) - (b.pct ?? 9) || a.item.row - b.item.row
    );
  }, [data, filter, detail.flow, detail.group, today]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(VERDICT_ORDER.map((k) => [k, 0]));
    rows.forEach((r) => (c[r.verdict] += 1));
    return c;
  }, [rows]);

  const scrollRef = useAutoScroll([rows.length, detail.flow, detail.group, filter.date, filter.status]);
  const setD = (patch) => setDetail((d) => ({ ...d, ...patch }));
  const singleFlow = detail.flow !== 'all';

  return (
    <section className="panel detail">
      <header className="dt-head">
        <div className="dt-title">
          <span className="dt-kicker">Chi tiết</span>
          <h2>
            {singleFlow ? flows.find((f) => f.key === detail.flow)?.label : 'Tất cả dòng tiền'}
            <span className="dt-scope">
              {' · '}
              {weekMode ? 'Cả kỳ' : fmtDay(filter.date)}
              {filter.status !== 'all' && <> · {STATUS[filter.status].label}</>}
              {filter.pic !== 'all' && <> · {filter.pic}</>}
            </span>
          </h2>
        </div>
        <div className="dt-sum">
          {['fail', 'doing', 'pass_late', 'pass'].map((k) => (
            <span key={k} className={`vsum vd-${k} ${counts[k] ? '' : 'zero'}`}>
              <b>{counts[k]}</b>
              {VERDICT[k].label}
            </span>
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
            {rows.length} dòng · Không đạt xếp lên đầu
            {idleSec > 0 && <> · tự về tổng quan sau {Math.round(idleSec / 60)} phút không thao tác</>}
          </span>
        </div>
      </div>

      <div className="dt-body" ref={scrollRef}>
        {!rows.length ? (
          <p className="fl-empty">Không có dòng nào phù hợp bộ lọc</p>
        ) : (
          <table className={`grid dgrid ${weekMode ? 'week' : 'day'}`}>
            <thead>
              <tr>
                {!singleFlow && <th className="c-flow">Dòng tiền</th>}
                <th className="c-grp">Nhóm</th>
                <th className="c-who">Người làm</th>
                <th className="c-kpi">KPI / Task</th>
                {weekMode ? (
                  <>
                    {days.map((d) => (
                      <th key={d} className={`c-day ${d === today ? 'today' : ''}`}>
                        <span className="wd">{d === today ? 'Hôm nay' : fmtDay(d).split(' ')[0]}</span>
                        {fmtDay(d, false)}
                      </th>
                    ))}
                    <th className="c-num">Lũy kế<span className="wd">/ KPI kỳ</span></th>
                  </>
                ) : (
                  <>
                    <th className="c-num">Chỉ tiêu</th>
                    <th className="c-num">Kết quả</th>
                  </>
                )}
                <th className="c-pct">% đạt</th>
                <th className="c-vd">Kết luận</th>
                <th className="c-note">Vướng mắc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const it = r.item;
                return (
                  <tr key={`${r.flow.key}-${it.groupKey}-${it.row}`} className={`row vd-${r.verdict}`}>
                    {!singleFlow && <td className="c-flow">{shortFlow(r.flow.label)}</td>}
                    <td className="c-grp">{it.group || '–'}</td>
                    <td className="c-who">
                      <div className="nm">{it.pic || '–'}</div>
                      {it.lead && it.lead !== it.pic && <div className="pic">TN: {it.lead}</div>}
                    </td>
                    <td className="c-kpi">
                      <div className={`nm ${it.placeholder ? 'muted' : ''}`}>{it.kpi || (it.placeholder ? 'Chưa được giao KPI' : it.group)}</div>
                    </td>
                    {weekMode ? (
                      <>
                        {days.map((d) => {
                          const idx = it.days.findIndex((x) => x.date === d);
                          return (
                            <td key={d} className={`c-day ${d === today ? 'today' : ''}`}>
                              <DayCell day={it.days[idx]} status={idx < 0 ? 'none' : r.dayStatuses[idx]} />
                            </td>
                          );
                        })}
                        <td className="c-num">
                          {r.pct === null ? '–' : <>{fmtNum(r.result)}<small> / {fmtNum(r.kpi)}</small></>}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="c-num">{r.pct === null ? '–' : fmtNum(r.kpi)}</td>
                        <td className="c-num">{r.pct === null ? '–' : fmtNum(r.result)}</td>
                      </>
                    )}
                    <td className="c-pct"><Pct v={r.pct} /></td>
                    <td className="c-vd"><Verdict v={r.verdict} /></td>
                    <td className="c-note">{it.note ? <span title={it.note}>⚠ {it.note}</span> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

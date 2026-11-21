import { STATUS, STATUS_KEYS } from '../lib/status.js';
import { fmtDay, fmtPct, fmtTime, fmtDateLong } from '../lib/format.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';

export default function OverviewPanel({
  data,
  view,
  filter,
  setFilter,
  days,
  pics,
  today,
  now,
  lastUpdated,
  error,
  loading,
  onRefresh,
  refreshSec,
  tall,
  detailOpen,
  onOpenDetail,
  onCloseDetail,
}) {
  const set = (k, v) => setFilter((f) => ({ ...f, [k]: f[k] === v && v !== 'all' ? 'all' : v }));
  // Bấm vào trạng thái -> lọc + mở danh sách chi tiết (ai làm, KPI gì, đạt hay không)
  const pickStatus = (k) => {
    const off = filter.status === k && k !== 'all';
    setFilter((f) => ({ ...f, status: off ? 'all' : k }));
    if (!off && k !== 'all') onOpenDetail();
  };
  const period = days.length ? `${fmtDay(days[0], false)} – ${fmtDay(days[days.length - 1], false)}/${days[0].slice(0, 4)}` : '';
  const rate = view.rate;

  return (
    <section className={`panel overview ${tall ? 'tall' : ''}`}>
      <header className="ov-head">
        <div>
          <h1>WAR ROOM <span>CT HOMES</span></h1>
          <p className="muted">
            KPI dòng tiền {period && <>· <b>{period}</b></>}
            {data?.mode === 'mock' && <span className="badge-mock">DỮ LIỆU GIẢ</span>}
          </p>
        </div>
        <div className="clock">
          <div className="time">{fmtTime(now)}</div>
          <div className="muted cap">{fmtDateLong(now)}</div>
        </div>
      </header>

      <div className="filters">
        <div className="frow">
          <span className="flabel">Ngày</span>
          <button className={`chip ${filter.date === 'all' ? 'on' : ''}`} onClick={() => set('date', 'all')}>
            Cả kỳ
          </button>
          {days.map((d) => (
            <button
              key={d}
              className={`chip ${filter.date === d ? 'on' : ''} ${d === today ? 'today' : ''}`}
              onClick={() => set('date', d)}
              title={d === today ? 'Hôm nay' : ''}
            >
              {fmtDay(d)}
            </button>
          ))}
        </div>
        <div className="frow">
          <span className="flabel">Trạng thái</span>
          <button className={`chip ${filter.status === 'all' ? 'on' : ''}`} onClick={() => pickStatus('all')}>
            Tất cả
          </button>
          {['done', 'done_late', 'late', 'in_progress'].map((k) => (
            <button key={k} className={`chip st-${k} ${filter.status === k ? 'on' : ''}`} onClick={() => pickStatus(k)}>
              <i className={`dot st-${k}`} />
              {STATUS[k].short}
            </button>
          ))}
        </div>
        <div className="frow">
          <span className="flabel">PIC</span>
          <select className="select" value={filter.pic} onChange={(e) => setFilter((f) => ({ ...f, pic: e.target.value }))}>
            <option value="all">Tất cả PIC</option>
            {pics.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {(filter.date !== 'all' || filter.status !== 'all' || filter.pic !== 'all') && (
            <button className="chip ghost" onClick={() => setFilter({ date: 'all', status: 'all', pic: 'all' })}>
              Xoá lọc
            </button>
          )}
        </div>
      </div>

      <div className="ov-stats">
        <div className="ring" style={{ '--p': rate === null ? 0 : Math.min(1, rate) }}>
          <div className="ring-in">
            <b>{fmtPct(rate)}</b>
            <span>hoàn thành</span>
            <small>{view.completed}/{view.due} task</small>
          </div>
        </div>
        <div className="tiles">
          <div className="tile">
            <span>Tổng task</span>
            <b>{view.tasks}</b>
          </div>
          {STATUS_KEYS.map((k) => (
            <button
              key={k}
              className={`tile st-${k} ${filter.status === k ? 'on' : ''} ${view.totals[k] ? '' : 'zero'}`}
              onClick={() => pickStatus(k)}
            >
              <span>{STATUS[k].short}</span>
              <b>{view.totals[k]}</b>
            </button>
          ))}
          <div className={`tile warn ${view.blockers ? 'has' : ''}`}>
            <span>Vướng mắc</span>
            <b>{view.blockers}</b>
          </div>
        </div>
      </div>

      {tall && <HotList view={view} onOpen={() => { setFilter((f) => ({ ...f, status: 'late' })); onOpenDetail(); }} />}

      <div className="ov-flows">
        {view.flows.map((f, i) => (
          <div className="ovf" key={f.key} onClick={() => onOpenDetail({ flow: f.key, group: 'all' })} title="Bấm để xem chi tiết">
            <span className="ovf-name">
              <em>{i + 2}</em>
              {f.label}
            </span>
            <div className="stack">
              {f.tasks ? (
                STATUS_KEYS.map((k) =>
                  f.counts[k] ? <i key={k} className={`st-${k}`} style={{ flexGrow: f.counts[k] }} title={`${STATUS[k].label}: ${f.counts[k]}`} /> : null
                )
              ) : (
                <i className="empty" />
              )}
            </div>
            <span className="ovf-rate">{fmtPct(f.rate)}</span>
          </div>
        ))}
      </div>

      <footer className="ov-foot">
        {error ? (
          <span className="err">⚠ {error}{lastUpdated ? ' — đang hiển thị dữ liệu lần cập nhật trước' : ''}</span>
        ) : (
          <span className="muted">
            Cập nhật: {lastUpdated ? fmtTime(lastUpdated) : '…'} · tự làm mới mỗi {refreshSec}s
          </span>
        )}
        <span className="foot-actions">
          {detailOpen ? (
            <button className="chip on" onClick={onCloseDetail}>✕ Về tổng quan</button>
          ) : (
            <button className="chip" onClick={() => onOpenDetail()}>☰ Danh sách chi tiết</button>
          )}
          <button className="chip ghost" onClick={onRefresh} disabled={loading}>
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
        </span>
      </footer>
    </section>
  );
}

/** Ô tổng quan dạng cột cao: liệt kê các KPI đang trễ hạn, % đạt thấp nhất lên trước */
function HotList({ view, onOpen }) {
  const late = [];
  for (const f of view.flows) for (const r of f.rows) if (r.status === 'late') late.push({ r, f });
  late.sort((a, b) => (a.r.pct ?? 0) - (b.r.pct ?? 0));
  const ref = useAutoScroll([late.length]);
  const short = (l) => l.replace(/^dòng tiền\s*/i, '');
  return (
    <div className="hot">
      <div className="hot-head">
        Cần xử lý ngay · {late.length} KPI trễ hạn
        {late.length > 0 && <span onClick={onOpen}>Xem tất cả ›</span>}
      </div>
      {late.length ? (
        <div className="hot-list" ref={ref}>
          {late.slice(0, 30).map(({ r, f }) => (
            <div className="hot-item" key={`${f.key}-${r.item.row}`} onClick={onOpen} title={r.item.note || ''}>
              <div style={{ minWidth: 0 }}>
                <div className="nm">{r.item.kpi || r.item.group}</div>
                <div className="pic">{r.item.pic} · {short(f.label)}</div>
              </div>
              <b>{fmtPct(r.pct)}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="hot-empty">Không có KPI nào trễ hạn</div>
      )}
    </div>
  );
}

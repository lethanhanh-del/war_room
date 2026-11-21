import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDashboard, getAccessKey, setAccessKey } from './lib/api.js';
import { buildView, allDays, allPics } from './lib/status.js';
import { todayVN } from './lib/format.js';
import OverviewPanel from './components/OverviewPanel.jsx';
import FlowPanel from './components/FlowPanel.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import AccessKeyGate from './components/AccessKeyGate.jsx';

// Tham số URL hỗ trợ (để cấu hình sẵn cho màn hình trình chiếu):
//   ?date=all|YYYY-MM-DD  &status=all|done|late|in_progress|upcoming  &pic=<tên>
//   &refresh=<giây, mặc định 60>  &idle=<giây tự thoát chế độ chi tiết, mặc định 120, 0 = tắt>
//   &key=<access key, chỉ cần nhập 1 lần>  &today=YYYY-MM-DD (giả lập ngày, để kiểm thử)
const params = new URLSearchParams(window.location.search);
if (params.get('key')) {
  setAccessKey(params.get('key'));
  params.delete('key');
  window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
}
const REFRESH_SEC = Math.max(15, Number(params.get('refresh')) || 60);
const IDLE_SEC = params.get('idle') === null ? 120 : Math.max(0, Number(params.get('idle')) || 0);
const TODAY_OVERRIDE = /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '') ? params.get('today') : null;

const CLOSED = null;

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [needKey, setNeedKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState(() => ({
    date: params.get('date') || 'all',
    status: ['done', 'late', 'in_progress', 'upcoming'].includes(params.get('status')) ? params.get('status') : 'all',
    pic: params.get('pic') || 'all',
  }));
  // Chế độ chi tiết: null = đóng; { flow: 'all' | key, group: 'all' | tên nhóm }
  const [detail, setDetail] = useState(CLOSED);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const d = await fetchDashboard({ force });
      setData(d);
      setError('');
      setNeedKey(false);
      setLastUpdated(new Date());
    } catch (e) {
      if (e.status === 401) setNeedKey(true);
      else setError(e.message || 'Không tải được dữ liệu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), REFRESH_SEC * 1000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Không ai thao tác một lúc -> tự quay về màn tổng quan (màn chiếu không bị kẹt ở chi tiết)
  useEffect(() => {
    if (!detail || !IDLE_SEC) return undefined;
    let timer = setTimeout(() => setDetail(CLOSED), IDLE_SEC * 1000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setDetail(CLOSED), IDLE_SEC * 1000);
    };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [detail]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setDetail(CLOSED);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Đồng bộ bộ lọc lên URL để có thể bookmark / cấu hình sẵn cho màn hình chiếu
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(filter)) {
      if (v && v !== 'all') p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [filter]);

  const today = TODAY_OVERRIDE || todayVN(now);
  const days = useMemo(() => allDays(data), [data]);
  const pics = useMemo(() => allPics(data), [data]);
  const view = useMemo(() => buildView(data, filter, today), [data, filter, today]);

  useEffect(() => {
    if (data && filter.date !== 'all' && !days.includes(filter.date)) setFilter((f) => ({ ...f, date: 'all' }));
  }, [data, days, filter.date]);

  const openDetail = useCallback((patch = {}) => setDetail((d) => ({ flow: 'all', group: 'all', ...(d || {}), ...patch })), []);

  if (needKey) {
    return (
      <AccessKeyGate
        hadKey={Boolean(getAccessKey())}
        onSubmit={(k) => {
          setAccessKey(k);
          load(true);
        }}
      />
    );
  }

  // Bố cục: <= 5 dòng tiền -> lưới 3x2 (ô 1 là tổng quan);
  //         >= 6 dòng tiền -> "bố cục B": tổng quan thành cột dọc bên trái, dòng tiền xếp 2 hàng bên phải.
  const flowCount = data ? data.flows.length : 5;
  const side = flowCount > 5;
  const cols = side ? Math.ceil(flowCount / 2) : 3;
  const layout = detail ? 'detail' : side ? 'side' : 'grid3';

  return (
    <main className={`wall ${layout} ${side ? 'is-side' : 'is-grid3'}`} style={{ '--cols': cols, '--colfr': `${(76 / cols).toFixed(3)}fr` }}>
      <OverviewPanel
        data={data}
        view={view}
        filter={filter}
        setFilter={setFilter}
        days={days}
        pics={pics}
        today={today}
        now={now}
        lastUpdated={lastUpdated}
        error={error}
        loading={loading}
        onRefresh={() => load(true)}
        refreshSec={REFRESH_SEC}
        tall={side || Boolean(detail)}
        detailOpen={Boolean(detail)}
        onOpenDetail={openDetail}
        onCloseDetail={() => setDetail(CLOSED)}
      />
      {detail ? (
        <DetailPanel
          data={data}
          filter={filter}
          setFilter={setFilter}
          detail={detail}
          setDetail={setDetail}
          pics={pics}
          today={today}
          onClose={() => setDetail(CLOSED)}
          idleSec={IDLE_SEC}
        />
      ) : (
        (data ? view.flows : Array.from({ length: 5 }, () => null)).map((flow, i) => (
          <FlowPanel
            key={flow?.key || i}
            index={i + 2}
            flow={flow}
            date={filter.date}
            days={days}
            today={today}
            compact={side}
            onOpen={() => flow && openDetail({ flow: flow.key, group: 'all' })}
          />
        ))
      )}
    </main>
  );
}

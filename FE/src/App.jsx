import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDashboard, getAccessKey, setAccessKey } from './lib/api.js';
import { buildView, allDays, allPics } from './lib/status.js';
import { todayVN } from './lib/format.js';
import OverviewPanel from './components/OverviewPanel.jsx';
import FlowPanel from './components/FlowPanel.jsx';
import AccessKeyGate from './components/AccessKeyGate.jsx';

// Tham số URL hỗ trợ (để cấu hình sẵn cho màn hình trình chiếu):
//   ?date=all|YYYY-MM-DD  &status=all|done|done_late|late|in_progress|upcoming  &pic=<tên>
//   &refresh=<giây, mặc định 60>  &key=<access key, chỉ cần nhập 1 lần>  &today=YYYY-MM-DD (giả lập ngày, để kiểm thử)
const params = new URLSearchParams(window.location.search);
if (params.get('key')) {
  setAccessKey(params.get('key'));
  params.delete('key');
  window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
}
const REFRESH_SEC = Math.max(15, Number(params.get('refresh')) || 60);
const TODAY_OVERRIDE = /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '') ? params.get('today') : null;

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [needKey, setNeedKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState(() => ({
    date: params.get('date') || 'all',
    status: params.get('status') || 'all',
    pic: params.get('pic') || 'all',
  }));

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

  // Ngày đang lọc không còn trong dữ liệu (sang tuần mới) -> về "Cả kỳ"
  useEffect(() => {
    if (data && filter.date !== 'all' && !days.includes(filter.date)) setFilter((f) => ({ ...f, date: 'all' }));
  }, [data, days, filter.date]);

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

  return (
    <main className="wall">
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
      />
      {(data ? view.flows : [null, null, null, null, null]).slice(0, 5).map((flow, i) => (
        <FlowPanel key={flow?.key || i} index={i + 2} flow={flow} date={filter.date} days={days} today={today} />
      ))}
    </main>
  );
}

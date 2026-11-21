import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime } from '../lib/format.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';
import {
  WP_CONFIG,
  computeTiming,
  fetchWaitingPoints,
  formatClock,
  getPeopleGridLayout,
  getTaskLimitForPeopleCount,
  groupItemsByPerson,
  normalizeText,
  resolveDeadlineFromSpec,
} from './sheetService.js';
import { isAudioUnlocked, playBell, unlockAudio } from './sound.js';
import {
  IconAlertTriangle,
  IconBell,
  IconBellOff,
  IconCheckCircle,
  IconHistory,
  IconUsers,
  IconWifiOff,
} from './Icons.jsx';
import PersonPanel from './PersonPanel.jsx';
import ClearedPanel from './ClearedPanel.jsx';
import './waitingPoint.css';

const STORAGE_TIMERS = 'warroom_oc_timers_v1';
const STORAGE_HISTORY = 'warroom_oc_history_v3';
const LEGACY_HISTORY = 'warroom_oc_history_v2';
const SYNC_CHANNEL_NAME = 'warroom_wp_sync_v1';

function todayKeyVN(nowMs = Date.now()) {
  const vn = new Date(nowMs + 7 * 3600 * 1000);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
}

function loadTimerStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_TIMERS) || '{}');
  } catch {
    return {};
  }
}

function saveTimerStore(store) {
  try {
    localStorage.setItem(STORAGE_TIMERS, JSON.stringify(store));
  } catch {
    // ignore storage quota errors
  }
}

function loadHistoryByDate() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || 'null');
    if (saved && typeof saved === 'object' && saved.historyByDate && typeof saved.historyByDate === 'object') {
      return saved.historyByDate;
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_HISTORY) || 'null');
    if (legacy && /^\d{4}-\d{2}-\d{2}$/.test(legacy.date || '') && Array.isArray(legacy.recentCleared)) {
      return { [legacy.date]: legacy.recentCleared.slice(0, 200) };
    }
  } catch {
    // ignore
  }
  return {};
}

function saveHistoryByDate(historyByDate) {
  try {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify({ historyByDate }));
  } catch {
    // ignore
  }
}

function mergeDayRecords(prevList = [], incomingList = []) {
  const out = [...prevList];
  for (const item of incomingList) {
    if (!item || !item.issue) continue;
    const clearedAt = Number(item.clearedAt) || Date.now();
    const baseKey = item.id || `${item.group || ''}|${item.issue}`;
    const bucket = Math.floor(clearedAt / 30000);
    const candidates = new Set([`${baseKey}@${bucket}`, `${baseKey}@${bucket - 1}`, `${baseKey}@${bucket + 1}`]);
    const idx = out.findIndex((c) => {
      const k = c.dedupKey || `${c.id || c.issue}@${Math.floor((c.clearedAt || 0) / 30000)}`;
      return candidates.has(k);
    });
    if (idx >= 0) {
      const ex = out[idx];
      if ((!ex.supporter && item.supporter) || (!ex.owner && item.owner)) {
        out[idx] = { ...ex, supporter: ex.supporter || item.supporter, owner: ex.owner || item.owner };
      }
      continue;
    }
    out.unshift({ ...item, dedupKey: item.dedupKey || `${baseKey}@${bucket}` });
  }
  return out.sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0)).slice(0, 200);
}

export default function WaitingPointApp() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isOnline, setIsOnline] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioReady, setAudioReady] = useState(() => isAudioUnlocked());
  const [bellRinging, setBellRinging] = useState(false);
  const [liveItems, setLiveItems] = useState([]);
  const [clearingItems, setClearingItems] = useState([]);
  const [historyByDate, setHistoryByDate] = useState(() => loadHistoryByDate());
  const [showCleared, setShowCleared] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => todayKeyVN());
  const [clearedPage, setClearedPage] = useState(0);
  const [expandedPeople, setExpandedPeople] = useState(() => new Set());
  const [toasts, setToasts] = useState([]);

  const liveMapRef = useRef(new Map());
  const firstFetchDoneRef = useRef(false);
  const syncApiAvailableRef = useRef(true);
  const newHighlightsRef = useRef(new Map());
  const burnedAlertedRef = useRef(new Set());
  const lastBurnReminderRef = useRef(0);
  const soundEnabledRef = useRef(true);
  const bellTimerRef = useRef(null);
  const bcRef = useRef(null);
  const historyByDateRef = useRef(historyByDate);

  const todayKey = todayKeyVN(nowMs);
  const todayCleared = useMemo(() => historyByDate[todayKey] || [], [historyByDate, todayKey]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    historyByDateRef.current = historyByDate;
  }, [historyByDate]);

  useEffect(() => {
    document.title = 'War Room CT Homes — Waiting Point';
  }, []);

  const pushToast = useCallback((title, body, kind = 'clear') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [{ id, title, body, kind }, ...prev].slice(0, 4));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const triggerBell = useCallback((kind) => {
    setBellRinging(false);
    requestAnimationFrame(() => setBellRinging(true));
    clearTimeout(bellTimerRef.current);
    bellTimerRef.current = setTimeout(() => setBellRinging(false), 1250);
    playBell(kind, soundEnabledRef.current, () => setAudioReady(true));
  }, []);

  const applySharedState = useCallback((shared) => {
    if (!shared || typeof shared !== 'object') return;
    const localTimers = loadTimerStore();
    let timerChanged = false;

    // Dọn các timer đã bị xóa trên máy khác để không bị tính nhầm thời gian cũ nếu tạo lại cùng nội dung
    if (shared.removedTimers && typeof shared.removedTimers === 'object') {
      for (const [id, removedAt] of Object.entries(shared.removedTimers)) {
        const cur = localTimers[id];
        if (cur && (cur.startedAt || 0) <= Number(removedAt)) {
          delete localTimers[id];
        }
      }
    }

    if (shared.timers && typeof shared.timers === 'object') {
      for (const [id, st] of Object.entries(shared.timers)) {
        if (!st || !st.startedAt) continue;
        const cur = localTimers[id];
        const mergedMeta = {
          lastSupporter: st.lastSupporter || cur?.lastSupporter || '',
          lastOwner: st.lastOwner || cur?.lastOwner || '',
        };
        if (
          !cur ||
          (cur.rawTime === st.rawTime && st.startedAt < cur.startedAt) ||
          (cur.rawTime !== st.rawTime && (st.updatedAt || 0) >= (cur.updatedAt || 0))
        ) {
          localTimers[id] = { ...st, ...mergedMeta };
          const live = liveMapRef.current.get(id);
          if (live) {
            live.startedAt = st.startedAt;
            live.totalSec = st.totalSec;
            live.endAt = st.endAt;
            live.lastKnownSupporter = live.lastKnownSupporter || mergedMeta.lastSupporter;
            live.lastKnownOwner = live.lastKnownOwner || mergedMeta.lastOwner;
            timerChanged = true;
          }
        } else if (mergedMeta.lastSupporter !== cur.lastSupporter || mergedMeta.lastOwner !== cur.lastOwner) {
          localTimers[id] = { ...cur, ...mergedMeta };
        }
      }
      saveTimerStore(localTimers);
      if (timerChanged) setLiveItems([...liveMapRef.current.values()]);
    }

    if (shared.historyByDate && typeof shared.historyByDate === 'object') {
      const nextHist = { ...historyByDateRef.current };
      for (const [dKey, list] of Object.entries(shared.historyByDate)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dKey) && Array.isArray(list)) {
          nextHist[dKey] = mergeDayRecords(nextHist[dKey], list);
        }
      }
      historyByDateRef.current = nextHist;
      setHistoryByDate(nextHist);
      saveHistoryByDate(nextHist);
    } else if (shared.date && Array.isArray(shared.recentCleared)) {
      const nextHist = {
        ...historyByDateRef.current,
        [shared.date]: mergeDayRecords(historyByDateRef.current[shared.date], shared.recentCleared),
      };
      historyByDateRef.current = nextHist;
      setHistoryByDate(nextHist);
      saveHistoryByDate(nextHist);
    }
  }, []);

  const fetchSharedState = useCallback(async () => {
    if (!syncApiAvailableRef.current) return null;
    try {
      const res = await fetch('/api/waiting-point', { cache: 'no-store' });
      if (res.status === 404 || res.status === 405) {
        syncApiAvailableRef.current = false;
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const pushSharedDelta = useCallback(
    async (delta, latestHistoryByDate) => {
      if (bcRef.current) {
        try {
          bcRef.current.postMessage({
            type: 'state_sync',
            payload: {
              date: todayKeyVN(),
              timers: loadTimerStore(),
              historyByDate: latestHistoryByDate || historyByDateRef.current,
            },
          });
        } catch {
          // ignore
        }
      }
      if (!syncApiAvailableRef.current) return;
      try {
        const res = await fetch('/api/waiting-point', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(delta),
        });
        if (res.ok) applySharedState(await res.json());
      } catch {
        // ignore network hiccup
      }
    },
    [applySharedState],
  );

  const syncFromSheet = useCallback(async () => {
    try {
      const [result, shared] = await Promise.all([fetchWaitingPoints(), fetchSharedState()]);
      if (shared) applySharedState(shared);

      const now = Date.now();
      const curToday = todayKeyVN(now);
      setIsOnline(true);

      const timerStore = loadTimerStore();
      const sharedTimers = shared?.timers || {};
      const nextMap = new Map();
      const newEntries = [];
      const newlyAssigned = [];
      const deltaTimers = {};
      let hasTimerDelta = false;

      for (const rawItem of result.items) {
        const existing = liveMapRef.current.get(rawItem.id);
        const fromServer = sharedTimers[rawItem.id];
        const stored = fromServer || timerStore[rawItem.id];

        const startedAt = fromServer?.startedAt || existing?.startedAt || stored?.startedAt || now;
        let totalSec = fromServer?.totalSec ?? existing?.totalSec ?? stored?.totalSec ?? null;
        let endAt = fromServer?.endAt ?? existing?.endAt ?? stored?.endAt ?? null;
        let updatedAt = fromServer?.updatedAt || stored?.updatedAt || now;

        const prevRawTime = fromServer?.rawTime ?? existing?.timeRaw ?? stored?.rawTime;
        if (!existing && !stored) {
          const calc = resolveDeadlineFromSpec(rawItem.timeSpec, startedAt);
          totalSec = calc.totalSec;
          endAt = calc.endAt;
          updatedAt = now;
          hasTimerDelta = true;
        } else if (prevRawTime !== rawItem.timeRaw) {
          const calc = resolveDeadlineFromSpec(rawItem.timeSpec, now);
          totalSec = calc.totalSec;
          endAt = calc.endAt;
          updatedAt = now;
          hasTimerDelta = true;
        }

        // Giữ lại Người hỗ trợ & Người phụ trách gần nhất để không mất khi xóa cột G/F trước cột D
        const lastKnownSupporter = rawItem.supporter || existing?.lastKnownSupporter || stored?.lastSupporter || '';
        const lastKnownOwner = rawItem.owner || existing?.lastKnownOwner || stored?.lastOwner || '';
        if (
          (rawItem.supporter && rawItem.supporter !== stored?.lastSupporter) ||
          (rawItem.owner && rawItem.owner !== stored?.lastOwner)
        ) {
          hasTimerDelta = true;
        }

        const fullItem = {
          ...rawItem,
          startedAt,
          totalSec,
          endAt,
          lastKnownSupporter,
          lastKnownOwner,
        };
        nextMap.set(fullItem.id, fullItem);

        const timerEntry = {
          startedAt,
          totalSec,
          endAt,
          rawTime: rawItem.timeRaw,
          updatedAt,
          lastSupporter: lastKnownSupporter,
          lastOwner: lastKnownOwner,
        };
        timerStore[fullItem.id] = timerEntry;
        deltaTimers[fullItem.id] = timerEntry;

        if (firstFetchDoneRef.current && !existing) {
          newEntries.push(fullItem);
          newHighlightsRef.current.set(fullItem.id, now + WP_CONFIG.NEW_HIGHLIGHT_MS);
        } else if (
          firstFetchDoneRef.current &&
          existing &&
          normalizeText(existing.supporter) !== normalizeText(rawItem.supporter) &&
          rawItem.supporter
        ) {
          newlyAssigned.push(fullItem);
          newHighlightsRef.current.set(fullItem.id, now + WP_CONFIG.NEW_HIGHLIGHT_MS);
        }
      }

      const removedEntries = [];
      if (firstFetchDoneRef.current) {
        for (const [id, prevItem] of liveMapRef.current.entries()) {
          if (!nextMap.has(id)) {
            removedEntries.push(prevItem);
            delete timerStore[id];
          }
        }
      }

      saveTimerStore(timerStore);
      liveMapRef.current = nextMap;
      firstFetchDoneRef.current = true;
      setLiveItems([...nextMap.values()]);

      let clearedPayload = [];
      let latestHistory = historyByDateRef.current;

      if (removedEntries.length > 0) {
        const clearingBatch = [];
        for (const item of removedEntries) {
          const spentSec = Math.max(5, Math.floor((now - item.startedAt) / 1000));
          const resolvedSupporter = item.supporter || item.lastKnownSupporter || '';
          const resolvedOwner = item.owner || item.lastKnownOwner || '';
          clearingBatch.push({ ...item, supporter: resolvedSupporter, owner: resolvedOwner, clearedAt: now });
          burnedAlertedRef.current.delete(item.id);
          newHighlightsRef.current.delete(item.id);

          const record = {
            date: curToday,
            id: item.id,
            group: item.group,
            stream: item.stream,
            issue: item.issue,
            owner: resolvedOwner,
            supporter: resolvedSupporter,
            spentSec,
            at: fmtTime(new Date(now)).slice(0, 5),
            clearedAt: now,
          };
          clearedPayload.push(record);
          const byWho = resolvedSupporter ? ` · ${resolvedSupporter}` : '';
          pushToast(`ĐÃ HOÀN THÀNH (${formatClock(spentSec)})`, `${item.group}${byWho} — ${item.issue}`, 'clear');
        }

        latestHistory = {
          ...historyByDateRef.current,
          [curToday]: mergeDayRecords(historyByDateRef.current[curToday], clearedPayload),
        };
        historyByDateRef.current = latestHistory;
        setHistoryByDate(latestHistory);
        setClearedPage(0);
        saveHistoryByDate(latestHistory);

        setClearingItems((prev) => [...clearingBatch, ...prev]);
        const removeIds = new Set(clearingBatch.map((c) => c.id));
        setTimeout(() => {
          setClearingItems((prev) => prev.filter((c) => !removeIds.has(c.id)));
        }, WP_CONFIG.CLEAR_ANIMATION_MS);

        triggerBell('clear');
      }

      if (newEntries.length > 0) {
        triggerBell('new');
        const first = newEntries[0];
        const who = first.supporter || 'Chưa phân công';
        pushToast(
          newEntries.length === 1 ? `YÊU CẦU MỚI · ${who}` : `${newEntries.length} YÊU CẦU MỚI`,
          `${first.group} — ${first.issue}`,
          'new',
        );
      } else if (newlyAssigned.length > 0) {
        triggerBell('assigned');
        const first = newlyAssigned[0];
        pushToast(`ĐÃ PHÂN CÔNG · ${first.supporter}`, `${first.group} — ${first.issue}`, 'assigned');
      }

      if (hasTimerDelta || newEntries.length > 0 || removedEntries.length > 0 || Object.keys(sharedTimers).length === 0) {
        pushSharedDelta(
          {
            timers: deltaTimers,
            removedIds: removedEntries.map((r) => r.id),
            clearedItems: clearedPayload,
          },
          latestHistory,
        );
      }
    } catch {
      setIsOnline(false);
    }
  }, [applySharedState, fetchSharedState, pushSharedDelta, pushToast, triggerBell]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
        ch.onmessage = (ev) => {
          if (ev?.data?.type === 'state_sync') applySharedState(ev.data.payload);
        };
        bcRef.current = ch;
      } catch {
        bcRef.current = null;
      }
    }

    syncFromSheet();
    const pollId = setInterval(syncFromSheet, WP_CONFIG.POLL_INTERVAL_MS);
    const tickId = setInterval(() => setNowMs(Date.now()), 1000);

    const onPointerDown = () => {
      unlockAudio(() => setAudioReady(true));
      if (isAudioUnlocked()) setAudioReady(true);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setShowCleared(false);
    };
    window.addEventListener('pointerdown', onPointerDown, { once: true });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      clearInterval(pollId);
      clearInterval(tickId);
      clearTimeout(bellTimerRef.current);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      bcRef.current?.close();
    };
  }, [applySharedState, syncFromSheet]);

  const { people, activeCount, burnCount } = useMemo(() => {
    const visible = [];
    const liveIds = new Set();

    for (const item of liveItems) {
      liveIds.add(item.id);
      visible.push({ ...item, isClearing: false, timing: computeTiming(item, nowMs) });
    }
    for (const item of clearingItems) {
      if (!liveIds.has(item.id)) {
        visible.push({
          ...item,
          isClearing: true,
          timing: { mode: 'countdown', remainingSec: 999999, elapsedSec: 0, pct: 100, tier: 'ok' },
        });
      }
    }

    const grouped = groupItemsByPerson(visible);
    const active = visible.filter((v) => !v.isClearing);
    const burning = active.filter((v) => v.timing.tier === 'burn').length;
    return { people: grouped, activeCount: active.length, burnCount: burning };
  }, [liveItems, clearingItems, nowMs]);

  useEffect(() => {
    if (!liveItems.length) return;
    let newlyBurned = null;
    let anyBurning = false;

    for (const item of liveItems) {
      const t = computeTiming(item, nowMs);
      if (t.tier === 'burn') {
        anyBurning = true;
        if (!burnedAlertedRef.current.has(item.id)) {
          burnedAlertedRef.current.add(item.id);
          newlyBurned = item;
        }
      }
    }

    if (newlyBurned) {
      lastBurnReminderRef.current = nowMs;
      triggerBell('burn');
      const who = newlyBurned.supporter || 'Chưa phân công';
      pushToast(`QUÁ HẠN XỬ LÝ · ${who}`, `${newlyBurned.group} — ${newlyBurned.issue}`, 'burn');
    } else if (anyBurning && nowMs - lastBurnReminderRef.current >= WP_CONFIG.BURN_REMINDER_MS) {
      lastBurnReminderRef.current = nowMs;
      triggerBell('burn');
    }
  }, [liveItems, nowMs, pushToast, triggerBell]);

  const handleToggleSound = () => {
    const wasLocked = !audioReady;
    unlockAudio(() => setAudioReady(true));
    setAudioReady(true);
    if (wasLocked && soundEnabled) {
      triggerBell('test');
      return;
    }
    const next = !soundEnabled;
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    if (next) triggerBell('test');
  };

  const handleToggleExpand = (personKey) => {
    setExpandedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(personKey)) next.delete(personKey);
      else next.add(personKey);
      return next;
    });
  };

  const gridCls = getPeopleGridLayout(people.length);
  const taskLimit = getTaskLimitForPeopleCount(people.length);
  const compact = people.length >= 7;
  const rowsCls = people.length <= 3 ? 'rows-1' : people.length <= 8 ? 'rows-2' : 'rows-auto';
  const gridScrollRef = useAutoScroll([people.length, rowsCls]);

  const bellLabel = !soundEnabled ? 'Chuông: Tắt' : !audioReady ? 'Bấm bật chuông' : 'Chuông: Bật';
  const bellBtnCls = !soundEnabled
    ? 'wp-sw-ctrl is-muted'
    : bellRinging
      ? 'wp-sw-ctrl is-ringing'
      : !audioReady
        ? 'wp-sw-ctrl is-attention'
        : 'wp-sw-ctrl';

  return (
    <main className="wall wp-wall">
      <header className="panel wp-sw-head">
        <div className="wp-sw-brand">
          <div className="wp-sw-monogram" aria-hidden="true">
            WP
          </div>
          <h1>Waiting Point</h1>
        </div>

        <div className="wp-sw-head-right">
          {!isOnline && (
            <span className="wp-sw-ctrl is-burn">
              <IconWifiOff className="wp-ico-sm" />
              <span>Mất kết nối Sheet</span>
            </span>
          )}

          {burnCount > 0 && (
            <div className="wp-sw-ctrl is-burn" title="Số yêu cầu đang quá thời gian xử lý">
              <IconAlertTriangle className="wp-ico-sm" />
              <span>Quá hạn</span>
              <b className="wp-mono">{burnCount}</b>
            </div>
          )}

          <div className={`wp-sw-ctrl is-stat ${activeCount === 0 ? 'is-zero' : ''}`}>
            <IconUsers className="wp-ico-sm" />
            <span className="wp-mono">
              <b>{people.length}</b> người · <b>{activeCount}</b> việc
            </span>
          </div>

          <button type="button" className={bellBtnCls} onClick={handleToggleSound} title="Bật / Tắt tiếng chuông báo">
            {soundEnabled ? <IconBell className="wp-ico-sm wp-bell-svg" /> : <IconBellOff className="wp-ico-sm" />}
            <span>{bellLabel}</span>
          </button>

          <button
            type="button"
            className={`wp-sw-ctrl ${showCleared ? 'is-active' : ''}`}
            onClick={() => {
              setShowCleared((v) => !v);
              setSelectedDate(todayKey);
              setClearedPage(0);
            }}
            title="Xem thống kê & lịch sử xử lý theo ngày"
          >
            <IconHistory className="wp-ico-sm" />
            <span>Thống kê</span>
            <b className={`wp-sw-badge ${todayCleared.length === 0 ? 'zero' : ''}`}>{todayCleared.length}</b>
          </button>

          <div className="wp-sw-clock" aria-label="Giờ hiện tại">
            {fmtTime(new Date(nowMs))}
          </div>
        </div>
      </header>

      <div className="wp-stage">
        {showCleared ? (
          <ClearedPanel
            historyByDate={historyByDate}
            todayKey={todayKey}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            page={clearedPage}
            onPageChange={setClearedPage}
            onClose={() => setShowCleared(false)}
          />
        ) : people.length === 0 ? (
          <section className="panel wp-empty-panel">
            <div className="wp-empty-ring st-done" aria-hidden="true">
              <IconCheckCircle className="wp-empty-ico" />
            </div>
            <h2>Hiện không có điểm chờ cần hỗ trợ</h2>
            <div className="wp-empty-bar">
              <div className="wp-empty-live">
                <span className={`wp-live-dot ${isOnline ? 'st-done' : 'st-late'}`} aria-hidden="true" />
                <span>{isOnline ? 'Đang đồng bộ trực tiếp với bảng điều phối' : 'Đang thử kết nối lại nguồn dữ liệu…'}</span>
              </div>
              {todayCleared.length > 0 && (
                <button
                  type="button"
                  className="wp-empty-history-btn"
                  onClick={() => {
                    setShowCleared(true);
                    setSelectedDate(todayKey);
                    setClearedPage(0);
                  }}
                >
                  <IconHistory className="wp-ico-xs" />
                  <span>
                    Thống kê hôm nay: <b className="wp-mono">{todayCleared.length}</b> đã xử lý
                  </span>
                </button>
              )}
            </div>
          </section>
        ) : (
          <div className={`wp-people-grid ${gridCls} ${rowsCls}`} ref={gridScrollRef}>
            {people.map((person, idx) => (
              <PersonPanel
                key={person.key}
                index={idx + 1}
                person={person}
                nowMs={nowMs}
                taskLimit={taskLimit}
                compact={compact}
                expanded={expandedPeople.has(person.key)}
                onToggleExpand={handleToggleExpand}
                newHighlights={newHighlightsRef.current}
              />
            ))}
          </div>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="wp-toasts" aria-live="polite">
          {toasts.map((t) => {
            const stCls =
              t.kind === 'burn'
                ? 'st-late'
                : t.kind === 'new'
                  ? 'st-done'
                  : t.kind === 'assigned'
                    ? 'st-in_progress'
                    : 'st-done';
            return (
              <div key={t.id} className={`wp-toast ${stCls}`}>
                <span className="wp-toast-ico">
                  {t.kind === 'burn' ? (
                    <IconAlertTriangle className="wp-ico-sm" />
                  ) : t.kind === 'new' ? (
                    <IconBell className="wp-ico-sm" />
                  ) : t.kind === 'assigned' ? (
                    <IconUsers className="wp-ico-sm" />
                  ) : (
                    <IconCheckCircle className="wp-ico-sm" />
                  )}
                </span>
                <div className="wp-toast-body">
                  <b>{t.title}</b>
                  <span>{t.body}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

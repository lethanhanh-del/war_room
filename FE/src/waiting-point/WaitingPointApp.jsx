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
import PersonPanel from './PersonPanel.jsx';
import ClearedPanel from './ClearedPanel.jsx';
import './waitingPoint.css';

const STORAGE_TIMERS = 'warroom_oc_timers_v1';
const STORAGE_HISTORY = 'warroom_oc_history_v2';
const SYNC_CHANNEL_NAME = 'warroom_wp_sync_v1';

function todayKeyVN() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
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

function loadDailyHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '{}');
    if (saved.date === todayKeyVN() && Array.isArray(saved.recentCleared)) {
      return saved.recentCleared.slice(0, 100);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveDailyHistory(list) {
  try {
    localStorage.setItem(
      STORAGE_HISTORY,
      JSON.stringify({
        date: todayKeyVN(),
        recentCleared: list.slice(0, 100),
      }),
    );
  } catch {
    // ignore
  }
}

function BellIcon({ enabled }) {
  if (enabled) {
    return (
      <svg className="wp-bell-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    );
  }
  return (
    <svg className="wp-bell-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" />
      <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export default function WaitingPointApp() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isOnline, setIsOnline] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioReady, setAudioReady] = useState(() => isAudioUnlocked());
  const [bellRinging, setBellRinging] = useState(false);
  const [liveItems, setLiveItems] = useState([]);
  const [clearingItems, setClearingItems] = useState([]);
  const [recentCleared, setRecentCleared] = useState(() => loadDailyHistory());
  const [showCleared, setShowCleared] = useState(false);
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
  const recentClearedRef = useRef(recentCleared);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    recentClearedRef.current = recentCleared;
  }, [recentCleared]);

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

    if (shared.timers && typeof shared.timers === 'object') {
      for (const [id, st] of Object.entries(shared.timers)) {
        if (!st || !st.startedAt) continue;
        const cur = localTimers[id];
        if (
          !cur ||
          (cur.rawTime === st.rawTime && st.startedAt < cur.startedAt) ||
          (cur.rawTime !== st.rawTime && (st.updatedAt || 0) >= (cur.updatedAt || 0))
        ) {
          localTimers[id] = st;
          const live = liveMapRef.current.get(id);
          if (live) {
            live.startedAt = st.startedAt;
            live.totalSec = st.totalSec;
            live.endAt = st.endAt;
            timerChanged = true;
          }
        }
      }
      saveTimerStore(localTimers);
      if (timerChanged) setLiveItems([...liveMapRef.current.values()]);
    }

    if (shared.date === todayKeyVN() && Array.isArray(shared.recentCleared)) {
      const sliced = shared.recentCleared.slice(0, 100);
      setRecentCleared(sliced);
      saveDailyHistory(sliced);
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
    async (delta, latestHistory) => {
      if (bcRef.current) {
        try {
          bcRef.current.postMessage({
            type: 'state_sync',
            payload: { date: todayKeyVN(), timers: loadTimerStore(), recentCleared: latestHistory || recentClearedRef.current },
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

        const fullItem = { ...rawItem, startedAt, totalSec, endAt };
        nextMap.set(fullItem.id, fullItem);

        const timerEntry = { startedAt, totalSec, endAt, rawTime: rawItem.timeRaw, updatedAt };
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

      // Xử lý đơn vừa được xóa/hoàn thành trên Sheet
      let clearedPayload = [];
      let latestHistory = recentClearedRef.current;

      if (removedEntries.length > 0) {
        const clearingBatch = [];
        for (const item of removedEntries) {
          const spentSec = Math.max(5, Math.floor((now - item.startedAt) / 1000));
          clearingBatch.push({ ...item, clearedAt: now });
          burnedAlertedRef.current.delete(item.id);
          newHighlightsRef.current.delete(item.id);

          const record = {
            id: item.id,
            group: item.group,
            stream: item.stream,
            issue: item.issue,
            owner: item.owner || '',
            supporter: item.supporter || '',
            spentSec,
            at: fmtTime(new Date(now)).slice(0, 5),
            clearedAt: now,
          };
          clearedPayload.push(record);
          const byWho = item.supporter ? ` · ${item.supporter}` : '';
          pushToast(`ĐÃ XONG (${formatClock(spentSec)})`, `${item.group}${byWho} — ${item.issue}`, 'clear');
        }

        latestHistory = [...clearedPayload, ...recentClearedRef.current].slice(0, 100);
        setRecentCleared(latestHistory);
        setClearedPage(0);
        saveDailyHistory(latestHistory);

        setClearingItems((prev) => [...clearingBatch, ...prev]);
        const removeIds = new Set(clearingBatch.map((c) => c.id));
        setTimeout(() => {
          setClearingItems((prev) => prev.filter((c) => !removeIds.has(c.id)));
        }, WP_CONFIG.CLEAR_ANIMATION_MS);

        triggerBell('clear');
      }

      // Rung chuông + thông báo khi có task mới hoặc gán người hỗ trợ
      if (newEntries.length > 0) {
        triggerBell('new');
        const first = newEntries[0];
        const who = first.supporter || 'Chưa phân công';
        pushToast(
          newEntries.length === 1 ? `TASK MỚI · ${who}` : `${newEntries.length} TASK MỚI LÊN SHEET`,
          `${first.group} — ${first.issue}`,
          'new',
        );
      } else if (newlyAssigned.length > 0) {
        triggerBell('assigned');
        const first = newlyAssigned[0];
        pushToast(`ĐÃ GÁN HỖ TRỢ · ${first.supporter}`, `${first.group} — ${first.issue}`, 'assigned');
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

  // Kết nối BroadcastChannel + poll Sheet mỗi 3 giây + nhịp đồng hồ mỗi 1 giây
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

  // Tính toán danh sách gom theo từng Người hỗ trợ (gấp nhất xếp đầu)
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

  // Rung chuông báo động khi task mới chạm mốc quá hạn (+ nhắc lại mỗi 60s)
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
      pushToast(`QUÁ HẠN · ${who}`, `${newlyBurned.group} — ${newlyBurned.issue}`, 'burn');
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
  const bellChipCls = !soundEnabled
    ? 'chip ghost wp-bell-btn'
    : bellRinging
      ? 'chip wp-bell-btn is-ringing'
      : !audioReady
        ? 'chip today wp-bell-btn'
        : 'chip wp-bell-btn';

  return (
    <main className="wall wp-wall">
      <header className="panel wp-head">
        <div className="wp-brand">
          <h1>
            WAR ROOM <span>WAITING POINT</span>
          </h1>
        </div>

        <div className="wp-head-right">
          {!isOnline && (
            <span className="tag st-late">
              <i>⚠</i>Mất kết nối Sheet
            </span>
          )}

          {burnCount > 0 && (
            <div className="wp-stat st-late" title="Số vấn đề đang quá thời gian xử lý">
              <span>Quá hạn</span>
              <b>{burnCount}</b>
            </div>
          )}

          <div className={`wp-stat st-in_progress ${activeCount === 0 ? 'zero' : ''}`}>
            <span>Đang chờ</span>
            <b>
              {people.length} người · {activeCount} việc
            </b>
          </div>

          <button type="button" className={bellChipCls} onClick={handleToggleSound} title="Bật / Tắt tiếng chuông báo">
            <BellIcon enabled={soundEnabled} />
            <span>{bellLabel}</span>
          </button>

          <button
            type="button"
            className={`chip ${showCleared ? 'on' : ''}`}
            onClick={() => {
              setShowCleared((v) => !v);
              setClearedPage(0);
            }}
            title="Xem danh sách vấn đề vừa hoàn thành trong ngày"
          >
            <i className={`dot ${recentCleared.length > 0 ? 'st-done' : 'st-none'}`} />
            <span>Đã xong</span>
            <b className={`wp-chip-num ${recentCleared.length === 0 ? 'zero' : ''}`}>{recentCleared.length}</b>
          </button>

          <div className="wp-clock" aria-label="Giờ hiện tại">
            {fmtTime(new Date(nowMs))}
          </div>
        </div>
      </header>

      <div className="wp-stage">
        {showCleared ? (
          <ClearedPanel
            items={recentCleared}
            page={clearedPage}
            onPageChange={setClearedPage}
            onClose={() => setShowCleared(false)}
          />
        ) : people.length === 0 ? (
          <section className="panel wp-empty-panel">
            <div className="wp-empty-badge st-done" aria-hidden="true">
              ✔
            </div>
            <h2>Bếp War Room đang trống sạch!</h2>
          </section>
        ) : (
          <div className={`wp-people-grid ${gridCls} ${rowsCls}`} ref={gridScrollRef}>
            {people.map((person, i) => (
              <PersonPanel
                key={person.key}
                index={i + 1}
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
                  ? 'wp-st-accent'
                  : t.kind === 'assigned'
                    ? 'st-in_progress'
                    : 'st-done';
            const icon = t.kind === 'burn' ? '⚠' : t.kind === 'new' ? '!' : t.kind === 'assigned' ? '✓' : '★';
            return (
              <div key={t.id} className={`wp-toast ${stCls}`}>
                <span className="wp-toast-ico">{icon}</span>
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

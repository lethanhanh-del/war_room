import { useAutoScroll } from '../lib/useAutoScroll.js';
import { formatClock, shortStreamName } from './sheetService.js';
import { IconCheckCircle, IconUserPlus } from './Icons.jsx';

function tierStatusClass(tier, isClearing) {
  if (isClearing) return 'st-done';
  if (tier === 'burn') return 'st-late';
  if (tier === 'warn') return 'wp-st-warn';
  if (tier === 'ok') return 'st-done';
  return 'st-upcoming';
}

export default function PersonPanel({
  index,
  person,
  nowMs,
  taskLimit,
  compact,
  expanded,
  onToggleExpand,
  newHighlights,
}) {
  const hiddenCount = expanded ? 0 : Math.max(0, person.tasks.length - taskLimit);
  const shownTasks = expanded ? person.tasks : person.tasks.slice(0, taskLimit);
  const scrollRef = useAutoScroll([shownTasks.length, expanded, compact]);

  const hasNew = person.tasks.some((t) => (newHighlights.get(t.id) || 0) > nowMs);
  const topTask = person.tasks.find((t) => !t.isClearing) || person.tasks[0];

  let heroClock = '–';
  let heroLabel = 'ĐANG CHỜ';
  let heroTierCls = 'st-upcoming';

  if (topTask) {
    if (topTask.isClearing) {
      heroClock = 'Xong';
      heroLabel = 'HOÀN TẤT';
      heroTierCls = 'st-done';
    } else if (topTask.timing.mode === 'elapsed') {
      heroClock = formatClock(topTask.timing.elapsedSec);
      heroLabel = 'ĐÃ CHỜ';
      heroTierCls = 'st-upcoming';
    } else {
      heroClock = formatClock(topTask.timing.remainingSec);
      heroLabel =
        topTask.timing.tier === 'burn'
          ? 'QUÁ HẠN'
          : topTask.timing.tier === 'warn'
            ? 'SẮP HẾT'
            : 'GẤP NHẤT';
      heroTierCls = tierStatusClass(topTask.timing.tier, false);
    }
  }

  const cardStateCls =
    person.topTier === 'burn'
      ? 'wp-card-burn'
      : person.topTier === 'warn'
        ? 'wp-card-warn'
        : person.isUnassigned
          ? 'wp-card-unassigned'
          : '';

  return (
    <section
      className={`panel wp-sw-card ${compact ? 'compact' : ''} ${cardStateCls} ${hasNew ? 'wp-card-new' : ''}`}
      data-person-key={person.key}
    >
      {/* Phần đầu thẻ chia đôi kiểu kiến trúc: định danh bên trái + ô đồng hồ góc vuông bên phải */}
      <header className="wp-sw-top">
        <div className="wp-sw-id">
          <span
            className={`wp-sw-idx ${person.isUnassigned ? 'is-unassigned' : ''}`}
            title={person.isUnassigned ? 'Chưa có người hỗ trợ' : `Thứ tự ưu tiên ${index}`}
          >
            {person.isUnassigned ? <IconUserPlus className="wp-ico-sm" /> : String(index).padStart(2, '0')}
          </span>

          <div className="wp-sw-name-col">
            <div className="wp-sw-name-row">
              <h2 title={person.name}>{person.name}</h2>
              {hasNew && <span className="wp-sw-new-kicker">MỚI</span>}
            </div>
            <div className="wp-sw-sub">
              <span>{person.isUnassigned ? 'Chờ nhận hỗ trợ' : 'Người hỗ trợ'}</span>
              <span>·</span>
              <b className="wp-mono">{person.activeCount}</b> yêu cầu
              {person.burnCount > 0 && (
                <>
                  <span>·</span>
                  <span className="wp-sub-burn">
                    <b className="wp-mono">{person.burnCount}</b> quá hạn
                  </span>
                </>
              )}
              {person.burnCount === 0 && person.warnCount > 0 && (
                <>
                  <span>·</span>
                  <span className="wp-sub-warn">
                    <b className="wp-mono">{person.warnCount}</b> sắp hết
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={`wp-sw-timeblock ${heroTierCls}`}>
          <b>{heroClock}</b>
          <span>{heroLabel}</span>
        </div>
      </header>

      {/* Danh sách công việc dạng trục Timeline dọc cao cấp */}
      <div className="wp-sw-timeline" ref={scrollRef}>
        {shownTasks.map((task) => {
          const isNew = (newHighlights.get(task.id) || 0) > nowMs;
          const stCls = tierStatusClass(task.timing.tier, task.isClearing);
          const streamShort = shortStreamName(task.stream);
          const restMeta = [streamShort, task.owner ? `PIC: ${task.owner}` : ''].filter(Boolean).join(' · ');

          let clockStr = '';
          let statusLabel = '';
          if (task.isClearing) {
            clockStr = 'Xong';
            statusLabel = 'Hoàn tất';
          } else if (task.timing.mode === 'elapsed') {
            clockStr = formatClock(task.timing.elapsedSec);
            statusLabel = 'Đã chờ';
          } else {
            clockStr = formatClock(task.timing.remainingSec);
            statusLabel =
              task.timing.tier === 'burn'
                ? 'Quá hạn'
                : task.timing.tier === 'warn'
                  ? 'Sắp hết'
                  : task.timeRaw || 'Còn lại';
          }

          return (
            <article
              key={task.id}
              className={`wp-sw-node ${stCls} ${task.isClearing ? 'is-clearing' : ''} ${isNew ? 'is-new' : ''}`}
              title={`${task.issue}\n${task.group} · ${restMeta}${task.timeRaw ? ` · SLA: ${task.timeRaw}` : ''}`}
            >
              <span className={`wp-sw-dot ${stCls}`} aria-hidden="true" />

              {task.isClearing && (
                <div className="wp-sw-cleared-veil" aria-hidden="true">
                  <span className="wp-sw-cleared-pill">
                    <IconCheckCircle className="wp-ico-sm" />
                    Đã hoàn thành
                  </span>
                </div>
              )}

              <div className="wp-sw-node-main">
                <p className="wp-sw-node-title">
                  {isNew && <span className="wp-sw-new-tag">MỚI</span>}
                  {task.issue}
                </p>

                <div className="wp-sw-node-meta">
                  {task.group && (
                    <span className="wp-sw-cat" title={task.group}>
                      {task.group}
                    </span>
                  )}
                  {restMeta && (
                    <span className="wp-sw-rest" title={restMeta}>
                      {restMeta}
                    </span>
                  )}
                </div>

                {task.timing.mode === 'countdown' && !task.isClearing && (
                  <div className="wp-sw-gauge" aria-hidden="true">
                    <i style={{ width: `${task.timing.pct}%` }} />
                  </div>
                )}
              </div>

              <div className={`wp-sw-node-right ${stCls}`}>
                <b>{clockStr}</b>
                <span title={statusLabel}>{statusLabel}</span>
              </div>
            </article>
          );
        })}
      </div>

      {(hiddenCount > 0 || expanded) && (
        <footer className="wp-sw-foot">
          <button type="button" className="wp-sw-more" onClick={() => onToggleExpand(person.key)}>
            {expanded ? 'Thu gọn bớt' : `Xem thêm ${hiddenCount} việc ít gấp hơn`}
          </button>
        </footer>
      )}
    </section>
  );
}

import { useAutoScroll } from '../lib/useAutoScroll.js';
import { formatClock, shortStreamName } from './sheetService.js';

function statusClassForTier(tier, isClearing) {
  if (isClearing) return 'st-done';
  if (tier === 'burn') return 'st-late';
  if (tier === 'warn') return 'wp-st-warn';
  if (tier === 'ok') return 'st-in_progress';
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
  const activeCount = person.activeCount;
  const hiddenCount = expanded ? 0 : Math.max(0, person.tasks.length - taskLimit);
  const shownTasks = expanded ? person.tasks : person.tasks.slice(0, taskLimit);
  const scrollRef = useAutoScroll([shownTasks.length, expanded, compact]);

  const hasNew = person.tasks.some((t) => (newHighlights.get(t.id) || 0) > nowMs);
  const topTask = person.tasks.find((t) => !t.isClearing) || person.tasks[0];

  let topClockText = '–';
  let topClockLabel = 'ĐANG CHỜ';
  let topClockCls = 'st-upcoming';

  if (topTask) {
    if (topTask.isClearing) {
      topClockText = '✔ XONG';
      topClockLabel = 'HOÀN TẤT';
      topClockCls = 'st-done';
    } else if (topTask.timing.mode === 'elapsed') {
      topClockText = formatClock(topTask.timing.elapsedSec);
      topClockLabel = 'ĐÃ CHỜ';
      topClockCls = 'st-upcoming';
    } else {
      topClockText = formatClock(topTask.timing.remainingSec);
      topClockLabel = topTask.timing.tier === 'burn' ? 'QUÁ HẠN' : topTask.timing.tier === 'warn' ? 'SẮP HẾT' : 'GẤP NHẤT';
      topClockCls = statusClassForTier(topTask.timing.tier, false);
    }
  }

  const cardTierCls =
    person.topTier === 'burn'
      ? 'wp-card-burn'
      : person.topTier === 'warn'
        ? 'wp-card-warn'
        : person.isUnassigned
          ? 'wp-card-unassigned'
          : '';

  return (
    <section
      className={`panel wp-person ${compact ? 'compact' : ''} ${cardTierCls} ${hasNew ? 'wp-card-new' : ''}`}
      data-person-key={person.key}
    >
      <header className="fl-head wp-p-head">
        <em className={`num ${person.isUnassigned ? 'wp-num-unassigned' : ''}`} title={person.isUnassigned ? 'Chưa có người hỗ trợ' : `Hạng ưu tiên ${index}`}>
          {person.isUnassigned ? '?' : index}
        </em>

        <div className="fl-title">
          <div className="wp-p-name-row">
            <h2 title={person.name}>{person.name}</h2>
            {hasNew && <span className="wp-kicker-new">MỚI</span>}
          </div>
          <div className="fl-counts">
            <span className={`cnt st-late ${person.burnCount ? '' : 'zero'}`}>
              <i className="dot st-late" />
              {!compact && 'Quá hạn'} <b>{person.burnCount}</b>
            </span>
            <span className={`cnt wp-st-warn ${person.warnCount ? '' : 'zero'}`}>
              <i className="dot wp-st-warn" />
              {!compact && 'Sắp hết'} <b>{person.warnCount}</b>
            </span>
            <span className={`cnt st-in_progress ${activeCount ? '' : 'zero'}`}>
              <i className="dot st-in_progress" />
              {!compact && 'Đang chờ'} <b>{activeCount}</b>
            </span>
          </div>
        </div>

        <div className={`wp-p-clock ${topClockCls}`}>
          <b>{topClockText}</b>
          <span>{topClockLabel}</span>
        </div>
      </header>

      <div className="wp-p-body" ref={scrollRef}>
        {shownTasks.map((task) => {
          const isNew = (newHighlights.get(task.id) || 0) > nowMs;
          const stCls = statusClassForTier(task.timing.tier, task.isClearing);
          const streamShort = shortStreamName(task.stream);
          const metaParts = [task.group, streamShort];
          if (task.owner) metaParts.push(`PIC: ${task.owner}`);
          const metaLine = metaParts.filter(Boolean).join(' · ');

          let clockStr = '';
          let subClock = '';
          if (task.isClearing) {
            clockStr = '✔ XONG';
            subClock = 'vừa hoàn thành';
          } else if (task.timing.mode === 'elapsed') {
            clockStr = formatClock(task.timing.elapsedSec);
            subClock = 'đã chờ';
          } else {
            clockStr = formatClock(task.timing.remainingSec);
            subClock = task.timing.tier === 'burn' ? 'quá hạn' : task.timeRaw || 'còn lại';
          }

          return (
            <article
              key={task.id}
              className={`wp-task ${stCls} ${task.isClearing ? 'is-clearing' : ''} ${isNew ? 'is-new' : ''}`}
              title={`${task.issue}\n${metaLine}${task.timeRaw ? ` · SLA: ${task.timeRaw}` : ''}`}
            >
              <div className="wp-task-main">
                <div className="wp-task-issue">
                  {isNew && <span className="wp-tag-new">MỚI</span>}
                  <span>{task.issue}</span>
                </div>
                <div className="wp-task-meta" title={metaLine}>
                  {metaLine}
                </div>
              </div>

              <div className="wp-task-right">
                <b className="wp-task-clock">{clockStr}</b>
                <span className="wp-task-sub" title={subClock}>
                  {subClock}
                </span>
                {task.timing.mode === 'countdown' && !task.isClearing && (
                  <span className="wp-track">
                    <i style={{ width: `${task.timing.pct}%` }} />
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {(hiddenCount > 0 || expanded) && (
        <footer className="wp-p-foot">
          <button type="button" className="wp-more-btn" onClick={() => onToggleExpand(person.key)}>
            {expanded ? 'Thu gọn bớt' : `+${hiddenCount} việc ít gấp hơn`}
          </button>
        </footer>
      )}
    </section>
  );
}

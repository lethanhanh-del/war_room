import { useAutoScroll } from '../lib/useAutoScroll.js';
import { formatClock, shortStreamName } from './sheetService.js';
import { IconCheckCircle, IconUserPlus } from './Icons.jsx';

// Bảng tông chữ cái avatar công sở (độ bão hòa trầm, sang trọng trên nền Night Ops)
const AVATAR_TONES = [
  { bg: 'rgba(61, 169, 252, 0.16)', border: 'rgba(61, 169, 252, 0.42)', text: '#7cc4fd' },
  { bg: 'rgba(46, 230, 166, 0.14)', border: 'rgba(46, 230, 166, 0.38)', text: '#6ee7be' },
  { bg: 'rgba(200, 255, 77, 0.12)', border: 'rgba(200, 255, 77, 0.36)', text: '#d4ff78' },
  { bg: 'rgba(148, 163, 184, 0.16)', border: 'rgba(148, 163, 184, 0.40)', text: '#cbd5e1' },
  { bg: 'rgba(255, 176, 32, 0.15)', border: 'rgba(255, 176, 32, 0.40)', text: '#fcd34d' },
  { bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.40)', text: '#7dd3fc' },
];

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarTone(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

function statusClassForTier(tier, isClearing) {
  if (isClearing) return 'st-done';
  if (tier === 'burn') return 'st-late';
  if (tier === 'warn') return 'wp-st-warn';
  if (tier === 'ok') return 'st-in_progress';
  return 'st-upcoming';
}

function stripClassForPerson(person) {
  if (person.topTier === 'burn') return 'st-late';
  if (person.topTier === 'warn') return 'wp-st-warn';
  if (person.topTier === 'clear') return 'st-done';
  if (person.isUnassigned) return 'wp-st-blocker';
  if (person.topTier === 'ok') return 'st-in_progress';
  return 'st-upcoming';
}

export default function PersonPanel({
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
  const stripCls = stripClassForPerson(person);
  const tone = person.isUnassigned ? null : getAvatarTone(person.name);

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
      className={`panel wp-person ${compact ? 'compact' : ''} ${cardStateCls} ${hasNew ? 'wp-card-new' : ''}`}
      data-person-key={person.key}
    >
      {/* Dải trạng thái mảnh trên cùng giúp quét mức độ ưu tiên trong 0.5 giây */}
      <div className={`wp-p-strip ${stripCls}`} aria-hidden="true" />

      <header className="wp-p-head">
        <div className="wp-p-identity">
          <div
            className={`wp-avatar ${person.isUnassigned ? 'is-unassigned' : ''}`}
            style={
              tone
                ? {
                    backgroundColor: tone.bg,
                    borderColor: tone.border,
                    color: tone.text,
                  }
                : undefined
            }
            aria-hidden="true"
          >
            {person.isUnassigned ? <IconUserPlus className="wp-avatar-ico" /> : getInitials(person.name)}
          </div>

          <div className="wp-p-name-col">
            <div className="wp-p-name-row">
              <h2 title={person.name}>{person.name}</h2>
              {hasNew && <span className="wp-kicker-new">MỚI</span>}
            </div>
            <div className={`wp-p-role ${person.isUnassigned ? 'is-unassigned' : ''}`}>
              {person.isUnassigned ? 'Chờ phân công người hỗ trợ' : 'Người hỗ trợ xử lý'}
            </div>
          </div>
        </div>

        <div className="wp-p-badges">
          {person.burnCount > 0 && (
            <span className="wp-p-pill st-late" title="Số yêu cầu đã quá thời hạn xử lý">
              <b>{person.burnCount}</b> quá hạn
            </span>
          )}
          {person.burnCount === 0 && person.warnCount > 0 && (
            <span className="wp-p-pill wp-st-warn" title="Số yêu cầu sắp hết hạn (dưới 5 phút)">
              <b>{person.warnCount}</b> sắp hết
            </span>
          )}
          <span className="wp-p-pill wp-p-pill-total">
            <b>{person.activeCount}</b> việc
          </span>
        </div>
      </header>

      <div className="wp-p-body" ref={scrollRef}>
        {shownTasks.map((task) => {
          const isNew = (newHighlights.get(task.id) || 0) > nowMs;
          const stCls = statusClassForTier(task.timing.tier, task.isClearing);
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
              className={`wp-ticket ${stCls} ${task.isClearing ? 'is-clearing' : ''} ${isNew ? 'is-new' : ''}`}
              title={`${task.issue}\n${task.group} · ${restMeta}${task.timeRaw ? ` · SLA: ${task.timeRaw}` : ''}`}
            >
              {task.isClearing && (
                <div className="wp-tk-cleared-veil" aria-hidden="true">
                  <span className="wp-tk-cleared-pill">
                    <IconCheckCircle className="wp-ico-sm" />
                    Đã hoàn thành
                  </span>
                </div>
              )}

              <div className="wp-tk-inner">
                <div className="wp-tk-left">
                  <span className="wp-tk-rail" aria-hidden="true" />
                  <div className="wp-tk-content">
                    <div className="wp-tk-issue-line">
                      {isNew && <span className="wp-tag-new">MỚI</span>}
                      <p className="wp-tk-issue">{task.issue}</p>
                    </div>
                    <div className="wp-tk-meta">
                      {task.group && (
                        <span className="wp-tk-group" title={task.group}>
                          {task.group}
                        </span>
                      )}
                      {restMeta && (
                        <span className="wp-tk-meta-rest" title={restMeta}>
                          {restMeta}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="wp-tk-right">
                  <div className={`wp-timer-pill ${stCls}`}>{clockStr}</div>
                  <span className={`wp-tk-status ${stCls}`} title={statusLabel}>
                    {statusLabel}
                  </span>
                </div>
              </div>

              {/* Thanh tiến độ sát cạnh đáy phiếu — giữ trọn cảm giác trực quan dễ đọc từ xa */}
              {task.timing.mode === 'countdown' && !task.isClearing && (
                <div className="wp-tk-bar" aria-hidden="true">
                  <div className="wp-tk-bar-fill" style={{ width: `${task.timing.pct}%` }} />
                </div>
              )}
            </article>
          );
        })}
      </div>

      {(hiddenCount > 0 || expanded) && (
        <footer className="wp-p-foot">
          <button type="button" className="wp-more-btn" onClick={() => onToggleExpand(person.key)}>
            {expanded ? 'Thu gọn bớt' : `Xem thêm ${hiddenCount} việc ít gấp hơn`}
          </button>
        </footer>
      )}
    </section>
  );
}

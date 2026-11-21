import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDailyStats, formatClock, formatDateLabelVN, normalizeText, shortStreamName, WP_CONFIG } from './sheetService.js';
import { IconCheckCircle, IconChevronLeft, IconChevronRight, IconHistory, IconX } from './Icons.jsx';

export default function ClearedPanel({ historyByDate, todayKey, selectedDate, onSelectDate, page, onPageChange, onClose }) {
  const [supporterFilter, setSupporterFilter] = useState('all');
  const [pageSize, setPageSize] = useState(WP_CONFIG.CLEARED_PAGE_SIZE);
  const bodyRef = useRef(null);

  // Danh sách các ngày có dữ liệu (luôn gồm hôm nay ở đầu)
  const availableDates = useMemo(() => {
    const set = new Set([todayKey, ...Object.keys(historyByDate || {})]);
    return [...set]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort((a, b) => b.localeCompare(a));
  }, [historyByDate, todayKey]);

  const activeDate = selectedDate || todayKey;
  const dayItems = useMemo(
    () => (historyByDate && Array.isArray(historyByDate[activeDate]) ? historyByDate[activeDate] : []),
    [historyByDate, activeDate],
  );
  const stats = useMemo(() => buildDailyStats(dayItems), [dayItems]);

  const filteredItems = useMemo(() => {
    if (supporterFilter === 'all') return dayItems;
    return dayItems.filter((rec) => {
      const key = String(rec.supporter || '').trim() ? normalizeText(rec.supporter) : '__unassigned__';
      return key === supporterFilter;
    });
  }, [dayItems, supporterFilter]);

  // Tự động đo chiều cao thực tế vùng bảng để hiển thị tối đa số dòng vừa khít màn hình rồi mới phân trang
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;

    const recalc = () => {
      const h = el.clientHeight;
      if (!h) return;
      const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
      const headH = el.querySelector('thead')?.getBoundingClientRect().height || rootFs * 2.15;
      const rows = el.querySelectorAll('tbody tr');
      let rowH = rootFs * 2.95;
      if (rows.length > 0) {
        let maxH = 0;
        for (const r of rows) maxH = Math.max(maxH, r.getBoundingClientRect().height);
        if (maxH > 16) rowH = maxH;
      }
      const fit = Math.max(5, Math.floor((h - headH - 4) / rowH));
      setPageSize((prev) => (prev === fit ? prev : fit));
    };

    const raf = requestAnimationFrame(recalc);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recalc) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', recalc);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', recalc);
    };
  }, [activeDate, supporterFilter, filteredItems.length]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = filteredItems.slice(start, start + pageSize);

  const handleDateChange = (nextDate) => {
    if (!nextDate) return;
    setSupporterFilter('all');
    onSelectDate(nextDate);
    onPageChange(0);
  };

  return (
    <section className="panel detail wp-cleared-panel">
      <header className="dt-head wp-cl-head">
        <div className="dt-title">
          <span className="dt-kicker">Thống kê theo ngày</span>
          <h2>
            Lịch sử xử lý
            <span className="dt-scope"> · {formatDateLabelVN(activeDate, todayKey)}</span>
          </h2>
        </div>

        <div className="wp-cl-actions">
          <div className="wp-date-bar" aria-label="Chọn ngày thống kê">
            {availableDates.slice(0, 5).map((d) => {
              const cnt = (historyByDate?.[d] || []).length;
              return (
                <button
                  key={d}
                  type="button"
                  className={`wp-date-chip ${d === activeDate ? 'is-active' : ''}`}
                  onClick={() => handleDateChange(d)}
                >
                  <span>{formatDateLabelVN(d, todayKey)}</span>
                  <b className="wp-mono">{cnt}</b>
                </button>
              );
            })}
            <input
              type="date"
              className="wp-date-input"
              value={activeDate}
              max={todayKey}
              onChange={(e) => handleDateChange(e.target.value)}
              title="Chọn ngày khác để xem thống kê"
              aria-label="Chọn ngày xem thống kê"
            />
          </div>

          {totalPages > 1 && (
            <div className="wp-pager" aria-label="Phân trang lịch sử">
              <button
                type="button"
                className="wp-sw-ctrl"
                disabled={safePage <= 0}
                onClick={() => onPageChange(Math.max(0, safePage - 1))}
              >
                <IconChevronLeft className="wp-ico-sm" />
                <span>Trước</span>
              </button>
              <span className="wp-pager-num">
                {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="wp-sw-ctrl"
                disabled={safePage >= totalPages - 1}
                onClick={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
              >
                <span>Sau</span>
                <IconChevronRight className="wp-ico-sm" />
              </button>
            </div>
          )}

          <button type="button" className="wp-sw-ctrl wp-sw-close" onClick={onClose}>
            <IconX className="wp-ico-sm" />
            <span>Về bảng chờ</span>
          </button>
        </div>
      </header>

      {/* Khối KPI thống kê tổng hợp của ngày đang chọn */}
      <div className="wp-stats-strip">
        <div className={`wp-stat-tile st-done ${stats.total === 0 ? 'is-zero' : ''}`}>
          <span>Đã xử lý trong ngày</span>
          <b className="wp-mono">{stats.total}</b>
        </div>
        <div className={`wp-stat-tile st-in_progress ${stats.supporterCount === 0 ? 'is-zero' : ''}`}>
          <span>Người hỗ trợ tham gia</span>
          <b className="wp-mono">{stats.supporterCount}</b>
        </div>
        <div className={`wp-stat-tile wp-st-warn ${stats.total === 0 ? 'is-zero' : ''}`}>
          <span>Thời gian xử lý TB</span>
          <b className="wp-mono">{stats.total ? formatClock(stats.avgSec) : '–'}</b>
        </div>
        <div className={`wp-stat-tile st-upcoming ${stats.total === 0 ? 'is-zero' : ''}`}>
          <span>Xử lý nhanh nhất</span>
          <b className="wp-mono">{stats.total ? formatClock(stats.fastestSec) : '–'}</b>
        </div>
      </div>

      {/* Thống kê chi tiết từng Người hỗ trợ trong ngày (bấm để lọc nhanh bảng) */}
      {stats.bySupporter.length > 0 && (
        <div className="wp-sup-stats" role="group" aria-label="Thống kê theo người hỗ trợ trong ngày">
          <span className="wp-sup-label">Theo người hỗ trợ</span>
          <button
            type="button"
            className={`wp-sup-chip ${supporterFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => {
              setSupporterFilter('all');
              onPageChange(0);
            }}
          >
            <span>Tất cả</span>
            <b className="wp-mono">{stats.total}</b>
          </button>
          {stats.bySupporter.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`wp-sup-chip ${supporterFilter === s.key ? 'is-active' : ''} ${s.isUnassigned ? 'is-unassigned' : ''}`}
              onClick={() => {
                setSupporterFilter((cur) => (cur === s.key ? 'all' : s.key));
                onPageChange(0);
              }}
              title={`${s.name}: ${s.count} việc · TB ${formatClock(s.avgSec)}`}
            >
              <span>{s.name}</span>
              <b className="wp-mono">{s.count}</b>
              <small className="wp-mono">TB {formatClock(s.avgSec)}</small>
            </button>
          ))}
        </div>
      )}

      <div className="dt-body" ref={bodyRef}>
        {!filteredItems.length ? (
          <div className="wp-cl-empty">
            <IconHistory className="wp-cl-empty-ico" />
            <p>Không có yêu cầu nào hoàn thành trong ngày {formatDateLabelVN(activeDate, todayKey)}</p>
          </div>
        ) : (
          <table className="grid dgrid wp-cleared-grid">
            <thead>
              <tr>
                <th className="wp-c-at">Giờ xong</th>
                <th className="wp-c-sup">Người hỗ trợ</th>
                <th className="wp-c-grp">Nhóm công việc</th>
                <th className="wp-c-flow">Dòng tiền</th>
                <th className="wp-c-issue">Vấn đề đã xử lý</th>
                <th className="wp-c-spent">Thời lượng</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((rec, idx) => (
                <tr key={rec.dedupKey || `${rec.id}-${rec.clearedAt}-${idx}`} className="row st-done">
                  <td className="wp-c-at">{rec.at || '–'}</td>
                  <td className="wp-c-sup">
                    <div className={`nm ${rec.supporter ? '' : 'muted'}`} title={rec.supporter || 'Chưa phân công'}>
                      {rec.supporter || 'Chưa phân công'}
                    </div>
                    {rec.owner && (
                      <div className="pic" title={`PIC: ${rec.owner}`}>
                        PIC: {rec.owner}
                      </div>
                    )}
                  </td>
                  <td className="wp-c-grp" title={rec.group}>
                    {rec.group || '–'}
                  </td>
                  <td className="wp-c-flow" title={rec.stream}>
                    {shortStreamName(rec.stream)}
                  </td>
                  <td className="wp-c-issue" title={rec.issue}>
                    {rec.issue}
                  </td>
                  <td className="wp-c-spent">
                    <span className="wp-spent-tag st-done">
                      <IconCheckCircle className="wp-ico-xs" />
                      {formatClock(rec.spentSec || 5)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

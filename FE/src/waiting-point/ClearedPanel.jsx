import { formatClock, shortStreamName, WP_CONFIG } from './sheetService.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';

export default function ClearedPanel({ items, page, onPageChange, onClose }) {
  const pageSize = WP_CONFIG.CLEARED_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const scrollRef = useAutoScroll([safePage, pageItems.length]);

  return (
    <section className="panel detail wp-cleared-panel">
      <header className="dt-head">
        <div className="dt-title">
          <span className="dt-kicker">Lịch sử hôm nay</span>
          <h2>
            Vừa hoàn thành
            <span className="dt-scope"> · {items.length} vấn đề đã xử lý</span>
          </h2>
        </div>

        {totalPages > 1 && (
          <div className="wp-pager">
            <button
              type="button"
              className="chip"
              disabled={safePage <= 0}
              onClick={() => onPageChange(Math.max(0, safePage - 1))}
            >
              ‹ Trước
            </button>
            <span className="wp-pager-num">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="chip"
              disabled={safePage >= totalPages - 1}
              onClick={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
            >
              Sau ›
            </button>
          </div>
        )}

        <button type="button" className="btn-close" onClick={onClose}>
          ✕ Về bảng chờ
        </button>
      </header>

      <div className="dt-body" ref={scrollRef}>
        {!items.length ? (
          <p className="fl-empty">Chưa có vấn đề nào hoàn thành trong hôm nay</p>
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
                    <div className="nm" title={rec.supporter || 'Chưa phân công'}>
                      {rec.supporter || '–'}
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
                    <span className="tag st-done">
                      <i>✔</i>
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

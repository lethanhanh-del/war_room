import { formatClock, shortStreamName, WP_CONFIG } from './sheetService.js';
import { useAutoScroll } from '../lib/useAutoScroll.js';
import { IconCheckCircle, IconChevronLeft, IconChevronRight, IconHistory, IconX } from './Icons.jsx';

export default function ClearedPanel({ items, page, onPageChange, onClose }) {
  const pageSize = WP_CONFIG.CLEARED_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const scrollRef = useAutoScroll([safePage, pageItems.length]);

  return (
    <section className="panel detail wp-cleared-panel">
      <header className="dt-head wp-cl-head">
        <div className="dt-title">
          <span className="dt-kicker">Lịch sử xử lý hôm nay</span>
          <h2>
            Vừa hoàn thành
            <span className="dt-scope"> · {items.length} yêu cầu đã đóng</span>
          </h2>
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
              Trang {safePage + 1} / {totalPages}
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
      </header>

      <div className="dt-body" ref={scrollRef}>
        {!items.length ? (
          <div className="wp-cl-empty">
            <IconHistory className="wp-cl-empty-ico" />
            <p>Chưa có yêu cầu nào được xử lý hoàn tất trong hôm nay</p>
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

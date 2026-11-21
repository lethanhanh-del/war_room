// Theo dõi thay đổi người dùng sửa trực tiếp trên Google Sheet để ghi vào tab NhatKy.
// Cách làm: giữ "ảnh chụp" lần đọc trước (lưu file trong DATA_DIR), so sánh từng ô ở lần đọc sau.
import fs from 'node:fs';
import path from 'node:path';
import { WATCHED_TABS, labelOf } from './schema.js';

const IGNORED_FIELDS = new Set(['updatedAt', '_row']);
const MAX_ENTRIES_PER_DIFF = 200;

function rowKey(tab, row) {
  const keyField = WATCHED_TABS[tab];
  if (keyField && String(row[keyField] || '').trim()) return String(row[keyField]).trim();
  return `dòng ${row._row}`;
}

function rowLabel(tab, row) {
  return String(row.title || row.name || row.content || row.person || row.amount || '').slice(0, 80);
}

export class ChangeTracker {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'snapshot.json');
    try {
      this.snapshot = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.snapshot = null;
    }
  }

  get hasBaseline() {
    return Boolean(this.snapshot);
  }

  static capture(tables) {
    const snap = {};
    for (const tab of Object.keys(WATCHED_TABS)) {
      snap[tab] = {};
      for (const row of tables[tab] || []) {
        const fields = {};
        for (const [k, v] of Object.entries(row)) if (!IGNORED_FIELDS.has(k)) fields[k] = String(v ?? '').trim();
        snap[tab][rowKey(tab, row)] = { _row: row._row, ...fields };
      }
    }
    return snap;
  }

  /**
   * Trả về danh sách thay đổi kể từ ảnh chụp trước + các dòng MucTieu cần đóng dấu "Cập nhật lúc".
   */
  diff(tables) {
    const entries = [];
    const touchedTargetRows = new Set();
    if (!this.snapshot) return { entries, touchedTargetRows };
    const next = ChangeTracker.capture(tables);
    for (const tab of Object.keys(WATCHED_TABS)) {
      const prev = this.snapshot[tab] || {};
      const cur = next[tab] || {};
      for (const [key, row] of Object.entries(cur)) {
        const old = prev[key];
        if (!old) {
          entries.push({ tab, action: 'Thêm dòng', object: key, field: '', before: '', after: rowLabel(tab, row) });
          if (tab === 'MucTieu') touchedTargetRows.add(row._row);
          continue;
        }
        for (const [field, value] of Object.entries(row)) {
          if (field === '_row') continue;
          if ((old[field] ?? '') !== value) {
            entries.push({ tab, action: 'Cập nhật', object: key, field: labelOf(tab, field), before: old[field] ?? '', after: value });
            if (tab === 'MucTieu') touchedTargetRows.add(row._row);
          }
        }
      }
      for (const [key, row] of Object.entries(prev)) {
        if (!cur[key]) entries.push({ tab, action: 'Xoá dòng', object: key, field: '', before: rowLabel(tab, row), after: '' });
      }
    }
    return { entries: entries.slice(0, MAX_ENTRIES_PER_DIFF), touchedTargetRows, truncated: entries.length > MAX_ENTRIES_PER_DIFF };
  }

  rebaseline(tables) {
    this.snapshot = ChangeTracker.capture(tables);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.snapshot));
  }
}

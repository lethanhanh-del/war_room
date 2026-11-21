// Chế độ DEMO: dữ liệu mẫu trong bộ nhớ (mất khi khởi động lại). Dùng để chạy thử / trình diễn
// khi chưa cấu hình Google Sheet. Giao diện giống hệt SheetStore.
import { COLUMNS } from '../schema.js';
import { SEED } from '../seed.js';

export class DemoStore {
  constructor() {
    this.mode = 'demo';
    this.sheetUrl = '';
    this.tables = {};
    for (const tab of Object.keys(COLUMNS)) {
      this.tables[tab] = (SEED[tab] || []).map((row, i) => ({ ...row, _row: i + 2 }));
    }
    this.lastActivity = Date.now();
  }

  async readAll() {
    return {
      tables: structuredClone(this.tables),
      meta: { lastActivity: this.lastActivity, lastModifier: 'Chế độ demo' },
    };
  }

  async appendRows(tab, rows) {
    const list = this.tables[tab] || (this.tables[tab] = []);
    for (const r of rows) list.push({ ...r, _row: list.length + 2 });
    this.lastActivity = Date.now();
  }

  async updateRow(tab, rowNumber, patch) {
    const row = (this.tables[tab] || []).find((r) => r._row === rowNumber);
    if (!row) throw new Error(`Không tìm thấy dòng ${rowNumber} trong ${tab}`);
    Object.assign(row, patch);
    this.lastActivity = Date.now();
  }
}

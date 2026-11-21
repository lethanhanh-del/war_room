// Đọc/ghi Google Sheet "Sổ mục tiêu" bằng service account (Google Sheets API v4 + Drive API v3).
import { sheets as sheetsApi } from '@googleapis/sheets';
import { drive as driveApi } from '@googleapis/drive';
import { GoogleAuth } from 'google-auth-library';
import { COLUMNS, keyOfLabel } from '../schema.js';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

export function googleClients(credentialsFile) {
  const auth = new GoogleAuth({ keyFile: credentialsFile || undefined, scopes: SCOPES });
  return {
    auth,
    sheets: sheetsApi({ version: 'v4', auth }),
    drive: driveApi({ version: 'v3', auth }),
  };
}

export function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Chặn "formula injection": nội dung bắt đầu bằng = + - @ (vd. trích từ tài liệu hoặc do AI sinh ra)
 * sẽ được ghi như chữ, không bị Google Sheet chạy như công thức.
 */
export function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  const s = String(value);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

const quoteTab = (tab) => `'${tab.replace(/'/g, "''")}'`;

export class SheetStore {
  constructor({ spreadsheetId, credentialsFile }) {
    this.mode = 'sheets';
    this.spreadsheetId = spreadsheetId;
    this.sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    const { sheets, drive } = googleClients(credentialsFile);
    this.sheets = sheets;
    this.drive = drive;
    this.headers = {};
    this.existingTabs = null;
  }

  async listTabs(force = false) {
    if (this.existingTabs && !force) return this.existingTabs;
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties.title',
    });
    this.existingTabs = res.data.sheets.map((s) => s.properties.title);
    return this.existingTabs;
  }

  async readAll() {
    const existing = await this.listTabs();
    const tabs = Object.keys(COLUMNS).filter((t) => existing.includes(t));
    const missing = Object.keys(COLUMNS).filter((t) => !existing.includes(t));
    if (missing.length) {
      // Tab mới được tạo bằng tay? làm mới danh sách lần sau.
      this.existingTabs = null;
    }
    const res = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: this.spreadsheetId,
      ranges: tabs.map((t) => `${quoteTab(t)}!A1:AZ`),
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const tables = {};
    for (const t of Object.keys(COLUMNS)) tables[t] = [];
    (res.data.valueRanges || []).forEach((vr, i) => {
      const tab = tabs[i];
      const values = vr.values || [];
      const header = (values[0] || []).map((h) => String(h).trim());
      this.headers[tab] = header.length ? header : COLUMNS[tab].map(([, l]) => l);
      const keys = this.headers[tab].map((h) => keyOfLabel(tab, h));
      tables[tab] = values.slice(1).map((row, r) => {
        const obj = { _row: r + 2 };
        keys.forEach((k, c) => { if (k) obj[k] = row[c] ?? ''; });
        return obj;
      }).filter((obj) => Object.keys(obj).some((k) => k !== '_row' && String(obj[k]).trim() !== ''));
    });

    let meta = {};
    try {
      const f = await this.drive.files.get({
        fileId: this.spreadsheetId,
        fields: 'modifiedTime,lastModifyingUser(displayName,emailAddress)',
        supportsAllDrives: true,
      });
      meta = {
        lastActivity: Date.parse(f.data.modifiedTime) || null,
        lastModifier: f.data.lastModifyingUser?.displayName || f.data.lastModifyingUser?.emailAddress || '',
      };
    } catch {
      meta = {};
    }
    return { tables, meta };
  }

  headerFor(tab) {
    return this.headers[tab] && this.headers[tab].length ? this.headers[tab] : COLUMNS[tab].map(([, l]) => l);
  }

  async appendRows(tab, rows) {
    if (!rows.length) return;
    const header = this.headerFor(tab);
    const keys = header.map((h) => keyOfLabel(tab, h));
    const values = rows.map((r) => keys.map((k) => (k ? safeCell(r[k]) : '')));
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${quoteTab(tab)}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }

  async updateRow(tab, rowNumber, patch) {
    const header = this.headerFor(tab);
    const data = [];
    for (const [key, value] of Object.entries(patch)) {
      const col = header.findIndex((h) => keyOfLabel(tab, h) === key);
      if (col < 0) throw new Error(`Sheet ${tab} thiếu cột cho trường "${key}" — chạy lại npm run setup-sheet`);
      data.push({ range: `${quoteTab(tab)}!${columnLetter(col)}${rowNumber}`, values: [[safeCell(value)]] });
    }
    if (!data.length) return;
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
  }
}

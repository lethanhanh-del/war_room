// Lớp truy cập dữ liệu: dùng Google Sheet làm database.
// File trong thư mục api/_lib không bị Vercel biến thành endpoint (tiền tố "_").
import { randomUUID } from 'node:crypto';
import { JWT } from 'google-auth-library';
import { COLUMNS, rowToTask, taskToRow } from './schema.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const LAST_COL = String.fromCharCode('A'.charCodeAt(0) + COLUMNS.length - 1); // "I"

export class NotFoundError extends Error {
  constructor(message = 'Không tìm thấy task') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.status = 500;
  }
}

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function tabName() {
  return env('GOOGLE_SHEET_TAB', 'Tasks');
}

function a1(range) {
  // Bọc tên tab trong nháy đơn để hỗ trợ tên có khoảng trắng / ký tự đặc biệt.
  const tab = tabName().replace(/'/g, "''");
  return encodeURIComponent(`'${tab}'!${range}`);
}

let jwtClient;
function getClient() {
  if (jwtClient) return jwtClient;
  const email = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const rawKey = env('GOOGLE_PRIVATE_KEY');
  if (!email || !rawKey || !env('GOOGLE_SHEET_ID')) {
    throw new ConfigError(
      'Thiếu cấu hình GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY'
    );
  }
  // Trên Vercel, private key thường được lưu với "\n" dạng ký tự -> đổi về xuống dòng thật.
  const key = rawKey.replace(/\\n/g, '\n');
  jwtClient = new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return jwtClient;
}

// Chỉ dùng trong unit test: thay client thật bằng client giả lập.
export function __setClientForTest(client) {
  jwtClient = client;
}

async function gapi(path, { method = 'GET', data } = {}) {
  const client = getClient();
  const url = `${SHEETS_API}/${env('GOOGLE_SHEET_ID')}${path}`;
  try {
    const res = await client.request({ url, method, data });
    return res.data;
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.error?.message || err.message;
    const e = new Error(`Google Sheets API lỗi${status ? ` (${status})` : ''}: ${msg}`);
    e.status = 502;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Google Sheet repository
// ---------------------------------------------------------------------------
const sheetRepo = {
  async list() {
    const data = await gapi(`/values/${a1(`A2:${LAST_COL}`)}`);
    return (data.values || []).filter((r) => r[0]).map(rowToTask);
  },

  async create(input) {
    const now = new Date().toISOString();
    const task = { ...input, id: randomUUID(), created_at: now, updated_at: now };
    await gapi(
      `/values/${a1(`A:${LAST_COL}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', data: { values: [taskToRow(task)] } }
    );
    return task;
  },

  async findRow(id) {
    const data = await gapi(`/values/${a1('A:A')}`);
    const ids = (data.values || []).map((r) => r[0]);
    const idx = ids.indexOf(id);
    if (idx < 1) throw new NotFoundError(); // idx 0 là dòng header
    return idx + 1; // số dòng trên sheet (1-based)
  },

  async update(id, patch) {
    const rowNum = await this.findRow(id);
    const data = await gapi(`/values/${a1(`A${rowNum}:${LAST_COL}${rowNum}`)}`);
    const current = rowToTask((data.values || [])[0] || []);
    if (current.id !== id) throw new NotFoundError('Dữ liệu vừa thay đổi, vui lòng thử lại');
    const task = { ...current, ...patch, id, updated_at: new Date().toISOString() };
    await gapi(`/values/${a1(`A${rowNum}:${LAST_COL}${rowNum}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      data: { values: [taskToRow(task)] },
    });
    return task;
  },

  async remove(id) {
    const rowNum = await this.findRow(id);
    const meta = await gapi('?fields=sheets.properties(sheetId,title)');
    const sheet = (meta.sheets || []).find((s) => s.properties.title === tabName());
    if (!sheet) throw new ConfigError(`Không tìm thấy tab "${tabName()}" trong Google Sheet`);
    await gapi(':batchUpdate', {
      method: 'POST',
      data: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheet.properties.sheetId,
                dimension: 'ROWS',
                startIndex: rowNum - 1,
                endIndex: rowNum,
              },
            },
          },
        ],
      },
    });
    return { id };
  },
};

// ---------------------------------------------------------------------------
// Mock repository (chỉ dùng khi dev local với MOCK_SHEETS=true)
// ---------------------------------------------------------------------------
const mockStore = new Map();
function seedMock() {
  if (mockStore.size) return;
  const now = new Date().toISOString();
  const samples = [
    ['Chuẩn bị báo cáo tuần', 'Tổng hợp tiến độ các dự án', 'An', 'In Progress', 'High', 3],
    ['Fix lỗi đăng nhập SSO', 'User không đăng nhập được bằng tài khoản AD', 'Bình', 'Blocked', 'Critical', 1],
    ['Review thiết kế dashboard', '', 'Chi', 'Todo', 'Medium', 7],
    ['Setup môi trường staging', '', 'Dũng', 'Done', 'Low', -2],
  ];
  for (const [title, description, assignee, status, priority, days] of samples) {
    const due = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const id = randomUUID();
    mockStore.set(id, { id, title, description, assignee, status, priority, due_date: due, created_at: now, updated_at: now });
  }
}

const mockRepo = {
  async list() {
    seedMock();
    return [...mockStore.values()];
  },
  async create(input) {
    const now = new Date().toISOString();
    const task = { ...input, id: randomUUID(), created_at: now, updated_at: now };
    mockStore.set(task.id, task);
    return task;
  },
  async update(id, patch) {
    const cur = mockStore.get(id);
    if (!cur) throw new NotFoundError();
    const task = { ...cur, ...patch, id, updated_at: new Date().toISOString() };
    mockStore.set(id, task);
    return task;
  },
  async remove(id) {
    if (!mockStore.delete(id)) throw new NotFoundError();
    return { id };
  },
};

export function getRepo() {
  return env('MOCK_SHEETS') === 'true' ? mockRepo : sheetRepo;
}

export function isMock() {
  return env('MOCK_SHEETS') === 'true';
}

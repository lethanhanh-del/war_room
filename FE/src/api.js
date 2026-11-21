// Client gọi API /api/* (cùng domain trên Vercel, proxy qua Vite khi dev).
const KEY_STORAGE = 'war_room_access_key';

export const STATUSES = ['Todo', 'In Progress', 'Blocked', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

export const STATUS_LABEL = {
  Todo: 'Cần làm',
  'In Progress': 'Đang làm',
  Blocked: 'Bị chặn',
  Done: 'Hoàn thành',
};
export const PRIORITY_LABEL = {
  Low: 'Thấp',
  Medium: 'Trung bình',
  High: 'Cao',
  Critical: 'Khẩn cấp',
};

export function getAccessKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}
export function setAccessKey(v) {
  try {
    if (v) localStorage.setItem(KEY_STORAGE, v);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* bỏ qua */
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const key = getAccessKey();
  if (key) headers['x-access-key'] = key;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* response rỗng */
  }
  if (!res.ok) throw new ApiError(json.error || `Lỗi ${res.status}`, res.status);
  return json;
}

export const api = {
  health: () => request('/health'),
  list: () => request('/tasks').then((r) => r.data),
  create: (task) => request('/tasks', { method: 'POST', body: task }).then((r) => r.data),
  update: (id, patch) =>
    request(`/tasks?id=${encodeURIComponent(id)}`, { method: 'PUT', body: patch }).then((r) => r.data),
  remove: (id) => request(`/tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export function isOverdue(task) {
  if (!task.due_date || task.status === 'Done') return false;
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return task.due_date < t;
}

export function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

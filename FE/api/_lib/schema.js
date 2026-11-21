// Định nghĩa cấu trúc bảng Task trong Google Sheet.
// Thứ tự cột trong COLUMNS chính là thứ tự cột A..I trên sheet.
export const COLUMNS = [
  'id',
  'title',
  'description',
  'assignee',
  'status',
  'priority',
  'due_date',
  'created_at',
  'updated_at',
];

export const STATUSES = ['Todo', 'In Progress', 'Blocked', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const MAX_LEN = {
  title: 200,
  description: 5000,
  assignee: 100,
};

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

/**
 * Kiểm tra & chuẩn hoá dữ liệu task từ client.
 * @param {object} input dữ liệu từ request body
 * @param {{ partial?: boolean }} opts partial=true khi cập nhật (không bắt buộc đủ trường)
 * @returns {object} chỉ gồm các trường hợp lệ, đã trim
 */
export function validateTask(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Body phải là JSON object');
  }
  const out = {};

  for (const key of ['title', 'description', 'assignee']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new ValidationError(`${key} phải là chuỗi`);
    const v = input[key].trim();
    if (v.length > MAX_LEN[key]) throw new ValidationError(`${key} tối đa ${MAX_LEN[key]} ký tự`);
    out[key] = v;
  }

  if (!partial && !out.title) throw new ValidationError('title là bắt buộc');
  if (partial && out.title === '') throw new ValidationError('title không được để trống');

  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) {
      throw new ValidationError(`status phải là một trong: ${STATUSES.join(', ')}`);
    }
    out.status = input.status;
  }
  if (input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority)) {
      throw new ValidationError(`priority phải là một trong: ${PRIORITIES.join(', ')}`);
    }
    out.priority = input.priority;
  }
  if (input.due_date !== undefined && input.due_date !== '') {
    if (typeof input.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) {
      throw new ValidationError('due_date phải có dạng YYYY-MM-DD');
    }
    const d = new Date(`${input.due_date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.due_date) {
      throw new ValidationError('due_date không hợp lệ');
    }
    out.due_date = input.due_date;
  } else if (input.due_date === '') {
    out.due_date = '';
  }

  if (!partial) {
    out.description ??= '';
    out.assignee ??= '';
    out.status ??= 'Todo';
    out.priority ??= 'Medium';
    out.due_date ??= '';
  }
  return out;
}

export function rowToTask(row) {
  const task = {};
  COLUMNS.forEach((col, i) => {
    task[col] = row[i] ?? '';
  });
  return task;
}

export function taskToRow(task) {
  return COLUMNS.map((col) => task[col] ?? '');
}

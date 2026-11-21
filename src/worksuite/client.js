// Gọi REST API của CT Worksuite (Frappe) bằng 1 tài khoản chỉ cần quyền ĐỌC Project, Task, Employee.
// Chỉ dùng fetch nên chạy được trên Cloudflare Worker và Node ≥ 18.
//
// Hai cách xác thực (ưu tiên API key nếu có cả hai):
//   1. API key:  Authorization: token {api_key}:{api_secret}
//   2. Tài khoản: POST /api/method/login {usr, pwd} -> cookie "sid", dùng lại cho các lần gọi sau;
//      phiên hết hạn thì tự đăng nhập lại 1 lần. Sai mật khẩu -> ngừng thử 10 phút để không khoá tài khoản.
//
//   GET {origin}/api/resource/{DocType}?fields=[…]&filters=[…]&limit_page_length=0

export class WorksuiteError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'WorksuiteError';
    this.status = status;
  }
}

const LOGIN_BLOCK_MS = 10 * 60 * 1000;
const sessions = new Map(); // `${origin}|${username}` -> sid
const loginBlocks = new Map(); // `${origin}|${username}` -> { until, message }

/** Xoá phiên đăng nhập đã lưu (dùng trong test). */
export function resetWorksuiteSessions() {
  sessions.clear();
  loginBlocks.clear();
}

/** Lấy thông báo lỗi dễ đọc từ phản hồi Frappe (không kèm traceback). */
function frappeMessage(body, status) {
  try {
    const j = JSON.parse(body);
    if (j._server_messages) {
      const msgs = JSON.parse(j._server_messages).map((m) => {
        try { return JSON.parse(m).message; } catch { return m; }
      });
      return msgs.join(' ').replace(/<[^>]+>/g, '').slice(0, 300);
    }
    if (j.message && typeof j.message === 'string') return j.message.replace(/<[^>]+>/g, '').slice(0, 300);
    if (j.exception) return String(j.exception).replace(/^[\w.]+:\s*/, '').replace(/<[^>]+>/g, '').slice(0, 300);
    if (j.exc_type) return String(j.exc_type).slice(0, 300);
  } catch { /* không phải JSON */ }
  return `HTTP ${status}`;
}

const isFieldError = (msg) => /field not permitted|not permitted in query|không được phép trong truy vấn|unknown column|invalid field|is not a valid field|cannot use sub-query/i.test(msg);

function readSid(headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  for (const c of list) {
    const m = /(?:^|[,;\s])sid=([^;,\s]+)/.exec(c);
    if (m && m[1] && m[1] !== 'Guest') return m[1];
  }
  return '';
}

export class WorksuiteClient {
  constructor({ baseUrl, apiKey, apiSecret, username, password, fetch: fetchImpl, timeoutMs = 20000 }) {
    if (!baseUrl) throw new Error('Thiếu WORKSUITE_URL');
    this.origin = new URL(baseUrl).origin;
    if (apiKey && apiSecret) {
      this.mode = 'token';
      this.auth = `token ${apiKey}:${apiSecret}`;
    } else if (username && password) {
      this.mode = 'password';
      this.username = username;
      this.password = password;
      this.sessionKey = `${this.origin}|${String(username).toLowerCase()}`;
    } else {
      throw new Error('Thiếu thông tin đăng nhập Worksuite (API key/secret hoặc tài khoản/mật khẩu)');
    }
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.timeoutMs = timeoutMs;
  }

  async send(url, init) {
    try {
      return await this.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs), ...init });
    } catch (e) {
      throw new WorksuiteError(e?.name === 'TimeoutError' ? 'Worksuite không phản hồi (quá thời gian chờ)' : `Không kết nối được Worksuite: ${e?.message || e}`, 0);
    }
  }

  async login() {
    const block = loginBlocks.get(this.sessionKey);
    if (block && block.until > Date.now()) throw new WorksuiteError(block.message, 401);
    const res = await this.send(`${this.origin}/api/method/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ usr: this.username, pwd: this.password }),
    });
    const body = await res.text();
    let fail = '';
    let j = {};
    try { j = JSON.parse(body); } catch { /* bỏ qua */ }
    if (!res.ok) fail = frappeMessage(body, res.status);
    else if (j.verification || j.tmp_id) fail = 'Tài khoản đang bật xác thực 2 lớp (OTP) — dùng tài khoản khác hoặc API key';
    const sid = fail ? '' : readSid(res.headers);
    if (!fail && !sid) fail = 'Worksuite không trả về phiên đăng nhập';
    if (fail) {
      const message = `Đăng nhập Worksuite thất bại: ${fail}. Tạm ngừng thử lại 10 phút để tránh khoá tài khoản — kiểm tra WORKSUITE_USERNAME / WORKSUITE_PASSWORD.`;
      loginBlocks.set(this.sessionKey, { until: Date.now() + LOGIN_BLOCK_MS, message });
      throw new WorksuiteError(message, res.status || 401);
    }
    loginBlocks.delete(this.sessionKey);
    sessions.set(this.sessionKey, sid);
    return sid;
  }

  async get(path, params = {}) {
    const url = new URL(path, this.origin);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    for (let attempt = 0; ; attempt++) {
      const headers = { Accept: 'application/json' };
      let reused = false;
      if (this.mode === 'token') {
        headers.Authorization = this.auth;
      } else {
        let sid = sessions.get(this.sessionKey);
        reused = Boolean(sid);
        if (!sid) sid = await this.login();
        headers.Cookie = `sid=${sid}`;
      }
      const res = await this.send(url.toString(), { method: 'GET', headers });
      const body = await res.text();
      // Phiên cũ hết hạn -> Frappe coi là khách (401/403): đăng nhập lại đúng 1 lần.
      if (this.mode === 'password' && reused && attempt === 0 && (res.status === 401 || res.status === 403)) {
        sessions.delete(this.sessionKey);
        continue;
      }
      if (!res.ok) {
        const msg = res.status === 401 || res.status === 403
          ? `Worksuite từ chối quyền truy cập (${res.status}): ${frappeMessage(body, res.status)}`
          : frappeMessage(body, res.status);
        throw new WorksuiteError(msg, res.status);
      }
      try {
        return JSON.parse(body);
      } catch {
        throw new WorksuiteError('Worksuite trả về dữ liệu không phải JSON — kiểm tra lại WORKSUITE_URL', res.status);
      }
    }
  }

  /**
   * Đọc danh sách 1 DocType. Nếu 1 trường tuỳ biến (custom_*) không tồn tại / không được phép,
   * bỏ đúng trường đó rồi thử lại, và ghi vào `missing`.
   */
  async list(doctype, { fields, filters, limit = 0, orderBy } = {}) {
    let current = [...(fields || [])];
    const missing = [];
    for (;;) {
      try {
        const j = await this.get(`/api/resource/${encodeURIComponent(doctype)}`, {
          fields: current,
          filters: filters && filters.length ? filters : undefined,
          limit_page_length: String(limit),
          order_by: orderBy,
        });
        return { rows: j.data || [], missing };
      } catch (e) {
        const custom = current.filter((f) => f.startsWith('custom_'));
        if (!(e instanceof WorksuiteError) || !custom.length || !isFieldError(e.message)) throw e;
        const named = custom.filter((f) => new RegExp(`\\b${f}\\b`).test(e.message));
        const drop = named.length ? named : custom;
        current = current.filter((f) => !drop.includes(f));
        missing.push(...drop);
      }
    }
  }
}

const TASK_FIELDS = [
  'name', 'subject', 'status', 'progress', 'exp_end_date', 'completed_on', 'parent_task', 'is_group',
  'creation', 'modified', 'custom_assignee', 'custom_assignee_name', 'custom_blocker_reason',
];
const OPTIONAL_FIELDS = new Set(['custom_blocker_reason']);
const EMPLOYEE_FIELDS = ['name', 'employee_name', 'designation', 'department', 'user_id'];

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Lấy dự án War Room + toàn bộ task (trừ Cancelled) + hồ sơ nhân sự của người được giao.
 * project: mã dự án (vd PROJ-0536). Bỏ trống -> tự tìm dự án tên "WAR ROOM" đang chạy, sửa gần nhất.
 */
export async function fetchWorksuiteRaw(client, { project } = {}) {
  const fields = ['name', 'project_name', 'status', 'modified'];
  const found = project
    ? await client.list('Project', { fields, filters: [['name', '=', project]], limit: 1 })
    : await client.list('Project', {
      fields,
      filters: [['project_name', 'like', '%war%room%'], ['status', 'not in', ['Cancelled', 'Completed']]],
      limit: 10,
      orderBy: 'modified desc',
    });
  const proj = found.rows[0];
  if (!proj) {
    throw new WorksuiteError(project
      ? `Không thấy dự án ${project} trên Worksuite (hoặc tài khoản không có quyền xem).`
      : 'Không thấy dự án tên "WAR ROOM" đang chạy trên Worksuite — đặt WORKSUITE_PROJECT=<mã dự án>.', 404);
  }

  const tasks = await client.list('Task', {
    fields: TASK_FIELDS,
    filters: [['project', '=', proj.name], ['status', '!=', 'Cancelled']],
    limit: 0,
    orderBy: 'creation asc',
  });
  const warnings = tasks.missing.filter((f) => !OPTIONAL_FIELDS.has(f)).map((f) => `Task trên Worksuite không có trường ${f}`);

  const empIds = [...new Set(tasks.rows.map((t) => t.custom_assignee).filter(Boolean))];
  const employees = [];
  for (const ids of chunks(empIds, 40)) {
    const r = await client.list('Employee', { fields: EMPLOYEE_FIELDS, filters: [['name', 'in', ids]], limit: 0 });
    employees.push(...r.rows);
  }
  return { project: proj, tasks: tasks.rows, employees, warnings };
}

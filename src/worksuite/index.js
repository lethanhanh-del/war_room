// Dữ liệu cho dashboard "Tiến độ dòng tiền": đọc Worksuite (có cache), hoặc dữ liệu mẫu khi ?demo=1.
// Dùng chung cho Cloudflare Worker (env) và Express (process.env).
//
// Biến cấu hình:
//   WORKSUITE_URL            https://cterp.ctgrouphitech.com/worksuite
//   WORKSUITE_API_KEY        API key của tài khoản chỉ đọc (User > Settings > API Access)
//   WORKSUITE_API_SECRET     API secret tương ứng — đặt là secret, không commit
//   WORKSUITE_USERNAME       (khi chưa có API key) email/tài khoản Worksuite chỉ có quyền xem
//   WORKSUITE_PASSWORD       mật khẩu tài khoản đó — đặt là secret, không commit
//   WORKSUITE_PROJECT        (tuỳ chọn) mã dự án War Room, vd PROJ-0536. Bỏ trống: tự tìm dự án tên "WAR ROOM"
//                            Dòng tiền = task nhóm cấp cao nhất có tiêu đề "Dòng tiền …" trong dự án đó.
//   WORKSUITE_CACHE_SECONDS  (tuỳ chọn, mặc định 60) giữ kết quả bao lâu trước khi đọc lại Worksuite

import { buildStreamsModel } from './model.js';
import { WorksuiteClient, fetchWorksuiteRaw } from './client.js';
import { DEMO_NOW, demoRaw } from './demo.js';

const DEFAULT_URL = 'https://cterp.ctgrouphitech.com/worksuite';

export function worksuiteConfig(env = {}) {
  const url = String(env.WORKSUITE_URL || '').trim() || DEFAULT_URL;
  const cacheSeconds = Math.max(15, Number.parseInt(env.WORKSUITE_CACHE_SECONDS, 10) || 60);
  const project = String(env.WORKSUITE_PROJECT || '').trim();
  const apiKey = String(env.WORKSUITE_API_KEY || '').trim();
  const apiSecret = String(env.WORKSUITE_API_SECRET || '').trim();
  const username = String(env.WORKSUITE_USERNAME || '').trim();
  const password = String(env.WORKSUITE_PASSWORD || '');
  const auth = apiKey && apiSecret ? 'token' : username && password ? 'password' : '';
  return { url, apiKey, apiSecret, username, password, auth, project, cacheSeconds, configured: Boolean(auth) };
}

let cache = null; // { key, at, data }
let inflight = null; // { key, promise }

export function resetStreamsCache() {
  cache = null;
  inflight = null;
}

/**
 * @param env  biến môi trường (Worker env hoặc process.env)
 * @param opts { demo?: boolean, fetch?: Function, now?: number, force?: boolean }
 */
export async function getStreams(env, opts = {}) {
  const cfg = worksuiteConfig(env);
  const base = { worksuiteUrl: cfg.url, refreshSeconds: cfg.cacheSeconds };

  if (opts.demo) {
    const now = DEMO_NOW;
    return { mode: 'demo', ...base, syncedAt: now, now, warnings: [], ...buildStreamsModel(demoRaw(), { now, worksuiteUrl: '' }) };
  }
  if (!cfg.configured) {
    return { mode: 'unconfigured', ...base, syncedAt: null, now: Date.now(), warnings: [], project: null, summary: null, streams: [], otherGroups: [] };
  }

  const key = `${cfg.url}|${cfg.auth}|${cfg.apiKey || cfg.username}|${cfg.project}`;
  const now = opts.now ?? Date.now();
  if (!opts.force && cache && cache.key === key && now - cache.at < cfg.cacheSeconds * 1000) return cache.data;
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = (async () => {
    await null; // để `inflight` được gán trước khi khối finally bên dưới chạy
    try {
      const client = new WorksuiteClient({
        baseUrl: cfg.url,
        apiKey: cfg.auth === 'token' ? cfg.apiKey : '',
        apiSecret: cfg.auth === 'token' ? cfg.apiSecret : '',
        username: cfg.username,
        password: cfg.password,
        fetch: opts.fetch,
      });
      const raw = await fetchWorksuiteRaw(client, { project: cfg.project });
      const at = opts.now ?? Date.now();
      const model = buildStreamsModel(raw, { now: at, worksuiteUrl: cfg.url });
      const warnings = [...raw.warnings];
      if (!model.streams.length) {
        warnings.push(`Dự án ${model.project?.name || ''} chưa có task nhóm nào có tiêu đề bắt đầu bằng "Dòng tiền".`);
      }
      const data = { mode: 'live', ...base, syncedAt: at, now: at, warnings, ...model };
      cache = { key, at, data };
      return data;
    } catch (e) {
      const message = e?.message || String(e);
      if (cache && cache.key === key) return { ...cache.data, stale: true, error: message };
      return { mode: 'live', ...base, syncedAt: null, now, warnings: [], error: message, project: null, summary: null, streams: [], otherGroups: [] };
    } finally {
      inflight = null;
    }
  })();
  inflight = { key, promise };
  return promise;
}

import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { DemoStore } from './store/demo.js';
import { SheetStore } from './store/sheets.js';
import { WarRoomService, HttpError } from './service.js';
import { emptyWaitingPointState, mergeWaitingPointState } from './waiting-point-sync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(config.dataDir, { recursive: true });

// ---------------------------------------------------------------- khởi tạo nguồn dữ liệu
let store;
let drive = null;
if (config.dataSource === 'sheets') {
  if (!config.spreadsheetId) throw new Error('Thiếu SPREADSHEET_ID cho DATA_SOURCE=sheets');
  store = new SheetStore({ spreadsheetId: config.spreadsheetId, credentialsFile: config.googleCredentials });
  drive = store.drive;
} else {
  store = new DemoStore();
}
const service = new WarRoomService({ store, drive, config });

// ---------------------------------------------------------------- bảo vệ
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

function basicAuth(req, res, next) {
  if (!config.basicAuthUser || !config.basicAuthPass || req.path === '/healthz') return next();
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (safeEqual(user, config.basicAuthUser) && safeEqual(rest.join(':'), config.basicAuthPass)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="War Room", charset="UTF-8"').status(401).send('Cần đăng nhập');
}

function operator(req, res, next) {
  if (!config.operatorPin) return next(new HttpError(403, 'Chưa bật quyền người vận hành (thiếu OPERATOR_PIN)'));
  const pin = req.get('x-operator-pin') || '';
  if (!safeEqual(pin, config.operatorPin)) return next(new HttpError(401, 'Mã PIN người vận hành không đúng'));
  let name = '';
  try {
    name = decodeURIComponent(req.get('x-operator-name') || '').trim();
  } catch {
    name = '';
  }
  if (!name) return next(new HttpError(400, 'Cần nhập tên người thao tác'));
  req.actor = name.slice(0, 80);
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((data) => res.json(data)).catch(next);

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
// Bảng War Room cũ (public/war-room.html) là file HTML độc lập có script nội tuyến.
const LEGACY_PAGES = new Set(['/war-room', '/war-room.html']);
const WP_PAGES = new Set(['/waiting-point', '/waiting-point.html']);
app.use((req, res, next) => {
  const scriptSrc = LEGACY_PAGES.has(req.path) ? "; script-src 'self' 'unsafe-inline'" : '';
  const connectSrc = WP_PAGES.has(req.path)
    ? "connect-src 'self' https://docs.google.com https://*.googleusercontent.com"
    : "connect-src 'self'";
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; ${connectSrc}${scriptSrc}`,
  });
  next();
});
app.use(basicAuth);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(here, '..', 'public'), { index: 'index.html', extensions: ['html'], maxAge: '5m' }));

app.get('/healthz', (req, res) => {
  res.status(service.model ? 200 : 503).json({
    ok: Boolean(service.model), mode: store.mode, lastRefreshAt: service.lastRefreshAt, lastError: service.lastError,
  });
});

// Tiến độ dòng tiền: không kết nối CT Worksuite nữa; dashboard chạy trên Worker (Google Sheet WR - MASTER TASK).
app.get('/api/streams', (req, res) => {
  res.set('Cache-Control', 'no-store').status(410).json({ error: 'Không còn kết nối CT Worksuite. Dashboard "Tiến độ dòng tiền" chạy trên Worker, đọc Google Sheet WR - MASTER TASK.', streams: [] });
});

app.get('/api/dashboard', (req, res) => {
  if (!service.model) return res.status(503).json({ error: service.lastError || 'Đang tải dữ liệu, thử lại sau vài giây' });
  res.json(service.getDashboard());
});

const wpStateFile = path.join(config.dataDir, 'waiting-point-state.json');
function readWpState() {
  try {
    if (fs.existsSync(wpStateFile)) {
      return mergeWaitingPointState(JSON.parse(fs.readFileSync(wpStateFile, 'utf8')), {}, Date.now());
    }
  } catch {}
  return emptyWaitingPointState();
}
app.get('/api/waiting-point', (req, res) => {
  res.set('Cache-Control', 'no-store').json(readWpState());
});
app.post('/api/waiting-point', (req, res) => {
  const next = mergeWaitingPointState(readWpState(), req.body && typeof req.body === 'object' ? req.body : {});
  try { fs.writeFileSync(wpStateFile, JSON.stringify(next), 'utf8'); } catch {}
  res.set('Cache-Control', 'no-store').json(next);
});

app.post('/api/operator/check', operator, (req, res) => res.json({ ok: true, actor: req.actor }));

app.post('/api/targets', operator, wrap((req) => service.addTarget(req.body || {}, req.actor)));
app.patch('/api/targets/:id', operator, wrap((req) => service.updateTarget(req.params.id, req.body || {}, req.actor)));
app.post('/api/targets/:id/remove', operator, wrap((req) => service.removeTarget(req.params.id, req.body?.reason, req.actor)));
app.post('/api/targets/:id/restore', operator, wrap((req) => service.restoreTarget(req.params.id, req.actor)));

app.post('/api/decisions', operator, wrap((req) => service.addDecision(req.body || {}, req.actor)));
app.post('/api/decisions/:id/resolve', operator, wrap((req) => service.resolveDecision(req.params.id, req.body || {}, req.actor)));

app.post('/api/proposals/:id/approve', operator, wrap((req) => service.approveProposal(req.params.id, req.actor)));
app.post('/api/proposals/:id/reject', operator, wrap((req) => service.rejectProposal(req.params.id, req.actor, req.body?.reason)));

app.post('/api/scan', operator, wrap((req) => service.runScan('Thủ công', req.actor)));
app.post('/api/report', operator, wrap((req) => service.generateReport('Thủ công', req.actor)));

app.use('/api', (req, res) => res.status(404).json({ error: 'Không có API này' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : err.type === 'entity.parse.failed' ? 400 : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? `Lỗi hệ thống: ${err.message}` : err.message });
});

// ---------------------------------------------------------------- chạy
async function boot() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await service.refresh();
      break;
    } catch (err) {
      console.error(`Lần đọc đầu thất bại (${attempt}/3):`, err.message);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  service.start();
  const server = app.listen(config.port, () => {
    console.log(`War Room dashboard: http://localhost:${config.port}  (nguồn dữ liệu: ${store.mode}${service.ai.enabled ? ', AI bật' : ', AI tắt'})`);
  });
  const shutdown = () => {
    service.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

boot();

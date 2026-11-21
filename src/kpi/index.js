// Trang "KPI & kết quả" (/kpi): đồng bộ Google Sheet KPI (sheet.js) vào D1 và trả về cho trình duyệt.
//
//   GET  /api/kpi        dữ liệu KPI (đọc lại sheet chạy nền nếu lần trước đã quá KPI_SYNC_EVERY_MS)
//   POST /api/kpi/sync   đọc lại sheet ngay
//
// Cron mỗi phút cũng gọi syncKpi (src/index.js). Sheet đổi -> báo các màn hình tải lại (WebSocket, scope "kpi").
// Trạng thái Đạt / Không đạt / Chưa cập nhật / Sắp tới tính ở trình duyệt theo ngày hôm nay (public/kpi-model.js).
// PIC nhóm lấy theo Đội trưởng trong file phân chia nhiệm vụ (bảng excel_teams); người thực hiện là cột PIC của từng dòng.
//
// Biến cấu hình (tuỳ chọn): KPI_SHEET_URL = link hoặc ID Google Sheet KPI (mặc định: thamkhao_kpi); "off" để tắt.

import { json } from '../http.js';
import { notifyLive } from '../live.js';
import { fetchSheetTabs } from '../excel/gsheet.js';
import { listImports, listTeams } from '../excel/index.js';
import { normKey } from '../worksuite/model.js';
import { parseKpiBook } from './sheet.js';

const DEFAULT_KPI_SHEET = '1vjhwDkU2-pdktEqGvqWHy2Op86cpjq8JAFVv5e1GjHg'; // thamkhao_kpi
export const KPI_SYNC_EVERY_MS = 20000;
const FORCE_EVERY_MS = 5000;

/** ID Google Sheet KPI; '' = tắt. */
export function kpiSheetId(env = {}) {
  const value = String(env.KPI_SHEET_URL ?? '').trim();
  if (!value) return DEFAULT_KPI_SHEET;
  if (/^(off|false|0|none)$/i.test(value)) return '';
  const m = /\/spreadsheets\/d\/([\w-]{20,})/.exec(value) || /^([\w-]{20,})$/.exec(value);
  return m ? m[1] : '';
}

let ready = false;
async function ensureTable(env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS kpi_sheet (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      checked_at TEXT NOT NULL DEFAULT '',
      changed_at TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      warnings TEXT NOT NULL DEFAULT '[]',
      data TEXT NOT NULL DEFAULT ''
    )`
  ).run();
  ready = true;
}

/** Giành lượt đọc sheet: tối đa 1 lượt mỗi minGapMs, kể cả khi cron và nhiều người xem gọi cùng lúc. */
async function claim(env, minGapMs, now) {
  const { meta } = await env.DB.prepare(
    `INSERT INTO kpi_sheet (id, checked_at) VALUES (1, ?1)
     ON CONFLICT(id) DO UPDATE SET checked_at = ?1 WHERE kpi_sheet.checked_at < ?2`
  ).bind(new Date(now).toISOString(), new Date(now - minGapMs).toISOString()).run();
  return meta.changes > 0;
}

const errText = (e) => String(e?.name === 'TimeoutError' ? 'Google Sheet KPI không phản hồi (quá 15 giây).' : e?.message || e).slice(0, 300);
const yearOf = (env) => Number(String(env.WARROOM_START || '').slice(0, 4)) || new Date().getUTCFullYear();

/** Đọc sheet KPI, lưu nếu khác lần trước. */
export async function syncKpi(env, { force = false, now = Date.now() } = {}) {
  const id = kpiSheetId(env);
  if (!id) return { off: true };
  await ensureTable(env);
  if (!(await claim(env, force ? FORCE_EVERY_MS : KPI_SYNC_EVERY_MS, now))) return { skipped: true };
  try {
    const book = parseKpiBook(await fetchSheetTabs(id), { year: yearOf(env) });
    const data = JSON.stringify(book.streams);
    const warnings = JSON.stringify(book.warnings.slice(0, 20).map((w) => String(w).slice(0, 300)));
    const prev = await env.DB.prepare('SELECT data FROM kpi_sheet WHERE id = 1').first();
    const changed = !prev || prev.data !== data;
    if (changed) {
      await env.DB.prepare("UPDATE kpi_sheet SET error = '', warnings = ?, data = ?, changed_at = ? WHERE id = 1")
        .bind(warnings, data, new Date(now).toISOString()).run();
      await notifyLive(env, { scope: 'kpi' });
    } else {
      await env.DB.prepare("UPDATE kpi_sheet SET error = '', warnings = ? WHERE id = 1").bind(warnings).run();
    }
    return { changed, streams: book.streams.length };
  } catch (e) {
    const error = errText(e);
    await env.DB.prepare('UPDATE kpi_sheet SET error = ? WHERE id = 1').bind(error).run().catch(() => {});
    return { error };
  }
}

const loose = (s) => normKey(s).replace(/[^a-z0-9]+/g, '');
/** Tên dòng tiền để so khớp: bỏ chữ "Dòng tiền" / "Nhóm" ở đầu, dấu câu và khoảng trắng. */
const streamKey = (s) => loose(normKey(s).replace(/^(dong tien|nhom)\s*[:\-–]?\s*/, ''));

/** Tìm dòng tiền theo tên: trùng hẳn, hoặc 1 tên là phần đầu của tên kia và chỉ có 1 kết quả như vậy. */
function byName(list, name, get) {
  const n = streamKey(name);
  if (!n) return null;
  const exact = list.find((x) => streamKey(get(x)) === n);
  if (exact) return exact;
  const prefix = list.filter((x) => { const k = streamKey(get(x)); return k && (k.startsWith(n) || n.startsWith(k)); });
  return prefix.length === 1 ? prefix[0] : null;
}

/**
 * Gắn mã dòng tiền (DT01… từ sheet task), PIC dòng tiền và PIC / người thực hiện của từng nhóm.
 * PIC nhóm: Đội trưởng của nhóm (file phân chia nhiệm vụ) có thành viên trùng người trong nhóm, hoặc nhóm cùng tên
 * nhiệm vụ chính, hoặc nhóm duy nhất của dòng tiền; không có thì là người ở dòng đầu tiên.
 */
export function attachPeople(streams, teams = [], imports = []) {
  return streams.map((s, si) => {
    const team = byName(teams, s.name, (t) => t.name);
    const imp = byName(imports, s.name, (i) => i.name);
    const tgroups = team?.groups || [];
    const groups = s.groups.map((g, gi) => {
      const persons = [...new Set(g.rows.map((r) => r.person).filter(Boolean))];
      let tg = tgroups.find((t) => (t.members || []).some((m) => !m.placeholder && persons.some((p) => loose(p) === loose(m.name))));
      if (!tg) tg = tgroups.find((t) => t.mainTask && loose(t.mainTask) === loose(g.name));
      if (!tg && tgroups.length === 1) tg = tgroups[0];
      const lead = tg?.lead && !tg.lead.placeholder ? { name: tg.lead.name, title: tg.lead.title || '' } : null;
      const pic = lead || (persons[0] ? { name: persons[0], title: '' } : null);
      return {
        key: loose(g.name) || `nhom${gi}`,
        name: g.name,
        pic,
        members: persons.filter((p) => !pic || loose(p) !== loose(pic.name)),
        rows: g.rows,
      };
    });
    return {
      key: loose(s.name) || `dongtien${si}`,
      name: s.name,
      sheet: s.sheet,
      code: imp?.code || '',
      pic: s.pic || imp?.pic || tgroups[0]?.lead?.name || '',
      days: s.days,
      groups,
    };
  });
}

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam. */
export const vnDate = (now) => new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** Dữ liệu cho trang /kpi. */
export async function kpiData(env, now = Date.now()) {
  const id = kpiSheetId(env);
  await ensureTable(env);
  const r = await env.DB.prepare('SELECT checked_at, changed_at, error, warnings, data FROM kpi_sheet WHERE id = 1').first();
  let streams = [];
  let warnings = [];
  try { streams = r?.data ? JSON.parse(r.data) : []; } catch { /* dữ liệu hỏng: coi như chưa có */ }
  try { warnings = JSON.parse(r?.warnings || '[]'); } catch { /* bỏ qua */ }
  const [teams, imports] = await Promise.all([listTeams(env).catch(() => []), listImports(env, { withTasks: false }).catch(() => [])]);
  const out = attachPeople(streams, teams, imports);
  const days = new Map();
  for (const s of out) for (const d of s.days) days.set(d.date, d);
  return {
    source: {
      off: !id,
      sheetUrl: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '',
      checkedAt: r?.checked_at || '',
      changedAt: r?.changed_at || '',
      error: r?.error || '',
      warnings,
    },
    now,
    today: vnDate(now),
    days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    streams: out,
  };
}

export async function handleKpi(request, env, url, ctx) {
  if (url.pathname === '/api/kpi/sync') {
    if (request.method !== 'POST') return json({ error: 'Chỉ hỗ trợ POST.' }, 405);
    const r = await syncKpi(env, { force: true });
    if (r.off) return json({ error: 'Đồng bộ Google Sheet KPI đang tắt (KPI_SHEET_URL=off).' }, 400);
    return json(r, r.error ? 502 : 200);
  }
  if (request.method !== 'GET') return json({ error: 'Chỉ hỗ trợ GET.' }, 405);
  await ensureTable(env);
  const has = await env.DB.prepare("SELECT 1 AS ok FROM kpi_sheet WHERE id = 1 AND data <> ''").first();
  // Lần đầu (database mới, chưa đọc sheet lần nào): đọc luôn rồi mới trả; các lần sau đọc lại chạy nền.
  if (!has) await syncKpi(env, { force: true });
  else ctx.waitUntil(syncKpi(env).catch(() => {}));
  return json(await kpiData(env));
}

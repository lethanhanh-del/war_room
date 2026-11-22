// KPI & kết quả: đồng bộ Google Sheet KPI (sheet.js) vào D1, phục vụ trang /kpi và màn hình War Room ở trang "/".
//
//   GET  /api/kpi              dữ liệu KPI cho /kpi (đọc lại sheet chạy nền nếu lần trước đã quá KPI_SYNC_EVERY_MS)
//   POST /api/kpi/sync         đọc lại sheet ngay
//   GET  /api/dashboard        cùng dữ liệu, theo định dạng app React FE/ (dashboard.js); ?force=1 đọc lại sheet ngay
//
// Cron mỗi phút cũng gọi syncKpi (src/index.js). Sheet đổi -> báo các màn hình tải lại (WebSocket, scope "kpi").
// Trạng thái Đạt / Hoàn thành trễ hạn / Không đạt / Đang làm / Sắp tới tính ở trình duyệt theo ngày hôm nay
// (public/kpi-model.js). Giờ hoàn thành của từng ô do Worker ghi lại lúc thấy ô được tick (ticks.js).
// PIC nhóm lấy theo Đội trưởng trong file phân chia nhiệm vụ (bảng excel_teams); người thực hiện là cột PIC của từng dòng.
//
// Biến cấu hình (tuỳ chọn): KPI_SHEET_URL = link hoặc ID Google Sheet KPI (mặc định: file master WR - MASTER TASK,
// tab KPI nằm ngay sau từng tab task "Dòng tiền …"); "off" để tắt.

import { json } from '../http.js';
import { notifyLive } from '../live.js';
import { fetchAnySourceTabs } from '../excel/gsheet.js';
import { isSharePointConfigured, isSharePointSource, sharePointMasterUrl, sourceKeyOf, sourceUrlOf } from '../excel/sharepoint.js';
import { listImports, listTeams } from '../excel/index.js';
import { normKey } from '../worksuite/model.js';
import { parseKpiBook } from './sheet.js';
import { toDashboard } from './dashboard.js';
import { stampTicks } from './ticks.js';
import { applyPlan, parsePlan } from './plan.js';
import { applyCloses, auditReport, closeKpi } from './close.js'; // KPI-CLOSE: chốt sổ lúc 05:00
import { applyVisibility, loadVisibility } from './visibility.js'; // Quản trị › Quản lý hiển thị nhiệm vụ: admin bật / tắt hiện KPI theo nhóm

const DEFAULT_KPI_SHEET = '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0'; // WR - MASTER TASK (trước 22/11: thamkhao_kpi)
// WarRoom_CTHomes_Final_20.11.2026 (bản Google Sheet của file SharePoint): 8 dòng tiền đánh số.
const DEFAULT_PLAN_SHEET = '1APLf2zn0gk62bRfmD85ZpxtALv2wGjsFQ--RQDhaGNY';
export const KPI_SYNC_EVERY_MS = 3000;
const FORCE_EVERY_MS = 1000;
const PLAN_CACHE_MS = 5 * 60 * 1000;
const planCache = new Map();

/** ID Google Sheet KPI; '' = tắt. */
/** ID file phân chia nhiệm vụ có danh sách dòng tiền đánh số (plan.js); '' = không xếp theo danh sách. */
export function planSheetId(env = {}) {
  const value = String(env.KPI_PLAN_URL ?? '').trim();
  if (!value) return DEFAULT_PLAN_SHEET;
  if (/^(off|false|0|none)$/i.test(value)) return '';
  const m = /\/spreadsheets\/d\/([\w-]{20,})/.exec(value) || /^([\w-]{20,})$/.exec(value);
  return m ? m[1] : '';
}

export function kpiSheetId(env = {}) {
  const value = String(env.KPI_SHEET_URL ?? '').trim();
  if (!value) return isSharePointConfigured(env) ? sharePointMasterUrl(env) : DEFAULT_KPI_SHEET;
  if (/^(off|false|0|none)$/i.test(value)) return '';
  if (isSharePointSource(value)) return value;
  const m = /\/spreadsheets\/d\/([\w-]{20,})/.exec(value) || /^([\w-]{20,})$/.exec(value);
  return m ? m[1] : '';
}

/** Khoá ổn định của nguồn KPI dùng lưu bản chốt sổ D1 (Google Sheet ID hoặc sp:<guid>). */
export const kpiSourceKey = (env = {}) => sourceKeyOf(kpiSheetId(env));

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

/** Đọc sheet KPI (SharePoint Excel hoặc Google Sheet), lưu nếu khác lần trước. */
export async function syncKpi(env, { force = false, now = Date.now(), load } = {}) {
  const id = kpiSheetId(env);
  if (!id) return { off: true };
  const closeId = sourceKeyOf(id);
  const loader = load || ((ref) => fetchAnySourceTabs(ref, env, { force }));
  await ensureTable(env);
  if (!(await claim(env, force ? FORCE_EVERY_MS : KPI_SYNC_EVERY_MS, now))) return { skipped: true };
  try {
    const book = parseKpiBook(await loader(id), { year: yearOf(env) });
    // Xếp + đánh số theo 8 dòng tiền của file phân chia nhiệm vụ; file đó đọc lỗi thì giữ thứ tự tab, kèm cảnh báo.
    const planId = planSheetId(env);
    if (planId) {
      try {
        const cachedPlan = !force ? planCache.get(planId) : null;
        let plan;
        if (cachedPlan && now - cachedPlan.at < PLAN_CACHE_MS) {
          plan = cachedPlan.plan;
        } else {
          plan = parsePlan(await loader(planId));
          if (plan.length) planCache.set(planId, { at: now, plan });
        }
        if (!plan.length) book.warnings.push('File phân chia nhiệm vụ chưa có cột “STT dòng tiền”: dòng tiền xếp theo thứ tự tab.');
        const r = applyPlan(book.streams, plan);
        book.streams = r.streams;
        book.warnings.push(...r.warnings);
      } catch (e) {
        book.warnings.push(`Chưa đọc được file phân chia nhiệm vụ (danh sách dòng tiền đánh số): ${errText(e)}`);
      }
    }
    const warnings = JSON.stringify(book.warnings.slice(0, 20).map((w) => String(w).slice(0, 300)));
    const prev = await env.DB.prepare('SELECT data FROM kpi_sheet WHERE id = 1').first();
    // Ghi giờ hoàn thành cho ô vừa được tick (ticks.js) trước khi so với lần trước: ô không đổi giữ nguyên giờ cũ.
    let before = null;
    try { before = prev?.data ? JSON.parse(prev.data) : null; } catch { /* dữ liệu hỏng: coi như chưa có */ }
    const data = JSON.stringify(stampTicks(book.streams, before, now));
    const changed = !prev || prev.data !== data;
    if (changed) {
      await env.DB.prepare("UPDATE kpi_sheet SET error = '', warnings = ?, data = ?, changed_at = ? WHERE id = 1")
        .bind(warnings, data, new Date(now).toISOString()).run();
      await notifyLive(env, { scope: 'kpi' });
    } else {
      await env.DB.prepare("UPDATE kpi_sheet SET error = '', warnings = ? WHERE id = 1").bind(warnings).run();
    }
    await closeKpi(env, closeId, book.streams, now, yearOf(env)); // KPI-CLOSE: ghi quan sát + chốt ngày đã qua 05:00
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
    const team = byName(teams, s.name, (t) => t.name) || (s.sourceName ? byName(teams, s.sourceName, (t) => t.name) : null);
    const imp = byName(imports, s.name, (i) => i.name) || (s.sourceName ? byName(imports, s.sourceName, (i) => i.name) : null);
    const tgroups = team?.groups || [];
    const groups = s.groups.map((g, gi) => {
      const persons = [...new Set(g.rows.map((r) => r.person).filter(Boolean))];
      const matchNames = [...new Set(g.rows.flatMap((r) => [r.person, r.taskPic]).filter(Boolean))];
      let tg = tgroups.find((t) => (t.members || []).some((m) => !m.placeholder && matchNames.some((p) => loose(p) === loose(m.name))));
      if (!tg) tg = tgroups.find((t) => t.mainTask && loose(t.mainTask) === loose(g.name));
      if (!tg && tgroups.length === 1) tg = tgroups[0];
      const lead = tg?.lead && !tg.lead.placeholder ? { name: tg.lead.name, title: tg.lead.title || '' } : null;
      const pic = lead || (persons[0] ? { name: persons[0], title: '' } : null);
      return {
        key: loose(g.name) || `nhom${gi}`,
        name: g.name,
        pic,
        members: persons.filter((p) => !pic || loose(p) !== loose(pic.name)),
        // Trạng thái duyệt KPI của BOD theo nhóm (src/kpi/sheet.js); dữ liệu cũ chưa có -> theo ô E1 của cả dòng tiền.
        approval: g.approval || { code: s.bodApproved === false ? 'N' : 'A', label: s.bodApproved === false ? 'Chưa trình BOD' : 'BOD đã duyệt', source: 'e1' },
        rows: g.rows,
      };
    });
    return {
      key: loose(s.name) || `dongtien${si}`,
      name: s.name,
      sheet: s.sheet,
      ...(s.kpiSheet ? { kpiSheet: s.kpiSheet } : {}),
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.no ? { no: s.no } : {}),
      ...(s.desc ? { desc: s.desc } : {}),
      code: s.kind === 'support' ? 'HT' : s.kind === 'liquidation' ? 'TL' : s.no ? `DT${String(s.no).padStart(2, '0')}` : imp?.code || '',
      pic: s.pic || imp?.pic || tgroups[0]?.lead?.name || '',
      bodApproved: s.bodApproved !== false,
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
  const closeId = sourceKeyOf(id);
  await ensureTable(env);
  const r = await env.DB.prepare('SELECT checked_at, changed_at, error, warnings, data FROM kpi_sheet WHERE id = 1').first();
  let streams = [];
  let warnings = [];
  try { streams = r?.data ? JSON.parse(r.data) : []; } catch { /* dữ liệu hỏng: coi như chưa có */ }
  await applyCloses(env, closeId, streams); // KPI-CLOSE: gắn kết quả chốt sổ (cell.closed) cho trình duyệt
  try { warnings = JSON.parse(r?.warnings || '[]'); } catch { /* bỏ qua */ }
  const [teams, imports] = await Promise.all([listTeams(env).catch(() => []), listImports(env, { withTasks: false }).catch(() => [])]);
  // Lựa chọn Hiện / Ẩn của admin theo nhóm được ưu tiên hơn trạng thái duyệt đọc từ sheet (visibility.js).
  const out = applyVisibility(attachPeople(streams, teams, imports), await loadVisibility(env, closeId).catch(() => new Map()));
  const days = new Map();
  for (const s of out) for (const d of s.days) days.set(d.date, d);
  return {
    source: {
      off: !id,
      provider: isSharePointSource(id) ? 'sharepoint' : 'google',
      sheetUrl: sourceUrlOf(id),
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
  if (url.pathname === '/api/kpi/audit') return json(await auditReport(env, kpiSourceKey(env))); // KPI-CLOSE: xem bản chốt + nhật ký
  if (url.pathname === '/api/kpi/sync') {
    if (request.method !== 'POST') return json({ error: 'Chỉ hỗ trợ POST.' }, 405);
    const r = await syncKpi(env, { force: true });
    if (r.off) return json({ error: 'Đồng bộ Google Sheet KPI đang tắt (KPI_SHEET_URL=off).' }, 400);
    return json(r, r.error ? 502 : 200);
  }
  if (request.method !== 'GET') return json({ error: 'Chỉ hỗ trợ GET.' }, 405);
  await freshen(env, ctx, url.searchParams.get('force') === '1');
  return json(await kpiData(env));
}

/** Lần đầu (database mới, chưa đọc sheet lần nào) hoặc force: đọc luôn rồi mới trả; các lần sau đọc lại chạy nền. */
async function freshen(env, ctx, force = false) {
  await ensureTable(env);
  const has = await env.DB.prepare("SELECT 1 AS ok FROM kpi_sheet WHERE id = 1 AND data <> ''").first();
  if (!has || force) await syncKpi(env, { force: true });
  else ctx.waitUntil(syncKpi(env).catch(() => {}));
}

/** GET /api/dashboard: màn hình War Room dòng tiền (app React của Thành Anh) ở trang "/". */
export async function handleDashboard(request, env, url, ctx) {
  if (request.method !== 'GET') return json({ error: 'Chỉ hỗ trợ GET.' }, 405);
  if (!kpiSheetId(env)) return json({ error: 'Đồng bộ Google Sheet KPI đang tắt (KPI_SHEET_URL=off).' }, 503);
  await freshen(env, ctx, url.searchParams.get('force') === '1');
  const data = await kpiData(env);
  if (!data.streams.length) return json({ error: data.source.error || 'Google Sheet KPI chưa có dữ liệu.' }, 502);
  return json(toDashboard(data));
}

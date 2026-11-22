// Quản lý hiển thị nhiệm vụ (trang Quản trị, chỉ admin): bật / tắt hiện KPI của từng nhóm trong dòng tiền.
//
//   GET    /api/admin/kpi-visibility                                   danh sách dòng tiền · nhóm và trạng thái hiện tại
//   POST   /api/admin/kpi-visibility  {stream, group, show, reason?, note?}
//          show = true  -> Hiện: KPI của nhóm coi như BOD đã duyệt, được hiện và tính trên dashboard
//          show = false -> Ẩn: KPI không hiện, không tính; reason = 'N' (Chưa trình BOD) | 'R' (Cần điều chỉnh, bổ sung và
//                          trình lại), note = ghi chú của admin (không bắt buộc)
//   DELETE /api/admin/kpi-visibility  {stream, group}                  bỏ lựa chọn của admin, quay về trạng thái trên sheet
//
// Lựa chọn của admin lưu ở bảng D1 kpi_group_visibility theo nguồn KPI + khoá dòng tiền + khoá nhóm, và được ƯU TIÊN hơn
// trạng thái duyệt đọc từ sheet (cột "Trạng thái duyệt" / ô E1). Áp vào dữ liệu ở kpiData (src/kpi/index.js) nên trang /kpi,
// màn hình "/", Zero Waiting Point và báo cáo phê duyệt đều theo. src/index.js đã chặn người không phải admin.

import { log } from '../db.js';
import { json } from '../http.js';
import { notifyLive } from '../live.js';

export const VISIBILITY_LABEL = { A: 'BOD đã duyệt KPI', R: 'Cần điều chỉnh, bổ sung và trình lại KPI', N: 'Chưa trình KPI cho BOD' };
const NOTE_MAX = 300;

let ready = false;
async function ensureTable(env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS kpi_group_visibility (
      sheet TEXT NOT NULL,
      stream TEXT NOT NULL,
      grp TEXT NOT NULL,
      code TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      by TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (sheet, stream, grp)
    )`
  ).run();
  ready = true;
}

/** Lựa chọn của admin cho nguồn KPI `id`: Map "khoá dòng tiền|khoá nhóm" -> { code, note, by, at }. */
export async function loadVisibility(env, id) {
  if (!id) return new Map();
  await ensureTable(env);
  const { results } = await env.DB.prepare('SELECT stream, grp, code, note, by, at FROM kpi_group_visibility WHERE sheet = ?').bind(id).all();
  return new Map(results.map((r) => [`${r.stream}|${r.grp}`, { code: r.code, note: r.note, by: r.by, at: r.at }]));
}

/**
 * Áp lựa chọn của admin lên dữ liệu đã qua attachPeople (hàm thuần, để test). Nhóm có lựa chọn: approval lấy theo admin
 * (source 'admin', kèm note / by / at), trạng thái trên sheet giữ ở approval.sheet. bodApproved của dòng tiền tính lại.
 */
export function applyVisibility(streams, overrides) {
  if (!overrides?.size) return streams;
  return streams.map((s) => {
    let touched = false;
    const groups = s.groups.map((g) => {
      const o = overrides.get(`${s.key}|${g.key}`);
      if (!o || !VISIBILITY_LABEL[o.code]) return g;
      touched = true;
      const { sheet: _old, ...fromSheet } = g.approval || {};
      return { ...g, approval: { code: o.code, label: VISIBILITY_LABEL[o.code], source: 'admin', note: o.note || '', by: o.by || '', at: o.at || '', sheet: fromSheet } };
    });
    return touched ? { ...s, groups, bodApproved: groups.every((g) => g.approval.code === 'A') } : s;
  });
}

/** Số ô KPI có nội dung của 1 nhóm (mọi người, mọi ngày). */
const kpiCount = (g) => (g.rows || []).reduce((n, r) => n + Object.values(r.cells || {}).filter((c) => c && String(c.kpi || '').trim()).length, 0);

/** Danh sách cho tab "Quản lý hiển thị nhiệm vụ" từ kết quả kpiData (hàm thuần, để test). */
export function visibilityList(streams) {
  return streams.map((s) => ({
    key: s.key,
    name: s.name,
    no: s.no || 0,
    code: s.code || '',
    pic: s.pic || '',
    groups: s.groups.map((g) => {
      const a = g.approval || { code: 'N' };
      const admin = a.source === 'admin';
      return {
        key: g.key,
        name: g.name,
        pic: g.pic?.name || '',
        kpis: kpiCount(g),
        show: a.code === 'A',
        code: a.code,
        label: VISIBILITY_LABEL[a.code] || a.label || '',
        source: admin ? 'admin' : 'sheet',
        note: admin ? a.note || '' : a.note || a.directive || '',
        by: admin ? a.by || '' : '',
        at: admin ? a.at || '' : '',
        sheetCode: (admin ? a.sheet?.code : a.code) || 'N',
      };
    }),
  }));
}

/** GET / POST / DELETE /api/admin/kpi-visibility */
export async function handleKpiVisibility(request, env, user) {
  const { kpiData, kpiSourceKey } = await import('./index.js');
  const id = kpiSourceKey(env);
  if (!id) return json({ error: 'Đồng bộ KPI đang tắt.' }, 400);
  await ensureTable(env);
  const data = await kpiData(env);
  if (request.method === 'GET') return json({ streams: visibilityList(data.streams), checkedAt: data.source?.checkedAt || '', error: data.source?.error || '' });

  if (request.method !== 'POST' && request.method !== 'DELETE') return json({ error: 'Phương thức không được hỗ trợ.' }, 405);
  const body = await request.json().catch(() => ({}));
  const s = data.streams.find((x) => x.key === String(body.stream || ''));
  const g = s?.groups.find((x) => x.key === String(body.group || ''));
  if (!g) return json({ error: 'Không tìm thấy nhóm này trong dữ liệu KPI. Tải lại trang rồi thử lại.' }, 404);
  const where = `${s.name} · ${g.name}`;

  if (request.method === 'DELETE') {
    const { meta } = await env.DB.prepare('DELETE FROM kpi_group_visibility WHERE sheet = ? AND stream = ? AND grp = ?').bind(id, s.key, g.key).run();
    if (!meta.changes) return json({ error: 'Nhóm này đang theo trạng thái trên sheet.' }, 404);
    await log(env, request, user.username, 'kpi_visibility_reset', `${where}: quay về trạng thái trên sheet`);
  } else {
    const show = body.show === true;
    const code = show ? 'A' : String(body.reason || '');
    if (!show && code !== 'N' && code !== 'R') return json({ error: 'Cần chọn lý do ẩn: Chưa trình KPI cho BOD, hoặc Cần điều chỉnh, bổ sung và trình lại KPI.' }, 400);
    const note = show ? '' : String(body.note || '').trim().slice(0, NOTE_MAX);
    await env.DB.prepare(
      `INSERT INTO kpi_group_visibility (sheet, stream, grp, code, note, by, at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sheet, stream, grp) DO UPDATE SET code = excluded.code, note = excluded.note, by = excluded.by, at = excluded.at`
    ).bind(id, s.key, g.key, code, note, user.username, new Date().toISOString()).run();
    await log(env, request, user.username, show ? 'kpi_visibility_show' : 'kpi_visibility_hide', `${where}: ${show ? `Hiện KPI (${VISIBILITY_LABEL.A})` : `Ẩn KPI · ${VISIBILITY_LABEL[code]}${note ? ` · ${note}` : ''}`}`);
  }
  await notifyLive(env, { scope: 'kpi' }).catch(() => {}); // các màn hình đang mở tải lại KPI
  return json({ ok: true, streams: visibilityList((await kpiData(env)).streams) });
}

// Danh sách dòng tiền chính thức có đánh số (1–8) trong file phân chia nhiệm vụ "WarRoom_CTHomes_Final_20.11.2026"
// (sheet "DS nhân sự War-Room", cột "STT dòng tiền" + "Dòng tiền"). Bản gốc ở SharePoint, bản Google Sheet cùng nội dung
// là nguồn Worker đọc được (KPI_PLAN_URL).
//
// Trang /kpi và màn hình Dòng tiền ("/") hiện đúng các dòng tiền này, theo đúng số thứ tự và tên trong file:
// - Dòng tiền có bảng KPI trong file master được ghép theo số ("Dòng tiền 5: Equity / IPO" trong tab task -> số 5),
//   không có số thì theo tên.
// - Dòng tiền chưa có tab KPI vẫn hiện (0 KPI).
// - Tab KPI không thuộc danh sách (vd "Dòng tiền Tài chính") bị ẩn, kèm 1 cảnh báo.

import { normKey } from '../worksuite/model.js';

const loose = (s) => normKey(s).replace(/[^a-z0-9]+/g, '');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * "Dòng tiền bán 4 dự án" -> "Bán 4 dự án"; "1. Cổ phiếu – Equity 2. IPO / niêm yết" -> "Cổ phiếu – Equity · IPO / niêm yết";
 * "Các gói tài trợ – Tài chính 57: Tổ chức Ban…" -> tên "Các gói tài trợ – Tài chính 57", mô tả "Tổ chức Ban…".
 */
export function planName(raw) {
  let t = clean(raw).replace(/^dòng tiền\s*[:\-–]?\s*/i, '');
  let desc = '';
  const colon = t.indexOf(':');
  if (colon > 0) { desc = t.slice(colon + 1).trim(); t = t.slice(0, colon).trim(); }
  if (/^\d+\.\s/.test(t)) t = t.split(/\s*\d+\.\s+/).filter(Boolean).join(' · ');
  return { name: t ? t.charAt(0).toLocaleUpperCase('vi') + t.slice(1) : clean(raw), desc };
}

/** Các tab của file phân chia nhiệm vụ -> [{ no, name, desc, raw }] theo số thứ tự; không có cột "STT dòng tiền" -> []. */
export function parsePlan(tabs) {
  const out = new Map();
  for (const tab of tabs || []) {
    if (tab.hidden) continue;
    const rows = tab.rows || [];
    let noCol = -1;
    let nameCol = -1;
    let h = -1;
    for (let i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
      const keys = (rows[i].cells || []).map((c) => normKey(c?.v));
      noCol = keys.indexOf('stt dong tien');
      nameCol = keys.indexOf('dong tien');
      if (noCol >= 0 && nameCol >= 0) h = i;
    }
    if (h < 0) continue;
    for (const row of rows.slice(h + 1)) {
      const no = Number.parseInt(clean(row.cells?.[noCol]?.v), 10);
      const raw = clean(row.cells?.[nameCol]?.v);
      if (!no || !raw || out.has(no)) continue;
      out.set(no, { no, ...planName(raw), raw });
    }
  }
  return [...out.values()].sort((a, b) => a.no - b.no);
}

/**
 * Xếp các dòng tiền KPI (parseKpiBook().streams) theo danh sách chính thức. Trả { streams, warnings }.
 * Danh sách rỗng (chưa đọc được file phân chia) -> giữ nguyên.
 */
export function applyPlan(streams, plan) {
  if (!plan?.length) return { streams, warnings: [] };
  const support = streams.filter((s) => s.kind === 'support');
  const liquidation = streams.filter((s) => s.kind === 'liquidation');
  const cash = streams.filter((s) => s.kind !== 'support' && s.kind !== 'liquidation');
  const used = new Set();
  const usedLiq = new Set();
  const tokens = (s) => normKey(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const pick = (p) => {
    let i = cash.findIndex((s, k) => !used.has(k) && s.no === p.no);
    if (i < 0) {
      const keys = [loose(p.name), loose(p.raw.replace(/^dòng tiền/i, ''))];
      i = cash.findIndex((s, k) => !used.has(k) && !s.no && keys.includes(loose(s.name)));
    }
    if (i < 0) {
      const hay = `${normKey(p.name)} ${normKey(p.raw)}`;
      const hits = cash
        .map((s, k) => ({ s, k, toks: tokens(s.name) }))
        .filter(({ s, k, toks }) => !used.has(k) && !s.no && toks.length >= 2 && toks.every((t) => hay.includes(t)));
      if (hits.length === 1) i = hits[0].k;
    }
    if (i >= 0) used.add(i);
    return i;
  };
  const out = plan.map((p) => {
    const liqIdx = liquidation.findIndex((s, k) => !usedLiq.has(k) && normKey(p.name).includes('thanh ly'));
    if (liqIdx >= 0) {
      usedLiq.add(liqIdx);
      const base = liquidation[liqIdx];
      return { ...base, no: p.no, name: 'Nhóm thanh lý', kind: 'liquidation', desc: p.desc, sourceName: base.name };
    }
    const i = pick(p);
    const base = i >= 0 ? cash[i] : { sheet: '', pic: '', days: [], groups: [] };
    return { ...base, no: p.no, name: p.name, desc: p.desc, sourceName: i >= 0 ? cash[i].name : '' };
  });
  for (const [k, s] of liquidation.entries()) if (!usedLiq.has(k)) out.push({ ...s, kind: 'liquidation' });
  for (const s of support) out.push({ ...s, kind: 'support' });
  const hidden = cash.filter((_, k) => !used.has(k)).map((s) => s.sheet || s.name);
  const warnings = hidden.length
    ? [`Không hiện ${hidden.map((n) => `“${n}”`).join(', ')}: không có trong ${plan.length} dòng tiền đánh số của file phân chia nhiệm vụ.`]
    : [];
  return { streams: out, warnings };
}

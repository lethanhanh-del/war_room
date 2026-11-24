// Báo cáo nhanh tình trạng phê duyệt KPI của BOD theo nhóm (nút "Xuất báo cáo phê duyệt" trên trang /kpi).
//   GET /api/kpi/approval-report -> file phe-duyet-KPI-YYYY-MM-DD.xlsx
//
// Theo mẫu báo cáo chị Ngân gửi (23/11/2026): mỗi dòng là 1 nhóm của 1 dòng tiền, cột
//   Stt | Dòng tiền | Nhóm | Đội trưởng/Phụ trách | Nhiệm vụ | Tình trạng phê duyệt KPI | Chỉ đạo của BLĐ tại tờ trình | Ghi chú
// - Tình trạng phê duyệt: cột "Trạng thái duyệt" của nhóm trên sheet (BOD đã duyệt / Cần điều chỉnh, bổ sung và trình lại /
//   Chưa trình BOD), sheet chưa có cột thì theo ô tick E1 của tab. Tô nền xanh lá / vàng / đỏ theo trạng thái.
// - Chỉ đạo của BLĐ / Ghi chú: cột "Chỉ đạo…" và "Ghi chú duyệt / Ghi chú BOD / Ý kiến BOD" của nhóm nếu sheet có.
// - Nhiệm vụ: các KPI khác nhau của nhóm (theo thứ tự ngày), tối đa 8 dòng; nhóm chưa có KPI ghi tên nhóm.
// Tab "Tổng hợp": đếm số nhóm theo trạng thái của từng dòng tiền.

import { log } from '../db.js';
import { XLSX_STYLE, writeXlsx } from './xlsx-write.js';

const LABEL = { A: 'BOD đã duyệt KPI', R: 'Cần điều chỉnh, bổ sung và trình lại KPI', N: 'Chưa trình KPI cho BOD' };
const STYLE = { A: XLSX_STYLE.ok, R: XLSX_STYLE.warn, N: XLSX_STYLE.bad };
const MAX_TASKS = 8;

/** ISO / ms -> "dd/mm/yyyy hh:mm" giờ VN. */
const vn = (t) => {
  const ms = typeof t === 'number' ? t : Date.parse(t || '');
  if (!ms) return '';
  const s = new Date(ms + 7 * 3600e3).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
};

/** Các KPI khác nhau của 1 nhóm, theo thứ tự ngày rồi thứ tự dòng. */
function tasksOf(g) {
  const dates = [...new Set((g.rows || []).flatMap((r) => Object.keys(r.cells || {})))].sort();
  const out = [];
  for (const d of dates) {
    for (const r of g.rows || []) {
      const k = String(r.cells?.[d]?.kpi || '').trim();
      if (k && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** Dòng báo cáo (hàm thuần, để test): [{ stream, group, pic, tasks, code, status, directive, note }]. */
export function approvalRows(streams) {
  const rows = [];
  for (const s of streams || []) {
    // Dòng tiền chưa có dữ liệu trên sheet: vẫn có 1 dòng trong báo cáo, ghi "Chưa có dữ liệu" (code X, không tô màu).
    if (!(s.groups || []).length) {
      rows.push({
        stream: s.name,
        group: '—',
        pic: s.pic || '',
        tasks: '',
        code: 'X',
        status: 'Chưa có dữ liệu',
        directive: '',
        note: s.sheetMissing ? 'Chưa tìm thấy tab của dòng tiền này trên file Excel SharePoint' : `Tab “${s.kpiSheet || s.sheet || s.name}” trên file Excel SharePoint chưa nhập Nhóm, PIC và KPI`,
      });
      continue;
    }
    for (const g of s.groups || []) {
      const a = g.approval || { code: s.bodApproved === false ? 'N' : 'A' };
      const code = LABEL[a.code] ? a.code : 'N';
      const tasks = tasksOf(g);
      rows.push({
        stream: s.name,
        group: g.name,
        pic: g.pic?.name || s.pic || '',
        tasks: tasks.length ? tasks.slice(0, MAX_TASKS).join('\n') + (tasks.length > MAX_TASKS ? `\n… và ${tasks.length - MAX_TASKS} KPI khác` : '') : g.name,
        code,
        // Giữ nguyên chữ ghi trên sheet (vd "Đã được BOD tạm duyệt"), không có thì nhãn chuẩn.
        status: a.label || LABEL[code],
        directive: a.directive || '',
        note: a.note || '',
      });
    }
  }
  return rows;
}

/** Nội dung workbook (mảng tab cho writeXlsx). */
export function approvalWorkbook({ rows, sheetUrl, checkedAt, by, now }) {
  const head = ['Stt', 'Dòng tiền', 'Nhóm', 'Đội trưởng/Phụ trách', 'Nhiệm vụ', 'Tình trạng phê duyệt KPI', 'Chỉ đạo của BLĐ tại tờ trình', 'Ghi chú'];
  const c = { A: 0, R: 0, N: 0, X: 0 };
  for (const r of rows) c[r.code]++;
  const nGroups = rows.length - c.X;
  const info = [
    ['BÁO CÁO TÌNH TRẠNG PHÊ DUYỆT KPI · WAR ROOM CT HOMES'],
    [`Xuất lúc ${vn(now)} · ${by} · dữ liệu đọc lúc ${vn(checkedAt) || '—'}`],
    [`${nGroups} nhóm: ${c.A} BOD đã duyệt KPI · ${c.R} cần điều chỉnh, bổ sung và trình lại KPI · ${c.N} chưa trình KPI cho BOD${c.X ? ` · ${c.X} dòng tiền chưa có dữ liệu trên sheet` : ''}`],
    ...(sheetUrl ? [[`Nguồn: ${sheetUrl}`]] : []),
    [],
  ];
  const top = info.length;
  const main = [...info, head, ...rows.map((r, i) => [i + 1, r.stream, r.group, r.pic, r.tasks, r.status, r.directive, r.note])];
  const codeAt = new Map(rows.map((r, i) => [top + 1 + i, r.code]));

  const by_ = new Map();
  for (const r of rows) {
    const x = by_.get(r.stream) || { A: 0, R: 0, N: 0, X: 0, total: 0, pending: [] };
    x[r.code]++;
    if (r.code === 'X') { x.pending.push('Chưa có dữ liệu trên sheet'); by_.set(r.stream, x); continue; }
    x.total++;
    if (r.code !== 'A') x.pending.push(`${r.group} (${LABEL[r.code]})`);
    by_.set(r.stream, x);
  }
  const summary = [
    ['TỔNG HỢP PHÊ DUYỆT KPI THEO DÒNG TIỀN'],
    [],
    ['Dòng tiền', 'Số nhóm', 'BOD đã duyệt KPI', 'Cần điều chỉnh, bổ sung và trình lại KPI', 'Chưa trình KPI cho BOD', 'Nhóm chưa được duyệt'],
    ...[...by_].map(([name, x]) => [name, x.total, x.A, x.R, x.N, x.pending.join('\n')]),
    ['Tổng', nGroups, c.A, c.R, c.N, ''],
  ];
  const sumLast = summary.length - 1;

  return [
    {
      name: 'Phê duyệt KPI',
      rows: main,
      widths: [6, 24, 22, 24, 60, 26, 30, 40],
      style: (r, col) => {
        if (r === 0) return XLSX_STYLE.title;
        if (r < top) return XLSX_STYLE.normal;
        if (r === top) return XLSX_STYLE.head;
        const code = codeAt.get(r);
        if (!code) return undefined;
        return col === 5 && STYLE[code] != null ? STYLE[code] : XLSX_STYLE.wrap;
      },
    },
    {
      name: 'Tổng hợp',
      rows: summary,
      widths: [32, 10, 14, 22, 16, 50],
      style: (r, col) => {
        if (r === 0) return XLSX_STYLE.title;
        if (r === 2) return XLSX_STYLE.head;
        if (r < 3) return undefined;
        if (r === sumLast) return XLSX_STYLE.bold;
        return col === 2 ? XLSX_STYLE.ok : col === 3 ? XLSX_STYLE.warn : col === 4 ? XLSX_STYLE.bad : XLSX_STYLE.wrap;
      },
    },
  ];
}

/** GET /api/kpi/approval-report */
export async function handleApprovalReport(request, env, user) {
  if (request.method !== 'GET') return new Response('Chỉ hỗ trợ GET.', { status: 405 });
  const { kpiData } = await import('./index.js');
  const now = Date.now();
  const data = await kpiData(env, now);
  const rows = approvalRows(data.streams);
  const book = approvalWorkbook({ rows, sheetUrl: data.source?.sheetUrl || '', checkedAt: data.source?.checkedAt || '', by: user.fullName || user.username, now });
  await log(env, request, user.username, 'kpi_approval_export', `Xuất báo cáo phê duyệt KPI (${rows.length} nhóm)`).catch(() => {});
  const day = data.today || new Date(now + 7 * 3600e3).toISOString().slice(0, 10);
  return new Response(writeXlsx(book), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="phe-duyet-KPI-${day}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

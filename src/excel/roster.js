// Đọc file PHÂN CHIA NHIỆM VỤ War Room (vd WarRoom_CTHomes_Final_20.11.2026.xlsx, sheet "DS nhân sự War-Room"):
//   STT · STT dòng tiền · Dòng tiền · Thành viên · Chức danh · Phòng ban · Đội trưởng/Đội phó · Nhiệm vụ thực hiện · ca trực…
//
// - Ô "Dòng tiền" có chữ mở 1 khối dòng tiền; các dòng thành viên bên dưới thuộc khối đó.
// - Trong 1 dòng tiền, mỗi "Đội trưởng" / "Trưởng nhóm" mở 1 NHÓM mới (vd Bán 4 dự án: Networking, Đại lý, Data…).
// - Nhiệm vụ chính của nhóm = "Nhiệm vụ thực hiện" mà các thành viên cùng làm; nếu mỗi người một việc thì để trống.
// - Cùng 1 dòng tiền xuất hiện ở sheet khác (vd sheet "Nhóm hỗ trợ") thì gộp thành viên vào.

import { normKey } from '../worksuite/model.js';
import { cleanOwner, parseStreamTitle } from './tasks.js';

const COLUMNS = [
  ['streamNo', (h) => h === 'stt dong tien'],
  ['stream', (h) => h === 'dong tien'],
  ['member', (h) => h.startsWith('thanh vien')],
  ['title', (h) => h === 'chuc danh'],
  ['department', (h) => h === 'phong ban'],
  ['role', (h) => h.includes('doi truong') || h.includes('doi pho') || h === 'vai tro' || h.includes('truong nhom')],
  ['task', (h) => h.includes('nhiem vu')],
];
const PLACEHOLDER = /them nguoi|bo sung|de xuat|theo ca truc|chua phan cong|dang can nhac|chua co ten|\btbd\b/;
const LEAD = /\b(doi truong|truong nhom|nhom truong|truong doi|leader)\b/;
const DEPUTY = /\b(doi pho|pho nhom|pho doi)\b/;

function findHeader(rows) {
  for (const row of rows.slice(0, 15)) {
    const map = {};
    row.cells.forEach((cell, i) => {
      if (!cell || typeof cell.v !== 'string') return;
      const h = normKey(cell.v);
      const hit = COLUMNS.find(([field, test]) => map[field] === undefined && test(h));
      if (hit) map[hit[0]] = i;
    });
    if (map.stream !== undefined && map.member !== undefined && map.task !== undefined) return { row: row.r, map };
  }
  return null;
}

/** File có sheet danh sách nhân sự theo dòng tiền (cột Dòng tiền + Thành viên + Nhiệm vụ thực hiện). */
export function isRoster(book) {
  return book.sheets.some((s) => !s.hidden && findHeader(s.rows));
}

const capital = (s) => (s ? s.charAt(0).toLocaleUpperCase('vi') + s.slice(1) : s);

/** "Dòng tiền Banking" -> Banking; "Nhóm kiểm soát kỷ luật War-Room" -> Kiểm soát kỷ luật War-Room. */
function streamOf(raw) {
  const t = parseStreamTitle(raw);
  if (t?.name) return { no: t.no, name: t.name, isStream: true };
  const m = /^nh[oó]m\s+(.+)$/iu.exec(raw);
  if (m) return { no: null, name: capital(m[1].trim()), isStream: false };
  return { no: null, name: raw, isStream: false };
}

function finishGroup(g) {
  const count = new Map();
  for (const m of g.members) if (m.task) count.set(m.task, (count.get(m.task) || 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  // Nhiệm vụ chung: có ít nhất 2 người cùng làm, hoặc cả nhóm chỉ có 1 nhiệm vụ.
  const mainTask = ranked.length === 1 || (ranked[0] && ranked[0][1] >= 2 && ranked[0][1] > (ranked[1]?.[1] ?? 0)) ? ranked[0][0] : '';
  return { lead: g.lead, mainTask, members: g.members };
}

/**
 * @returns {{ sections: { key, name, code, raw, sheet, canCreate, groups, memberCount }[], warnings: string[] }}
 *   group: { lead: member|null, mainTask, members: [{ name, title, department, role, task, placeholder }] }
 */
export function extractRoster(book) {
  const blocks = new Map();
  const warnings = [];
  let first = true;
  for (const sheet of book.sheets) {
    if (sheet.hidden) continue;
    const header = findHeader(sheet.rows);
    if (!header) continue;
    const col = (row, f) => {
      const i = header.map[f];
      const c = i === undefined ? undefined : row.cells[i];
      return c ? String(c.v).replace(/\s+/g, ' ').trim() : '';
    };
    let block = null;
    let fresh = false;
    for (const row of sheet.rows) {
      if (row.r <= header.row) continue;
      const streamRaw = col(row, 'stream');
      if (streamRaw) {
        const s = streamOf(streamRaw);
        const key = normKey(s.name);
        block = blocks.get(key);
        if (!block) {
          const no = s.no || Number.parseInt(col(row, 'streamNo'), 10) || null;
          // Thẻ mới chỉ tạo cho "Dòng tiền …", hoặc "Nhóm …" ở sheet danh sách chính (vd Nhóm Tài chính… 10 dòng tiền);
          // "Cố vấn, chỉ đạo", các nhóm hỗ trợ (IT, hậu cần…) chỉ gắn vào thẻ cùng tên nếu có.
          const canCreate = s.isStream || (first && /^nh[oó]m\s/iu.test(streamRaw));
          block = { key, name: s.name, raw: streamRaw, no, sheet: sheet.name, canCreate, groups: [] };
          blocks.set(key, block);
        }
        fresh = true;
      }
      if (!block) continue;
      const nameRaw = col(row, 'member');
      if (!nameRaw) continue; // dòng chỉ ghi nhiệm vụ (vd "Chốt lộ trình và nhân sự"), chưa có người
      const placeholder = PLACEHOLDER.test(normKey(nameRaw));
      const cleaned = cleanOwner(nameRaw);
      const member = {
        name: placeholder || cleaned.split(' ').length < 2 ? nameRaw : cleaned,
        title: col(row, 'title'),
        department: col(row, 'department'),
        role: col(row, 'role'),
        task: col(row, 'task'),
        placeholder,
      };
      const r = normKey(member.role);
      const isLead = LEAD.test(r) && !DEPUTY.test(r);
      let group = block.groups[block.groups.length - 1];
      if (fresh && group && !isLead) {
        // Dòng tiền xuất hiện lại ở sheet khác: thêm vào nhóm cùng nhiệm vụ (nếu có).
        group = block.groups.find((g) => member.task && g.members.some((m) => m.task === member.task)) || group;
      } else if (!group || (isLead && (group.lead || group.members.length))) {
        group = { lead: null, members: [] };
        block.groups.push(group);
      }
      fresh = false;
      if (isLead && !group.lead) group.lead = member;
      group.members.push(member);
    }
    first = false;
  }

  const sections = [];
  for (const b of blocks.values()) {
    const groups = b.groups.map(finishGroup);
    const people = new Set(groups.flatMap((g) => g.members.filter((m) => !m.placeholder).map((m) => normKey(m.name))));
    if (!people.size) continue; // khối chưa có người (vd Trái phiếu, Cổ phiếu: "Chốt lộ trình và nhân sự")
    for (const [i, g] of groups.entries()) {
      if (!g.lead && b.canCreate) warnings.push(`${b.raw}: nhóm ${i + 1} chưa có Đội trưởng / Trưởng nhóm.`);
    }
    sections.push({ key: b.key, name: b.name, code: b.no ? `DT${String(b.no).padStart(2, '0')}` : '', raw: b.raw, sheet: b.sheet, canCreate: b.canCreate, groups, memberCount: people.size });
  }
  if (!sections.length) throw new Error('File phân chia nhiệm vụ không có dòng tiền nào có thành viên.');
  return { sections, warnings };
}

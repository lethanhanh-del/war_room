// Tính toàn bộ số liệu dashboard từ dữ liệu thô của Sổ mục tiêu.
// Hàm thuần (không gọi mạng) -> dễ kiểm thử. Quy tắc bám theo văn bản chỉ đạo War Room:
//   One Task – One Owner – One Deadline – One Result; Zero Waiting Point; End-to-End; Strict Time Box.

import { STAGES, REMOVED_STATUS } from './schema.js';
import {
  parseVnDateTime, hasTimePart, vnParts, vnStartOfDay, vnDayKey, fmtVn,
  humanDuration, humanAgo, minutesOfDay, DAY_MS,
} from './time.js';

const GROUP_OWNER_RE = /[\/&,;+]|\s(và|với)\s|^(nhóm|ban|phòng|khối|bộ phận|team|các)(\s|$)/i;
const INTERMEDIATE_OUTPUT_RE = /(phương án|tối ưu|tiếp tục|nghiên cứu|làm rõ)/i;
const UNDEFINED_STREAM_RE = /chưa xác định|chưa có trong danh mục/i;
const PLACEHOLDER_TITLE_RE = /cần bổ sung/i;

export function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).replace(/\s|tỷ|ty|vnđ|vnd/gi, '');
  s = s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * One Owner: owner phải là họ tên MỘT người ("Nguyễn Thị Kim Cúc", "Mr. Vinh"),
 * không phải đơn vị ("Kinh doanh", "DAIT") hay nhóm ("Kinh doanh / Data").
 */
export function looksLikeOnePerson(value) {
  const s = str(value);
  if (!s || GROUP_OWNER_RE.test(s)) return false;
  const words = s.replace(/^(mr|ms|mrs|anh|chị|ông|bà)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return words.every((w) => /^\p{Lu}[\p{Ll}]*$/u.test(w));
}
const pass = () => ({ ok: true, reason: '' });
const fail = (reason) => ({ ok: false, reason });

/** "DT01", "DT #01", "#1", "Dòng tiền #01" -> "01"; còn lại -> null. */
export function streamCode(value) {
  const m = str(value).match(/(?:DT|#|dòng tiền)\s*#?\s*0*(\d{1,2})\b/i);
  return m ? m[1].padStart(2, '0') : null;
}

function enrichTarget(t, ctx) {
  const stageNum = Number.parseInt(t.stage, 10);
  const stage = Number.isFinite(stageNum) && stageNum >= 1 && stageNum <= 6 ? stageNum : null;
  const status = str(t.status) || 'Chưa bắt đầu';
  const removed = status === REMOVED_STATUS;
  const owner = str(t.owner);
  const output = str(t.output);
  const criteria = str(t.criteria);
  const evidence = str(t.evidence);
  const deadlineRaw = str(t.deadline);
  const deadlineMs = parseVnDateTime(deadlineRaw, { endOfDay: !hasTimePart(deadlineRaw), defaultYear: ctx.year });
  const verified = status === 'Hoàn thành' && stage === 6 && Boolean(evidence);
  const reportedDone = !verified && (status === 'Hoàn thành' || status === 'Chờ kiểm chứng');
  const open = !removed && !verified;
  // Đang làm = còn mở và chưa báo xong. Việc đã báo xong (Bước 5) chỉ còn thiếu chứng từ,
  // nên không tính vào vi phạm owner/đầu ra/hạn để khỏi thổi phồng số liệu.
  const active = open && !reportedDone;

  const checks = {
    owner: !owner ? fail('Chưa có owner') : looksLikeOnePerson(owner) ? pass() : fail('Giao cho nhóm / đơn vị, chưa phải 1 người'),
    output: !output ? fail('Chưa có đầu ra') : INTERMEDIATE_OUTPUT_RE.test(output) ? fail('Đầu ra là bước trung gian') : pass(),
    deadline: !deadlineRaw ? fail('Chưa có hạn')
      : deadlineMs === null ? fail('Hạn không đọc được')
        : ctx.end && deadlineMs > ctx.end ? fail('Hạn vượt time-box') : pass(),
    criteria: !criteria ? fail('Chưa có tiêu chí kiểm chứng') : pass(),
  };
  const missingEvidence = status === 'Hoàn thành' && !verified;
  const overdue = open && deadlineMs !== null && deadlineMs < ctx.now;
  const blocked = open && (Boolean(str(t.blocker)) || status === 'Nghẽn');
  const violations = (active ? Object.values(checks).filter((c) => !c.ok).length : 0) + (missingEvidence ? 1 : 0);

  return {
    id: str(t.id), stream: str(t.stream), streamCode: streamCode(t.stream), title: str(t.title),
    placeholder: PLACEHOLDER_TITLE_RE.test(str(t.title)),
    owner, unit: str(t.unit), output, criteria, evidence, note: str(t.note),
    start: str(t.start), deadline: deadlineRaw, deadlineMs, deadlineText: deadlineMs ? fmtVn(deadlineMs, { time: hasTimePart(deadlineRaw), year: false }) : '',
    stage, stageName: stage ? STAGES[stage - 1] : 'Chưa xác định', status,
    blocker: str(t.blocker), escalateTo: str(t.escalateTo),
    moneyTarget: parseNumber(t.moneyTarget), unlocked: parseNumber(t.unlocked),
    updatedAt: str(t.updatedAt), removedReason: str(t.removedReason),
    removed, verified, reportedDone, open, active, overdue, blocked, missingEvidence, checks, violations,
    _row: t._row,
  };
}

function streamState(s) {
  const name = str(s.name);
  const owner = str(s.owner);
  const staff = parseNumber(s.staff);
  const flag = str(s.flag);
  if (!name || UNDEFINED_STREAM_RE.test(name)) return { state: 'undefined', label: 'Chưa xác định' };
  if (!owner && (staff === 0 || staff === null)) return { state: 'noPeople', label: 'Chưa có người' };
  if (flag === 'Thiếu người') return { state: 'short', label: 'Thiếu người' };
  if (flag === 'Tạm dừng') return { state: 'short', label: 'Tạm dừng' };
  if (!owner) return { state: 'noLead', label: 'Chưa chốt owner' };
  return { state: 'running', label: 'Có owner' };
}

function currentShift(now, cfg) {
  const p = vnParts(now);
  const minutes = p.h * 60 + p.mi;
  const dayStart = minutesOfDay(cfg.shiftDayStart, 7 * 60 + 30);
  const nightStart = minutesOfDay(cfg.shiftNightStart, 19 * 60 + 30);
  const today = vnStartOfDay(now);
  if (minutes >= dayStart && minutes < nightStart) {
    return { name: 'Ngày', dateMs: today, label: `Ca ngày ${fmtVn(today, { time: false, year: false })}`, range: `${cfg.shiftDayStart}–${cfg.shiftNightStart}` };
  }
  const dateMs = minutes >= nightStart ? today : today - DAY_MS;
  return { name: 'Đêm', dateMs, label: `Ca đêm ${fmtVn(dateMs, { time: false, year: false })}`, range: `${cfg.shiftNightStart}–${cfg.shiftDayStart}` };
}

const normShift = (v) => (/đêm|dem|night/i.test(str(v)) ? 'Đêm' : /ngày|ngay|day/i.test(str(v)) ? 'Ngày' : '');

export function computeDashboard(raw, { now = Date.now(), config = {} } = {}) {
  const cfg = {
    warRoomStart: '21/11/2026 07:30', warRoomEnd: '25/11/2026 23:59',
    shiftDayStart: '07:30', shiftNightStart: '19:30', staleMinutes: 60, ...config,
  };
  const start = parseVnDateTime(cfg.warRoomStart);
  const end = parseVnDateTime(cfg.warRoomEnd);
  const year = start ? vnParts(start).y : vnParts(now).y;
  const ctx = { now, end, year };

  // ---- Mục tiêu
  const allTargets = (raw.MucTieu || []).filter((t) => str(t.id) || str(t.title)).map((t) => enrichTarget(t, ctx));
  const targets = allTargets.filter((t) => !t.removed);
  const removedTargets = allTargets.filter((t) => t.removed);
  const openTargets = targets.filter((t) => t.open);
  const activeTargets = targets.filter((t) => t.active);

  // ---- Dòng tiền
  const collections = (raw.ThuTien || []).map((c) => ({
    date: str(c.date), stream: str(c.stream), streamCode: streamCode(c.stream), target: str(c.target),
    amount: parseNumber(c.amount), evidence: str(c.evidence), recordedBy: str(c.recordedBy), note: str(c.note),
  })).filter((c) => c.amount !== null);
  const verifiedCollections = collections.filter((c) => c.evidence);
  const streams = (raw.DongTien || []).filter((s) => str(s.id)).map((s) => {
    const code = streamCode(s.id) || str(s.id);
    const st = streamState(s);
    const streamTargets = targets.filter((t) => t.streamCode === code);
    return {
      id: str(s.id), code, name: str(s.name) || 'Chưa có trong danh mục', owner: str(s.owner),
      staff: parseNumber(s.staff), moneyTarget: parseNumber(s.moneyTarget), flag: str(s.flag), note: str(s.note),
      ...st,
      targets: streamTargets.length,
      openTargets: streamTargets.filter((t) => t.open).length,
      blocked: streamTargets.filter((t) => t.blocked).length,
      collected: verifiedCollections.filter((c) => c.streamCode === code).reduce((a, c) => a + c.amount, 0),
    };
  });

  // ---- Tiền (Mục V): chỉ tính tiền có chứng từ
  const collected = verifiedCollections.reduce((a, c) => a + c.amount, 0);
  const pendingCollected = collections.filter((c) => !c.evidence).reduce((a, c) => a + c.amount, 0);
  const unlocked = targets.reduce((a, t) => a + (t.unlocked || 0), 0);
  const streamTargetSum = streams.reduce((a, s) => a + (s.moneyTarget || 0), 0);
  const targetMoneySum = targets.reduce((a, t) => a + (t.moneyTarget || 0), 0);
  const moneyTarget = streamTargetSum || targetMoneySum || null;

  // ---- Điểm chờ (Zero Waiting Point)
  const waitingItems = [
    ...streams.filter((s) => s.state === 'noPeople').map((s) => ({ kind: 'Dòng tiền chưa có người', label: `${s.id} · ${s.name}` })),
    ...activeTargets.filter((t) => !t.owner).map((t) => ({ kind: 'Mục tiêu chưa có owner', label: `${t.id} · ${t.title}` })),
    ...openTargets.filter((t) => t.blocked).map((t) => ({ kind: 'Điểm nghẽn công việc', label: `${t.id} · ${t.blocker || t.title}` })),
  ];
  const waitingByKind = {};
  for (const w of waitingItems) waitingByKind[w.kind] = (waitingByKind[w.kind] || 0) + 1;

  // ---- Quyết định
  const decisions = (raw.QuyetDinh || []).filter((d) => str(d.id) || str(d.content)).map((d) => ({
    id: str(d.id), content: str(d.content), rule: str(d.rule), decider: str(d.decider), impact: str(d.impact),
    openedAt: str(d.openedAt), status: str(d.status) || 'Mở', result: str(d.result), decidedAt: str(d.decidedAt), source: str(d.source),
  }));
  const openDecisions = decisions.filter((d) => d.status !== 'Đã quyết' && d.status !== 'Huỷ');

  // ---- KPI mục tiêu
  const kpi = {
    total: targets.length,
    verified: targets.filter((t) => t.verified).length,
    reportedDone: targets.filter((t) => t.reportedDone).length,
    inProgress: targets.filter((t) => t.open && (t.status === 'Đang triển khai' || t.status === 'Nghẽn')).length,
    notStarted: targets.filter((t) => t.open && t.status === 'Chưa bắt đầu').length,
    overdue: targets.filter((t) => t.overdue).length,
    blocked: targets.filter((t) => t.blocked).length,
    removed: removedTargets.length,
  };
  kpi.doneOrReported = kpi.verified + kpi.reportedDone;
  kpi.donePct = kpi.total ? Math.round((kpi.doneOrReported / kpi.total) * 1000) / 10 : 0;

  // ---- Time-box
  let phase = 'running';
  if (start && now < start) phase = 'before';
  if (end && now > end) phase = 'ended';
  const totalDays = start && end ? Math.max(1, Math.round((vnStartOfDay(end) - vnStartOfDay(start)) / DAY_MS) + 1) : null;
  const dayIndex = start ? Math.min(totalDays || 1, Math.max(0, Math.floor((vnStartOfDay(now) - vnStartOfDay(start)) / DAY_MS) + 1)) : null;
  const timebox = {
    phase, start, end, totalDays, dayIndex,
    elapsedPct: start && end ? Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100))) : null,
    text: phase === 'before' ? `Mở sau ${humanDuration(start - now)}`
      : phase === 'ended' ? 'Đã kết thúc time-box'
        : `Còn ${humanDuration(end - now)}`,
    rangeText: start && end ? `${fmtVn(start, { time: false, year: false })}–${fmtVn(end, { time: false, year: false })}` : '',
  };

  // ---- Ca trực
  const shift = currentShift(now, cfg);
  const shifts = (raw.CaTruc || []).map((s) => ({
    dateMs: parseVnDateTime(str(s.date), { defaultYear: year }), shift: normShift(s.shift), person: str(s.person), unit: str(s.unit),
  })).filter((s) => s.dateMs !== null && s.person);
  const onDuty = shifts.filter((s) => vnDayKey(s.dateMs) === vnDayKey(shift.dateMs) && s.shift === shift.name);
  const slots = [];
  if (start && end) {
    for (let d = vnStartOfDay(start); d <= vnStartOfDay(end); d += DAY_MS) {
      for (const name of ['Ngày', 'Đêm']) {
        const people = shifts.filter((s) => vnDayKey(s.dateMs) === vnDayKey(d) && s.shift === name);
        slots.push({ dayLabel: fmtVn(d, { time: false, year: false }), name, count: people.length, people: people.map((p) => p.person) });
      }
    }
  }

  // ---- Real-time: lần cập nhật gần nhất
  const lastActivity = raw.meta?.lastActivity
    || Math.max(0, ...allTargets.map((t) => parseVnDateTime(t.updatedAt, { defaultYear: year }) || 0)) || null;
  const ageMs = lastActivity ? now - lastActivity : null;

  // ---- 5 nguyên tắc
  const ownerFails = activeTargets.filter((t) => !t.checks.owner.ok);
  const outputFails = activeTargets.filter((t) => !t.checks.output.ok);
  const evidenceFails = targets.filter((t) => t.missingEvidence);
  const deadlineFails = activeTargets.filter((t) => !t.checks.deadline.ok);
  const rules = [
    {
      key: 'realtime', name: 'REAL-TIME', ok: ageMs !== null && ageMs <= cfg.staleMinutes * 60000,
      status: ageMs === null ? 'Chưa có cập nhật' : `Cập nhật ${humanAgo(ageMs)}`,
    },
    { key: 'owner', name: 'ONE OWNER', ok: ownerFails.length === 0, status: ownerFails.length ? `${ownerFails.length}/${activeTargets.length} chưa có 1 owner` : 'Đủ owner' },
    { key: 'waiting', name: 'ZERO WAITING', ok: waitingItems.length === 0, status: waitingItems.length ? `${waitingItems.length} điểm chờ` : 'Không có điểm chờ' },
    {
      key: 'e2e', name: 'END-TO-END', ok: outputFails.length + evidenceFails.length === 0,
      status: outputFails.length + evidenceFails.length
        ? `${outputFails.length}/${activeTargets.length} thiếu đầu ra đo được${evidenceFails.length ? ` · ${evidenceFails.length} đóng thiếu chứng từ` : ''}`
        : `Đạt · ${kpi.reportedDone} chờ chứng từ`,
    },
    {
      key: 'timebox', name: 'TIME BOX', ok: deadlineFails.length + kpi.overdue === 0,
      status: deadlineFails.length + kpi.overdue ? `${deadlineFails.length} chưa có hạn · ${kpi.overdue} quá hạn` : 'Đạt',
    },
  ];

  // ---- Câu "Điều cần biết ngay"
  const issues = [];
  if (!moneyTarget) issues.push('chưa có chỉ tiêu tiền');
  if (!collected) issues.push('chưa ghi nhận tiền thu có chứng từ');
  const streamsNoPeople = streams.filter((s) => s.state === 'noPeople').length;
  const streamsDefined = streams.filter((s) => s.state !== 'undefined').length;
  if (streamsNoPeople) issues.push(`${streamsNoPeople}/10 dòng tiền chưa có người phụ trách`);
  if (ownerFails.length) issues.push(`${ownerFails.length}/${activeTargets.length} mục tiêu đang làm chưa có 1 người chịu trách nhiệm`);
  if (kpi.reportedDone) issues.push(`${kpi.reportedDone} mục tiêu báo xong đang chờ chứng từ`);
  if (kpi.overdue) issues.push(`${kpi.overdue} mục tiêu quá hạn`);
  if (streamsDefined < 10) issues.push(`danh mục mới có ${streamsDefined}/10 dòng tiền`);
  const lead = `${kpi.doneOrReported}/${kpi.total} mục tiêu đã báo hoàn thành (${kpi.verified} đã kiểm chứng chứng từ)`;
  const headline = issues.length ? `${lead}. Cần xử lý: ${issues.join('; ')}.` : `${lead}. Không có vi phạm nguyên tắc — giữ nhịp cập nhật.`;

  // ---- Sắp xếp mục tiêu: việc cần chú ý lên trước
  const sortedTargets = [...targets].sort((a, b) => {
    const score = (t) => (t.verified ? -100 : 0) + (t.overdue ? 40 : 0) + (t.blocked ? 30 : 0) + (t.placeholder ? -5 : 0) + t.violations * 5;
    return score(b) - score(a) || a.id.localeCompare(b.id, 'vi', { numeric: true });
  });

  // ---- Đề xuất AI, nhật ký, báo cáo
  const proposals = (raw.DeXuatAI || []).map((p) => ({ ...p, _row: p._row }));
  const pendingProposals = proposals.filter((p) => str(p.status) === 'Chờ duyệt' || !str(p.status));
  const recentReviewed = proposals.filter((p) => str(p.status) && str(p.status) !== 'Chờ duyệt').slice(-10).reverse();
  const log = (raw.NhatKy || []).slice(-80).reverse();
  const reports = (raw.BaoCao || []).slice(-5).reverse();

  return {
    generatedAt: now,
    timebox, shift: { ...shift, onDuty, slots, slotsCovered: slots.filter((s) => s.count > 0).length },
    headline, issues, rules, kpi,
    money: { collected, pendingCollected, unlocked, moneyTarget, collections: collections.slice(-20).reverse() },
    waiting: { total: waitingItems.length, byKind: waitingByKind, items: waitingItems },
    decisions: { open: openDecisions, all: decisions },
    streams, targets: sortedTargets, removedTargets,
    proposals: { pending: pendingProposals, recent: recentReviewed },
    log, reports,
    lastActivity, lastActivityText: ageMs === null ? '' : humanAgo(ageMs),
  };
}

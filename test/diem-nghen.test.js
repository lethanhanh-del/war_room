// Trang Điểm nghẽn (public/diem-nghen-model.js) và báo cáo phê duyệt KPI (src/kpi/approval-report.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, SUPPORT_GAP_LABEL, dueHint, dueText, isSoon, kindLabel, mergeUnits, supportGap, parseBlockers, parseDeadline, parseDuration, statusCode, streamParts, splitTasks, summarize } from '../public/diem-nghen-model.js';
import { approvalRows, approvalWorkbook } from '../src/kpi/approval-report.js';
import { writeXlsx } from '../src/kpi/xlsx-write.js';
import { countWaitingPointPeopleFromCsv } from '../src/waiting-point-sync.js';

// 10:00 23/11/2026 giờ Việt Nam
const NOW = Date.parse('2026-11-23T03:00:00Z');

// Đúng mẫu tab "Điểm nghẽn" hiện tại: ô HƯỚNG DẪN phía trên cũng có chữ "Dòng tiền", "Vấn đề gặp phải".
const CSV = [
  '"HƯỚNG DẪN:\nCách báo: điền đủ 6 ô:\n1) Dòng tiền\n3) Vấn đề gặp phải: ghi ngắn",,,,,,,,,',
  'STT,Dòng tiền,Nhóm,Phân loại điểm nghẽn,Nội dung điểm nghẽn,Task,Người phụ trách,Người hỗ trợ,Trạng thái,Thời gian xử lý (Deadline)',
  '1,Dòng tiền 1: Bán 4 dự án,Data,Khách hàng / đối tác,"Mẫu Zalo cần 2–3 ngày duyệt","- Gửi lại mẫu cho Zalo\n- DAIT kiểm tra tài khoản OA",Trần Thị Xuân Thi,"DAIT, Tường Vi",Đang xử lý,22/11 17:30',
  '2,Dòng tiền 4: Dòng tiền thu trước hạn/quá hạn,,,Tiến độ ra sổ hồng I-Home,,Phạm Hoàng Oanh,,Chờ xử lý,23/11/2026',
  '3,Dòng tiền 3: Nợ khó đòi,VPC,Pháp lý,Chưa có biên bản đối chiếu,Ký biên bản; Gửi tòa,Mạc Thị Thúy Hiền,Ban Pháp chế,Cần quyết định,',
  '4,Dòng tiền 1: Bán 4 dự án,Networking,,Thiếu Data khách VIP,,Hoàng Thị Quỳnh Mai,Mai Tâm,Đã xử lý,25/11/2026',
  '5,,,,,,,,,',
  '6,Dòng tiền 2: Banking,H300,,Ngân hàng yêu cầu BCTC quý III,,Trần Thị B,Phòng Tài chính,Chờ phối hợp,23/11 15:00',
].join('\n');

test('parseBlockers: nhận đúng dòng tiêu đề (bỏ ô HƯỚNG DẪN), cột Task, trạng thái, hạn; bỏ dòng trống', () => {
  const r = parseBlockers(CSV, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.columns.hasTask, true);
  assert.deepEqual(r.items.map((it) => [it.stt, it.no, it.streamShort, it.status]), [
    ['1', 1, 'Bán 4 dự án', 'doing'],
    ['2', 4, 'Thu trước hạn/quá hạn', 'new'],
    ['3', 3, 'Nợ khó đòi', 'decide'],
    ['4', 1, 'Bán 4 dự án', 'done'],
    ['6', 2, 'Banking', 'coord'],
  ]);
  const [a, b, c] = r.items;
  assert.deepEqual(a.tasks, ['Gửi lại mẫu cho Zalo', 'DAIT kiểm tra tài khoản OA']);
  assert.deepEqual(c.tasks, ['Ký biên bản', 'Gửi tòa']);
  assert.equal(a.kind, 'Khách hàng / đối tác');
  assert.equal(a.supporter, 'DAIT, Tường Vi');
  assert.equal(b.supporter, '');
  assert.equal(dueText(a), '22/11 · 17:30');
  assert.equal(dueText(b), '23/11'); // chỉ có ngày: hạn hết ngày 23/11
  assert.equal(c.due, null);
});

test('summarize: quá hạn lên đầu rồi theo hạn gần nhất, chưa có hạn cuối; đếm 5 thẻ số, dòng tiền, người phụ trách', () => {
  const s = summarize(parseBlockers(CSV, NOW).items, NOW);
  assert.deepEqual(s.open.map((it) => [it.stt, it.dueState]), [['1', 'overdue'], ['6', 'today'], ['2', 'today'], ['3', 'none']]);
  assert.deepEqual(s.counts, { open: 4, overdue: 1, today: 2, soon: 0, noSupporter: 1, noDue: 1, done: 1, streams: 4 });
  // Sắp đến hạn = chưa quá hạn và còn dưới 2 giờ: hạn 15:00, lúc 13:00 còn đúng 2 giờ (chưa tính), 13:01 thì tính, 15:00 là quá hạn.
  const six = s.open.find((it) => it.stt === '6');
  const vn = (h, m) => Date.parse(`2026-11-23T${String(h - 7).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  assert.deepEqual([isSoon(six, vn(13, 0)), isSoon(six, vn(13, 1)), isSoon(six, vn(14, 59)), isSoon(six, vn(15, 0))], [false, true, true, false]);
  assert.equal(summarize(parseBlockers(CSV, vn(14, 0)).items, vn(14, 0)).counts.soon, 1);
  assert.deepEqual(s.byStatus, { unset: 0, new: 1, doing: 1, coord: 1, decide: 1 });
  assert.deepEqual(s.streams.map((x) => [x.no, x.open, x.overdue]), [[1, 1, 1], [2, 1, 0], [3, 1, 0], [4, 1, 0]]);
  assert.equal(s.owners[0].name, 'Trần Thị Xuân Thi'); // có điểm nghẽn quá hạn lên đầu
  assert.equal(dueHint(s.open[0], NOW), 'Trễ 16 giờ');
  assert.equal(dueHint(s.open[1], NOW), 'Còn 5 giờ 0 phút');
});

test('Điểm nghẽn: đọc hạn, trạng thái, tên dòng tiền, task con', () => {
  const at = (t) => { const d = parseDeadline(t, NOW); return d.at ? new Date(d.at + 7 * 3600e3).toISOString().slice(0, 16) : null; };
  assert.equal(at('23/11 17:30'), '2026-11-23T17:30');
  assert.equal(at('17h30 24/11'), '2026-11-24T17:30');
  assert.equal(at('Trước 9h ngày 26/11'), '2026-11-26T09:00');
  assert.equal(at('17:30'), '2026-11-23T17:30');
  assert.equal(at('25/11/2026'), '2026-11-25T23:59');
  assert.equal(at('hôm nay'), null);
  assert.equal(STATUS.unset.label, 'Cần cập nhật trạng thái'); // ô Trạng thái trống
  for (const [v, c] of [['', 'unset'], ['  ', 'unset'], ['Chờ xử lý', 'new'], ['Đang xử lý', 'doing'], ['Chờ phối hợp', 'coord'], ['Cần quyết định', 'decide'], ['Đã xử lý', 'done'], ['Hoàn thành', 'done']]) assert.equal(statusCode(v), c, v);
  assert.deepEqual(streamParts('Dòng tiền 4: Dòng tiền thu trước hạn/quá hạn'), { no: 4, short: 'Thu trước hạn/quá hạn' });
  assert.deepEqual(streamParts('Dòng tiền 2: Banking'), { no: 2, short: 'Banking' });
  assert.deepEqual(streamParts('Nhóm hỗ trợ'), { no: null, short: 'Nhóm hỗ trợ' });
  assert.deepEqual(splitTasks('1. Gọi khách\n2) Gửi hồ sơ;• Chờ duyệt'), ['Gọi khách', 'Gửi hồ sơ', 'Chờ duyệt']);
  // Bộ đếm cho nút "Tự chuyển tab" cũng bỏ ô HƯỚNG DẪN, nhận cột "Nội dung điểm nghẽn"
  assert.deepEqual(countWaitingPointPeopleFromCsv(CSV), { peopleCount: 4, itemCount: 4, sec: 40 }); // bỏ dòng Đã xử lý
});

// Layout thật của tab "Điểm nghẽn" trên file SharePoint WR - MASTER TASK (đọc 23/11/2026): 13 cột A–M, không gộp ô,
// cột STT đánh số sẵn cho cả dòng chưa nhập, có 3 cột "Đơn vị …" và cột "Nội dung hỗ trợ".
const s0 = (items) => items.reduce((c, it) => ({ ...c, [it.status]: (c[it.status] || 0) + 1 }), {});
const SP_CSV = [
  'HƯỚNG DẪN: Dùng khi công việc gặp điểm nghẽn.,,,,,,,,,,,,',
  'STT,Dòng tiền,Nhóm,Phân loại điểm nghẽn,Nội dung điểm nghẽn,Người phụ trách,Đơn vị Người phụ trách,Người hỗ trợ,Đơn vị người hỗ trợ,Đơn vị hỗ trợ,Nội dung hỗ trợ,Trạng thái,Thời gian xử lý (Deadline)',
  '1,Dòng tiền 1: Bán 4 dự án,Data,Internal,Chưa quảng cáo bằng Open AI,Trần Thị Xuân Thi,Phòng Marcom,,,,,,',
  '2,Dòng tiền 1: Bán 4 dự án,Data,external,Thiếu nguồn quản lý Data,Trần Thị Xuân Thi,Phòng Marcom,Nguyễn Thanh Phong,DAIT,Ban DAIT,Tìm kiếm/ Cung cấp hệ thống quản lý data,Chờ xử lý,22/11/2026-25/11/2026',
  '6,Dòng tiền 4: Dòng tiền thu trước hạn/quá hạn,,,Tiến độ ra sổ hồng dự án I-Home PVC,Phạm Hoàng Oanh,,Ngô Thị Thu Thủy,,,,,',
  '8,,,,,,,,,,,,',
  '9,Dòng tiền 1: Bán 4 dự án,Networking,,Thiếu Data khách VIP,Hoàng Thị Quỳnh Mai,Phòng Sales,,,,,Chờ xử lý,25/11/2026',
  '10,,,External,Thiếu hệ thống quản lý nhân sự,Hoàng Thị Quỳnh Mai,Phòng Sales,,,Ban DAIT,Cung cấp hệ thống phân bổ khách,Chờ xử lý,1 giờ 30 phút',
  '13,,,,Thiếu nhân sự khối tài chính,,,,,,,,23/11/2026',
].join('\n');

test('Điểm nghẽn: đọc đúng layout 13 cột trên SharePoint (đơn vị, nội dung hỗ trợ, khoảng ngày, thời lượng)', () => {
  const r = parseBlockers(SP_CSV, NOW);
  assert.equal(r.error, undefined);
  assert.deepEqual([r.columns.owner, r.columns.ownerUnit, r.columns.supporter, r.columns.supporterUnit, r.columns.supportUnit, r.columns.supportContent, r.columns.content, r.columns.hasTask], [5, 6, 7, 8, 9, 10, 4, false]);
  assert.deepEqual(r.items.map((it) => it.stt), ['1', '2', '6', '9', '10', '13']); // dòng 8 chỉ có STT: bỏ
  const [a, b, , , e, f] = r.items;
  assert.deepEqual([a.owner, a.ownerUnit, a.kind, a.supporter, a.status], ['Trần Thị Xuân Thi', 'Phòng Marcom', 'Internal', '', 'unset']); // ô Trạng thái trống
  assert.deepEqual(s0(r.items), { unset: 3, new: 3 });
  // Hỗ trợ phải có cả người lẫn đơn vị: STT 1 thiếu cả hai, 2 đủ, 6 chỉ có người, 10 chỉ có đơn vị.
  assert.deepEqual(r.items.map((it) => [it.stt, supportGap(it)]), [['1', 'both'], ['2', ''], ['6', 'unit'], ['9', 'both'], ['10', 'person'], ['13', 'both']]);
  assert.deepEqual([SUPPORT_GAP_LABEL.unit, SUPPORT_GAP_LABEL.person, SUPPORT_GAP_LABEL.both], ['Cần cập nhật đơn vị hỗ trợ', 'Cần cập nhật người hỗ trợ', 'Cần cập nhật người/đơn vị hỗ trợ']);
  assert.deepEqual([b.kind, b.supporter, mergeUnits(b.supporterUnit, b.supportUnit), b.supportContent], ['External', 'Nguyễn Thanh Phong', 'Ban DAIT', 'Tìm kiếm/ Cung cấp hệ thống quản lý data']);
  // Khoảng ngày: hạn là hết ngày cuối (25/11), không phải ngày đầu.
  assert.equal(dueText(b), '22/11 – 25/11');
  assert.equal(new Date(b.due + 7 * 3600e3).toISOString().slice(0, 16), '2026-11-25T23:59');
  // Thời lượng theo danh sách chọn của cột: không thành giờ "01:30", không có hạn tuyệt đối.
  assert.deepEqual([e.due, e.duration, dueHint(e, NOW), e.stream, e.supportUnit], [null, '1 giờ 30 phút', 'Xử lý trong 1 giờ 30 phút', '', 'Ban DAIT']);
  assert.deepEqual([f.owner, dueText(f)], ['', '23/11']);
  const s = summarize(r.items, NOW);
  assert.deepEqual(s.open.map((it) => [it.stt, it.dueState]), [['13', 'today'], ['2', 'later'], ['9', 'later'], ['1', 'none'], ['6', 'none'], ['10', 'none']]);
  // noSupporter: chưa có cả người lẫn đơn vị hỗ trợ (STT 10 có "Đơn vị hỗ trợ"); noDue: không tính dòng ghi thời lượng.
  assert.deepEqual(s.counts, { open: 6, overdue: 0, today: 1, soon: 0, noSupporter: 3, noDue: 2, done: 0, streams: 2 }); // streams: DT 1 và DT 4
  assert.equal(statusCode('Chờ xử lý'), 'new');
  assert.deepEqual([parseDuration('30 phút'), parseDuration('1 giờ 30 phút'), parseDuration('1 ngày'), parseDuration('17h30'), parseDuration('25/11/2026')], [30, 90, 1440, null, null]);
  assert.deepEqual([kindLabel('external'), kindLabel('INTERNAL'), kindLabel('Pháp lý')], ['External', 'Internal', 'Pháp lý']);
  assert.equal(mergeUnits('Phòng Sales', 'Ban DAIT', 'DAIT'), 'Phòng Sales · Ban DAIT');
  const at = (t) => { const d = parseDeadline(t, NOW); return d.at ? [new Date((d.from ?? d.at) + 7 * 3600e3).toISOString().slice(5, 10), new Date(d.at + 7 * 3600e3).toISOString().slice(5, 10)] : null; };
  assert.deepEqual(at('22/11 đến 25/11'), ['11-22', '11-25']);
  assert.deepEqual(at('22-25/11/2026'), ['11-22', '11-25']);
});

test('Báo cáo phê duyệt KPI: 1 dòng / nhóm theo mẫu, giữ chữ trạng thái trên sheet, file .xlsx hợp lệ', () => {
  const rows = approvalRows([
    { name: 'Dòng tiền bán 4 dự án', groups: [
      { name: 'Networking', pic: { name: 'Hoàng Thị Quỳnh Mai' }, approval: { code: 'A', label: 'Đã được BOD tạm duyệt', directive: 'Liên tục cập nhật' }, rows: [{ cells: { '2026-11-21': { kpi: 'Gặp 5 khách' }, '2026-11-22': { kpi: 'Gặp 5 khách' } } }, { cells: { '2026-11-22': { kpi: 'Gọi 20 khách' } } }] },
      { name: 'Data', pic: { name: 'Lê Thị Mai Tâm' }, approval: { code: 'R', label: 'Cần điều chỉnh', note: 'Điều chỉnh lại KPI theo góp ý của BOD' }, rows: [] },
    ] },
    { name: 'Dòng tiền Banking', bodApproved: false, pic: 'Nguyễn Thị Mai Thu', groups: [{ name: 'H300', rows: [] }] },
  ]);
  assert.deepEqual(rows.map((r) => [r.stream, r.group, r.pic, r.tasks, r.code, r.status, r.directive, r.note]), [
    ['Dòng tiền bán 4 dự án', 'Networking', 'Hoàng Thị Quỳnh Mai', 'Gặp 5 khách\nGọi 20 khách', 'A', 'Đã được BOD tạm duyệt', 'Liên tục cập nhật', ''],
    ['Dòng tiền bán 4 dự án', 'Data', 'Lê Thị Mai Tâm', 'Data', 'R', 'Cần điều chỉnh', '', 'Điều chỉnh lại KPI theo góp ý của BOD'],
    ['Dòng tiền Banking', 'H300', 'Nguyễn Thị Mai Thu', 'H300', 'N', 'Chưa trình BOD', '', ''],
  ]);
  const book = approvalWorkbook({ rows, sheetUrl: '', checkedAt: '', by: 'test', now: NOW });
  const head = book[0].rows.find((r) => r[0] === 'Stt');
  assert.deepEqual(head, ['Stt', 'Dòng tiền', 'Nhóm', 'Đội trưởng/Phụ trách', 'Nhiệm vụ', 'Tình trạng phê duyệt KPI', 'Chỉ đạo của BLĐ tại tờ trình', 'Ghi chú']);
  assert.deepEqual(book[1].rows.at(-1), ['Tổng', 3, 1, 1, 1, '']);
  const bytes = writeXlsx(book);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  assert.ok(new TextDecoder().decode(bytes).includes('<fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/>'));
});

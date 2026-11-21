// DỮ LIỆU MẪU cho dashboard dòng tiền (mở bằng ?demo=1).
// Cùng cấu trúc với dự án WAR ROOM thật trên Worksuite: mỗi dòng tiền là 1 task nhóm "Dòng tiền …",
// task con bên dưới giao cho từng người. Tên dòng tiền theo Worksuite; nhân sự theo file War Room 20/11;
// task con, % tiến độ, hạn và lý do chờ là GIẢ ĐỊNH để dựng giao diện — không phải số liệu thật.

export const DEMO_NOW = Date.UTC(2026, 10, 21, 8, 0, 0); // 21/11/2026 15:00 giờ Việt Nam

const PEOPLE = {
  QM: ['Hoàng Thị Quỳnh Mai', 'Trưởng phòng Sales', 'Ban Kinh doanh - CTG'],
  XT: ['Trần Thị Xuân Thi', 'Phó phòng Marcom', 'Ban Kinh doanh - CTG'],
  KC: ['Nguyễn Thị Kim Cúc', 'Phó phòng KD BĐS cho thuê', 'Ban Kinh doanh - CTG'],
  TH: ['Mạc Thị Thúy Hiền', 'Trưởng phòng Đối ngoại', 'Ban Đối ngoại - CTG'],
  MT: ['Lê Thị Mai Tâm', 'Trợ lý Chủ tịch', 'Văn phòng Chủ tịch - CTG'],
  NT: ['Nguyễn Lê Minh Tân', 'Vận hành ứng dụng', 'DAIT - CTG'],
  MH: ['Trần Minh Huy', 'Chuyên viên KD BĐS cho thuê', 'Ban Kinh doanh - CTG'],
  TA: ['Trương Huỳnh Thúy An', 'Junior AI Engineer', 'DAIT - CTG'],
  HN: ['Nguyễn Trần Hải Nam', 'Thực tập sinh', 'Ban Kinh doanh - CTG'],
  UT: ['Trịnh Hoàng Uyên Thy', 'Nhân viên truyền thông', 'Ban Kinh doanh - CTG'],
  TV: ['Trần Lê Tường Vi', 'Trưởng nhóm Marcom', 'Ban Kinh doanh - CTG'],
  HL: ['Phan Hoàng Long', 'Nhân viên Digital Marketing', 'Ban Kinh doanh - CTG'],
  HH: ['Võ Đào Huy Hoàng', 'Security Engineer', 'DAIT - CTG'],
  NV: ['Trần Ngọc Vy', 'Nhân viên Pháp chế', 'Phòng Tổng vụ - CTG'],
  MY: ['Trần Thị Mỹ Hạnh', 'Thư ký BKD', 'Ban Kinh doanh - CTG'],
  TT: ['Ngô Thị Thu Thủy', 'Phó TGĐ phụ trách Phát triển dự án', 'Ban PTDA - CTG'],
  HT: ['Hoàng Thị Hà Thu', 'Trưởng phòng CSKH', 'Ban Kinh doanh - CTG'],
  TN: ['Nguyễn Thế Nhiên', 'Quyền GĐ Ban TC-KT', 'Ban Tài chính - Kế toán - CTG'],
  MU: ['Nguyễn Thị Mai Thu', 'GĐ Ban Kế toán 1', 'Ban Tài chính - Kế toán - CTG'],
  TS: ['Võ Trường Sơn', 'Giám đốc Ban XD', 'Ban XD - CTG'],
  CS: ['Lê Công Sum', 'Giám đốc HTC', 'HTC - CTG'],
  NA: ['Huỳnh Ngọc Nhật Tài', 'Trưởng nhóm Tài chính cá nhân', 'Ban Tài chính - Kế toán - CTG'],
  TO: ['Châu Thị Thảo Oanh', 'Kế toán trưởng', 'HTC - CTG'],
  VI: ['Mr. Vinh', 'Quyền Vụ trưởng Vụ Pháp chế', 'Vụ Pháp chế - CTG'],
};

// [mã người, tiêu đề, trạng thái Worksuite, % tiến độ, hạn, lý do chờ?]
const W = 'In Progress', O = 'Open', R = 'In Review', C = 'Completed', P = 'Pending';
const STREAMS = [
  ['Dòng tiền Banking', 'MU', [
    ['TN', 'Soát xét toàn bộ hồ sơ vay', W, 50, '2026-11-23 17:00:00'],
    ['TN', 'Làm việc với 2 ngân hàng về hạn mức', P, 20, '2026-11-24 17:00:00', 'Chờ ngân hàng xác nhận lịch làm việc'],
    ['MU', 'Kế hoạch kinh doanh SS1 và N20', W, 60, '2026-11-20 17:00:00'],
    ['MU', 'Phương án tài chính SS1', C, 100, '2026-11-21 10:00:00'],
    ['TS', 'Hồ sơ tiến độ xây dựng và dự toán', W, 70, '2026-11-22 17:00:00'],
    ['TS', 'Hình ảnh công trường gửi ngân hàng', C, 100, '2026-11-21 09:00:00'],
    ['CS', 'Kết nối 2 nhóm thi hành án', W, 30, '2026-11-24 17:00:00'],
    ['NA', 'Soạn hồ sơ SS1 và N20', R, 90, '2026-11-21 18:00:00'],
    ['NA', 'Checklist hồ sơ ngân hàng', C, 100, '2026-11-21 11:00:00'],
  ]],
  ['Dòng tiền Tài chính phụ trách triển khai và chịu trách nhiệm 10 dòng tiền', 'TN', [
    ['TN', 'Tổng hợp tiền thu 10 dòng tiền mỗi ca', W, 40, '2026-11-21 18:00:00'],
    ['MU', 'Thành lập Ban Tài chính 57', C, 100, '2026-11-21 10:00:00'],
    ['MU', 'Danh mục chương trình tài trợ KHCN', W, 40, '2026-11-23 17:00:00'],
    ['NA', 'Rà soát ưu đãi thuế', W, 30, '2026-11-24 17:00:00'],
    ['NA', 'Quy trình khai thác các cơ hội tài trợ', O, 0, '2026-11-25 17:00:00'],
  ]],
  ['Dòng tiền kiểm soát kỷ luật War-Room', null, []],
  ['Dòng tiền bán 4 dự án', 'QM', [
    ['QM', 'Chốt danh sách 50 khách hàng networking', W, 70, '2026-11-22 17:00:00'],
    ['QM', 'Báo cáo kết quả networking ngày 21/11', R, 80, '2026-11-21 18:00:00'],
    ['QM', 'Họp giao ban nhóm networking 2 ca', C, 100, '2026-11-21 09:30:00'],
    ['QM', 'Kịch bản gặp khách VIP dự án I-Home', W, 30, '2026-11-24 12:00:00'],
    ['XT', 'Làm sạch data khách hàng 4 dự án', W, 60, '2026-11-21 12:00:00'],
    ['XT', 'Lọc data khách cũ có nhu cầu đầu tư lại', W, 40, '2026-11-23 17:00:00'],
    ['XT', 'Bàn giao data cho nhóm telesale', O, 0, '2026-11-24 12:00:00'],
    ['KC', 'Gửi chính sách bán hàng mới cho đại lý', W, 80, '2026-11-21 10:00:00'],
    ['KC', 'Ký hợp đồng với 3 đại lý mới', W, 30, '2026-11-24 17:00:00'],
    ['TH', 'Kết nối 10 đối tác networking cấp cao', W, 50, '2026-11-23 17:00:00'],
    ['MT', 'Phân loại data theo từng dự án', W, 50, '2026-11-22 17:00:00'],
    ['MT', 'Tổng hợp data khách hàng từ Văn phòng Chủ tịch', C, 100, '2026-11-21 11:00:00'],
    ['NT', 'Thử nghiệm app gửi tin viral marketing', W, 40, '2026-11-23 17:00:00'],
    ['MH', 'Gọi lại 20 đại lý cũ', W, 45, '2026-11-22 17:00:00'],
    ['UT', 'Bài truyền thông cho 4 dự án', R, 90, '2026-11-21 18:00:00'],
    ['TV', 'Bộ tài liệu bán hàng bản cập nhật', W, 70, '2026-11-22 17:00:00'],
    ['HL', 'Chạy quảng cáo thu data dự án I-Home', W, 35, '2026-11-24 17:00:00'],
    ['NV', 'Rà soát hồ sơ pháp lý bán hàng', W, 50, '2026-11-23 17:00:00'],
    ['MY', 'Chuẩn bị hợp đồng mẫu', C, 100, '2026-11-21 11:00:00'],
    ['TT', 'Xử lý pháp lý Liên Chiểu, Bồng Sơn, I-Home sổ hồng', P, 30, '2026-11-25 17:00:00', 'Chờ chốt 1 nhân sự phụ trách pháp lý dự án'],
  ]],
  ['Dòng tiền nợ khó đòi', 'TH', [
    ['CS', 'Làm việc với thi hành án về biện pháp cưỡng chế', W, 40, '2026-11-20 17:00:00'],
    ['CS', 'Danh sách tài sản có thể kê biên', W, 30, '2026-11-19 17:00:00'],
    ['TH', 'Thúc đẩy tòa ra bản án', W, 20, '2026-11-20 17:00:00'],
    ['TH', 'Hồ sơ khởi kiện bổ sung', C, 100, '2026-11-21 10:00:00'],
    ['TO', 'Đối chiếu công nợ 12 khách hàng', W, 50, '2026-11-21 12:00:00'],
    ['TO', 'Trực chiến hồ sơ', W, 40, '2026-11-23 17:00:00'],
    ['VI', 'Ý kiến pháp lý cho hồ sơ cưỡng chế', C, 100, '2026-11-21 09:00:00'],
  ]],
  ['Dòng tiền thu trước hạn/quá hạn', 'HT', [
    ['HT', 'Gọi 40 khách hàng đến hạn thanh toán', W, 60, '2026-11-23 17:00:00'],
    ['HT', 'Chính sách chiết khấu thanh toán trước hạn', C, 100, '2026-11-21 10:00:00'],
    ['HT', 'Báo cáo tiền thu ngày 21/11', R, 90, '2026-11-21 18:00:00'],
    ['TH', 'Làm việc với 5 khách hàng quá hạn lớn', W, 50, '2026-11-24 17:00:00'],
  ]],
];

export function demoRaw() {
  const codes = Object.keys(PEOPLE);
  const empId = (k) => `HR-EMP-${String(codes.indexOf(k) + 1).padStart(5, '0')}`;
  const employees = codes.map((k) => ({
    name: empId(k),
    employee_name: PEOPLE[k][0],
    designation: PEOPLE[k][1],
    department: PEOPLE[k][2],
    user_id: `${k.toLowerCase()}@demo.ctgroup`,
  }));
  const tasks = [];
  let n = 13956;
  let minute = 0;
  const creation = () => `2026-11-21 ${String(11 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute++ % 60).padStart(2, '0')}:00`;
  const add = (t) => { const task = { name: `TASK-2026-${n++}`, creation: creation(), progress: 0, ...t }; tasks.push(task); return task; };
  for (const [subject, pic, list] of STREAMS) {
    const group = add({
      subject, status: 'Open', is_group: 1, exp_end_date: '2026-11-26 03:30:00',
      custom_assignee: pic ? empId(pic) : null, custom_assignee_name: pic ? PEOPLE[pic][0] : null,
    });
    for (const [who, title, status, progress, due, blocker] of list) {
      add({
        subject: title, status, progress, exp_end_date: due, parent_task: group.name, is_group: 0,
        completed_on: status === C ? due.slice(0, 10) : null,
        custom_assignee: empId(who), custom_assignee_name: PEOPLE[who][0],
        custom_blocker_reason: blocker || null,
      });
    }
  }
  const support = add({ subject: 'Nhóm hỗ trợ', status: 'Open', is_group: 1, exp_end_date: '2026-11-26 03:30:00' });
  const it = add({ subject: 'Nhóm hỗ trợ IT', status: 'Open', is_group: 1, parent_task: support.name });
  add({ subject: 'Tạo Dashboard cho War Room', status: W, progress: 80, is_group: 0, parent_task: it.name, exp_end_date: '2026-11-21 14:30:00', custom_assignee: empId('NT'), custom_assignee_name: PEOPLE.NT[0] });
  return { project: { name: 'PROJ-0536', project_name: 'WAR ROOM ', status: 'In Progress' }, tasks, employees };
}

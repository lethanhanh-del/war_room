// Dữ liệu minh họa cho /kpi?demo=1, giống bản thiết kế Figma (hôm nay = 23/11/2026). Không phải số liệu thật.
const DATES = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'];
const days = DATES.map((d) => ({ date: d, label: `${d.slice(8)}/${d.slice(5, 7)}` }));
const key = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '');

let rowNo = 4;
/** list: 5 phần tử [KPI, 'D' | 'K' | 'C' | 'S'] hoặc null (ngày không có KPI). */
function row(person, list, note = '') {
  const cells = {};
  list.forEach((x, i) => { if (x) cells[DATES[i]] = { kpi: x[0], res: x[1] === 'D' || x[1] === 'K' ? x[1] : '' }; });
  rowNo += 1;
  return { row: rowNo, stt: '', person, note, folder: '', folderText: '', cells };
}
function group(name, pic, title, rows) {
  const persons = [...new Set(rows.map((r) => r.person))];
  return { key: key(name), name, pic: { name: pic, title }, members: persons.filter((p) => p !== pic), rows };
}
function stream(name, code, pic, groups) {
  return { key: key(name), name, sheet: `DÒNG TIỀN ${name.toUpperCase()}`, code, pic, days, groups };
}

const streams = [
  stream('Bán 4 dự án', 'DT01', 'Hoàng Thị Quỳnh Mai', [
    group('Networking', 'Hoàng Thị Quỳnh Mai', 'Trưởng Phòng Sales', [
      row('Mạc Thị Thúy Hiền', [['Gặp 5 khách hàng VIP', 'D'], ['Tổ chức networking 30 khách', 'D'], ['Chốt 3 khách giữ chỗ', 'D'], ['Thu cọc 2 căn', 'S'], ['Chốt doanh số tuần', 'S']]),
      row('Trương Huỳnh Thúy An', [['Gọi 40 khách hàng cũ', 'D'], ['Mời 15 khách dự sự kiện', 'D'], ['Đưa 5 khách đi xem nhà mẫu', 'C'], ['Hẹn ký hợp đồng 2 khách', 'S'], ['Cập nhật CRM cuối tuần', 'S']]),
      row('Trương Ngọc Thảo', [['Chuẩn bị quà tặng sự kiện', 'D'], ['Chăm sóc 10 khách tiềm năng', 'K'], ['Gửi báo giá cho 8 khách', 'D'], ['Gọi lại 6 khách quan tâm', 'S'], ['Tổng hợp phản hồi khách', 'S']], '4/10 khách chưa phản hồi'),
    ]),
    group('Phụ trách đại lý', 'Nguyễn Thị Kim Cúc', 'Phó phòng kinh doanh BĐS cho thuê', [
      row('Trần Minh Huy', [['Gửi chính sách cho 10 đại lý', 'D'], null, null, ['Mở bán qua 5 đại lý', 'S'], null]),
      row('Nguyễn Thị Kim Cúc', [null, ['Đào tạo sản phẩm cho 3 đại lý', 'D'], ['Ký 2 hợp đồng đại lý F1', 'K'], null, ['Báo cáo doanh số đại lý', 'S']], '1/2 đại lý xin lùi lịch ký sang 24/11'),
    ]),
    group('Data', 'Lê Thị Mai Tâm', 'Trợ lý Chủ tịch', [
      row('Nguyễn Trần Hải Nam', [['Làm sạch 500 data khách cũ', 'K'], null, null, ['Cập nhật CRM sau cuộc gọi', 'S'], null], 'Chờ IT xuất file khách hàng từ CRM'),
      row('Trần Thị Xuân Thi', [null, ['Phân loại 300 data nóng', 'D'], ['Bàn giao 200 data cho Sales', 'C'], null, null]),
      row('Lê Thị Mai Tâm', [null, null, null, null, ['Báo cáo tỷ lệ chuyển đổi', 'S']]),
    ]),
    group('Tìm app gửi viral marketing', 'Võ Đào Huy Hoàng', '', [
      row('Võ Đào Huy Hoàng', [['Chọn app gửi tin hàng loạt', 'D'], ['Gửi thử 1.000 tin', 'D'], ['Gửi 5.000 tin chiến dịch', 'D'], ['Đo tỷ lệ phản hồi', 'S'], ['Tối ưu nội dung lần 2', 'S']]),
    ]),
    group('Hồ sơ, giấy tờ khác', 'Trần Ngọc Vy', '', [
      row('Trần Ngọc Vy', [['Rà soát hồ sơ 20 căn', 'K'], ['Bổ sung 12 bộ hồ sơ thiếu', 'D'], ['Hoàn thiện hồ sơ ký HĐMB', 'D'], ['Bàn giao hồ sơ cho Pháp lý', 'S'], ['Lưu trữ hồ sơ điện tử', 'S']], 'Còn thiếu 3 bộ hồ sơ gốc'),
    ]),
    group('Xử lý pháp lý Liên Chiểu, Bồng Sơn, I-Home sổ hồng', 'Ngô Thị Thu Thủy', '', [
      row('Ngô Thị Thu Thủy', [['Nộp hồ sơ sổ hồng I-Home đợt 1', 'D'], ['Làm việc Sở TN&MT về Bồng Sơn', 'K'], ['Nhận kết quả thẩm định Liên Chiểu', 'C'], ['Nhận sổ hồng I-Home đợt 1', 'S'], ['Báo cáo tiến độ pháp lý', 'S']], 'Sở TN&MT hẹn trả lời ngày 24/11'),
    ]),
  ]),
  stream('Banking', 'DT02', 'Nguyễn Thị Mai Thu', [
    group('SS1 – Hạn mức HDBank', 'Nguyễn Thị Mai Thu', 'Giám đốc Ban Kế toán 1', [
      row('Nguyễn Thế Nhiên', [['Chốt checklist hồ sơ HDBank', 'D'], ['Gửi phương án tài chính SS1', 'D'], ['Nộp đủ hồ sơ hạn mức cho HDBank', 'K'], ['HDBank thẩm định hồ sơ', 'S'], ['Chốt điều kiện hạn mức', 'S']], 'Thiếu dự toán chi tiết từ Ban Xây dựng'),
    ]),
    group('H300 – Delta', 'Nguyễn Thị Mai Thu', 'Giám đốc Ban Kế toán 1', [
      row('Lê Công Sum', [['Xin phán quyết vụ Delta', 'K'], ['Lên lịch làm việc với THA', 'D'], ['Chốt lịch làm việc chung với Delta', 'C'], ['Họp với Delta', 'S'], ['Báo cáo phương án', 'S']]),
    ]),
    group('Hồ sơ tín dụng', 'Nguyễn Thị Mai Thu', 'Giám đốc Ban Kế toán 1', [
      row('Huỳnh Ngọc Nhật Tài', [['Soát xét hồ sơ SS1 và N20', 'K'], ['Bổ sung báo cáo tài chính', 'K'], ['Hoàn thiện hồ sơ trình HDBank', 'D'], ['Gửi hồ sơ bổ sung', 'S'], ['Nhận phản hồi ngân hàng', 'S']]),
    ]),
  ]),
  stream('Nợ khó đòi', 'DT03', 'Mạc Thị Thúy Hiền', [
    group('Thúc đẩy tòa ra bản án', 'Mạc Thị Thúy Hiền', 'Trưởng Phòng Đối ngoại', [
      row('Mạc Thị Thúy Hiền', [['Nộp đơn đề nghị xét xử nhanh', 'D'], ['Làm việc với thẩm phán', 'D'], ['Nhận lịch xét xử', 'D'], ['Dự phiên tòa', 'S'], ['Báo cáo kết quả', 'S']]),
    ]),
    group('Thi hành án', 'Mạc Thị Thúy Hiền', 'Trưởng Phòng Đối ngoại', [
      row('Lê Văn Phúc', [['Gửi hồ sơ yêu cầu thi hành án', 'D'], ['Làm việc với Chi cục THA', 'D'], ['Làm việc với Chi cục THA quận 7', 'C'], ['Xác minh tài sản', 'S'], ['Đề xuất cưỡng chế', 'S']]),
    ]),
    group('Trực chiến hồ sơ', 'Mạc Thị Thúy Hiền', 'Trưởng Phòng Đối ngoại', [
      row('Phạm Thu Hà', [['Rà soát 15 hồ sơ nợ', 'K'], ['Gửi thư nhắc nợ 15 khách', 'D'], ['Gọi 20 khách nợ', 'D'], ['Lập danh sách khởi kiện', 'S'], ['Tổng hợp tiến độ thu', 'S']], 'Thiếu chứng từ gốc 3 hồ sơ'),
    ]),
  ]),
  stream('Tài chính', '', 'Phạm Thanh Hùng', [
    group('Kế hoạch dòng tiền', 'Phạm Thanh Hùng', 'Quyền Phó Tổng giám đốc', [
      row('Phạm Thanh Hùng', [['Chốt kế hoạch dòng tiền tuần', 'D'], ['Cập nhật dòng tiền 10 nguồn', 'D'], ['Báo cáo Chủ tịch', 'D'], ['Rà soát chi phí', 'S'], ['Tổng kết dòng tiền', 'S']]),
      row('Huỳnh Ngọc Nhật Tài', [['Báo cáo thu chi ngày 21/11', 'D'], ['Báo cáo thu chi ngày 22/11', 'D'], ['Báo cáo thu chi ngày 23/11', 'D'], ['Báo cáo thu chi ngày 24/11', 'S'], ['Báo cáo thu chi ngày 25/11', 'S']]),
    ]),
  ]),
  stream('Thu trước hạn / quá hạn', 'DT04', 'Hoàng Thị Hà Thu', [
    group('Thu trước hạn', 'Hoàng Thị Hà Thu', 'Trưởng nhóm thu hồi', [
      row('Hoàng Thị Hà Thu', [['Gọi 30 khách thu trước hạn', 'D'], ['Thu 800 triệu trước hạn', 'D'], ['Gọi 40 khách thu trước hạn', 'C'], ['Thu 1 tỷ trước hạn', 'S'], ['Chốt số thu tuần', 'S']]),
    ]),
    group('Thu quá hạn', 'Hoàng Thị Hà Thu', 'Trưởng nhóm thu hồi', [
      row('Trương Thị Thanh Hiền', [['Gửi thông báo nợ 25 khách', 'D'], ['Thu 600 triệu nợ quá hạn', 'K'], ['Thu 1,2 tỷ nợ quá hạn', 'K'], ['Gặp 5 khách nợ lớn', 'S'], ['Báo cáo nợ còn lại', 'S']], 'Khách hẹn chuyển khoản ngày 25/11'),
    ]),
    group('Đối soát công nợ', 'Hoàng Thị Hà Thu', 'Trưởng nhóm thu hồi', [
      row('Nguyễn Thị Lan', [['Đối soát 50 hợp đồng', 'K'], ['Đối soát 40 hợp đồng', 'K'], ['Đối soát 30 hợp đồng', 'D'], ['Chốt danh sách nợ', 'S'], ['Gửi xác nhận công nợ', 'S']]),
    ]),
  ]),
];

export const DEMO = {
  demo: true,
  source: { off: false, sheetUrl: '', checkedAt: '2026-11-23T07:32:00.000Z', changedAt: '2026-11-23T07:32:00.000Z', error: '', warnings: [] },
  now: Date.UTC(2026, 10, 23, 7, 32),
  today: '2026-11-23',
  days,
  streams,
};

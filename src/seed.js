// Dữ liệu khởi tạo cho Sổ mục tiêu — lấy từ báo cáo War Room 20/11/2026 và file nhân sự trên Drive.
// Chỗ nào là ƯỚC LƯỢNG hoặc CẦN BỔ SUNG đều ghi rõ ở cột "Ghi chú" để thư ký War Room xác nhận lại.

const SRC_REPORT = 'Báo cáo War Room 20/11/2026';
const NOTE_STAGE = 'Bước là ước lượng ban đầu từ báo cáo 20/11 — thư ký xác nhận lại';

export const SEED = {
  MucTieu: [
    {
      id: 'MT-01', stream: 'Hạ tầng điều hành', title: 'Hoàn thiện Dashboard theo dõi 10 dòng tiền',
      owner: 'IT (DAIT) & Tổng vụ', unit: 'DAIT',
      output: 'Dashboard real-time hiển thị từng mục tiêu, điểm nghẽn, dòng tiền trên màn hình Hội trường',
      criteria: '', start: '', deadline: '20/11/2026', stage: 4, status: 'Đang triển khai',
      note: `${SRC_REPORT}; hạn theo Chỉ đạo #2. ${NOTE_STAGE}`,
    },
    {
      id: 'MT-02', stream: 'DT01', title: 'Làm rõ phương án cho thuê',
      owner: 'Nguyễn Thị Kim Cúc', unit: 'Ban Kinh doanh',
      output: 'Phương án cho thuê', criteria: '', deadline: '', stage: 2, status: 'Đang triển khai',
      note: `${SRC_REPORT}. ${NOTE_STAGE}`,
    },
    {
      id: 'MT-03', stream: 'DT01', title: 'Chuẩn hóa dữ liệu khách hàng theo 5 tiêu chí',
      owner: 'Kinh doanh / Data', unit: 'Ban Kinh doanh',
      output: 'Dữ liệu khách hàng đạt 5 tiêu chí',
      criteria: 'Đúng – Đủ – Sạch – Sống – Đúng mục tiêu', deadline: '', stage: 4, status: 'Đang triển khai',
      note: `${SRC_REPORT}. ${NOTE_STAGE}`,
    },
    {
      id: 'MT-04', stream: 'DT01', title: 'Khắc phục email bị chặn / vào spam',
      owner: 'Kinh doanh / DAIT', unit: 'Ban Kinh doanh, DAIT',
      output: '', criteria: '', deadline: '', stage: 4, status: 'Nghẽn',
      blocker: 'Email gửi khách hàng bị chặn hoặc vào spam',
      note: `${SRC_REPORT}. ${NOTE_STAGE}`,
    },
    {
      id: 'MT-05', stream: 'DT01', title: 'Tối ưu phương thức tiếp cận khách hàng',
      owner: 'Kinh doanh', unit: 'Ban Kinh doanh',
      output: '', criteria: '', deadline: '', stage: 1, status: 'Đang triển khai',
      note: `${SRC_REPORT}. ${NOTE_STAGE}`,
    },
    {
      id: 'MT-06', stream: 'DT01', title: 'Chăm sóc, khai thác mạng lưới khách hàng',
      owner: 'Nhóm Networking', unit: 'Ban Kinh doanh, Ban Đối ngoại',
      output: '', criteria: '', deadline: '', stage: 4, status: 'Đang triển khai',
      note: `${SRC_REPORT}. ${NOTE_STAGE}`,
    },
    // Báo cáo 20/11 ghi 8 task đã hoàn thành nhưng không nêu tên -> giữ 8 dòng chờ bổ sung,
    // để ở "Chờ kiểm chứng" vì chưa có chứng từ (nguyên tắc End-to-End).
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `MT-${String(7 + i).padStart(2, '0')}`, stream: '',
      title: `(Cần bổ sung tên) Task đã báo hoàn thành #${i + 1}`,
      owner: '', output: '', criteria: '', deadline: '', stage: 5, status: 'Chờ kiểm chứng',
      note: `${SRC_REPORT} ghi đã hoàn thành nhưng không nêu tên. Cần tên, owner và chứng từ để đóng việc.`,
    })),
  ],

  DongTien: [
    { id: 'DT01', name: 'Dòng tiền bán 4 dự án', owner: '', staff: 15, note: 'Nhân sự theo file DANH SÁCH NHÂN SỰ WAR ROOM' },
    { id: 'DT02', name: 'Dòng tiền Banking', owner: '', staff: 5, note: '' },
    { id: 'DT03', name: 'Dòng tiền nợ khó đòi', owner: '', staff: 4, note: '' },
    { id: 'DT04', name: 'Dòng tiền thu trước hạn / quá hạn', owner: '', staff: 2, flag: 'Thiếu người', note: 'Còn 1 vị trí chờ bổ sung' },
    { id: 'DT05', name: 'Cổ phiếu – Equity · IPO / niêm yết', owner: '', staff: 0, note: 'Chưa phân công nhân sự' },
    { id: 'DT06', name: 'Trái phiếu', owner: '', staff: 0, note: 'Chưa phân công nhân sự' },
    { id: 'DT07', name: 'Các gói tài trợ – Tài chính 57', owner: '', staff: 0, note: 'Chưa phân công nhân sự' },
    { id: 'DT08', name: 'Thanh lý', owner: '', staff: 0, note: 'Chưa phân công nhân sự' },
    { id: 'DT09', name: '', owner: '', staff: '', note: 'Chưa có trong danh mục' },
    { id: 'DT10', name: '', owner: '', staff: '', note: 'Chưa có trong danh mục' },
  ],

  QuyetDinh: [
    {
      id: 'QĐ-1', content: 'Chỉ định owner cho 4 dòng tiền: #5 Cổ phiếu/IPO, #6 Trái phiếu, #7 Gói tài trợ – TC57, #8 Thanh lý',
      rule: 'Zero Waiting', decider: 'Ban Điều hành', impact: '4/10 dòng tiền chưa chạy', openedAt: '20/11/2026', status: 'Mở',
      source: 'Đề xuất từ phân tích dashboard — Ban Điều hành xác nhận',
    },
    {
      id: 'QĐ-2', content: 'Chọn 1 người chịu trách nhiệm cho các mục tiêu đang giao nhóm (MT-01, 03, 04, 05, 06)',
      rule: 'One Owner', decider: 'Trưởng các khối liên quan', impact: '5/6 việc trọng tâm chưa có người chốt kết quả', openedAt: '20/11/2026', status: 'Mở',
      source: 'Đề xuất từ phân tích dashboard — Ban Điều hành xác nhận',
    },
    {
      id: 'QĐ-3', content: 'Đặt chỉ tiêu tiền và thời hạn cho từng mục tiêu',
      rule: 'Đánh giá kết quả (Mục V)', decider: 'Ban Tài chính (chủ trì 10 dòng tiền)', impact: 'Chưa đo được thành công của War Room', openedAt: '20/11/2026', status: 'Mở',
      source: 'Đề xuất từ phân tích dashboard — Ban Điều hành xác nhận',
    },
    {
      id: 'QĐ-4', content: 'Bổ sung dòng tiền #9, #10 hoặc chốt chỉ chạy 8 dòng',
      rule: 'Danh mục (Mục IV.1)', decider: 'Ban Điều hành', impact: 'Danh mục 10 dòng tiền chưa đủ', openedAt: '20/11/2026', status: 'Mở',
      source: 'Đề xuất từ phân tích dashboard — Ban Điều hành xác nhận',
    },
  ],

  ThuTien: [],

  // Lịch trực theo dấu "X" trong file nhân sự trên Drive (đồng bộ 20/11/2026 21:07).
  CaTruc: [
    { date: '21/11/2026', shift: 'Ngày', person: 'Nguyễn Thị Mai Thu', unit: 'Ban Tài chính - Kế toán' },
    { date: '21/11/2026', shift: 'Đêm', person: 'Nguyễn Thị Mai Thu', unit: 'Ban Tài chính - Kế toán' },
    { date: '22/11/2026', shift: 'Ngày', person: 'Phạm Thanh Hùng', unit: 'Ban Tài chính - Kế toán' },
    { date: '22/11/2026', shift: 'Đêm', person: 'Nguyễn Thế Nhiên', unit: 'Ban Tài chính - Kế toán' },
    { date: '23/11/2026', shift: 'Đêm', person: 'Nguyễn Tân Hoàng Phương', unit: 'Văn phòng Chủ tịch' },
    { date: '24/11/2026', shift: 'Đêm', person: 'Hoàng Thị Quỳnh Mai', unit: 'Ban Kinh doanh' },
    { date: '25/11/2026', shift: 'Đêm', person: 'Trần Thị Xuân Thi', unit: 'Ban Kinh doanh' },
  ],

  DeXuatAI: [],
  NhatKy: [],
  BaoCao: [],
};

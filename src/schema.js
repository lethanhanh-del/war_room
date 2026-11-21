// Cấu trúc Google Sheet "Sổ mục tiêu War Room".
// Mỗi tab: danh sách [khoá nội bộ, tiêu đề cột hiển thị trong Sheet].
// Server đọc theo TIÊU ĐỀ CỘT, nên người vận hành có thể đổi thứ tự cột mà không làm hỏng hệ thống.

export const TABS = {
  TARGETS: 'MucTieu',
  STREAMS: 'DongTien',
  DECISIONS: 'QuyetDinh',
  COLLECTIONS: 'ThuTien',
  SHIFTS: 'CaTruc',
  PROPOSALS: 'DeXuatAI',
  LOG: 'NhatKy',
  REPORTS: 'BaoCao',
};

export const COLUMNS = {
  MucTieu: [
    ['id', 'Mã'],
    ['stream', 'Dòng tiền'],
    ['title', 'Tên mục tiêu'],
    ['owner', 'Owner (1 người)'],
    ['unit', 'Đơn vị'],
    ['output', 'Đầu ra cần đạt'],
    ['criteria', 'Tiêu chí kiểm chứng'],
    ['start', 'Bắt đầu'],
    ['deadline', 'Hạn'],
    ['stage', 'Bước (1-6)'],
    ['status', 'Trạng thái'],
    ['blocker', 'Điểm nghẽn'],
    ['escalateTo', 'Cần ai quyết / hỗ trợ'],
    ['moneyTarget', 'Chỉ tiêu tiền (tỷ)'],
    ['unlocked', 'Khai thông (tỷ)'],
    ['evidence', 'Link chứng từ'],
    ['updatedAt', 'Cập nhật lúc'],
    ['note', 'Ghi chú'],
    ['removedReason', 'Lý do loại khỏi War Room'],
  ],
  DongTien: [
    ['id', 'Mã'],
    ['name', 'Tên dòng tiền'],
    ['owner', 'Owner (1 người)'],
    ['staff', 'Số nhân sự'],
    ['moneyTarget', 'Chỉ tiêu tiền (tỷ)'],
    ['flag', 'Đánh dấu'],
    ['note', 'Ghi chú'],
  ],
  QuyetDinh: [
    ['id', 'Mã'],
    ['content', 'Cần quyết định'],
    ['rule', 'Nguyên tắc'],
    ['decider', 'Người quyết'],
    ['impact', 'Ảnh hưởng'],
    ['openedAt', 'Mở từ'],
    ['status', 'Trạng thái'],
    ['result', 'Kết quả quyết định'],
    ['decidedAt', 'Quyết lúc'],
    ['source', 'Nguồn'],
  ],
  ThuTien: [
    ['date', 'Ngày'],
    ['stream', 'Dòng tiền'],
    ['target', 'Mục tiêu'],
    ['amount', 'Số tiền (tỷ)'],
    ['evidence', 'Chứng từ (link)'],
    ['recordedBy', 'Người ghi'],
    ['note', 'Ghi chú'],
  ],
  CaTruc: [
    ['date', 'Ngày'],
    ['shift', 'Ca'],
    ['person', 'Người trực'],
    ['unit', 'Đơn vị'],
  ],
  DeXuatAI: [
    ['id', 'Mã'],
    ['createdAt', 'Thời gian'],
    ['source', 'Nguồn'],
    ['sourceUrl', 'Link nguồn'],
    ['target', 'Mục tiêu'],
    ['field', 'Trường'],
    ['current', 'Giá trị hiện tại'],
    ['proposed', 'Giá trị đề xuất'],
    ['quote', 'Trích dẫn'],
    ['confidence', 'Độ tin cậy'],
    ['status', 'Trạng thái'],
    ['reviewer', 'Người duyệt'],
    ['reviewedAt', 'Duyệt lúc'],
    ['reason', 'Lý do'],
  ],
  NhatKy: [
    ['time', 'Thời gian'],
    ['actor', 'Người thực hiện'],
    ['actorType', 'Loại'],
    ['channel', 'Kênh'],
    ['action', 'Hành động'],
    ['object', 'Đối tượng'],
    ['field', 'Trường'],
    ['before', 'Trước'],
    ['after', 'Sau'],
    ['result', 'Kết quả'],
    ['note', 'Ghi chú'],
  ],
  BaoCao: [
    ['time', 'Thời gian'],
    ['kind', 'Loại'],
    ['content', 'Nội dung'],
    ['model', 'Mô hình'],
  ],
};

export const TARGET_STATUS = ['Chưa bắt đầu', 'Đang triển khai', 'Nghẽn', 'Chờ kiểm chứng', 'Hoàn thành', 'Đã loại'];
// "Đã loại" = tách khỏi danh mục War Room (Mục IV văn bản chỉ đạo). Không xoá dòng để giữ dấu vết kiểm toán.
export const REMOVED_STATUS = 'Đã loại';

// Các trường người vận hành được nhập/sửa trực tiếp trên dashboard.
export const EDITABLE_FIELDS = [
  'stream', 'title', 'owner', 'unit', 'output', 'criteria', 'start', 'deadline', 'stage', 'status',
  'blocker', 'escalateTo', 'moneyTarget', 'unlocked', 'evidence', 'note',
];
export const STAGES = ['Nhận diện', 'Quyết định', 'Phân công', 'Hành động', 'Kiểm chứng', 'Đóng việc'];
export const DECISION_STATUS = ['Mở', 'Đã quyết', 'Huỷ'];
export const PROPOSAL_STATUS = ['Chờ duyệt', 'Đã duyệt', 'Từ chối'];
export const STREAM_FLAGS = ['Thiếu người', 'Tạm dừng'];
export const SHIFT_NAMES = ['Ngày', 'Đêm'];

// Các trường của MucTieu mà AI / thư mục Chứng từ được phép ĐỀ XUẤT (không tự ghi).
export const PROPOSABLE_FIELDS = [
  'title', 'owner', 'output', 'criteria', 'deadline', 'stage', 'status',
  'blocker', 'escalateTo', 'moneyTarget', 'unlocked', 'evidence', 'note',
];

// Tab nào được theo dõi thay đổi để ghi Nhật ký (khoá dòng = cột id, nếu có).
export const WATCHED_TABS = {
  MucTieu: 'id',
  DongTien: 'id',
  QuyetDinh: 'id',
  ThuTien: null,
  CaTruc: null,
};

export function labelOf(tab, key) {
  const col = (COLUMNS[tab] || []).find(([k]) => k === key);
  return col ? col[1] : key;
}

export function keyOfLabel(tab, label) {
  const norm = String(label || '').trim().toLowerCase();
  const col = (COLUMNS[tab] || []).find(([, l]) => l.toLowerCase() === norm);
  return col ? col[0] : null;
}

export function fieldKeyFromAny(value) {
  // Chấp nhận cả khoá nội bộ ("owner") lẫn tiêu đề cột ("Owner (1 người)").
  if (PROPOSABLE_FIELDS.includes(value)) return value;
  return keyOfLabel('MucTieu', value);
}

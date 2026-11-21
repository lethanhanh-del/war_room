// Kiểm thử lớp đọc Google Sheet với Sheets API giả lập (xác minh URL, range, khớp tên sheet).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_SHEETS = 'false';
process.env.GOOGLE_SHEET_ID = 'SHEET123';
delete process.env.CASHFLOW_SHEETS;

const { getDashboardData, __setClientForTest, extractPubId, parseCsv, parsePublicTabs } = await import('../api/_lib/sheets.js');

const HEAD = [
  ['BẢNG KPI (21/11/2026 - 25/11/2026)'],
  ['ghi chú'],
  ['Stt', 'Nhóm', 'PIC', 46347, '', 46348, '', 46349, '', 46350, '', 46351, '', 'Tổng kết', '', '', 'Ghi chú / Vướng mắc', 'Thư mục dữ liệu lưu trữ'],
  ['', '', '', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'KPI', 'Kết quả', 'Lũy kế đạt', '% đạt KPI', 'Đánh giá'],
];

// Tên sheet giống file thật, kể cả dấu cách thừa cuối "Dòng tiền tài chính "
const TITLES = [
  'KPI 21-25.11',
  'DÒNG TIỀN BÁN 4 DỰ ÁN',
  'DÒNG TIỀN BANKING',
  'DÒNG TIỀN NỢ KHÓ ĐÒI',
  'Dòng tiền tài chính ',
  'Dòng tiền thu trước hạn quá hạn',
];

test('đọc 5 sheet dòng tiền, khớp tên không phân biệt hoa thường / khoảng trắng', async () => {
  const calls = [];
  __setClientForTest({
    async request({ url }) {
      calls.push(url);
      assert.ok(url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/SHEET123'));
      if (url.includes('?fields=')) {
        return { data: { properties: { title: 'thamkhao_kpi' }, sheets: TITLES.map((title) => ({ properties: { title } })) } };
      }
      assert.ok(url.includes('/values:batchGet?'));
      assert.ok(url.includes('valueRenderOption=UNFORMATTED_VALUE'));
      const ranges = [...new URL(url).searchParams.getAll('ranges')];
      assert.equal(ranges.length, 5);
      assert.ok(ranges.includes("'Dòng tiền tài chính '!A1:Z500"));
      assert.ok(!ranges.some((r) => r.startsWith("'KPI")));
      return {
        data: {
          valueRanges: ranges.map((r, i) => ({ range: r, values: [...HEAD, [1, 'Nhóm', `P${i}`], ['', 'KPI A', '', 'Gọi 10 KH', true]] })),
        },
      };
    },
  });

  const d = await getDashboardData({ force: true });
  assert.equal(d.mode, 'google-sheets');
  assert.equal(d.spreadsheetTitle, 'thamkhao_kpi');
  assert.deepEqual(
    d.flows.map((f) => f.sheet),
    ['DÒNG TIỀN BÁN 4 DỰ ÁN', 'DÒNG TIỀN NỢ KHÓ ĐÒI', 'DÒNG TIỀN BANKING', 'Dòng tiền tài chính ', 'Dòng tiền thu trước hạn quá hạn']
  );
  for (const f of d.flows) {
    assert.ok(!f.error);
    assert.equal(f.items.length, 1);
    assert.deepEqual(f.items[0].days[0], { date: '2026-11-21', task: 'Gọi 10 KH', done: true });
    assert.equal(f.items[0].pic, `P${d.flows.indexOf(f)}`);
  }

  // Lần gọi thứ 2 trong thời gian cache -> không gọi API nữa
  const n = calls.length;
  await getDashboardData();
  assert.equal(calls.length, n);
});

test('thiếu sheet -> báo lỗi riêng ô đó, các ô khác vẫn chạy', async () => {
  __setClientForTest({
    async request({ url }) {
      if (url.includes('?fields=')) {
        return { data: { properties: { title: 'x' }, sheets: [{ properties: { title: 'DÒNG TIỀN BANKING' } }] } };
      }
      return { data: { valueRanges: [{ values: [...HEAD] }] } };
    },
  });
  const d = await getDashboardData({ force: true });
  const banking = d.flows.find((f) => f.key === 'banking');
  assert.ok(!banking.error);
  assert.equal(d.flows.filter((f) => f.error).length, 4);
  assert.match(d.flows[0].error, /Không tìm thấy sheet/);
});

test('lỗi Google API -> 502 có thông điệp rõ ràng', async () => {
  __setClientForTest({
    async request() {
      const e = new Error('x');
      e.response = { status: 403, data: { error: { message: 'The caller does not have permission' } } };
      throw e;
    },
  });
  await assert.rejects(getDashboardData({ force: true }), (e) => e.status === 502 && /403/.test(e.message));
});

test('đọc URL Publish to web (iframe / pubhtml) và CSV không cần Service Account', () => {
  const iframe = '<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vABC_123/pubhtml?widget=true&headers=false"></iframe>';
  assert.equal(extractPubId(iframe), '2PACX-1vABC_123');
  const html = '<title>WR - MASTER TASK - Google Drive</title><script>items.push({name: "Dòng tiền Equity \\/ IPO", gid: "674"});</script>';
  const parsed = parsePublicTabs(html);
  assert.equal(parsed.title, 'WR - MASTER TASK');
  assert.deepEqual(parsed.tabs, [{ name: 'Dòng tiền Equity / IPO', gid: '674' }]);
  assert.deepEqual(parseCsv('Stt,Nhóm\r\n1,"A, B"\r\n2,"He said ""ok"""'), [
    ['Stt', 'Nhóm'],
    ['1', 'A, B'],
    ['2', 'He said "ok"'],
  ]);
});

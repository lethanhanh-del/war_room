import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/d1.js';
import {
  DEFAULT_SHAREPOINT_MASTER_URL,
  encodeShareId,
  fetchSharePointSheetCsv,
  fetchSharePointTabs,
  isSharePointConfigured,
  isSharePointSource,
  resetSharePointCache,
  rowsToCsv,
  sharePointMasterUrl,
  sourceKeyOf,
  sourceUrlOf,
} from '../src/excel/sharepoint.js';
import { parseKpiBook, streamNameOf } from '../src/kpi/sheet.js';
import { sheetIds } from '../src/excel/gsheet.js';

test('sharepoint helpers: encodeShareId, sourceKeyOf, sourceUrlOf, rowsToCsv, auto-detection', async () => {
  const { kpiSheetId, kpiSourceKey } = await import('../src/kpi/index.js');
  assert.equal(isSharePointConfigured({}), false);
  const env = { MS_TENANT_ID: 't1', MS_CLIENT_ID: 'c1', MS_CLIENT_SECRET: 's1' };
  assert.equal(isSharePointConfigured(env), true);
  assert.equal(isSharePointConfigured({ ...env, SHAREPOINT_MASTER_URL: 'off' }), false);

  const url = sharePointMasterUrl(env);
  assert.equal(url, DEFAULT_SHAREPOINT_MASTER_URL);
  assert.equal(isSharePointSource(url), true);
  assert.equal(isSharePointSource('1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0'), false);

  assert.equal(sourceKeyOf(url), 'sp:13e2c89e-7c5a-4204-b3d4-530ff46e86fc');
  assert.equal(sourceKeyOf('1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0'), '1S7lTXwXUCHR8LziWox1B3GNe5mpcTezhdaV2socaVF0');
  assert.equal(sourceUrlOf(url), url);
  assert.equal(sourceUrlOf('ABC123'), 'https://docs.google.com/spreadsheets/d/ABC123/edit');

  // Khi có đủ MS_* secrets -> tự chọn SharePoint làm nguồn chính
  assert.equal(kpiSheetId(env), DEFAULT_SHAREPOINT_MASTER_URL);
  assert.equal(kpiSourceKey(env), 'sp:13e2c89e-7c5a-4204-b3d4-530ff46e86fc');
  assert.equal(sheetIds(env)[0], DEFAULT_SHAREPOINT_MASTER_URL);

  // encodeShareId chuẩn base64url bắt đầu bằng u! và không có =, +, /
  const sid = encodeShareId(url);
  assert.ok(sid.startsWith('u!'));
  assert.ok(!/[=+/]/.test(sid.slice(2)));

  // rowsToCsv escape dấu phẩy, ngoặc kép và xuống dòng đúng chuẩn RFC 4180
  assert.equal(
    rowsToCsv([
      ['STT', 'Vấn đề', 'Ghi chú'],
      ['1', 'Chưa duyệt, cần "gấp"', 'Dòng 1\nDòng 2'],
    ]),
    'STT,Vấn đề,Ghi chú\n1,"Chưa duyệt, cần ""gấp""","Dòng 1\nDòng 2"',
  );
});

test('Excel 31-char sheet names: khôi phục đầy đủ tên Dòng tiền 4 & 5 và đánh số tự động', () => {
  assert.equal(streamNameOf('4. Dòng tiền thu trước hạn quá '), 'Dòng tiền thu trước hạn quá hạn');
  assert.equal(streamNameOf('5. Dòng tiền Equity  IPO'), 'Dòng tiền Equity / IPO');
});

test('fetchSharePointTabs + fetchSharePointSheetCsv: đọc nhiều tab qua Graph $batch và 1 tab CSV Điểm nghẽn', async () => {
  resetSharePointCache();
  const env = { MS_TENANT_ID: 'tenant-1', MS_CLIENT_ID: 'client-1', MS_CLIENT_SECRET: 'secret-1' };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('/shares/u!')) {
      return new Response(JSON.stringify({
        id: 'ITEM1',
        name: 'WR - MASTER TASK.xlsx',
        webUrl: DEFAULT_SHAREPOINT_MASTER_URL,
        parentReference: { driveId: 'DRIVE1' },
      }), { status: 200 });
    }
    if (u.includes('$select=eTag,cTag')) {
      return new Response(JSON.stringify({ eTag: '"E1"', cTag: '"C1"' }), { status: 200 });
    }
    if (u.includes('/workbook/worksheets?')) {
      return new Response(JSON.stringify({
        value: [
          { id: 'W0', name: 'Điểm nghẽn', visibility: 'Visible', position: 0 },
          { id: 'W1', name: '4. Dòng tiền thu trước hạn quá ', visibility: 'Visible', position: 1 },
          { id: 'W2', name: '5. Dòng tiền Equity  IPO', visibility: 'Visible', position: 2 },
          { id: 'W3', name: 'DataValidation', visibility: 'Hidden', position: 3 },
        ],
      }), { status: 200 });
    }
    if (u.endsWith('/$batch')) {
      const body = JSON.parse(init.body);
      assert.equal(body.requests.length, 3); // bỏ qua DataValidation (Hidden)
      return new Response(JSON.stringify({
        responses: [
          {
            id: '0',
            status: 200,
            body: {
              text: [
                ['STT', 'Dòng tiền', 'Nhóm công việc', 'Vấn đề gặp phải', 'Thời gian xử lý', 'Người phụ trách', 'Người hỗ trợ'],
                ['1', 'Dòng tiền 1', 'Data', 'Chờ duyệt', '30 phút', 'Long', 'DAIT'],
              ],
            },
          },
          {
            id: '1',
            status: 200,
            body: {
              text: [
                ['Stt', 'Nhóm', 'PIC', 'Người phụ trách', '22/11', ''],
                ['', '', '', '', 'KPI', 'Kết quả'],
                ['1', 'Dữ liệu', 'Hoàng Thị Hà Thu', 'Nguyễn Văn A', 'Tổng hợp công nợ', 'TRUE'],
              ],
            },
          },
          {
            id: '2',
            status: 200,
            body: {
              text: [
                ['Stt', 'Nhóm', 'PIC', 'Người phụ trách', '22/11', ''],
                ['', '', '', '', 'KPI', 'Kết quả'],
                ['1', 'Equity / IPO', 'Anh Nguyễn Thế Nhiên', '', 'Chốt nhân sự CFO', 'FALSE'],
              ],
            },
          },
        ],
      }), { status: 200 });
    }
    if (u.includes("worksheets('%C4%90i%E1%BB%83m%20ngh%E1%BA%BDn')/usedRange")) {
      return new Response(JSON.stringify({
        text: [
          ['STT', 'Dòng tiền', 'Nhóm công việc', 'Vấn đề gặp phải', 'Thời gian xử lý', 'Người phụ trách', 'Người hỗ trợ'],
          ['1', 'Dòng tiền 1', 'Data', 'Chờ duyệt', '30 phút', 'Long', 'DAIT'],
        ],
      }), { status: 200 });
    }
    return new Response('unexpected: ' + u, { status: 404 });
  };

  try {
    const tabs = await fetchSharePointTabs(env, DEFAULT_SHAREPOINT_MASTER_URL, 10000);
    assert.deepEqual(tabs.map((t) => t.name), ['Điểm nghẽn', '4. Dòng tiền thu trước hạn quá ', '5. Dòng tiền Equity  IPO']);

    const book = parseKpiBook(tabs, { year: 2026 });
    assert.deepEqual(book.streams.map((s) => [s.no, s.name]), [
      [4, 'Dòng tiền thu trước hạn quá hạn'],
      [5, 'Dòng tiền Equity / IPO'],
    ]);
    assert.equal(book.streams[0].groups[0].rows[0].person, 'Nguyễn Văn A');
    assert.equal(book.streams[0].groups[0].rows[0].taskPic, 'Hoàng Thị Hà Thu');
    assert.equal(book.streams[1].groups[0].rows[0].person, 'Anh Nguyễn Thế Nhiên');
    assert.equal(book.streams[1].groups[0].rows[0].taskPic, undefined);

    const csv = await fetchSharePointSheetCsv(env, DEFAULT_SHAREPOINT_MASTER_URL, 'Điểm nghẽn', 11000);
    assert.match(csv, /Chờ duyệt/);
    assert.match(csv, /DAIT/);
    // Gọi lại fetchSharePointTabs: dùng lại danh sách worksheet đã đệm (chỉ 1 lần gọi /worksheets),
    // nhưng LUÔN gọi $batch đọc dữ liệu trực tiếp (không bị trễ theo cTag).
    const wsBefore = calls.filter((u) => u.includes('/workbook/worksheets?')).length;
    const batchBefore = calls.filter((u) => u.endsWith('/$batch')).length;
    const tabs2 = await fetchSharePointTabs(env, DEFAULT_SHAREPOINT_MASTER_URL, 12000);
    assert.equal(tabs2.length, 3);
    assert.equal(calls.filter((u) => u.includes('/workbook/worksheets?')).length, wsBefore);
    assert.equal(calls.filter((u) => u.endsWith('/$batch')).length, batchBefore + 1);
    // Token chỉ xin 1 lần duy nhất nhờ cache
    assert.equal(calls.filter((u) => u.includes('/oauth2/v2.0/token')).length, 1);
  } finally {
    globalThis.fetch = realFetch;
    resetSharePointCache();
  }
});

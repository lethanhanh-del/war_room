// Kiểm thử cơ chế phát hiện trùng Cấp 1 nâng cấp (Hybrid BM25 + TF-IDF Cosine + Char 3-gram + Từ điển War Room + Entity Conflict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/d1.js';
import { fakeD1 } from './fixtures/d1.js';
import { parseBlockers } from '../public/diem-nghen-model.js';
import { DEDUP_LEVEL, detectDuplicates, evaluateEntities, extractEntities, mergeAiDuplicates, normalizeForDedup } from '../public/diem-nghen-dedup.js';
import { VIABLE_GROQ_MODELS, parseGroqKeys, resetGroqRotationState, verifyDuplicatesWithAI } from '../src/dedup-ai.js';
import { getSheetAuthors, resetAuthorsTableReady, syncSheetAuthors } from '../src/diem-nghen-authors.js';

const NOW = Date.parse('2026-11-23T07:30:00Z');

// Đúng 11 dòng dữ liệu mẫu từ tab "Test local" (WR - MASTER TASK.xlsx)
const TEST_LOCAL_CSV = [
  'HƯỚNG DẪN: Dùng khi công việc gặp điểm nghẽn.,,,,,,,,,,,,',
  'STT,Dòng tiền,Nhóm,Phân loại điểm nghẽn,Nội dung điểm nghẽn,Người phụ trách,Đơn vị Người phụ trách,Người hỗ trợ,Đơn vị người hỗ trợ,Đơn vị hỗ trợ,Nội dung hỗ trợ,Trạng thái,Thời gian xử lý (Deadline)',
  '1,Dòng tiền 1: Bán 4 dự án,Data,Internal,Chưa quảng cáo bằng Open AI,Trần Thị Xuân Thi,Phòng Marcom,,,,,Đang xử lý,',
  '2,Dòng tiền 1: Bán 4 dự án,Data,external,Thiếu nguồn quản lý Data,Trần Thị Xuân Thi,Phòng Marcom,Nguyễn Thanh Phong,DAIT,Ban DAIT,Tìm kiếm/ Cung cấp hệ thống quản lý data,,22/11/2026-25/11/2026',
  '3,Dòng tiền 1: Bán 4 dự án,Data,,Thiếu nguồn data lớn,Trần Thị Xuân Thi,Phòng Marcom,,,,,,',
  '4,Dòng tiền 1: Bán 4 dự án,Data,,Thiếu nguồn data trọng điểm,Trần Thị Xuân Thi,Phòng Marcom,,,,,,',
  '5,Dòng tiền 1: Bán 4 dự án,Data,Internal,Đánh không đúng mục tiêu khách hàng trọng tâm,Trần Thị Xuân Thi,Phòng Marcom,,,,,,',
  '6,Dòng tiền 4: Dòng tiền thu trước hạn/quá hạn,,Internal,Tiến độ ra sổ hồng dự án I-Home PVC,Phạm Hoàng Oanh,Ban PTDA,Ngô Thị Thu Thủy,,,,,',
  '7,Dòng tiền 4: Dòng tiền thu trước hạn/quá hạn,,Internal,Tiến độ triển khai thi công xây dựng tại dự án Minh Châu,Võ Trường Sơn,Ban Xây dựng,,,,,,',
  '8,Dòng tiền 1: Bán 4 dự án,Networking,,Thiếu Data khách VIP,Hoàng Thị Quỳnh Mai,Phòng Sales,,,,,,22/11/2026-25/11/2026',
  '9,Dòng tiền 1: Bán 4 dự án,Networking,external,"Nhân sự: Chưa xây dựng được hệ thống nhân sự hứng phễu, chăm sóc tự động khách VIP",Hoàng Thị Quỳnh Mai,Phòng Sales,Nguyễn Thanh Phong,DAIT,Ban DAIT,"Tìm kiếm/ Cung cấp hệ thống quản lý, phân bổ khách và chăm sóc khách",,22/11/2026-25/11/2026',
  '10,Dòng tiền 1: Bán 4 dự án,Networking,Internal,Thiếu hệ thống lưu trữ và quản lý data,Hoàng Thị Quỳnh Mai,Phòng Sales,Nguyễn Thanh Phong,DAIT,Ban DAIT,Tìm kiếm/ Cung cấp hệ thống quản lý và lưu trữ data,,22/11/2026-25/11/2026',
  '11,Dòng tiền 5: Equity / IPO,,,"Thiếu nhân sự, năng lực khối tài chính triển khai IPO",Nguyễn Thế Nhiên,,Nguyễn Thị Mai Thu,,,,,23/11/2026',
].join('\n');

test('Test local (11 dòng thật): bắt đúng STT 2↔10 (Trùng cao · khác phòng) và STT 3↔4 (Nghi trùng), 0 báo nhầm', () => {
  const { items } = parseBlockers(TEST_LOCAL_CSV, NOW);
  assert.equal(items.length, 11);
  const res = detectDuplicates(items);

  const pairOf = (s1, s2) => res.pairs.find((p) => (p.aStt === s1 && p.bStt === s2) || (p.aStt === s2 && p.bStt === s1));

  // STT 2 (Marcom) <-> STT 10 (Sales): trùng bản chất + trùng yêu cầu gửi Nguyễn Thanh Phong / Ban DAIT
  const p210 = pairOf('2', '10');
  assert.ok(p210, 'Phải phát hiện cặp STT 2 ↔ STT 10');
  assert.equal(p210.level, 'high');
  assert.equal(p210.crossTeam, true);
  assert.ok(p210.score >= 0.64, `score=${p210.score}`);

  // STT 3 <-> STT 4: "Thiếu nguồn data lớn" vs "Thiếu nguồn data trọng điểm"
  const p34 = pairOf('3', '4');
  assert.ok(p34, 'Phải phát hiện cặp STT 3 ↔ STT 4');
  assert.equal(p34.level, 'medium');

  // Các cặp KHÔNG được báo nhầm
  assert.equal(pairOf('6', '7'), undefined, 'Khác dự án I-Home PVC vs Minh Châu không được báo trùng');
  assert.equal(pairOf('9', '10'), undefined, 'STT 9 (nhân sự chăm sóc VIP) vs STT 10 (lưu trữ data) không được báo nhầm');
  assert.equal(pairOf('2', '9'), undefined, 'STT 2 vs STT 9 không được báo nhầm vì câu mẫu hỗ trợ');
  assert.equal(pairOf('8', '9'), undefined, 'STT 8 vs STT 9 không được báo nhầm');
  assert.equal(pairOf('9', '11'), undefined, 'STT 9 vs STT 11 khác mảng Sales vs IPO');
  assert.equal(res.counts.pairs, 2);
  assert.equal(res.counts.high, 1);
  assert.equal(res.counts.medium, 1);
  assert.equal(res.counts.crossTeam, 1);
  assert.equal(res.byId.size, 4);
});

test('Entity Conflict Guardrail: chặn báo nhầm khi 2 dòng giống cấu trúc 85% nhưng KHÁC DỰ ÁN', () => {
  const entA = extractEntities('Tiến độ ra sổ hồng dự án I-Home PVC');
  const entB = extractEntities('Tiến độ ra sổ hồng dự án Minh Châu');
  const ev = evaluateEntities(entA, entB);
  assert.equal(ev.conflict, true);
  assert.match(ev.note, /khác dự án/i);

  const items = [
    { id: 'a', stt: '1', status: 'doing', stream: 'Dòng tiền 4', no: 4, group: 'Pháp lý', content: 'Tiến độ ra sổ hồng dự án I-Home PVC', owner: 'Phạm Hoàng Oanh', supportContent: '' },
    { id: 'b', stt: '2', status: 'doing', stream: 'Dòng tiền 4', no: 4, group: 'Pháp lý', content: 'Tiến độ ra sổ hồng dự án Minh Châu', owner: 'Võ Trường Sơn', supportContent: '' },
    { id: 'c', stt: '3', status: 'doing', stream: 'Dòng tiền 1', no: 1, group: 'Data', content: 'Chưa quảng cáo bằng Open AI', owner: 'Thi', supportContent: '' },
  ];
  const res = detectDuplicates(items);
  assert.equal(res.pairs.length, 0, 'Khác tên dự án (I-Home PVC ≠ Minh Châu) phải bị chặn hoàn toàn');
});

test('Từ điển War Room + cùng dự án: bắt trúng câu đồng nghĩa khác hẳn mặt chữ', () => {
  assert.match(normalizeForDedup('Chậm cấp giấy chứng nhận quyền sử dụng đất dự án I-Home PVC'), /so hong/);
  assert.match(normalizeForDedup('Chưa có phần mềm lưu trữ dữ liệu khách hàng'), /thieu he thong luu tru data khach/);

  const items = [
    { id: 'a', stt: '1', status: 'new', stream: 'DT 4', no: 4, group: '', content: 'Tiến độ ra sổ hồng dự án I-Home PVC', owner: 'Oanh', supportContent: '' },
    { id: 'b', stt: '2', status: 'new', stream: 'DT 4', no: 4, group: '', content: 'Chậm cấp giấy chứng nhận quyền sử dụng đất dự án I-Home PVC', owner: 'Thủy', supportContent: '' },
    { id: 'c', stt: '3', status: 'new', stream: 'DT 1', no: 1, group: 'Data', content: 'Chưa có phần mềm lưu trữ dữ liệu khách hàng', owner: 'Thi', supportContent: '' },
    { id: 'd', stt: '4', status: 'new', stream: 'DT 1', no: 1, group: 'Networking', content: 'Thiếu hệ thống lưu trữ data khách', owner: 'Mai', supportContent: '' },
    { id: 'e', stt: '5', status: 'new', stream: 'DT 2', no: 2, group: 'Banking', content: 'Ngân hàng yêu cầu bổ sung BCTC quý III', owner: 'Bình', supportContent: '' },
  ];
  const res = detectDuplicates(items);
  const pAB = res.pairs.find((p) => (p.aId === 'a' && p.bId === 'b') || (p.aId === 'b' && p.bId === 'a'));
  const pCD = res.pairs.find((p) => (p.aId === 'c' && p.bId === 'd') || (p.aId === 'd' && p.bId === 'c'));
  assert.ok(pAB && pAB.score >= 0.44, `Sổ hồng vs Giấy chứng nhận cùng dự án I-Home PVC phải bị bắt (got ${pAB?.score})`);
  assert.ok(pCD && pCD.level === 'high', `Chưa có phần mềm lưu trữ dữ liệu vs Thiếu hệ thống lưu trữ data phải là high (got ${pCD?.level}, ${pCD?.score})`);
});

test('Char 3-gram + chống lỗi gõ chính tả tiếng Việt & bỏ qua dòng Đã xử lý', () => {
  const items = [
    { id: 'a', stt: '1', status: 'doing', stream: 'DT 1', no: 1, group: 'Data', content: 'Thiếu hệ thống lưu trữ và quản lý data', owner: 'Mai', supportContent: '' },
    { id: 'b', stt: '2', status: 'doing', stream: 'DT 1', no: 1, group: 'Data', content: 'Thieu he thong luu trư va quan li data', owner: 'Thi', supportContent: '' },
    { id: 'c', stt: '3', status: 'done', stream: 'DT 1', no: 1, group: 'Data', content: 'Thiếu hệ thống lưu trữ và quản lý data', owner: 'Lan', supportContent: '' },
    { id: 'd', stt: '4', status: 'doing', stream: 'DT 2', no: 2, group: 'Banking', content: 'Chờ phê duyệt hạn mức tín dụng', owner: 'An', supportContent: '' },
  ];
  const res = detectDuplicates(items);
  assert.equal(res.pairs.length, 1);
  assert.equal(res.pairs[0].level, 'high');
  assert.equal(res.byId.has('c'), false, 'Dòng đã xử lý không được tham gia cảnh báo trùng');
});

test('Xung đột bộ phận trong nội dung & mức Trùng yêu cầu hỗ trợ (support)', () => {
  const items = [
    { id: 'o1', stt: '1', status: 'new', stream: 'DT 1', no: 1, group: '', content: 'Thiếu nhân sự Phòng Sales triển khai bán hàng', owner: 'Mai', supportContent: '' },
    { id: 'o2', stt: '2', status: 'new', stream: 'DT 5', no: 5, group: '', content: 'Thiếu nhân sự Khối Tài chính triển khai báo cáo', owner: 'Nhiên', supportContent: '' },
    { id: 's1', stt: '3', status: 'new', stream: 'DT 1', no: 1, group: 'Data', content: 'Chưa kết nối được API Zalo OA với bảng theo dõi', owner: 'Thi', supporter: 'Nguyễn Thanh Phong', supportUnit: 'Ban DAIT', supportContent: 'Cấp quyền tài khoản quản trị Zalo OA và webhook đồng bộ' },
    { id: 's2', stt: '4', status: 'new', stream: 'DT 3', no: 3, group: 'CSKH', content: 'Khách hàng chưa nhận được tin nhắn nhắc lịch tự động', owner: 'Lan', supporter: 'Nguyễn Thanh Phong', supportUnit: 'Ban DAIT', supportContent: 'Cấp quyền tài khoản quản trị Zalo OA và cấu hình webhook' },
    { id: 's3', stt: '5', status: 'new', stream: 'DT 2', no: 2, group: 'Banking', content: 'Chậm giải ngân hồ sơ vay ngân hàng', owner: 'Bình', supporter: 'Ban Tài chính', supportUnit: 'Ban Tài chính', supportContent: 'Bổ sung hồ sơ pháp lý tài sản đảm bảo' },
  ];
  const res = detectDuplicates(items);
  const pOrg = res.pairs.find((p) => (p.aId === 'o1' && p.bId === 'o2') || (p.aId === 'o2' && p.bId === 'o1'));
  assert.equal(pOrg, undefined, 'Khác bộ phận (Phòng Sales ≠ Khối Tài chính) phải bị chặn');

  const pSup = res.pairs.find((p) => (p.aId === 's1' && p.bId === 's2') || (p.aId === 's2' && p.bId === 's1'));
  assert.ok(pSup, 'Hai điểm nghẽn khác nhau nhưng gửi cùng 1 yêu cầu Zalo OA cho Nguyễn Thanh Phong phải hiện cảnh báo');
  assert.equal(pSup.level, 'support');
  assert.equal(DEDUP_LEVEL[pSup.level].label, 'Trùng yêu cầu hỗ trợ');
});

test('Hiệu năng: chạy 150 dòng điểm nghẽn hoàn tất nhanh dưới 500ms', () => {
  const items = Array.from({ length: 150 }, (_, i) => ({
    id: `r${i}`,
    stt: String(i + 1),
    status: 'doing',
    stream: `Dòng tiền ${(i % 8) + 1}`,
    no: (i % 8) + 1,
    group: i % 2 ? 'Data' : 'Networking',
    content: i % 15 === 0 ? 'Thiếu hệ thống lưu trữ và quản lý data khách hàng' : `Vướng mắc nghiệp vụ số ${i} cần xử lý hồ sơ đợt ${i % 12}`,
    owner: `Nhân sự ${i % 10}`,
    supportContent: i % 15 === 0 ? 'Tìm kiếm cung cấp hệ thống quản lý data' : '',
  }));
  const t0 = performance.now();
  const res = detectDuplicates(items);
  const dt = performance.now() - t0;
  assert.ok(res.pairs.length > 0);
  assert.ok(dt < 500, `Quá chậm: ${dt.toFixed(1)}ms`);
});

test('Groq AI rotation: thử hết model khả thi của Key #1 -> tự xoay sang Key #2 & cache vào D1', async () => {
  resetGroqRotationState();
  const env = {
    DB: fakeD1(),
    GROQ_API_KEYS: 'k1,k2,k3',
  };
  assert.deepEqual(parseGroqKeys(env), ['k1', 'k2', 'k3']);
  assert.deepEqual(VIABLE_GROQ_MODELS.map((m) => m.id), ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);

  const calls = [];
  const fakeFetch = async (_url, init) => {
    const auth = init.headers.Authorization;
    const body = JSON.parse(init.body);
    calls.push(`${auth}:${body.model}`);
    // Toàn bộ 3 model trên Key #1 đều lỗi (429 / 503 / bad_json) -> phải tự xoay sang Key #2!
    if (auth === 'Bearer k1') {
      if (body.model === 'qwen/qwen3.8-27b') return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 });
      if (body.model === 'openai/gpt-oss-120b') return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            pairs: [{ a: 'T1', b: 'T2', level: 'high', confidence: 94, reason: 'Cùng thiếu hệ thống quản lý data và gửi Ban DAIT.' }],
          }),
        },
      }],
    }), { status: 200 });
  };

  const items = [
    { id: 'id1', stt: '2', stream: 'DT 1', group: 'Data', content: 'Thiếu nguồn quản lý Data', owner: 'Thi', supportContent: 'Cung cấp hệ thống quản lý data' },
    { id: 'id2', stt: '10', stream: 'DT 1', group: 'Networking', content: 'Thiếu hệ thống lưu trữ và quản lý data', owner: 'Mai', supportContent: 'Cung cấp hệ thống quản lý lưu trữ data' },
  ];

  const r1 = await verifyDuplicatesWithAI(env, { items, candidates: [{ aId: 'id1', bId: 'id2', score: 0.71, level: 'high' }] }, { fetchImpl: fakeFetch, now: 1_000_000 });
  assert.equal(r1.ok, true);
  assert.equal(r1.cached, false);
  assert.equal(r1.keyIndex, 2);
  assert.equal(r1.model, 'qwen/qwen3.8-27b');
  assert.equal(r1.pairs.length, 1);
  assert.equal(r1.pairs[0].confidence, 94);
  assert.deepEqual(calls, [
    'Bearer k1:qwen/qwen3.8-27b',
    'Bearer k1:openai/gpt-oss-120b',
    'Bearer k1:openai/gpt-oss-20b',
    'Bearer k2:qwen/qwen3.8-27b',
  ]);

  // Gọi lần 2 với cùng dữ liệu -> đọc từ D1 cache, KHÔNG gọi lại Groq
  const callsBefore = calls.length;
  const r2 = await verifyDuplicatesWithAI(env, { items, candidates: [{ aId: 'id1', bId: 'id2', score: 0.71, level: 'high' }] }, { fetchImpl: fakeFetch, now: 1_005_000 });
  assert.equal(r2.ok, true);
  assert.equal(r2.cached, true);
  assert.equal(calls.length, callsBefore);

  // Kiểm tra mergeAiDuplicates: giữ số đo BM25+Cosine + bổ sung cặp AI ngữ nghĩa + loại cặp AI bác bỏ
  const baseDup = detectDuplicates(items);
  const merged = mergeAiDuplicates(baseDup, items, r1);
  assert.equal(merged.pairs.length, 1);
  assert.equal(merged.pairs[0].source, 'hybrid');
  assert.equal(merged.pairs[0].aiConfidence, 94);
  assert.ok(merged.pairs[0].metrics.cosine > 0);
  assert.match(merged.pairs[0].aiReason, /quản lý data/i);

  // Khi AI lỗi -> fallback về kết quả BM25 + Cosine Cấp 1 không bị mất cảnh báo
  const fallback = mergeAiDuplicates(baseDup, items, { enabled: true, ok: false, error: 'limit', pairs: [] });
  assert.equal(fallback.pairs.length, baseDup.pairs.length);
  resetGroqRotationState();
});

test('Groq AI rotation: Key #1 bị 401 -> bỏ qua các model còn lại và xoay thẳng sang Key #2', async () => {
  resetGroqRotationState();
  const env = { DB: fakeD1(), GROQ_API_KEYS: 'badKey,goodKey' };
  const calls = [];
  const fakeFetch = async (_url, init) => {
    const auth = init.headers.Authorization;
    const body = JSON.parse(init.body);
    calls.push(`${auth}:${body.model}`);
    if (auth === 'Bearer badKey') return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"pairs":[]}' } }] }), { status: 200 });
  };
  const items = [
    { id: 'a', stt: '1', content: 'Vướng mắc A' },
    { id: 'b', stt: '2', content: 'Vướng mắc B' },
  ];
  const r = await verifyDuplicatesWithAI(env, { items }, { fetchImpl: fakeFetch, now: 2_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.keyIndex, 2);
  assert.deepEqual(calls, ['Bearer badKey:qwen/qwen3.8-27b', 'Bearer goodKey:qwen/qwen3.8-27b']);
  resetGroqRotationState();
});

test('Theo dõi Người thêm & Người sửa gần nhất theo từng dòng/ô (D1 + backfill versions + diff field)', async () => {
  resetAuthorsTableReady();
  const env = {
    DB: fakeD1(),
    MS_TENANT_ID: 't1',
    MS_CLIENT_ID: 'c1',
    MS_CLIENT_SECRET: 's1',
  };
  const head = 'HƯỚNG DẪN,,,,,,,,,,,,\nSTT,Dòng tiền,Nhóm,Phân loại điểm nghẽn,Nội dung điểm nghẽn,Người phụ trách,Đơn vị Người phụ trách,Người hỗ trợ,Đơn vị người hỗ trợ,Đơn vị hỗ trợ,Nội dung hỗ trợ,Trạng thái,Thời gian xử lý (Deadline)';
  const csvV1 = `${head}\n1,Dòng tiền 1,Data,Internal,Hệ thống lưu trữ data,Thi,Marcom,,,,,Đang xử lý,25/11/2026`;
  const csvV2 = `${csvV1}\n2,Dòng tiền 1,Data,Internal,Chưa quảng cáo Open AI,Thi,Marcom,,,,,Chờ xử lý,25/11/2026`;
  const csvV3 = `${head}\n1,Dòng tiền 1,Data,Internal,Hệ thống lưu trữ data,Thi,Marcom,,,,,Đã xử lý,25/11/2026\n2,Dòng tiền 1,Data,Internal,Chưa quảng cáo Open AI,Thi,Marcom,,,,,Chờ xử lý,25/11/2026\n3,Dòng tiền 4,,Internal,Tiến độ sổ hồng I-Home,Oanh,PTDA,,,,,Đang xử lý,25/11/2026`;

  let versionCalls = 0;
  let editorCalls = 0;
  const fetchVersions = async () => {
    versionCalls++;
    return [
      { id: '1.0', at: '2026-11-23T08:00:00Z', by: 'Nguyễn Ngọc Chiến', csv: csvV1 },
      { id: '2.0', at: '2026-11-23T08:10:00Z', by: 'Lê Thành Anh', csv: csvV2 },
    ];
  };
  const fetchEditors = async () => {
    editorCalls++;
    return { name: 'Hoàng Thị Quỳnh Mai', email: 'mai@ct.vn', at: '2026-11-23T08:25:00Z' };
  };

  // Lần đầu khởi tạo -> backfill từ 2 version: dòng 1 do Chiến thêm, dòng 2 do Thành Anh thêm
  const s1 = await syncSheetAuthors(env, 'Điểm nghẽn', csvV2, { fetchVersions, fetchEditors });
  assert.equal(s1.seeded, true);
  assert.equal(versionCalls, 1);
  assert.equal(editorCalls, 0);

  let au = await getSheetAuthors(env, 'Điểm nghẽn');
  assert.equal(au.byStt['1'].addedBy, 'Nguyễn Ngọc Chiến');
  assert.equal(au.byStt['1'].lastChange, 'Mới thêm');
  assert.equal(au.byStt['2'].addedBy, 'Lê Thành Anh');

  // Lần 2 CSV không đổi -> 0 gọi API
  const s2 = await syncSheetAuthors(env, 'Điểm nghẽn', csvV2, { fetchVersions, fetchEditors });
  assert.equal(s2.changed, false);
  assert.equal(editorCalls, 0);

  // Lần 3: Mai đổi Trạng thái dòng 1 và thêm mới dòng 3 -> dòng 1 giữ addedBy=Chiến, updatedBy=Mai, lastChange='Sửa Trạng thái'; dòng 3 addedBy=Mai
  const s3 = await syncSheetAuthors(env, 'Điểm nghẽn', csvV3, { fetchVersions, fetchEditors });
  assert.equal(s3.changed, true);
  assert.equal(editorCalls, 1);

  au = await getSheetAuthors(env, 'Điểm nghẽn');
  assert.equal(au.byStt['1'].addedBy, 'Nguyễn Ngọc Chiến');
  assert.equal(au.byStt['1'].updatedBy, 'Hoàng Thị Quỳnh Mai');
  assert.equal(au.byStt['1'].lastChange, 'Sửa Trạng thái');
  assert.equal(au.byStt['2'].updatedBy, 'Lê Thành Anh'); // dòng 2 không đổi -> không bị ghi đè thành Mai
  assert.equal(au.byStt['3'].addedBy, 'Hoàng Thị Quỳnh Mai');
  assert.equal(au.byStt['3'].lastChange, 'Mới thêm');
  resetAuthorsTableReady();
});

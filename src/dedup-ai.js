// Thẩm định & phát hiện điểm nghẽn trùng bằng Groq LLM (Tầng 2 kết hợp sau BM25 + Cosine Cấp 1).
// - Đọc danh sách API keys từ biến môi trường GROQ_API_KEYS (hoặc GROQ_API_KEY), KHÔNG lưu cứng key trong mã nguồn.
// - Luân phiên tự động: ưu tiên các model khả thi theo thứ tự (qwen/qwen3.8-27b -> openai/gpt-oss-120b -> openai/gpt-oss-20b).
//   Nếu tất cả model khả thi của key hiện tại đều lỗi / hết hạn mức (429/401/5xx) -> tự động xoay sang key kế tiếp.
// - Cache kết quả theo chữ ký SHA-256 của danh sách điểm nghẽn đang mở vào bảng D1 `dedup_ai_cache` để các lượt polling 3s
//   không tốn thêm request Groq.

import { sha256Hex } from './auth.js';
import { json } from './http.js';

export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const PROMPT_VERSION = 'v1';
const FETCH_TIMEOUT_MS = 20000;
const MAX_ITEMS_FULL_LIST = 40;
const MAX_CANDIDATES = 25;

// Chỉ dùng các model chat đã kiểm chứng hoạt động tốt với JSON + tiếng Việt trên Groq.
// Bỏ qua: allam-2-7b (không tuân thủ JSON tiếng Việt), prompt-guard / safeguard (chỉ phân loại an toàn), whisper / orpheus (audio).
export const VIABLE_GROQ_MODELS = [
  {
    id: 'qwen/qwen3.8-27b',
    extra: { response_format: { type: 'json_object' }, max_completion_tokens: 1400 },
  },
  {
    id: 'openai/gpt-oss-120b',
    extra: { response_format: { type: 'json_object' }, reasoning_effort: 'low', max_completion_tokens: 1400 },
  },
  {
    id: 'openai/gpt-oss-20b',
    extra: { response_format: { type: 'json_object' }, reasoning_effort: 'low', max_completion_tokens: 1400 },
  },
];

// Trạng thái luân phiên trong bộ nhớ isolate (reset khi Worker khởi động lại).
let activeKeyIdx = 0;
const modelCooldown = new Map(); // `${keyIdx}:${modelId}` -> timestamp ms
const keyCooldown = new Map(); // keyIdx -> timestamp ms (khi 401/403 key chết)
let tableReady = false;

export function resetGroqRotationState() {
  activeKeyIdx = 0;
  modelCooldown.clear();
  keyCooldown.clear();
  tableReady = false;
}

/** Đọc mảng key từ env.GROQ_API_KEYS (cách nhau bằng dấu phẩy / xuống dòng / khoảng trắng) hoặc env.GROQ_API_KEY. */
export function parseGroqKeys(env = {}) {
  const raw = String(env?.GROQ_API_KEYS || env?.GROQ_API_KEY || '').trim();
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const k = part.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export function isGroqConfigured(env = {}) {
  return parseGroqKeys(env).length > 0;
}

async function ensureCacheTable(env) {
  if (tableReady || !env?.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS dedup_ai_cache (
      sig TEXT PRIMARY KEY,
      result TEXT NOT NULL,
      model TEXT NOT NULL,
      key_idx INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`
  ).run();
  tableReady = true;
}

function cleanStr(s, max = 260) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .filter((it) => it && it.id && cleanStr(it.content))
    .slice(0, 120)
    .map((it) => ({
      id: cleanStr(it.id, 180),
      stt: cleanStr(it.stt || it.row || '', 20),
      stream: cleanStr(it.streamShort || it.stream || '', 80),
      group: cleanStr(it.group || '', 50),
      content: cleanStr(it.content, 260),
      owner: cleanStr(it.owner || '', 60),
      ownerUnit: cleanStr(it.ownerUnit || '', 60),
      supporter: cleanStr(it.supporter || '', 60),
      supportUnit: cleanStr(it.supportUnit || '', 60),
      supportContent: cleanStr(it.supportContent || '', 220),
    }));
}

function sanitizeCandidates(rawCandidates, validIds) {
  if (!Array.isArray(rawCandidates)) return [];
  return rawCandidates
    .filter((c) => c && validIds.has(c.aId) && validIds.has(c.bId) && c.aId !== c.bId)
    .slice(0, MAX_CANDIDATES)
    .map((c) => ({
      aId: String(c.aId),
      bId: String(c.bId),
      score: Number(c.score) || 0,
      level: cleanStr(c.level || '', 20),
    }));
}

function buildMessages(items, candidates) {
  // Gán mã ngắn T1..Tn để tiết kiệm token và tránh LLM trả sai ID dài.
  const tagOf = new Map();
  const byTag = new Map();
  items.forEach((it, idx) => {
    const tag = `T${idx + 1}`;
    tagOf.set(it.id, tag);
    byTag.set(tag, it);
  });

  // Nếu quá nhiều dòng (> MAX_ITEMS_FULL_LIST), chỉ gửi các dòng nằm trong danh sách ứng viên BM25+Cosine.
  let scopeItems = items;
  if (items.length > MAX_ITEMS_FULL_LIST && candidates.length) {
    const inCand = new Set();
    for (const c of candidates) { inCand.add(c.aId); inCand.add(c.bId); }
    scopeItems = items.filter((it) => inCand.has(it.id));
  }

  const lines = scopeItems.map((it) => {
    const tag = tagOf.get(it.id);
    const parts = [
      `${tag} (#${it.stt || '?'})`,
      it.stream ? `[${it.stream}${it.group ? ' · ' + it.group : ''}]` : '',
      `Nội dung: "${it.content}"`,
      it.owner ? `PT: ${it.owner}${it.ownerUnit ? ` (${it.ownerUnit})` : ''}` : '',
      it.supporter || it.supportUnit ? `Đầu mối HT: ${[it.supporter, it.supportUnit].filter(Boolean).join(' / ')}` : '',
      it.supportContent ? `Yêu cầu HT: "${it.supportContent}"` : '',
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
  });

  const candLines = candidates.map((c) => {
    const ta = tagOf.get(c.aId);
    const tb = tagOf.get(c.bId);
    return `- ${ta} <-> ${tb} (BM25+Cosine: ${Math.round(c.score * 100)}%)`;
  });

  const system = [
    'Bạn là chuyên gia phân tích trùng lặp điểm nghẽn cho War Room doanh nghiệp Việt Nam.',
    'LUÔN trả về đúng 1 object JSON hợp lệ, viết toàn bộ trường "reason" bằng TIẾNG VIỆT tự nhiên, ngắn gọn (1 câu tối đa 25 từ).',
    'Quy tắc suy luận bắt buộc:',
    '1. Câu hỏi cốt lõi: Xử lý xong điểm nghẽn A có đồng thời giải quyết xong điểm nghẽn B không?',
    '2. LUẬT LOẠI TRỪ CỨNG: Nếu 2 điểm nghẽn thuộc 2 DỰ ÁN khác nhau (vd I-Home PVC ≠ Minh Châu), 2 MẢNG/BỘ PHẬN chuyên biệt khác nhau (vd nhân sự Sales ≠ nhân sự khối Tài chính IPO), hoặc 2 bài toán độc lập dù dùng chung mẫu câu hỗ trợ -> KHÔNG ĐƯỢC báo trùng (bỏ qua, không đưa vào mảng pairs).',
    '3. Phân đúng 3 mức độ cho các cặp THỰC SỰ trùng/liên quan mạnh:',
    '   - "high": Trùng bản chất hoặc cùng 1 giải pháp/đầu ra gỡ được cả 2 (kể cả khác phòng ban/người phụ trách).',
    '   - "medium": Rất gần nhau hoặc bao hàm cha–con trong cùng 1 nhóm vấn đề, nên rà soát gom nhóm.',
    '   - "support": Vấn đề gốc khác nhau nhưng yêu cầu hỗ trợ gần giống hệt nhau gửi cho cùng 1 người/đơn vị hỗ trợ.',
    '4. Nếu 2 câu diễn đạt khác từ nhưng đồng nghĩa (vd "giấy chứng nhận" = "sổ hồng", "chưa có phần mềm dữ liệu" = "thiếu hệ thống quản lý data"), HÃY PHÁT HIỆN và đưa vào kết quả.',
    '5. KHÔNG bịa mã T không có trong danh sách; không lặp cặp (A,B) với (B,A). Nếu không có cặp nào trùng, trả {"pairs":[]}.',
  ].join('\n');

  const user = [
    'Danh sách điểm nghẽn đang mở:',
    ...lines,
    candLines.length ? '\nCác cặp ứng viên do BM25+Cosine gợi ý (hãy thẩm định lại — giữ nếu đúng, loại nếu khác dự án/khác bản chất; đồng thời bổ sung thêm nếu phát hiện cặp trùng ngữ nghĩa khác từ):' : '',
    ...candLines,
    '\nTrả về JSON đúng mẫu: {"pairs":[{"a":"T2","b":"T10","level":"high","confidence":92,"reason":"1 câu giải thích ngắn bằng tiếng Việt"}]}',
  ].filter(Boolean).join('\n');

  return { system, user, byTag };
}

function extractJsonObject(rawText) {
  const cleaned = String(rawText || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch { /* thử tách ngoặc nhọn */ }
  const m = /\{[\s\S]*\}/.exec(cleaned);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function parseVerdicts(parsed, byTag) {
  if (!parsed || !Array.isArray(parsed.pairs)) return null;
  const out = [];
  const seen = new Set();
  for (const p of parsed.pairs) {
    if (!p || typeof p !== 'object') continue;
    const tagA = String(p.a || '').trim().toUpperCase();
    const tagB = String(p.b || '').trim().toUpperCase();
    const itemA = byTag.get(tagA);
    const itemB = byTag.get(tagB);
    if (!itemA || !itemB || itemA.id === itemB.id) continue;
    const rawLv = String(p.level || p.relation || '').trim().toLowerCase();
    let level = '';
    if (rawLv === 'high' || rawLv === 'duplicate') level = 'high';
    else if (rawLv === 'medium' || rawLv === 'near_duplicate' || rawLv === 'subset') level = 'medium';
    else if (rawLv === 'support' || rawLv === 'overlap_support') level = 'support';
    else continue; // distinct hoặc giá trị lạ -> bỏ

    const pairKey = itemA.id < itemB.id ? `${itemA.id}||${itemB.id}` : `${itemB.id}||${itemA.id}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const conf = Math.max(50, Math.min(100, Math.round(Number(p.confidence) || (level === 'high' ? 88 : level === 'medium' ? 72 : 68))));
    out.push({
      aId: itemA.id,
      bId: itemB.id,
      level,
      confidence: conf,
      reason: cleanStr(p.reason || '', 240),
    });
  }
  return out;
}

/**
 * Gọi Groq Chat Completions với cơ chế xoay vòng Key + Model:
 * - Thử lần lượt từng model khả thi trên key hiện tại (activeKeyIdx).
 * - Khi TẤT CẢ model khả thi của key đó đều lỗi/hết hạn mức (hoặc key bị 401/403) -> tự động xoay sang key kế tiếp.
 */
export async function callGroqWithRotation(env, messages, { fetchImpl = fetch, now = Date.now(), models = VIABLE_GROQ_MODELS } = {}) {
  const keys = parseGroqKeys(env);
  if (!keys.length) {
    return { ok: false, error: 'Chưa cấu hình GROQ_API_KEYS.' };
  }

  const attempts = [];
  const startKey = activeKeyIdx % keys.length;

  for (let offset = 0; offset < keys.length; offset++) {
    const keyIdx = (startKey + offset) % keys.length;
    const key = keys[keyIdx];
    const keyBlockedUntil = keyCooldown.get(keyIdx) || 0;
    if (now < keyBlockedUntil) {
      attempts.push({ key: keyIdx + 1, model: '*', status: 'key_cooldown' });
      continue;
    }

    for (const m of models) {
      const slot = `${keyIdx}:${m.id}`;
      const blockedUntil = modelCooldown.get(slot) || 0;
      if (now < blockedUntil) {
        attempts.push({ key: keyIdx + 1, model: m.id, status: 'cooldown' });
        continue;
      }

      try {
        const res = await fetchImpl(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: m.id,
            temperature: 0,
            ...m.extra,
            messages: [
              { role: 'system', content: messages.system },
              { role: 'user', content: messages.user },
            ],
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        const data = await res.json().catch(() => ({}));

        if (res.status === 401 || res.status === 403) {
          // Key không hợp lệ hoặc bị thu hồi -> đánh dấu cooldown cả key và xoay ngay sang key kế tiếp.
          keyCooldown.set(keyIdx, now + 30 * 60 * 1000);
          attempts.push({ key: keyIdx + 1, model: m.id, status: res.status });
          break;
        }

        if (res.status === 429) {
          const retryAfter = Number(res.headers?.get?.('retry-after')) || 60;
          modelCooldown.set(slot, now + Math.min(300, Math.max(15, retryAfter)) * 1000);
          attempts.push({ key: keyIdx + 1, model: m.id, status: 429 });
          continue;
        }

        if (!res.ok) {
          modelCooldown.set(slot, now + 45 * 1000);
          attempts.push({ key: keyIdx + 1, model: m.id, status: res.status, msg: cleanStr(data?.error?.message, 100) });
          continue;
        }

        const content = data?.choices?.[0]?.message?.content || '';
        const parsed = extractJsonObject(content);
        const verdicts = parseVerdicts(parsed, messages.byTag);
        if (!verdicts) {
          modelCooldown.set(slot, now + 20 * 1000);
          attempts.push({ key: keyIdx + 1, model: m.id, status: 'bad_json' });
          continue;
        }

        // Thành công -> ghi nhớ key này đang hoạt động tốt để ưu tiên cho lần sau.
        activeKeyIdx = keyIdx;
        return {
          ok: true,
          pairs: verdicts,
          model: m.id,
          keyIndex: keyIdx + 1,
          keyCount: keys.length,
          attempts,
        };
      } catch (e) {
        modelCooldown.set(slot, now + 30 * 1000);
        attempts.push({ key: keyIdx + 1, model: m.id, status: 'network_err', msg: cleanStr(e?.message || e, 80) });
      }
    }
  }

  // Tất cả key và model đều lỗi -> dịch activeKeyIdx sang key kế tiếp cho lần thử sau.
  activeKeyIdx = (startKey + 1) % keys.length;
  return {
    ok: false,
    error: 'Tất cả key và model Groq hiện đang bận hoặc hết hạn mức.',
    attempts,
  };
}

/**
 * Thẩm định trùng bằng AI (có cache D1 theo chữ ký nội dung).
 * Dùng chung cho endpoint /api/waiting-point/dedup-ai và kiểm thử Node.
 */
export async function verifyDuplicatesWithAI(env, { items: rawItems, candidates: rawCandidates, force = false } = {}, opts = {}) {
  const keys = parseGroqKeys(env);
  if (!keys.length) {
    return { enabled: false, ok: false, pairs: [], error: 'Chưa cấu hình GROQ_API_KEYS.' };
  }

  const items = sanitizeItems(rawItems);
  if (items.length < 2) {
    return { enabled: true, ok: true, cached: true, pairs: [], model: '', keyIndex: 0, keyCount: keys.length };
  }

  const validIds = new Set(items.map((it) => it.id));
  const candidates = sanitizeCandidates(rawCandidates, validIds);
  const sig = await sha256Hex(JSON.stringify({ v: PROMPT_VERSION, items, candidates }));

  await ensureCacheTable(env);
  if (!force && env?.DB) {
    const cached = await env.DB.prepare('SELECT result, model, key_idx, created_at FROM dedup_ai_cache WHERE sig = ?').bind(sig).first();
    if (cached?.result) {
      try {
        const pairs = JSON.parse(cached.result);
        return {
          enabled: true,
          ok: true,
          cached: true,
          pairs,
          model: cached.model,
          keyIndex: cached.key_idx,
          keyCount: keys.length,
          checkedAt: cached.created_at,
        };
      } catch { /* bản cache hỏng -> gọi lại */ }
    }
  }

  const messages = buildMessages(items, candidates);
  const res = await callGroqWithRotation(env, messages, opts);
  if (!res.ok) {
    return { enabled: true, ok: false, pairs: [], error: res.error, attempts: res.attempts, keyCount: keys.length };
  }

  const checkedAt = new Date(opts.now || Date.now()).toISOString();
  if (env?.DB) {
    await env.DB.prepare(
      'INSERT INTO dedup_ai_cache (sig, result, model, key_idx, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sig) DO UPDATE SET result = excluded.result, model = excluded.model, key_idx = excluded.key_idx, created_at = excluded.created_at'
    )
      .bind(sig, JSON.stringify(res.pairs), res.model, res.keyIndex, checkedAt)
      .run()
      .catch(() => {});
  }

  return {
    enabled: true,
    ok: true,
    cached: false,
    pairs: res.pairs,
    model: res.model,
    keyIndex: res.keyIndex,
    keyCount: res.keyCount,
    checkedAt,
  };
}

/** HTTP handler cho POST /api/waiting-point/dedup-ai */
export async function handleDedupAI(request, env) {
  if (request.method !== 'POST') return json({ error: 'Chỉ hỗ trợ POST.' }, 405);
  const body = await request.json().catch(() => ({}));
  const res = await verifyDuplicatesWithAI(env, {
    items: body?.items,
    candidates: body?.candidates,
    force: body?.force === true,
  });
  return json(res, 200);
}

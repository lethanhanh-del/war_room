// Phát hiện điểm nghẽn trùng / gần giống (Cấp 1 nâng cấp — thuần JS, không phụ thuộc DOM hay thư viện ngoài).
// Kết hợp:
//   1. Chuẩn hoá tiếng Việt + từ điển thuật ngữ War Room (dữ liệu <-> data, sổ hồng <-> giấy chứng nhận, chưa có <-> thiếu...).
//   2. Tách đa tầng: Word Unigram + Word Bigram (trọng số 1.3x cho từ ghép 2 âm tiết) + Char 3-gram nội từ (chống sai dấu/chính tả).
//   3. Hybrid BM25 (IDF làm mượt trên số dòng không rỗng, chuẩn hoá đối xứng) + TF-IDF Cosine Similarity (sublinear TF).
//   4. Đa trường (Nội dung điểm nghẽn + Nội dung hỗ trợ) + Context boost nhẹ (cùng Dòng tiền / Nhóm / Người hỗ trợ).
//   5. Phạt xung đột Thực thể / Dự án (Entity Conflict Guardrail): chặn báo nhầm 2 dự án / mã riêng / phòng ban khác nhau
//      như "Tiến độ ra sổ hồng dự án I-Home PVC" vs "Tiến độ ra sổ hồng dự án Minh Châu".
//
// Phân 3 mức cảnh báo rõ ràng (chỉ so các điểm nghẽn đang mở):
//   - 'high'    (Trùng cao · nên gộp): cùng bản chất vấn đề / giải 1 việc gỡ cả 2 (score >= 0.64)
//   - 'medium'  (Nghi trùng · gần giống): nội dung sát nhau hoặc bao hàm cha–con (0.44 <= score < 0.64)
//   - 'support' (Trùng yêu cầu hỗ trợ): vấn đề khác nhưng cùng yêu cầu gửi chung đầu mối hỗ trợ

import { mergeUnits, nk } from './diem-nghen-model.js';

export const DEDUP_LEVEL = {
  high: { label: 'Trùng cao', action: 'Nên gộp', order: 0 },
  medium: { label: 'Nghi trùng', action: 'Rà soát gộp', order: 1 },
  support: { label: 'Trùng yêu cầu hỗ trợ', action: 'Gom đầu mối', order: 2 },
};

const STOPWORDS = new Set([
  'va', 'cua', 'cac', 'cho', 'tai', 'bang', 'de', 'voi', 'la', 'mot', 'nhung',
  'duoc', 'bi', 'co', 'trong', 'tren', 'duoi', 'tu', 'den', 've', 'theo', 'khi',
  'nay', 'do', 'da', 'dang', 'se', 'nhieu', 'rat', 'qua', 'van', 'chi', 'ma',
  'nen', 'hay', 'hoac', 'nhu', 'boi', 'can', 'phai', 'viec',
]);

// Từ điển chuẩn hoá thuật ngữ nội bộ War Room (chỉ giữ các cặp đồng nghĩa chắc chắn, tránh đánh đồng sai).
const SYNONYM_RULES = [
  [/\bgiay\s+chung\s+nhan(?:\s+quyen\s+su\s+dung\s+dat)?\b/g, 'so hong'],
  [/\bgcn(?:qsd(?:d)?)?\b/g, 'so hong'],
  [/\bso\s+do\b/g, 'so hong'],
  [/\bdu\s+lieu\b/g, 'data'],
  [/\bkhach\s+hang\b/g, 'khach'],
  [/\bnhan\s+luc\b/g, 'nhan su'],
  [/\bphan\s+mem\b/g, 'he thong'],
  [/\bcong\s+cu\b/g, 'he thong'],
  [/\btool\b/g, 'he thong'],
  [/\bquan\s+tri\b/g, 'quan ly'],
  [/\bopen\s+ai\b/g, 'openai'],
  [/\bchay\s+ads\b/g, 'quang cao'],
  [/\bads\b/g, 'quang cao'],
  [/\bbao\s+cao\s+tai\s+chinh\b/g, 'bctc'],
  [/\bniem\s+yet\b/g, 'ipo'],
  [/\bchua\s+co\b/g, 'thieu'],
  [/\bkhong\s+co\b/g, 'thieu'],
  [/\bchua\s+du\b/g, 'thieu'],
  [/\bkhong\s+du\b/g, 'thieu'],
  [/\bcham\s+tre\b/g, 'cham'],
  [/\bbi\s+tre\b/g, 'cham'],
  [/\btri\s+hoan\b/g, 'cham'],
  [/\bdap\s+ung\b/g, 'cung cap'],
];

// Các từ viết tắt / chữ in hoa mang nghĩa chung (KHÔNG tính là thực thể dự án / mã riêng để tránh phạt oan).
const GENERIC_ENTITIES = new Set([
  'data', 'kpi', 'vip', 'bod', 'dait', 'ai', 'crm', 'hr', 'it', 'erp', 'ceo', 'cfo',
  'internal', 'external', 'sales', 'marcom', 'marketing', 'networking', 'banking', 'equity',
  'kh', 'ns', 'ht', 'bctc', 'gcn', 'vn', 'vnd', 'usd', 'app', 'web', 'api', 'csv', 'pdf',
]);

// Từ nối kết thúc tên dự án khi trích sau cụm "dự án ...".
const PROJECT_STOP = new Set([
  'va', 'cua', 'tai', 'cho', 'de', 'bi', 'chua', 'khong', 'dang', 'da', 'se',
  'co', 'can', 'phai', 'nhung', 'nhieu', 've', 'theo', 'khi', 'tu', 'den',
  'trong', 'tren', 'duoi', 'do', 'vi', 'nen', 'hoac', 'hay', 'la',
]);

/** Chuẩn hoá văn bản để tạo token (bỏ dấu, hạ thường, giữ chữ số, áp từ điển đồng nghĩa). */
export function normalizeForDedup(text) {
  let clean = nk(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, rep] of SYNONYM_RULES) clean = clean.replace(re, rep);
  return clean.replace(/\s+/g, ' ').trim();
}

/** Tách từ sạch + Word Bigram (đại diện từ ghép 2 âm tiết tiếng Việt) + Char 3-gram nội từ. */
export function tokenizeText(text) {
  const clean = normalizeForDedup(text);
  const words = clean.split(' ').filter((w) => w && !STOPWORDS.has(w));
  const wordTokens = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    wordTokens.push(`${words[i]}_${words[i + 1]}`);
  }
  const charTokens = [];
  for (const w of words) {
    if (w.length < 3) {
      charTokens.push(`^${w}$`);
      continue;
    }
    const padded = `^${w}$`;
    for (let i = 0; i <= padded.length - 3; i++) {
      charTokens.push(padded.slice(i, i + 3));
    }
  }
  return { clean, words, wordTokens, charTokens };
}

const UPPER_WORD_RE = /^[A-ZĐÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][A-Za-z0-9ĐđÀ-ỹ-]*$/;

/**
 * Trích xuất thực thể đặc thù ngay trong nội dung điểm nghẽn để phát hiện xung đột đối tượng:
 * - projects: tên sau "dự án ..." (vd "I-Home PVC", "Minh Châu")
 * - orgs: phòng/ban/khối ghi trực tiếp TRONG câu nội dung (vd "Phòng Sales" vs "Khối Tài chính")
 * - codes: mã chữ-số hoặc chữ viết hoa đặc thù (vd "I-Home", "H300", "PVC", "VPC", "IPO", "OpenAI")
 */
export function extractEntities(rawText) {
  const raw = String(rawText ?? '').replace(/\s+/g, ' ').trim();
  const projects = [];
  const orgs = [];
  const codes = [];
  if (!raw) return { projects, orgs, codes };

  const addUnique = (arr, label) => {
    const key = nk(label).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key || key.length < 2 || GENERIC_ENTITIES.has(key)) return;
    if (!arr.some((x) => x.key === key)) arr.push({ key, label: label.trim() });
  };

  // 1) Tên dự án sau "dự án ..."
  const projRe = /(?:dự\s*án|du\s*an)\s+([^\n,.;:()]+)/gi;
  let m;
  while ((m = projRe.exec(raw))) {
    const rawWords = m[1].trim().split(/\s+/);
    const picked = [];
    for (let i = 0; i < rawWords.length && picked.length < 4; i++) {
      const w = rawWords[i].replace(/^[^A-Za-z0-9ĐđÀ-ỹ]+|[^A-Za-z0-9ĐđÀ-ỹ-]+$/g, '');
      const k = nk(w);
      if (!k || PROJECT_STOP.has(k)) break;
      // Nếu đã lấy >= 1 từ viết hoa mà gặp từ thường phía sau (vd "dự án Minh Châu chưa xong") -> dừng.
      if (picked.length > 0 && !UPPER_WORD_RE.test(w) && !/\d/.test(w)) break;
      picked.push(w);
    }
    if (picked.length) addUnique(projects, picked.join(' '));
  }

  // 2) Phòng / Ban / Khối xuất hiện trực tiếp trong nội dung điểm nghẽn (không lấy từ cột đơn vị bên ngoài)
  const orgRe = /(?:phòng|phong|ban|khối|khoi)\s+([^\n,.;:()]+)/gi;
  while ((m = orgRe.exec(raw))) {
    const rawWords = m[1].trim().split(/\s+/);
    const picked = [];
    for (let i = 0; i < rawWords.length && picked.length < 3; i++) {
      const w = rawWords[i].replace(/^[^A-Za-z0-9ĐđÀ-ỹ]+|[^A-Za-z0-9ĐđÀ-ỹ-]+$/g, '');
      const k = nk(w);
      if (!k || PROJECT_STOP.has(k) || /^(trien|khai|thuc|hien|can|chua|thieu|xu|ly)$/.test(k)) break;
      picked.push(w);
    }
    if (picked.length) addUnique(orgs, picked.join(' '));
  }

  // 3) Mã định danh / tên riêng đặc thù (chứa dấu gạch nối+chữ hoa như I-Home, chữ+số như H300, viết tắt hoa như IPO/PVC/VPC/Zalo)
  const tokens = raw.split(/[\s,.;:()\/]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/^[^A-Za-z0-9ĐđÀ-ỹ]+|[^A-Za-z0-9ĐđÀ-ỹ-]+$/g, '');
    if (!tok || tok.length < 2) continue;
    const k = nk(tok);
    if (GENERIC_ENTITIES.has(k)) continue;
    // Mã có cả chữ lẫn số hoặc gạch nối (I-Home, H300, CT57, MT-04)
    if ((/[A-Za-z]/.test(tok) && /\d/.test(tok)) || /^[A-Z][A-Za-z0-9]*-[A-Z0-9][A-Za-z0-9]*$/.test(tok)) {
      addUnique(codes, tok);
      continue;
    }
    // Từ viết tắt toàn chữ hoa dài 2-6 ký tự (PVC, VPC, IPO, SHB, VCB, OA...)
    if (/^[A-Z]{2,6}$/.test(tok)) {
      addUnique(codes, tok);
    }
  }

  // Cụm 2-3 từ viết hoa liên tiếp nằm giữa câu (không ở vị trí đầu câu): vd "Minh Châu", "Open AI"
  const sentences = raw.split(/[.!?;:\n]+/);
  for (const sent of sentences) {
    const ws = sent.trim().split(/\s+/).filter(Boolean);
    for (let i = 1; i < ws.length; i++) {
      const w1 = ws[i].replace(/^[^A-Za-z0-9ĐđÀ-ỹ]+|[^A-Za-z0-9ĐđÀ-ỹ-]+$/g, '');
      if (!UPPER_WORD_RE.test(w1) || GENERIC_ENTITIES.has(nk(w1))) continue;
      const phrase = [w1];
      while (i + 1 < ws.length && phrase.length < 3) {
        const wn = ws[i + 1].replace(/^[^A-Za-z0-9ĐđÀ-ỹ]+|[^A-Za-z0-9ĐđÀ-ỹ-]+$/g, '');
        if (!UPPER_WORD_RE.test(wn)) break;
        phrase.push(wn);
        i++;
      }
      if (phrase.length >= 2) addUnique(codes, phrase.join(' '));
    }
  }

  return { projects, orgs, codes };
}

function entityOverlap(listA, listB) {
  for (const a of listA) {
    for (const b of listB) {
      if (a.key === b.key || a.key.includes(b.key) || b.key.includes(a.key)) {
        return { matched: true, label: a.label.length >= b.label.length ? a.label : b.label };
      }
    }
  }
  return { matched: false, label: '' };
}

/** Đánh giá thực thể giữa 2 điểm nghẽn: khớp cùng dự án (thưởng điểm) hay xung đột dự án/đối tượng (phạt mạnh). */
export function evaluateEntities(entA, entB) {
  // Ưu tiên kiểm tra xung đột tên dự án ("dự án I-Home PVC" vs "dự án Minh Châu")
  if (entA.projects.length && entB.projects.length) {
    const ov = entityOverlap(entA.projects, entB.projects);
    if (ov.matched) {
      return { conflict: false, matched: true, multiplier: 1, bonus: 0.08, note: `cùng dự án ${ov.label}` };
    }
    return {
      conflict: true,
      matched: false,
      multiplier: 0.38,
      bonus: 0,
      note: `khác dự án (${entA.projects[0].label} ≠ ${entB.projects[0].label})`,
    };
  }

  // Kiểm tra xung đột phòng/ban/khối ghi thẳng trong nội dung (vd "khối tài chính" vs "phòng sales")
  if (entA.orgs.length && entB.orgs.length) {
    const ov = entityOverlap(entA.orgs, entB.orgs);
    if (!ov.matched) {
      return {
        conflict: true,
        matched: false,
        multiplier: 0.5,
        bonus: 0,
        note: `khác bộ phận (${entA.orgs[0].label} ≠ ${entB.orgs[0].label})`,
      };
    }
  }

  // Kiểm tra xung đột mã/tên riêng đặc thù (I-Home, H300, IPO, Open AI...)
  if (entA.codes.length && entB.codes.length) {
    const ov = entityOverlap(entA.codes, entB.codes);
    if (ov.matched) {
      return { conflict: false, matched: true, multiplier: 1, bonus: 0.05, note: `cùng đối tượng ${ov.label}` };
    }
    return {
      conflict: true,
      matched: false,
      multiplier: 0.55,
      bonus: 0,
      note: `khác đối tượng (${entA.codes[0].label} ≠ ${entB.codes[0].label})`,
    };
  }

  return { conflict: false, matched: false, multiplier: 1, bonus: 0, note: '' };
}

/**
 * Xây dựng chỉ mục BM25 + TF-IDF Cosine trên mảng danh sách token.
 * Lưu ý quan trọng: N và avgdl chỉ tính trên các tài liệu KHÔNG RỖNG (nonEmptyN) để không làm méo IDF
 * của các cột thưa như "Nội dung hỗ trợ" (nhiều dòng để trống).
 */
function buildVectorIndex(docsTokens, { bigramWeight = 1.3, k1 = 1.2, b = 0.75 } = {}) {
  const df = new Map();
  const postings = new Map(); // inverted index: term -> [docIdx, ...]
  let totalLen = 0;
  let nonEmptyN = 0;
  const tfs = docsTokens.map((toks, docIdx) => {
    if (toks.length > 0) nonEmptyN += 1;
    totalLen += toks.length;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) {
      df.set(t, (df.get(t) || 0) + 1);
      let list = postings.get(t);
      if (!list) { list = []; postings.set(t, list); }
      list.push(docIdx);
    }
    return { len: toks.length, tf };
  });
  const N = Math.max(1, nonEmptyN);
  const avgdl = totalLen / N;

  // IDF làm mượt (BM25+ / Lucene): luôn dương kể cả khi tập nhỏ (10-30 dòng)
  const idfBm25 = new Map();
  const idfCos = new Map();
  for (const [t, freq] of df) {
    idfBm25.set(t, Math.log(1 + (N - freq + 0.5) / (freq + 0.5)));
    idfCos.set(t, Math.log((N + 1) / (freq + 1)) + 1);
  }

  const weightOf = (t) => (t.includes('_') ? bigramWeight : 1.0);

  // Vector TF-IDF chuẩn hoá L2 cho Cosine Similarity
  const vecs = tfs.map(({ tf }) => {
    const v = new Map();
    let normSq = 0;
    for (const [t, f] of tf) {
      const w = (1 + Math.log(f)) * (idfCos.get(t) || 1) * weightOf(t);
      v.set(t, w);
      normSq += w * w;
    }
    return { v, norm: Math.sqrt(normSq) };
  });

  function bm25Raw(qIdx, dIdx) {
    const q = tfs[qIdx];
    const d = tfs[dIdx];
    if (!q.len || !d.len) return 0;
    let score = 0;
    for (const [t, qf] of q.tf) {
      const f = d.tf.get(t) || 0;
      if (!f) continue;
      const idf = idfBm25.get(t) || 0;
      const num = f * (k1 + 1);
      const den = f + k1 * (1 - b + b * (d.len / avgdl));
      score += idf * weightOf(t) * (num / den) * (1 + Math.log(qf));
    }
    return score;
  }

  const selfBm25 = tfs.map((_, i) => bm25Raw(i, i));

  function bm25Sym(i, j) {
    const si = selfBm25[i] > 0 ? bm25Raw(i, j) / selfBm25[i] : 0;
    const sj = selfBm25[j] > 0 ? bm25Raw(j, i) / selfBm25[j] : 0;
    return 0.5 * (si + sj);
  }

  function cosine(i, j) {
    const a = vecs[i];
    const bVec = vecs[j];
    if (!a.norm || !bVec.norm) return 0;
    let dot = 0;
    for (const [t, wa] of a.v) {
      const wb = bVec.v.get(t);
      if (wb) dot += wa * wb;
    }
    return dot / (a.norm * bVec.norm);
  }

  function sharedKeywords(i, j, limit = 6) {
    const shared = [];
    for (const t of tfs[i].tf.keys()) {
      if (tfs[j].tf.has(t)) shared.push({ term: t, idf: (idfBm25.get(t) || 0) * weightOf(t) });
    }
    // Ưu tiên cụm 2 từ (bigram) có độ đặc trưng IDF cao trước, rồi lọc từ đơn đã nằm trong bigram để hiển thị gọn.
    shared.sort((a, b) => b.idf - a.idf);
    const picked = [];
    const covered = new Set();
    for (const s of shared) {
      if (s.term.includes('_')) {
        const pretty = s.term.replace(/_/g, ' ');
        picked.push(pretty);
        for (const p of s.term.split('_')) covered.add(p);
      } else if (!covered.has(s.term)) {
        picked.push(s.term);
      }
      if (picked.length >= limit) break;
    }
    return picked;
  }

  function neighbors(qIdx) {
    const out = new Set();
    for (const t of tfs[qIdx].tf.keys()) {
      const list = postings.get(t);
      if (!list) continue;
      for (const dIdx of list) if (dIdx !== qIdx) out.add(dIdx);
    }
    return out;
  }

  return { bm25Raw, bm25Sym, cosine, sharedKeywords, neighbors };
}

function sameNonEmpty(a, b) {
  const ka = nk(a);
  const kb = nk(b);
  return Boolean(ka && kb && ka === kb);
}

function sameSupportEntity(a, b) {
  if (sameNonEmpty(a.supporter, b.supporter)) return { same: true, label: a.supporter };
  const ua = mergeUnits(a.supporterUnit, a.supportUnit);
  const ub = mergeUnits(b.supporterUnit, b.supportUnit);
  if (ua && ub && (nk(ua).includes(nk(ub)) || nk(ub).includes(nk(ua)))) {
    return { same: true, label: ua.length >= ub.length ? ua : ub };
  }
  return { same: false, label: '' };
}

/**
 * Phát hiện các cặp điểm nghẽn trùng / nghi trùng trên danh sách `items` (mặc định chỉ xét các dòng đang mở).
 *
 * Trả về:
 *  - pairs: danh sách cặp nghi trùng (xếp theo điểm giảm dần)
 *  - byId: Map<item.id, { level, topScore, matches: [...] }> để UI tra cứu O(1) cho từng dòng
 *  - counts: { items, pairs, high, medium, support, crossTeam }
 */
export function detectDuplicates(items = [], opts = {}) {
  const {
    onlyOpen = true,
    highThreshold = 0.64,
    mediumThreshold = 0.44,
    supportThreshold = 0.52,
    topKPerItem = 10,
  } = opts;

  const list = (Array.isArray(items) ? items : []).filter((it) => it && it.content && (!onlyOpen || it.status !== 'done'));
  const byId = new Map();
  const empty = { pairs: [], byId, counts: { items: 0, pairs: 0, high: 0, medium: 0, support: 0, crossTeam: 0 } };
  if (list.length < 2) return empty;

  const contentTok = list.map((it) => tokenizeText(it.content));
  const supportTok = list.map((it) => tokenizeText(it.supportContent));
  const combinedTok = list.map((it) => tokenizeText(`${it.content} ${it.supportContent || ''}`));
  const entities = list.map((it) => extractEntities(it.content));

  const contentWordIdx = buildVectorIndex(contentTok.map((t) => t.wordTokens), { bigramWeight: 1.3 });
  const contentCharIdx = buildVectorIndex(contentTok.map((t) => t.charTokens), { bigramWeight: 1.0 });
  const supportWordIdx = buildVectorIndex(supportTok.map((t) => t.wordTokens), { bigramWeight: 1.3 });
  const combinedWordIdx = buildVectorIndex(combinedTok.map((t) => t.wordTokens), { bigramWeight: 1.25 });

  // Tầng 1 — BM25 Candidate Retrieval qua Inverted Index: chỉ duyệt các dòng thực sự có chung từ/cụm từ.
  const candidatePairs = new Set();
  for (let i = 0; i < list.length; i++) {
    const candIds = contentWordIdx.neighbors(i);
    for (const j of supportWordIdx.neighbors(i)) candIds.add(j);
    if (candIds.size < topKPerItem) {
      for (const j of contentCharIdx.neighbors(i)) candIds.add(j);
    }
    const scored = [];
    for (const j of candIds) {
      const bm = contentWordIdx.bm25Raw(i, j) + 0.5 * supportWordIdx.bm25Raw(i, j);
      const score = bm > 0 ? bm : 0.25 * contentCharIdx.cosine(i, j);
      if (score > 0 || (contentTok[i].clean && contentTok[i].clean === contentTok[j].clean)) {
        scored.push({ j, bm: score });
      }
    }
    scored.sort((x, y) => y.bm - x.bm);
    for (const c of scored.slice(0, topKPerItem)) {
      const a = Math.min(i, c.j);
      const b = Math.max(i, c.j);
      candidatePairs.add(`${a}:${b}`);
    }
  }

  // Tầng 2 — Hybrid Rescoring (Cosine + BM25 + Char3 + Multi-field + Entity Guardrail)
  const pairs = [];
  for (const key of candidatePairs) {
    const [i, j] = key.split(':').map(Number);
    const a = list[i];
    const b = list[j];

    const exactContent = Boolean(contentTok[i].clean && contentTok[i].clean === contentTok[j].clean);
    const wordCos = contentWordIdx.cosine(i, j);
    const charCos = contentCharIdx.cosine(i, j);
    const contentCos = 0.85 * wordCos + 0.15 * charCos;
    const contentBm25 = contentWordIdx.bm25Sym(i, j);
    const contentScore = exactContent ? 1 : 0.55 * contentCos + 0.45 * contentBm25;

    const hasBothSupport = Boolean(supportTok[i].words.length && supportTok[j].words.length);
    const supportCos = hasBothSupport ? supportWordIdx.cosine(i, j) : 0;
    const supportBm25 = hasBothSupport ? supportWordIdx.bm25Sym(i, j) : 0;
    const supportScore = hasBothSupport ? 0.55 * supportCos + 0.45 * supportBm25 : 0;

    const combScore = 0.55 * combinedWordIdx.cosine(i, j) + 0.45 * combinedWordIdx.bm25Sym(i, j);
    const entEval = evaluateEntities(entities[i], entities[j]);

    const sameStream = (a.no != null && b.no != null && a.no === b.no) || sameNonEmpty(a.stream, b.stream);
    const sameGroup = sameNonEmpty(a.group, b.group);
    const supMatch = sameSupportEntity(a, b);
    const crossTeam = Boolean(
      (a.owner && b.owner && !sameNonEmpty(a.owner, b.owner)) ||
      (a.ownerUnit && b.ownerUnit && !sameNonEmpty(a.ownerUnit, b.ownerUnit)),
    );

    const reasons = [];
    let ctxBoost = 0;
    if (!entEval.conflict && (contentScore >= 0.22 || supportScore >= supportThreshold)) {
      if (sameStream) { ctxBoost += 0.03; reasons.push('cùng dòng tiền'); }
      if (sameGroup) { ctxBoost += 0.02; reasons.push(`cùng nhóm ${a.group}`); }
      if (supMatch.same) { ctxBoost += 0.03; reasons.push(`cùng đầu mối hỗ trợ (${supMatch.label})`); }
    }
    if (entEval.note) reasons.push(entEval.note);

    let textBase;
    if (exactContent) {
      textBase = 1;
    } else if (hasBothSupport) {
      const effSupport = contentScore >= 0.20 ? supportScore : supportScore * 0.35;
      const blended = 0.65 * contentScore + 0.35 * effSupport;
      textBase = Math.max(blended, contentScore >= 0.20 ? combScore * 0.96 : 0);
    } else {
      textBase = contentScore;
    }

    const finalScore = entEval.conflict
      ? Math.max(0, Math.min(1, textBase * entEval.multiplier))
      : Math.max(0, Math.min(1, textBase + entEval.bonus + ctxBoost));

    let level = '';
    if (!entEval.conflict) {
      if (exactContent || finalScore >= highThreshold) level = 'high';
      else if (finalScore >= mediumThreshold) level = 'medium';
      else if (hasBothSupport && supportScore >= supportThreshold && supMatch.same) level = 'support';
    }
    if (!level) continue;

    if (crossTeam) reasons.push('khác người/đơn vị phụ trách');
    const sharedContent = contentWordIdx.sharedKeywords(i, j, 5);
    const sharedSupport = hasBothSupport ? supportWordIdx.sharedKeywords(i, j, 4) : [];

    pairs.push({
      aId: a.id,
      bId: b.id,
      aStt: a.stt || String(a.row),
      bStt: b.stt || String(b.row),
      a,
      b,
      level,
      score: Number(finalScore.toFixed(3)),
      pct: Math.round(finalScore * 100),
      metrics: {
        cosine: Number(contentCos.toFixed(3)),
        wordCosine: Number(wordCos.toFixed(3)),
        charCosine: Number(charCos.toFixed(3)),
        bm25: Number(contentBm25.toFixed(3)),
        support: Number(supportScore.toFixed(3)),
      },
      crossTeam,
      shared: sharedContent.length ? sharedContent : sharedSupport,
      sharedSupport,
      reasons,
    });
  }

  pairs.sort((x, y) => DEDUP_LEVEL[x.level].order - DEDUP_LEVEL[y.level].order || y.score - x.score);

  const pushMatch = (id, other, pair) => {
    const entry = byId.get(id) || { level: pair.level, topScore: pair.score, crossTeam: false, matches: [] };
    if (DEDUP_LEVEL[pair.level].order < DEDUP_LEVEL[entry.level].order) entry.level = pair.level;
    if (pair.score > entry.topScore) entry.topScore = pair.score;
    if (pair.crossTeam) entry.crossTeam = true;
    entry.matches.push({
      otherId: other.id,
      otherStt: other.stt || String(other.row),
      other,
      level: pair.level,
      score: pair.score,
      pct: pair.pct,
      metrics: pair.metrics,
      crossTeam: pair.crossTeam,
      shared: pair.shared,
      reasons: pair.reasons,
    });
    byId.set(id, entry);
  };

  for (const p of pairs) {
    pushMatch(p.aId, p.b, p);
    pushMatch(p.bId, p.a, p);
  }
  for (const entry of byId.values()) {
    entry.matches.sort((x, y) => DEDUP_LEVEL[x.level].order - DEDUP_LEVEL[y.level].order || y.score - x.score);
  }

  return {
    pairs,
    byId,
    counts: {
      items: byId.size,
      pairs: pairs.length,
      high: pairs.filter((p) => p.level === 'high').length,
      medium: pairs.filter((p) => p.level === 'medium').length,
      support: pairs.filter((p) => p.level === 'support').length,
      crossTeam: pairs.filter((p) => p.crossTeam).length,
    },
  };
}

function pairKeyOf(aId, bId) {
  return aId < bId ? `${aId}||${bId}` : `${bId}||${aId}`;
}

/**
 * Hợp nhất kết quả Tầng 1 (BM25 + Cosine) với kết quả thẩm định Tầng 2 (Groq LLM):
 * - Cặp AI xác nhận: giữ mức độ & lý do tiếng Việt của AI, kèm nguyên số đo Cosine/BM25 từ Tầng 1.
 * - Cặp trùng ngữ nghĩa chỉ AI phát hiện (BM25+Cosine bỏ sót): bổ sung thêm với source='ai'.
 * - Cặp Tầng 1 bắt nhưng AI loại bỏ: gỡ bỏ báo nhầm (trừ trường hợp giống hệt 100% sau chuẩn hoá).
 * - Nếu AI chưa bật hoặc lỗi: trả nguyên `baseDup` (dự phòng an toàn bằng Tầng 1).
 */
export function mergeAiDuplicates(baseDup, openItems = [], aiResult = null) {
  if (!aiResult || !aiResult.ok || !Array.isArray(aiResult.pairs)) {
    return { ...baseDup, ai: aiResult ? { ok: false, enabled: !!aiResult.enabled, error: aiResult.error || '' } : null };
  }

  const itemById = new Map((openItems || []).filter((it) => it && it.id).map((it) => [it.id, it]));
  const baseByKey = new Map((baseDup?.pairs || []).map((p) => [pairKeyOf(p.aId, p.bId), p]));
  const mergedPairs = [];
  const usedKeys = new Set();

  for (const v of aiResult.pairs) {
    if (!v || !DEDUP_LEVEL[v.level]) continue;
    const a = itemById.get(v.aId);
    const b = itemById.get(v.bId);
    if (!a || !b || a.id === b.id) continue;
    const pk = pairKeyOf(a.id, b.id);
    if (usedKeys.has(pk)) continue;
    usedKeys.add(pk);

    const prev = baseByKey.get(pk);
    const crossTeam = prev
      ? prev.crossTeam
      : Boolean(
          (a.owner && b.owner && !sameNonEmpty(a.owner, b.owner)) ||
          (a.ownerUnit && b.ownerUnit && !sameNonEmpty(a.ownerUnit, b.ownerUnit)),
        );
    const aiConf = Math.max(50, Math.min(100, Math.round(Number(v.confidence) || 85)));
    const score = Number((aiConf / 100).toFixed(3));
    const reasons = [...(prev?.reasons || [])];
    if (crossTeam && !reasons.includes('khác người/đơn vị phụ trách')) reasons.push('khác người/đơn vị phụ trách');

    mergedPairs.push({
      aId: a.id,
      bId: b.id,
      aStt: a.stt || String(a.row),
      bStt: b.stt || String(b.row),
      a,
      b,
      level: v.level,
      score,
      pct: aiConf,
      aiConfidence: aiConf,
      aiReason: String(v.reason || '').trim(),
      source: prev ? 'hybrid' : 'ai',
      metrics: prev?.metrics || { cosine: 0, wordCosine: 0, charCosine: 0, bm25: 0, support: 0 },
      crossTeam,
      shared: prev?.shared || [],
      sharedSupport: prev?.sharedSupport || [],
      reasons,
    });
  }

  // Giữ lại cặp trùng nguyên văn 100% kể cả khi AI vô tình bỏ sót.
  for (const p of baseDup?.pairs || []) {
    const pk = pairKeyOf(p.aId, p.bId);
    if (usedKeys.has(pk)) continue;
    if (normalizeForDedup(p.a?.content) && normalizeForDedup(p.a?.content) === normalizeForDedup(p.b?.content)) {
      usedKeys.add(pk);
      mergedPairs.push({ ...p, source: 'exact' });
    }
  }

  mergedPairs.sort((x, y) => DEDUP_LEVEL[x.level].order - DEDUP_LEVEL[y.level].order || y.score - x.score);

  const byId = new Map();
  const pushMatch = (id, other, pair) => {
    const entry = byId.get(id) || { level: pair.level, topScore: pair.score, crossTeam: false, matches: [] };
    if (DEDUP_LEVEL[pair.level].order < DEDUP_LEVEL[entry.level].order) entry.level = pair.level;
    if (pair.score > entry.topScore) entry.topScore = pair.score;
    if (pair.crossTeam) entry.crossTeam = true;
    entry.matches.push({
      otherId: other.id,
      otherStt: other.stt || String(other.row),
      other,
      level: pair.level,
      score: pair.score,
      pct: pair.pct,
      aiConfidence: pair.aiConfidence,
      aiReason: pair.aiReason,
      source: pair.source,
      metrics: pair.metrics,
      crossTeam: pair.crossTeam,
      shared: pair.shared,
      reasons: pair.reasons,
    });
    byId.set(id, entry);
  };

  for (const p of mergedPairs) {
    pushMatch(p.aId, p.b, p);
    pushMatch(p.bId, p.a, p);
  }
  for (const entry of byId.values()) {
    entry.matches.sort((x, y) => DEDUP_LEVEL[x.level].order - DEDUP_LEVEL[y.level].order || y.score - x.score);
  }

  return {
    pairs: mergedPairs,
    byId,
    counts: {
      items: byId.size,
      pairs: mergedPairs.length,
      high: mergedPairs.filter((p) => p.level === 'high').length,
      medium: mergedPairs.filter((p) => p.level === 'medium').length,
      support: mergedPairs.filter((p) => p.level === 'support').length,
      crossTeam: mergedPairs.filter((p) => p.crossTeam).length,
    },
    ai: {
      ok: true,
      enabled: true,
      cached: !!aiResult.cached,
      model: aiResult.model || '',
      keyIndex: aiResult.keyIndex || 0,
      keyCount: aiResult.keyCount || 0,
      checkedAt: aiResult.checkedAt || '',
    },
  };
}


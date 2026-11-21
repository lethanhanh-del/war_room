// Nghiệp vụ War Room: đọc Sổ mục tiêu, ghi nhật ký, thêm/sửa/loại mục tiêu, duyệt đề xuất AI,
// quét tài liệu Drive, soạn báo cáo ngày. Mọi thao tác ghi đều đi qua một khoá (mutex) để không giẫm nhau.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeDashboard, parseNumber, looksLikeOnePerson } from './logic.js';
import {
  TARGET_STATUS, REMOVED_STATUS, EDITABLE_FIELDS, PROPOSABLE_FIELDS, DECISION_STATUS, labelOf, fieldKeyFromAny,
} from './schema.js';
import { fmtVn, parseVnDateTime, hasTimePart, vnParts, vnDayKey, minutesOfDay, pad } from './time.js';
import { ChangeTracker } from './audit.js';
import { DriveReader, targetIdFrom } from './drive.js';
import { AiService, AiRefusalError, Anthropic } from './ai.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class Mutex {
  #tail = Promise.resolve();
  run(fn) {
    const result = this.#tail.then(fn, fn);
    this.#tail = result.catch(() => {});
    return result;
  }
}

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const CONFIDENCE = { cao: 'Cao', trung_binh: 'Trung bình', thap: 'Thấp' };

export class WarRoomService {
  constructor({ store, drive, config }) {
    this.cfg = config;
    this.store = store;
    this.tracker = new ChangeTracker(config.dataDir);
    this.ai = new AiService(config);
    this.drive = drive ? new DriveReader(drive) : null;
    this.lock = new Mutex();
    this.tables = null;
    this.meta = {};
    this.model = null;
    this.lastRefreshAt = null;
    this.lastError = null;
    this.scanning = false;
    this.bootTime = Date.now();
    this.stateFile = path.join(config.dataDir, 'state.json');
    try {
      this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      this.state = {};
    }
  }

  // ------------------------------------------------------------------ tiện ích
  now() {
    const fixed = this.cfg.demoNow ? parseVnDateTime(this.cfg.demoNow) : null;
    return fixed ? fixed + (Date.now() - this.bootTime) : Date.now();
  }

  nowText() {
    return fmtVn(this.now(), { seconds: true });
  }

  #saveState() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  #logRow({ actor, actorType = 'Người', channel = 'Dashboard', action, object = '', field = '', before = '', after = '', result = 'Thành công', note = '' }) {
    return { time: this.nowText(), actor: actor || 'Không rõ', actorType, channel, action, object, field, before: str(before), after: str(after), result, note };
  }

  #year() {
    const start = parseVnDateTime(this.cfg.warRoomStart);
    return start ? vnParts(start).y : vnParts(this.now()).y;
  }

  #recompute() {
    if (!this.tables) return;
    this.model = computeDashboard({ ...this.tables, meta: this.meta }, {
      now: this.now(),
      config: {
        warRoomStart: this.cfg.warRoomStart,
        warRoomEnd: this.cfg.warRoomEnd,
        shiftDayStart: this.cfg.shiftDayStart,
        shiftNightStart: this.cfg.shiftNightStart,
        staleMinutes: this.cfg.staleMinutes,
      },
    });
  }

  // ------------------------------------------------------------------ đọc & theo dõi thay đổi
  refresh() {
    return this.lock.run(() => this.#refreshUnlocked());
  }

  async #refreshUnlocked() {
    try {
      const { tables, meta } = await this.store.readAll();
      if (this.tracker.hasBaseline) {
        const { entries, touchedTargetRows, truncated } = this.tracker.diff(tables);
        if (entries.length) {
          const actor = meta.lastModifier ? `${meta.lastModifier} (theo lịch sử Drive)` : 'Người dùng Google Sheet';
          const rows = entries.map((e) => this.#logRow({
            actor, channel: 'Google Sheet', action: e.action, object: `${e.tab} · ${e.object}`,
            field: e.field, before: e.before, after: e.after, result: 'Đã ghi',
          }));
          if (truncated) {
            rows.push(this.#logRow({ actor: 'Hệ thống', actorType: 'Hệ thống', channel: 'Hệ thống', action: 'Cảnh báo', object: 'NhatKy', result: 'Cần xử lý', note: 'Quá nhiều thay đổi trong một lần đọc, chỉ ghi 200 dòng đầu' }));
          }
          await this.store.appendRows('NhatKy', rows);
          tables.NhatKy.push(...rows);
        }
        const stamp = this.nowText();
        for (const rowNum of touchedTargetRows) {
          await this.store.updateRow('MucTieu', rowNum, { updatedAt: stamp });
          const r = tables.MucTieu.find((x) => x._row === rowNum);
          if (r) r.updatedAt = stamp;
        }
      }
      this.tracker.rebaseline(tables);
      this.tables = tables;
      this.meta = meta;
      this.#recompute();
      this.lastRefreshAt = Date.now();
      this.lastError = null;
    } catch (err) {
      this.lastError = `Không đọc được Sổ mục tiêu: ${err.message}`;
      throw err;
    }
  }

  async #rereadUnlocked() {
    const { tables, meta } = await this.store.readAll();
    this.tracker.rebaseline(tables);
    this.tables = tables;
    this.meta = meta;
    this.#recompute();
    this.lastRefreshAt = Date.now();
  }

  /** Mọi thao tác ghi: đọc mới (ghi nhật ký thay đổi tay trước) -> ghi -> đọc lại làm mốc. */
  mutate(fn) {
    return this.lock.run(async () => {
      await this.#refreshUnlocked();
      const result = await fn(this.tables);
      await this.#rereadUnlocked();
      return result;
    });
  }

  getDashboard() {
    this.#recompute();
    return { model: this.model, meta: this.publicMeta() };
  }

  publicMeta() {
    return {
      mode: this.store.mode,
      sheetUrl: this.store.sheetUrl,
      refreshSeconds: this.cfg.refreshSeconds,
      aiEnabled: this.ai.enabled,
      aiModelExtract: this.cfg.aiModelExtract,
      aiModelReport: this.cfg.aiModelReport,
      scanDocs: Boolean(this.drive && this.cfg.driveDocsFolderId && this.ai.enabled),
      scanEvidence: Boolean(this.drive && this.cfg.driveEvidenceFolderId),
      lastRefreshAt: this.lastRefreshAt,
      lastError: this.lastError,
      lastScanAt: this.state.lastScanAt || null,
      lastScanResult: this.state.lastScanResult || '',
      reportTime: this.cfg.reportTime,
      operatorEnabled: Boolean(this.cfg.operatorPin),
      serverNow: this.now(),
    };
  }

  // ------------------------------------------------------------------ kiểm tra dữ liệu nhập
  normalizeField(key, value) {
    const v = str(value);
    switch (key) {
      case 'stage': {
        if (!v) return '';
        const n = Number.parseInt(v, 10);
        if (!(n >= 1 && n <= 6)) throw new HttpError(400, 'Bước phải là số từ 1 đến 6');
        return n;
      }
      case 'status':
        if (!v) return '';
        if (v === REMOVED_STATUS) throw new HttpError(400, 'Dùng chức năng "Loại khỏi War Room" để loại mục tiêu');
        if (!TARGET_STATUS.includes(v)) throw new HttpError(400, `Trạng thái không hợp lệ: ${v}`);
        return v;
      case 'deadline':
      case 'start': {
        if (!v) return '';
        const ms = parseVnDateTime(v, { endOfDay: !hasTimePart(v), defaultYear: this.#year() });
        if (ms === null) throw new HttpError(400, `Ngày giờ không hợp lệ: "${v}" (dạng dd/mm/yyyy hh:mm)`);
        return fmtVn(ms, { time: hasTimePart(v) });
      }
      case 'moneyTarget':
      case 'unlocked': {
        if (!v) return '';
        const n = parseNumber(v);
        if (n === null || n < 0) throw new HttpError(400, `Số tiền không hợp lệ: "${v}" (đơn vị tỷ VNĐ)`);
        return n;
      }
      default:
        if (v.length > 1000) throw new HttpError(400, 'Nội dung quá dài (tối đa 1000 ký tự)');
        return v;
    }
  }

  #assertEndToEnd(row) {
    if (str(row.status) === 'Hoàn thành' && (Number(row.stage) !== 6 || !str(row.evidence))) {
      throw new HttpError(400, 'Chỉ được đóng việc (Hoàn thành) khi ở Bước 6 và có link chứng từ — nguyên tắc End-to-End');
    }
  }

  #findTarget(tables, id) {
    const key = str(id).toUpperCase();
    const row = tables.MucTieu.find((t) => str(t.id).toUpperCase() === key);
    if (!row) throw new HttpError(404, `Không tìm thấy mục tiêu ${id}`);
    return row;
  }

  #nextId(rows, prefix, width = 2) {
    const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
    const max = rows.reduce((m, r) => {
      const mm = str(r.id).match(re);
      return mm ? Math.max(m, Number(mm[1])) : m;
    }, 0);
    return `${prefix}${pad(max + 1, width)}`;
  }

  // ------------------------------------------------------------------ mục tiêu: thêm / sửa / loại / khôi phục
  addTarget(input, actor) {
    return this.mutate(async (tables) => {
      const title = str(input.title);
      if (!title) throw new HttpError(400, 'Cần nhập tên mục tiêu');
      const row = {};
      for (const key of EDITABLE_FIELDS) if (input[key] !== undefined) row[key] = this.normalizeField(key, input[key]);
      row.title = title;
      row.status = row.status || 'Chưa bắt đầu';
      row.stage = row.stage || 1;
      this.#assertEndToEnd(row);
      row.id = this.#nextId(tables.MucTieu, 'MT-');
      row.updatedAt = this.nowText();
      await this.store.appendRows('MucTieu', [row]);
      await this.store.appendRows('NhatKy', [this.#logRow({ actor, action: 'Thêm mục tiêu', object: row.id, field: 'Tên mục tiêu', after: title })]);
      return { id: row.id };
    });
  }

  updateTarget(id, patch, actor) {
    return this.mutate(async (tables) => {
      const row = this.#findTarget(tables, id);
      if (str(row.status) === REMOVED_STATUS) throw new HttpError(400, 'Mục tiêu đã bị loại — khôi phục trước khi sửa');
      const changes = {};
      for (const key of EDITABLE_FIELDS) {
        if (patch[key] === undefined) continue;
        const value = this.normalizeField(key, patch[key]);
        if (str(value) !== str(row[key])) changes[key] = value;
      }
      if (key0(changes) === undefined) return { id: row.id, changed: 0 };
      if ('title' in changes && !str(changes.title)) throw new HttpError(400, 'Tên mục tiêu không được để trống');
      this.#assertEndToEnd({ ...row, ...changes });
      await this.store.updateRow('MucTieu', row._row, { ...changes, updatedAt: this.nowText() });
      await this.store.appendRows('NhatKy', Object.entries(changes).map(([k, v]) => this.#logRow({
        actor, action: 'Cập nhật mục tiêu', object: row.id, field: labelOf('MucTieu', k), before: row[k], after: v,
      })));
      return { id: row.id, changed: Object.keys(changes).length };
    });
  }

  removeTarget(id, reason, actor) {
    return this.mutate(async (tables) => {
      const why = str(reason);
      if (why.length < 5) throw new HttpError(400, 'Cần ghi lý do loại mục tiêu (tối thiểu 5 ký tự)');
      const row = this.#findTarget(tables, id);
      if (str(row.status) === REMOVED_STATUS) throw new HttpError(400, 'Mục tiêu đã bị loại trước đó');
      await this.store.updateRow('MucTieu', row._row, { status: REMOVED_STATUS, removedReason: why, updatedAt: this.nowText() });
      await this.store.appendRows('NhatKy', [this.#logRow({
        actor, action: 'Loại khỏi War Room', object: row.id, field: 'Trạng thái', before: row.status, after: REMOVED_STATUS, note: why,
      })]);
      return { id: row.id };
    });
  }

  restoreTarget(id, actor) {
    return this.mutate(async (tables) => {
      const row = this.#findTarget(tables, id);
      if (str(row.status) !== REMOVED_STATUS) throw new HttpError(400, 'Mục tiêu không ở trạng thái "Đã loại"');
      const status = Number(row.stage) >= 2 ? 'Đang triển khai' : 'Chưa bắt đầu';
      await this.store.updateRow('MucTieu', row._row, { status, removedReason: '', updatedAt: this.nowText() });
      await this.store.appendRows('NhatKy', [this.#logRow({
        actor, action: 'Khôi phục mục tiêu', object: row.id, field: 'Trạng thái', before: REMOVED_STATUS, after: status,
      })]);
      return { id: row.id };
    });
  }

  // ------------------------------------------------------------------ quyết định
  addDecision(input, actor) {
    return this.mutate(async (tables) => {
      const content = str(input.content);
      if (!content) throw new HttpError(400, 'Cần nhập nội dung cần quyết định');
      const row = {
        id: this.#nextId(tables.QuyetDinh, 'QĐ-', 1),
        content, rule: str(input.rule), decider: str(input.decider), impact: str(input.impact),
        openedAt: fmtVn(this.now()), status: 'Mở', source: 'Dashboard',
      };
      await this.store.appendRows('QuyetDinh', [row]);
      await this.store.appendRows('NhatKy', [this.#logRow({ actor, action: 'Thêm việc cần quyết định', object: row.id, field: 'Cần quyết định', after: content })]);
      return { id: row.id };
    });
  }

  resolveDecision(id, input, actor) {
    return this.mutate(async (tables) => {
      const status = str(input.status) || 'Đã quyết';
      if (!DECISION_STATUS.includes(status) || status === 'Mở') throw new HttpError(400, 'Trạng thái phải là "Đã quyết" hoặc "Huỷ"');
      const result = str(input.result);
      if (!result) throw new HttpError(400, 'Cần ghi kết quả quyết định');
      const row = tables.QuyetDinh.find((d) => str(d.id) === str(id));
      if (!row) throw new HttpError(404, `Không tìm thấy ${id}`);
      await this.store.updateRow('QuyetDinh', row._row, { status, result, decidedAt: fmtVn(this.now()) });
      await this.store.appendRows('NhatKy', [this.#logRow({ actor, action: 'Ghi quyết định', object: row.id, field: 'Trạng thái', before: row.status, after: status, note: result })]);
      return { id: row.id };
    });
  }

  // ------------------------------------------------------------------ đề xuất AI: duyệt / từ chối
  approveProposal(id, reviewer) {
    return this.mutate(async (tables) => {
      const p = tables.DeXuatAI.find((x) => str(x.id) === str(id));
      if (!p) throw new HttpError(404, `Không tìm thấy đề xuất ${id}`);
      if (str(p.status) && str(p.status) !== 'Chờ duyệt') throw new HttpError(409, `Đề xuất đã được xử lý (${p.status})`);
      const key = fieldKeyFromAny(str(p.field));
      if (!key || !PROPOSABLE_FIELDS.includes(key)) throw new HttpError(400, `Trường không được phép: ${p.field}`);
      const value = this.normalizeField(key, p.proposed);
      let objectId = str(p.target);
      let before = '';
      if (objectId.toUpperCase() === 'MOI') {
        if (key !== 'title') throw new HttpError(400, 'Đề xuất mục tiêu mới phải là trường "Tên mục tiêu"');
        objectId = this.#nextId(tables.MucTieu, 'MT-');
        await this.store.appendRows('MucTieu', [{
          id: objectId, title: value, status: 'Chưa bắt đầu', stage: 1, updatedAt: this.nowText(), note: `Tạo từ đề xuất ${p.id} (${p.source})`,
        }]);
      } else {
        const row = this.#findTarget(tables, objectId);
        before = row[key];
        this.#assertEndToEnd({ ...row, [key]: value });
        await this.store.updateRow('MucTieu', row._row, { [key]: value, updatedAt: this.nowText() });
      }
      await this.store.updateRow('DeXuatAI', p._row, { status: 'Đã duyệt', reviewer, reviewedAt: this.nowText() });
      await this.store.appendRows('NhatKy', [this.#logRow({
        actor: reviewer, action: 'Duyệt đề xuất', object: objectId, field: labelOf('MucTieu', key), before, after: value,
        note: `${p.id} · nguồn: ${p.source}`,
      })]);
      return { id: objectId };
    });
  }

  rejectProposal(id, reviewer, reason) {
    return this.mutate(async (tables) => {
      const p = tables.DeXuatAI.find((x) => str(x.id) === str(id));
      if (!p) throw new HttpError(404, `Không tìm thấy đề xuất ${id}`);
      if (str(p.status) && str(p.status) !== 'Chờ duyệt') throw new HttpError(409, `Đề xuất đã được xử lý (${p.status})`);
      await this.store.updateRow('DeXuatAI', p._row, { status: 'Từ chối', reviewer, reviewedAt: this.nowText(), reason: str(reason) });
      await this.store.appendRows('NhatKy', [this.#logRow({
        actor: reviewer, action: 'Từ chối đề xuất', object: p.target, field: p.field, before: p.current, after: p.proposed,
        result: 'Bị từ chối', note: str(reason),
      })]);
      return { id: p.id };
    });
  }

  // ------------------------------------------------------------------ quét Drive (Tầng 1)
  #proposal(target, key, current, proposed, { source, sourceUrl, quote, confidence }) {
    const d = vnParts(this.now());
    return {
      id: `DX-${d.y}${pad(d.mo)}${pad(d.d)}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt: this.nowText(), source, sourceUrl, target, field: labelOf('MucTieu', key),
      current: str(current), proposed: str(proposed), quote: str(quote).slice(0, 500), confidence, status: 'Chờ duyệt',
    };
  }

  #validateAiUpdate(u, tables) {
    const key = fieldKeyFromAny(u.field);
    if (!key || !PROPOSABLE_FIELDS.includes(key)) return { skip: `trường "${u.field}" không được phép` };
    const isNew = str(u.target_id).toUpperCase() === 'MOI';
    if (isNew && key !== 'title') return { skip: 'mục tiêu mới chỉ đề xuất tên' };
    const row = isNew ? null : tables.MucTieu.find((t) => str(t.id).toUpperCase() === str(u.target_id).toUpperCase());
    if (!isNew && !row) return { skip: `không có mục tiêu ${u.target_id}` };
    let value;
    try {
      value = this.normalizeField(key, u.new_value);
    } catch (e) {
      return { skip: e.message };
    }
    if (key === 'owner' && !looksLikeOnePerson(value)) return { skip: 'owner không phải họ tên 1 người' };
    if (!isNew && str(row[key]) === str(value)) return { skip: 'trùng giá trị hiện có' };
    return { key, value, row, target: isNew ? 'MOI' : row.id };
  }

  async runScan(trigger = 'Tự động', actor = 'Hệ thống') {
    if (!this.drive) return { skipped: 'Chưa cấu hình Google Drive (chế độ demo)' };
    if (this.scanning) return { skipped: 'Đang quét' };
    this.scanning = true;
    const logs = [];
    const proposals = [];
    const state = { ...this.state };
    const startIso = new Date(parseVnDateTime(this.cfg.warRoomStart) || Date.now()).toISOString();
    const tables = this.tables || (await this.store.readAll()).tables;
    try {
      // (a) Thư mục Chứng từ: không cần AI — gán theo mã MT-xx trong tên file / thư mục
      if (this.cfg.driveEvidenceFolderId) {
        const files = await this.drive.listChanged(this.cfg.driveEvidenceFolderId, state.evidenceSince || startIso);
        for (const f of files.slice(0, 50)) {
          const id = targetIdFrom(f.name, f.folderName);
          const row = id && tables.MucTieu.find((t) => str(t.id).toUpperCase() === id);
          if (!row) {
            logs.push(this.#logRow({ actor: 'Hệ thống', actorType: 'Hệ thống', channel: 'Drive', action: 'Đọc chứng từ', object: f.name, result: 'Cần xử lý', note: 'Không gán được mục tiêu — đặt tên file/thư mục theo dạng MT-xx' }));
          } else {
            const meta = { source: `Thư mục Chứng từ · ${f.name}`, sourceUrl: f.webViewLink, quote: `File chứng từ mới: ${f.name}`, confidence: 'Cao' };
            if (str(row.evidence) !== f.webViewLink) proposals.push(this.#proposal(row.id, 'evidence', row.evidence, f.webViewLink, meta));
            if (!(Number(row.stage) >= 5)) proposals.push(this.#proposal(row.id, 'stage', row.stage, 5, meta));
            if (!['Chờ kiểm chứng', 'Hoàn thành'].includes(str(row.status))) proposals.push(this.#proposal(row.id, 'status', row.status, 'Chờ kiểm chứng', meta));
          }
          state.evidenceSince = f.modifiedTime;
        }
      }
      // (b) Thư mục tài liệu điều hành (BBH, báo cáo ngày): AI đọc phần mới, đề xuất cập nhật
      if (this.cfg.driveDocsFolderId && this.ai.enabled) {
        const files = await this.drive.listChanged(this.cfg.driveDocsFolderId, state.docsSince || startIso);
        const register = tables.MucTieu.filter((t) => str(t.status) !== REMOVED_STATUS).slice(0, 150).map((t) => ({
          id: t.id, title: t.title, owner: t.owner, output: t.output, criteria: t.criteria,
          deadline: t.deadline, stage: t.stage, status: t.status, blocker: t.blocker,
        }));
        for (const f of files.slice(0, this.cfg.maxFilesPerScan)) {
          const doc = await this.drive.read(f, this.cfg.maxDocChars);
          if (doc.kind === 'unsupported') {
            logs.push(this.#logRow({ actor: 'Hệ thống', actorType: 'Hệ thống', channel: 'Drive', action: 'Đọc tài liệu', object: f.name, result: 'Bỏ qua', note: doc.reason }));
            state.docsSince = f.modifiedTime;
            continue;
          }
          let out;
          try {
            out = await this.ai.extractProposals({ name: f.name, doc, register });
          } catch (err) {
            const reason = err instanceof AiRefusalError ? err.message
              : err instanceof Anthropic.RateLimitError ? 'AI đang quá tải (429) — sẽ thử lại lần quét sau'
                : err instanceof Anthropic.APIError ? `Lỗi API Claude ${err.status}: ${err.message}`
                  : err.message;
            logs.push(this.#logRow({ actor: 'AI trích xuất', actorType: 'AI', channel: 'Drive', action: 'Đọc tài liệu', object: f.name, result: 'Lỗi', note: reason }));
            break; // không bỏ qua file lỗi: lần quét sau đọc lại
          }
          let accepted = 0;
          const skipped = [];
          for (const u of out.updates || []) {
            const v = this.#validateAiUpdate(u, tables);
            if (v.skip) { skipped.push(v.skip); continue; }
            proposals.push(this.#proposal(v.target, v.key, v.row ? v.row[v.key] : '', v.value, {
              source: f.name, sourceUrl: f.webViewLink, quote: u.quote, confidence: CONFIDENCE[u.confidence] || u.confidence,
            }));
            accepted += 1;
          }
          logs.push(this.#logRow({
            actor: 'AI trích xuất', actorType: 'AI', channel: 'Drive', action: 'Đọc tài liệu', object: f.name,
            after: `${accepted} đề xuất`, result: 'Thành công',
            note: [out.summary, doc.truncated ? `Tài liệu dài, chỉ đọc ${this.cfg.maxDocChars} ký tự đầu` : '', skipped.length ? `Bỏ ${skipped.length} đề xuất không hợp lệ` : '', out.model].filter(Boolean).join(' · '),
          }));
          state.docsSince = f.modifiedTime;
        }
      }

      state.lastScanAt = Date.now();
      state.lastScanResult = `${trigger}: ${proposals.length} đề xuất mới`;
      await this.mutate(async (fresh) => {
        const pendingKeys = new Set(fresh.DeXuatAI.filter((p) => str(p.status) === 'Chờ duyệt')
          .map((p) => `${p.target}|${p.field}|${p.proposed}`));
        const unique = proposals.filter((p) => !pendingKeys.has(`${p.target}|${p.field}|${p.proposed}`));
        if (unique.length) await this.store.appendRows('DeXuatAI', unique);
        if (trigger !== 'Tự động' || unique.length || logs.length) {
          logs.push(this.#logRow({ actor, actorType: actor === 'Hệ thống' ? 'Hệ thống' : 'Người', channel: 'Hệ thống', action: 'Quét tài liệu', object: 'Drive', after: `${unique.length} đề xuất mới`, note: trigger }));
        }
        if (logs.length) await this.store.appendRows('NhatKy', logs);
      });
      this.state = state;
      this.#saveState();
      return { proposals: proposals.length };
    } finally {
      this.scanning = false;
    }
  }

  // ------------------------------------------------------------------ báo cáo ngày
  buildReportFacts() {
    const m = this.getDashboard().model;
    return {
      ngay: fmtVn(this.now(), { time: false }),
      time_box: `${m.timebox.rangeText} · ngày ${m.timebox.dayIndex}/${m.timebox.totalDays} · ${m.timebox.text}`,
      muc_tieu: {
        tong: m.kpi.total, bao_hoan_thanh: m.kpi.doneOrReported, da_kiem_chung_chung_tu: m.kpi.verified,
        dang_trien_khai: m.kpi.inProgress, chua_bat_dau: m.kpi.notStarted, qua_han: m.kpi.overdue, dang_nghen: m.kpi.blocked, da_loai: m.kpi.removed,
      },
      tien_ty_vnd: { chi_tieu: m.money.moneyTarget, da_thu_co_chung_tu: m.money.collected, khai_thong: m.money.unlocked },
      dong_tien: m.streams.map((s) => ({ ma: s.id, ten: s.name, owner: s.owner || null, tinh_trang: s.label, nhan_su: s.staff })),
      diem_cho: m.waiting.byKind,
      can_quyet_dinh: m.decisions.open.map((d) => ({ ma: d.id, noi_dung: d.content, nguoi_quyet: d.decider })),
      vi_pham_nguyen_tac: m.rules.filter((r) => !r.ok).map((r) => `${r.name}: ${r.status}`),
      muc_tieu_trong_tam: m.targets.filter((t) => t.open && !t.placeholder).slice(0, 10).map((t) => ({
        ma: t.id, ten: t.title, owner: t.owner || null, buoc: `${t.stage || '?'} ${t.stageName}`, trang_thai: t.status,
        han: t.deadline || null, diem_nghen: t.blocker || null,
      })),
    };
  }

  #templateReport(f) {
    const L = [];
    L.push('Kính gửi các Anh/Chị thành viên War Room,');
    L.push(`Em xin gửi tình hình War Room ngày ${f.ngay} (${f.time_box}), tổng hợp tự động từ Sổ mục tiêu.`);
    L.push('1. Tổng quan:');
    L.push(`- Mục tiêu: ${f.muc_tieu.tong}; đã báo hoàn thành ${f.muc_tieu.bao_hoan_thanh} (${f.muc_tieu.da_kiem_chung_chung_tu} đã kiểm chứng chứng từ); đang triển khai ${f.muc_tieu.dang_trien_khai}; quá hạn ${f.muc_tieu.qua_han}.`);
    L.push(`- Tiền đã thu có chứng từ: ${f.tien_ty_vnd.da_thu_co_chung_tu || 0} tỷ VNĐ; chỉ tiêu: ${f.tien_ty_vnd.chi_tieu ? `${f.tien_ty_vnd.chi_tieu} tỷ VNĐ` : 'chưa đặt'}.`);
    L.push(`- Điểm chờ đang mở: ${Object.values(f.diem_cho).reduce((a, b) => a + b, 0)}.`);
    L.push('2. Trọng tâm cần đẩy nhanh:');
    for (const t of f.muc_tieu_trong_tam) L.push(`- ${t.ma} ${t.ten} — ${t.owner || 'chưa có owner'} (Bước ${t.buoc})${t.diem_nghen ? `; nghẽn: ${t.diem_nghen}` : ''}.`);
    L.push('3. Cần quyết định / yêu cầu triển khai:');
    for (const d of f.can_quyet_dinh) L.push(`- ${d.ma}: ${d.noi_dung} — ${d.nguoi_quyet || 'chưa rõ người quyết'}.`);
    for (const v of f.vi_pham_nguyen_tac) L.push(`- ${v}.`);
    return L.join('\n');
  }

  async generateReport(trigger = 'Tự động', actor = 'Hệ thống') {
    const facts = this.buildReportFacts();
    let content;
    let model = 'Mẫu tự động (không dùng AI)';
    let note = '';
    if (this.ai.enabled) {
      try {
        const out = await this.ai.writeDailyReport(facts);
        content = out.text;
        model = out.model;
      } catch (err) {
        note = `AI lỗi, dùng mẫu tự động: ${err.message}`;
      }
    }
    if (!content) content = this.#templateReport(facts);
    await this.mutate(async () => {
      await this.store.appendRows('BaoCao', [{ time: this.nowText(), kind: `Báo cáo ngày (${trigger.toLowerCase()})`, content, model }]);
      await this.store.appendRows('NhatKy', [this.#logRow({
        actor, actorType: actor === 'Hệ thống' ? 'Hệ thống' : 'Người', channel: 'Hệ thống', action: 'Tạo báo cáo ngày', object: 'BaoCao', after: model, note,
      })]);
    });
    this.state.lastReportDay = vnDayKey(this.now());
    this.#saveState();
    return { content, model };
  }

  // ------------------------------------------------------------------ lịch chạy
  start() {
    const safe = (name, fn) => async () => {
      try {
        await fn();
      } catch (err) {
        console.error(`[${name}]`, err.message);
      }
    };
    this.timers = [
      setInterval(safe('refresh', () => this.refresh()), this.cfg.pollSeconds * 1000),
      setInterval(safe('scan', async () => {
        if (this.drive && (this.cfg.driveEvidenceFolderId || this.cfg.driveDocsFolderId)) await this.runScan('Tự động');
      }), this.cfg.scanMinutes * 60000),
      setInterval(safe('report', async () => {
        const p = vnParts(this.now());
        const due = p.h * 60 + p.mi >= minutesOfDay(this.cfg.reportTime, 18 * 60);
        if (due && this.state.lastReportDay !== vnDayKey(this.now()) && this.tables) await this.generateReport('Tự động');
      }), 60000),
    ];
  }

  stop() {
    for (const t of this.timers || []) clearInterval(t);
  }
}

function key0(obj) {
  return Object.keys(obj)[0];
}

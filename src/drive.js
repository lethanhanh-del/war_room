// Đọc file trong 2 thư mục Drive mà War Room chỉ định (tài liệu điều hành + chứng từ).
// Chỉ đọc file CÓ THAY ĐỔI kể từ lần quét trước (so theo modifiedTime) — không quét lại toàn bộ.
import mammoth from 'mammoth';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GDOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const TEXT_MIMES = new Set(['text/plain', 'text/markdown', 'text/csv']);
const MAX_PDF_BYTES = 30 * 1024 * 1024;

const safeId = (id) => {
  if (!/^[A-Za-z0-9_-]+$/.test(id || '')) throw new Error(`ID thư mục Drive không hợp lệ: ${id}`);
  return id;
};

export class DriveReader {
  constructor(drive) {
    this.drive = drive;
  }

  /** Liệt kê file (đệ quy tối đa `depth` cấp thư mục con) có modifiedTime > sinceIso, cũ trước mới sau. */
  async listChanged(folderId, sinceIso, depth = 2) {
    const out = [];
    const walk = async (id, folderName, level) => {
      let pageToken;
      do {
        const res = await this.drive.files.list({
          q: `'${safeId(id)}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,webViewLink,size)',
          pageSize: 200,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const f of res.data.files || []) {
          if (f.mimeType === FOLDER_MIME) {
            if (level < depth) await walk(f.id, f.name, level + 1);
          } else if (!sinceIso || f.modifiedTime > sinceIso) {
            out.push({ ...f, folderName });
          }
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken);
    };
    await walk(folderId, '', 0);
    out.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
    return out;
  }

  async #media(fileId, responseType) {
    const res = await this.drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType });
    return res.data;
  }

  /**
   * Đọc nội dung để gửi AI.
   * -> { kind: 'text', text, truncated } | { kind: 'pdf', base64 } | { kind: 'unsupported', reason }
   */
  async read(file, maxChars) {
    const clip = (text) => {
      const t = String(text || '').replace(/\r\n/g, '\n').trim();
      return t.length > maxChars ? { kind: 'text', text: t.slice(0, maxChars), truncated: true } : { kind: 'text', text: t, truncated: false };
    };
    if (file.mimeType === GDOC_MIME) {
      const res = await this.drive.files.export({ fileId: file.id, mimeType: 'text/plain' }, { responseType: 'text' });
      return clip(res.data);
    }
    if (file.mimeType === DOCX_MIME) {
      const data = await this.#media(file.id, 'arraybuffer');
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
      return clip(value);
    }
    if (file.mimeType === PDF_MIME) {
      if (Number(file.size || 0) > MAX_PDF_BYTES) return { kind: 'unsupported', reason: 'PDF lớn hơn 30 MB' };
      const data = await this.#media(file.id, 'arraybuffer');
      return { kind: 'pdf', base64: Buffer.from(data).toString('base64') };
    }
    if (TEXT_MIMES.has(file.mimeType)) {
      return clip(await this.#media(file.id, 'text'));
    }
    return { kind: 'unsupported', reason: `Chưa hỗ trợ định dạng ${file.mimeType}` };
  }
}

/** Lấy mã mục tiêu từ tên file hoặc tên thư mục: "MT-04_bien-ban.pdf", "MT04", "mt 4". */
export function targetIdFrom(...names) {
  for (const n of names) {
    const m = String(n || '').match(/\bMT[\s_-]?0*(\d{1,3})\b/i);
    if (m) return `MT-${m[1].padStart(2, '0')}`;
  }
  return null;
}

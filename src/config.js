import path from 'node:path';

const env = process.env;
const int = (v, d) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : d);
const trim = (v) => (v || '').trim();

const spreadsheetId = trim(env.SPREADSHEET_ID);

export const config = {
  port: int(env.PORT, 8080),
  dataSource: trim(env.DATA_SOURCE) || (spreadsheetId ? 'sheets' : 'demo'),
  dataDir: path.resolve(trim(env.DATA_DIR) || './data'),

  // Google
  spreadsheetId,
  googleCredentials: trim(env.GOOGLE_APPLICATION_CREDENTIALS),
  driveDocsFolderId: trim(env.DRIVE_DOCS_FOLDER_ID), // BBH, báo cáo ngày
  driveEvidenceFolderId: trim(env.DRIVE_EVIDENCE_FOLDER_ID), // Chứng từ

  // AI (Claude)
  anthropicApiKey: trim(env.ANTHROPIC_API_KEY),
  aiModelExtract: trim(env.AI_MODEL_EXTRACT) || 'claude-opus-5-5',
  aiModelReport: trim(env.AI_MODEL_REPORT) || 'claude-opus-5-5',
  aiEffortExtract: trim(env.AI_EFFORT_EXTRACT) || 'low',
  aiEffortReport: trim(env.AI_EFFORT_REPORT) || 'medium',
  maxFilesPerScan: int(env.MAX_FILES_PER_SCAN, 5),
  maxDocChars: int(env.MAX_DOC_CHARS, 120000),

  // War Room
  warRoomStart: trim(env.WAR_ROOM_START) || '21/11/2026 07:30',
  warRoomEnd: trim(env.WAR_ROOM_END) || '25/11/2026 23:59',
  shiftDayStart: trim(env.SHIFT_DAY_START) || '07:30',
  shiftNightStart: trim(env.SHIFT_NIGHT_START) || '19:30',
  staleMinutes: int(env.STALE_MINUTES, 60),

  // Nhịp chạy
  pollSeconds: Math.max(10, int(env.POLL_SECONDS, 20)),
  scanMinutes: Math.max(1, int(env.SCAN_MINUTES, 5)),
  reportTime: trim(env.REPORT_TIME) || '18:00',
  refreshSeconds: Math.max(10, int(env.CLIENT_REFRESH_SECONDS, 30)),

  // Bảo vệ
  operatorPin: trim(env.OPERATOR_PIN),
  basicAuthUser: trim(env.BASIC_AUTH_USER),
  basicAuthPass: trim(env.BASIC_AUTH_PASS),

  // Chỉ dùng cho demo / ảnh chụp: cố định "bây giờ"
  demoNow: trim(env.DEMO_NOW),
};

export const aiEnabled = () => Boolean(config.anthropicApiKey);

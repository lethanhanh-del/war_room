// Build màn hình War Room dòng tiền của Thành Anh (app React + Vite, thư mục FE/) thành trang "/" của Worker.
// Chạy trong bước build của wrangler (xem "build" trong wrangler.jsonc) trước mỗi lần deploy / dev, hoặc `npm run build:fe`.
//
// - Kết quả ở public/app/ (base /app/, không commit: .gitignore). Worker phục vụ public/app/index.html ở "/" và chèn
//   thanh điều hướng chung; dữ liệu app lấy từ GET /api/dashboard của Worker (src/kpi/dashboard.js).
// - FE/ giữ nguyên để Thành Anh vẫn chạy / deploy riêng lên Vercel (FE/api/ đọc Google Sheet bằng Service Account).
// - FE/ không đổi kể từ lần build trước thì bỏ qua (wrangler dev chạy lại bước build mỗi khi sửa src/).
// - Build lỗi: giữ bản build cũ nếu có, không thì ghi trang báo lỗi; vẫn thoát 0 để các trang khác vẫn deploy được.
//   FORCE_FE_BUILD=1: luôn build lại. STRICT_FE_BUILD=1: build lỗi thì dừng (thoát 1).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fe = join(root, "FE");
const out = join(root, "public", "app");
const index = join(out, "index.html");
const SOURCES = ["src", "public", "index.html", "vite.config.js", "package.json", "package-lock.json"];

/** Thời điểm sửa mới nhất trong các file nguồn của FE. */
function newest(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(p).reduce((m, name) => Math.max(m, newest(join(p, name))), st.mtimeMs);
}

function run(cmd, args) {
  console.log(`[build-fe] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: fe, stdio: "inherit", env: process.env });
  return r.status === 0;
}

function fail(message) {
  console.error(`[build-fe] LỖI: ${message}`);
  if (process.env.STRICT_FE_BUILD === "1") process.exit(1);
  if (existsSync(index)) {
    console.error("[build-fe] Giữ bản build trước của màn hình Dòng tiền.");
    return;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    index,
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Dòng tiền · War Room</title></head>` +
      `<body style="margin:0;background:#07090d;color:#f3f6fa;font:15px system-ui,sans-serif">` +
      `<p style="margin:48px auto;max-width:640px;line-height:1.6">Chưa build được màn hình Dòng tiền (thư mục FE/). ` +
      `Xem log build trên Cloudflare (Workers Builds) để biết lỗi.</p></body></html>\n`
  );
}

if (!existsSync(join(fe, "package.json"))) {
  fail("không có thư mục FE/.");
} else if (process.env.FORCE_FE_BUILD !== "1" && existsSync(index) && statSync(index).mtimeMs >= Math.max(...SOURCES.map((s) => newest(join(fe, s))))) {
  console.log("[build-fe] FE/ không đổi: dùng bản build hiện có (public/app/).");
} else {
  const vite = join(fe, "node_modules", "vite", "bin", "vite.js");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  if (!existsSync(vite) && !run(npm, ["ci", "--no-audit", "--no-fund"]) && !run(npm, ["install", "--no-audit", "--no-fund"])) {
    fail("cài thư viện cho FE/ không được (npm ci / npm install).");
  } else if (!run(process.execPath, [vite, "build", "--base", "/app/", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"])) {
    fail("vite build không chạy được.");
  } else {
    console.log("[build-fe] Đã build màn hình Dòng tiền vào public/app/.");
  }
}

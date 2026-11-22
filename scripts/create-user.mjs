// Tạo tài khoản War Room trực tiếp trên D1 (mặc định Production --remote).
// Cách dùng:
//   npm run create-user -- "Nguyễn Văn A" "Chức danh" "Phòng ban"
//   node scripts/create-user.mjs "Nguyễn Văn A" "Chức danh" "Phòng ban"
//   node scripts/create-user.mjs "Nguyễn Văn A" --user nva2 --pass CTG@2026
//   node scripts/create-user.mjs          (chế độ hỏi tương tác)

import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { DEFAULT_PASSWORD, hashPassword, makeUsername } from "../src/auth.js";

const DB_NAME = "ctgwarroom";
const LOGIN_URL = "https://ctgwarroom.cthomes-warroom.workers.dev";

function parseArgs(argv) {
  const positional = [];
  const opts = { user: "", pass: "", local: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--local") opts.local = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--user" || a === "-u") opts.user = argv[++i] || "";
    else if (a === "--pass" || a === "-p") opts.pass = argv[++i] || "";
    else if (a.startsWith("--user=")) opts.user = a.slice(7);
    else if (a.startsWith("--pass=")) opts.pass = a.slice(7);
    else positional.push(a);
  }
  return { positional, opts };
}

function sqlStr(v) {
  return `'${String(v ?? "").replace(/'/g, "''")}'`;
}

function resolveNode22() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) return { nodeBin: process.execPath, extraPath: "" };
  const portableDir = join(homedir(), ".local", "node22");
  const portableNode = join(portableDir, process.platform === "win32" ? "node.exe" : "node");
  if (existsSync(portableNode)) return { nodeBin: portableNode, extraPath: portableDir };
  return { nodeBin: process.execPath, extraPath: "" };
}

function runD1Sql(sql, { local }) {
  const wranglerJs = resolve(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerJs)) {
    throw new Error("Không tìm thấy wrangler trong node_modules. Hãy chạy `npm install` trước.");
  }
  const { nodeBin, extraPath } = resolveNode22();
  const tmpFile = join(tmpdir(), `warroom-create-user-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(tmpFile, sql, "utf8");
  try {
    const env = { ...process.env };
    if (extraPath) env.PATH = `${extraPath}${process.platform === "win32" ? ";" : ":"}${env.PATH || ""}`;
    const args = [wranglerJs, "d1", "execute", DB_NAME, local ? "--local" : "--remote", "--file", tmpFile, "--yes"];
    return execFileSync(nodeBin, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

function printHelp() {
  console.log(`
Tạo tài khoản mới trên War Room (Cloudflare D1: ${DB_NAME})

Cách dùng nhanh:
  npm run create-user -- "Họ và Tên" ["Chức danh"] ["Phòng ban"]
  node scripts/create-user.mjs "Họ và Tên" ["Chức danh"] ["Phòng ban"]

Tùy chọn:
  --user, -u <username>   Tự chọn tên đăng nhập (mặc định tự sinh từ họ tên)
  --pass, -p <password>   Mật khẩu ban đầu (mặc định: ${DEFAULT_PASSWORD})
  --local                 Tạo trên D1 local thay vì Production
  --dry-run               Chỉ in thông tin & SQL, không ghi vào database

Ví dụ:
  npm run create-user -- "Nguyễn Văn An" "Trưởng phòng" "HTC"
  npm run create-user -- "Trần Thị Bình"
  npm run create-user     (nhập từng dòng tương tác)
`);
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  let fullName = (positional[0] || "").trim();
  let title = (positional[1] || "").trim();
  let department = (positional[2] || "").trim();

  if (!fullName) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      fullName = (await rl.question("Họ và tên (bắt buộc): ")).trim();
      if (!fullName) {
        console.error("Lỗi: Cần nhập họ và tên.");
        process.exit(1);
      }
      title = (await rl.question("Chức danh (Enter để bỏ trống): ")).trim();
      department = (await rl.question("Phòng ban (Enter để bỏ trống): ")).trim();
      const autoUser = makeUsername(fullName);
      const customUser = (await rl.question(`Tên đăng nhập [${autoUser}]: `)).trim();
      if (customUser) opts.user = customUser;
    } finally {
      rl.close();
    }
  }

  const username = (opts.user || makeUsername(fullName)).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!username || username === "admin") {
    console.error(`Lỗi: Tên đăng nhập không hợp lệ ("${username}"). Hãy truyền --user <ten_dang_nhap>.`);
    process.exit(1);
  }

  const password = opts.pass || DEFAULT_PASSWORD;
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const sql = [
    `INSERT INTO users (username, full_name, title, department, password_hash, must_change, pw_version, created_at)`,
    `VALUES (${sqlStr(username)}, ${sqlStr(fullName)}, ${sqlStr(title)}, ${sqlStr(department)}, ${sqlStr(passwordHash)}, 1, 1, ${sqlStr(now)});`,
    `INSERT INTO audit_log (ts, username, action, detail, ip)`,
    `VALUES (${sqlStr(now)}, 'admin', 'user_created', ${sqlStr(`${username} (${fullName})`)}, 'cli');`,
  ].join("\n");

  if (opts.dryRun) {
    console.log("[DRY RUN] Sẽ tạo tài khoản:", { username, fullName, title, department, password, target: opts.local ? "local" : "remote" });
    console.log(sql);
    return;
  }

  try {
    runD1Sql(sql, { local: opts.local });
  } catch (err) {
    const msg = String(err?.stderr || err?.stdout || err?.message || err);
    if (/UNIQUE constraint failed/i.test(msg)) {
      console.error(`\n❌ Tên đăng nhập "${username}" đã tồn tại!`);
      console.error(`   Gợi ý: chạy lại với tên khác, ví dụ: --user ${username}2`);
    } else {
      console.error("\n❌ Tạo tài khoản thất bại:\n" + msg);
    }
    process.exit(1);
  }

  console.log(`\n✅ Tạo tài khoản thành công (${opts.local ? "LOCAL" : "PRODUCTION"})!`);
  console.log(`   Link đăng nhập : ${LOGIN_URL}`);
  console.log(`   Tên đăng nhập  : ${username}`);
  console.log(`   Mật khẩu       : ${password} (đổi mật khẩu ở lần đăng nhập đầu)`);
  console.log(`   Họ và tên      : ${fullName}`);
  if (title) console.log(`   Chức danh      : ${title}`);
  if (department) console.log(`   Phòng ban      : ${department}`);
}

main();

// Chạy trong bước build của wrangler (xem "build" trong wrangler.jsonc).
// Lấy ACCESS_PASSWORD từ biến Build của Cloudflare Workers Builds
// và chỉ ghi mã băm SHA-256 vào generated/password.js, không ghi mật khẩu gốc.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const pw = process.env.ACCESS_PASSWORD || "";
const hash = pw ? createHash("sha256").update(pw).digest("hex") : "";
mkdirSync("generated", { recursive: true });
writeFileSync("generated/password.js", `export const BUILD_PASSWORD_HASH = ${JSON.stringify(hash)};\n`);
console.log(pw ? "ACCESS_PASSWORD (build): found" : "ACCESS_PASSWORD (build): not set");

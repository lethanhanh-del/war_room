#!/usr/bin/env bash
# Deploy War Room lên Vercel (macOS / Linux / Git Bash)
# Cách dùng (từ thư mục gốc repo):
#   ./deploy/deploy.sh          -> deploy bản Preview
#   ./deploy/deploy.sh --prod   -> deploy Production
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/FE"

command -v vercel >/dev/null 2>&1 || { echo "Chưa có Vercel CLI, đang cài..."; npm i -g vercel; }

echo "== Cài dependency =="; npm ci
echo "== Chạy test ==";      npm test
echo "== Build thử ==";      npm run build

[ -f .vercel/project.json ] || { echo "== Link project Vercel =="; vercel link; }

if [ "${1:-}" = "--prod" ]; then
  echo "== Deploy PRODUCTION =="; vercel --prod
else
  echo "== Deploy PREVIEW ==";    vercel
fi

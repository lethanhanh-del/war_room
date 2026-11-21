# Deploy War Room lên Vercel (Windows PowerShell)
# Cách dùng (từ thư mục gốc repo):
#   .\deploy\deploy.ps1            -> deploy bản Preview
#   .\deploy\deploy.ps1 -Prod      -> deploy Production
param([switch]$Prod)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$fe = Join-Path $root 'FE'

if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
  Write-Host 'Chưa có Vercel CLI, đang cài: npm i -g vercel' -ForegroundColor Yellow
  npm i -g vercel
}

Push-Location $fe
try {
  Write-Host '== Cài dependency ==' -ForegroundColor Cyan
  npm ci
  Write-Host '== Chạy test ==' -ForegroundColor Cyan
  npm test
  Write-Host '== Build thử ==' -ForegroundColor Cyan
  npm run build

  if (-not (Test-Path '.vercel/project.json')) {
    Write-Host '== Link project Vercel ==' -ForegroundColor Cyan
    vercel link
  }

  if ($Prod) {
    Write-Host '== Deploy PRODUCTION ==' -ForegroundColor Magenta
    vercel --prod
  } else {
    Write-Host '== Deploy PREVIEW ==' -ForegroundColor Cyan
    vercel
  }
} finally {
  Pop-Location
}

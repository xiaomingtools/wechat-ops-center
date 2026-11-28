# ============================================================
#  One-click: local data -> data/appdata.json -> GitHub -> Vercel
#  Usage:  powershell -ExecutionPolicy Bypass -File publish_cloud.ps1 [-SkipVercel]
#
#  All embedded JS was extracted into sibling helper scripts
#  (show_fetched.js / biz_compare.js / update_check_ts.js / cloud_verify.js)
#  because PS 5.1 mis-parses multi-line embedded JS and non-ASCII argv.
# ============================================================
param([switch]$SkipVercel)
$ErrorActionPreference = "Stop"

$ROOT     = $PSScriptRoot
$LocalAPI = "http://localhost:3001/api/app"
$OutFile  = Join-Path $ROOT "data\appdata.json"
$BRANCH   = "main"

Set-Location $ROOT

function Test-Port3001 {
  try {
    $r = Invoke-WebRequest -Uri $LocalAPI -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Write-Log {
  param([string]$msg, [string]$color = "White")
  Write-Host $msg -ForegroundColor $color
}

Write-Log "=== wechat-ops-center : publish to cloud ===" -ForegroundColor Cyan
Write-Host ""

# ---- 0. record sync start time ----
$syncStart = Get-Date
Write-Host "[sync start] $($syncStart.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan

# ---- 1. ensure local service is running ----
if (Test-Port3001) {
  Write-Host "[1/7] local :3001 already running" -ForegroundColor Green
} else {
  Write-Host "[1/7] local :3001 not running - starting server.mjs ..." -ForegroundColor Yellow
  Start-Process -FilePath "node" -ArgumentList "src\server.mjs" -WorkingDirectory $ROOT -WindowStyle Hidden
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Port3001) { $ok = $true; break }
  }
  if (-not $ok) {
    Write-Error "local service failed to start on :3001 (check port / node install)"
    exit 1
  }
  Write-Host "      local service ready" -ForegroundColor Green
}

# ---- 2. pull fresh /api/app ----
Write-Host "[2/7] fetching /api/app ..." -ForegroundColor Yellow
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes = $wc.DownloadData($LocalAPI)
$wc.Dispose()
New-Item -ItemType Directory -Force -Path (Join-Path $ROOT "data") | Out-Null
$NewFile = Join-Path $ROOT "data\.appdata.new.json"
[System.IO.File]::WriteAllBytes($NewFile, $bytes)

$chk = node (Join-Path $PSScriptRoot "show_fetched.js")
$f = ($chk -split '\|')
Write-Host ("      fetched: followers=" + $f[0] + " readers30d=" + $f[1] + " articles=" + $f[2]) -ForegroundColor Green

# ---- 3. commit only if BUSINESS data changed ----
Write-Host "[3/7] checking for data change ..." -ForegroundColor Yellow
$OldFile = Join-Path $ROOT "data\.appdata.old.json"
cmd /c "git show HEAD:data/appdata.json > `"$OldFile`" 2>nul"

$changed = node (Join-Path $PSScriptRoot "biz_compare.js")
Write-Host "      fingerprint: $changed" -ForegroundColor DarkGray

Remove-Item $OldFile -Force -ErrorAction SilentlyContinue
Remove-Item $NewFile -Force -ErrorAction SilentlyContinue

if ($changed -ceq "SAME") {
  Write-Host "      business data unchanged - cloud already up to date. Updating check timestamp..." -ForegroundColor Gray
  node (Join-Path $PSScriptRoot "update_check_ts.js")
  Write-Host "      check timestamp updated, done." -ForegroundColor Gray
  Write-Host ""
  Write-Host "  local: http://localhost:3001/" -ForegroundColor Cyan
  Write-Host "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
  exit 0
}

# ---- 4. write fresh data and commit ----
Write-Host "[4/7] writing fresh data & committing ..." -ForegroundColor Yellow
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes2 = $wc.DownloadData($LocalAPI)
$wc.Dispose()
[System.IO.File]::WriteAllBytes($OutFile, $bytes2)

git add data/appdata.json
$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "sync: refresh cloud data appdata.json @ $ts" | Out-Null

# ---- 5. git push with retry ----
Write-Host "[5/7] pushing to GitHub ..." -ForegroundColor Yellow
$pushOk = $false
for ($i = 1; $i -le 3; $i++) {
  git push origin main
  if ($LASTEXITCODE -eq 0) { $pushOk = $true; break }
  Write-Host "  [retry] git push failed, exit $LASTEXITCODE, retry in 5s..." -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
if (-not $pushOk) {
  Write-Error "git push failed after 3 retries - cloud data NOT yet pushed"
  exit 1
}
Write-Host "      data updated & pushed to GitHub" -ForegroundColor Green

# ---- 6. Vercel deploy (optional) ----
if ($SkipVercel) {
  Write-Host "[6/7] vercel deploy skipped (-SkipVercel). Data is live via raw GitHub fallback." -ForegroundColor Gray
} else {
  Write-Host "[6/7] redeploying Vercel ..." -ForegroundColor Yellow
  $vercelOk = $false
  for ($i = 1; $i -le 3; $i++) {
    $out = vercel --prod --yes 2>&1
    if ($out -match "Aliased|Ready in|Production") { $vercelOk = $true; break }
    Write-Host "  [retry] vercel deploy abnormal, retry in 10s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
  }
  if (-not $vercelOk) {
    Write-Host "  Vercel deploy may be abnormal, but GitHub raw data source is updated; cloud dashboard still reachable via fallback source" -ForegroundColor Yellow
  } else {
    Write-Host "      Vercel deploy complete" -ForegroundColor Green
  }
}

# ---- 7. cloud read-back verification ----
Write-Host "[7/7] cloud data verify..." -ForegroundColor Cyan
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$cloudUrl = "https://raw.githubusercontent.com/xiaomingtools/wechat-ops-center/main/data/appdata.json"
$bytes = $wc.DownloadData($cloudUrl)
$wc.Dispose()
$cloudFile = Join-Path $ROOT "data\.appdata.cloud.json"
[System.IO.File]::WriteAllBytes($cloudFile, $bytes)

$verify = node (Join-Path $PSScriptRoot "cloud_verify.js")
Remove-Item (Join-Path $ROOT "data\.appdata.cloud.json") -Force -ErrorAction SilentlyContinue

if ($LASTEXITCODE -eq 0) {
  Write-Host "  business fingerprint SAME - cloud data synced" -ForegroundColor Green
} else {
  Write-Error "cloud data verify failed, sync may be incomplete"
  exit 1
}

Write-Host "[done] sync complete" -ForegroundColor Green
Write-Host ""
Write-Host "  local: http://localhost:3001/" -ForegroundColor Cyan
Write-Host "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: cloud dashboard pulls data live from raw.githubusercontent (data/appdata.json)" -ForegroundColor DarkGray
Write-Host "      Git push is enough to refresh cloud view; Vercel deploy is optional." -ForegroundColor DarkGray

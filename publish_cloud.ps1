# ============================================================
#  One-click: local data -> data/appdata.json -> GitHub -> Vercel
#  Usage:  powershell -ExecutionPolicy Bypass -File publish_cloud.ps1 [-SkipVercel]
# ============================================================
param([switch]$SkipVercel)
$ErrorActionPreference = "Stop"

# Derive ROOT from script location -> avoids any Chinese-path literal encoding issues.
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

Write-Host "=== wechat-ops-center : publish to cloud ===" -ForegroundColor Cyan
Write-Host ""

# ---- 1. ensure local service is running ----
if (Test-Port3001) {
  Write-Host "[1/5] local :3001 already running" -ForegroundColor Green
} else {
  Write-Host "[1/5] local :3001 not running - starting server.mjs ..." -ForegroundColor Yellow
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

# ---- 2. pull fresh /api/app (raw bytes via WebClient, no PS5.1 encoding issues) ----
Write-Host "[2/5] fetching /api/app ..." -ForegroundColor Yellow
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes = $wc.DownloadData($LocalAPI)
$wc.Dispose()
New-Item -ItemType Directory -Force -Path (Join-Path $ROOT "data") | Out-Null
$NewFile = Join-Path $ROOT "data\.appdata.new.json"
[System.IO.File]::WriteAllBytes($NewFile, $bytes)   # raw bytes, zero re-encoding

# quick human check
$chk = node -e "const d=require('$($NewFile -replace '\\','/')'); console.log(d.overview.followers+'|'+d.overview.totalReaders30d+'|'+d.overview.totalArticles)"
$f = $chk.Split('|')
Write-Host ("      fetched: followers=" + $f[0] + " readers30d=" + $f[1] + " articles=" + $f[2]) -ForegroundColor Green

# ---- 3. commit only if BUSINESS data changed (ignore generated_at timestamp) ----
Write-Host "[3/5] checking for data change ..." -ForegroundColor Yellow
$OldFile = Join-Path $ROOT "data\.appdata.old.json"
# use cmd-level redirect so git output bytes are preserved (no PS GBK re-encode)
cmd /c "git show HEAD:data/appdata.json > `"$OldFile`" 2>nul"

$changed = node -e "
const fs=require('fs');
function biz(p){
  let s;
  try{ s=fs.readFileSync(p,'utf8'); }catch(e){ return null; }
  const o=JSON.parse(s);
  if(o.generated_at!==undefined) delete o.generated_at;
  return JSON.stringify(o);
}
const oldB=biz('$($OldFile -replace '\\','/')');
const newB=biz('$($NewFile -replace '\\','/')');
if(oldB===null){ console.log('ADD'); }
else if(oldB===newB){ console.log('SAME'); }
else{ console.log('CHANGED'); }
"
Write-Host "      fingerprint: $changed" -ForegroundColor DarkGray

# clean temp comparison files (best effort)
Remove-Item $OldFile -Force -ErrorAction SilentlyContinue
Remove-Item $NewFile -Force -ErrorAction SilentlyContinue

if ($changed -ceq "SAME") {
  Write-Host "      business data unchanged (only timestamp differs) - cloud already up to date. done." -ForegroundColor Gray
  Write-Host ""
  Write-Host "  local: http://localhost:3001/" -ForegroundColor Cyan
  Write-Host "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
  exit 0
}

# write fresh data (raw bytes) and commit
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes2 = $wc.DownloadData($LocalAPI)
$wc.Dispose()
[System.IO.File]::WriteAllBytes($OutFile, $bytes2)
git add data/appdata.json
$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "sync: refresh cloud data appdata.json @ $ts" | Out-Null
git push origin $BRANCH 2>&1 | Out-Null
Write-Host "      data updated & pushed to GitHub" -ForegroundColor Green

# ---- 4. redeploy Vercel (optional) ----
if ($SkipVercel) {
  Write-Host "[4/5] vercel deploy skipped (-SkipVercel). Data is live via raw GitHub fallback." -ForegroundColor Gray
} else {
  Write-Host "[4/5] redeploying Vercel ..." -ForegroundColor Yellow
  vercel --prod --yes 2>&1 | Select-Object -Last 5
  Write-Host "      deploy complete" -ForegroundColor Green
}

# ---- 5. result ----
Write-Host "[5/5] finished" -ForegroundColor Green
Write-Host ""
Write-Host "  local: http://localhost:3001/" -ForegroundColor Cyan
Write-Host "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: cloud dashboard pulls data live from raw.githubusercontent" -ForegroundColor DarkGray
Write-Host "(data/appdata.json), so a git push is enough to refresh the cloud view." -ForegroundColor DarkGray

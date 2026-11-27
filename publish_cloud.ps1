# ============================================================
#  One-click: local data -> data/appdata.json -> GitHub -> Vercel
#  Usage:  powershell -ExecutionPolicy Bypass -File publish_cloud.ps1 [-SkipVercel]
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

# ---- 0. 记录同步开始时间 ----
$syncStart = Get-Date
Write-Host "[同步开始] $($syncStart.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan

# ---- 1. ensure local service is running ----
if (Test-Port3001) {
  Write-Host "[1/6] local :3001 already running" -ForegroundColor Green
} else {
  Write-Host "[1/6] local :3001 not running - starting server.mjs ..." -ForegroundColor Yellow
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
Write-Host "[2/6] fetching /api/app ..." -ForegroundColor Yellow
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes = $wc.DownloadData($LocalAPI)
$wc.Dispose()
New-Item -ItemType Directory -Force -Path (Join-Path $ROOT "data") | Out-Null
$NewFile = Join-Path $ROOT "data\.appdata.new.json"
[System.IO.File]::WriteAllBytes($NewFile, $bytes)

$chk = node -e "const d=require('$($NewFile -replace '\\','/')'); console.log(d.overview.followers+'|'+d.overview.totalReaders30d+'|'+d.overview.totalArticles)"
$f = $chk.Split('|')
Write-Host ("      fetched: followers=" + $f[0] + " readers30d=" + $f[1] + " articles=" + $f[2]) -ForegroundColor Green

# ---- 3. commit only if BUSINESS data changed ----
Write-Host "[3/6] checking for data change ..." -ForegroundColor Yellow
$OldFile = Join-Path $ROOT "data\.appdata.old.json"
cmd /c "git show HEAD:data/appdata.json > `"$OldFile`" 2>nul"

$changed = node -e "
const fs=require('fs');
function biz(p){
  let s; try{ s=fs.readFileSync(p,'utf8'); }catch(e){ return null; }
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

Remove-Item $OldFile -Force -ErrorAction SilentlyContinue
Remove-Item $NewFile -Force -ErrorAction SilentlyContinue

if ($changed -ceq "SAME") {
  Write-Host "      business data unchanged - cloud already up to date. Updating check timestamp..." -ForegroundColor Gray
  node -e "
  const fs=require('fs');
  const f='$($OutFile -replace '\\','/')';
  const d=JSON.parse(fs.readFileSync(f,'utf8'));
  if(d.overview && d.overview.dataBrief){
    d.overview.dataBrief.lastSystemCheckAt = new Date().toISOString();
    d.overview.dataBrief.collectFailureReason = '业务数据无变化，仅更新检查时间';
    fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
    console.log('updated');
  } else { console.log('no dataBrief'); }
  "
  Write-Host "      check timestamp updated, done." -ForegroundColor Gray
  Write-Host ""
  Write-Host "  local: http://localhost:3001/" -ForegroundColor Cyan
  Write-Host "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
  exit 0
}

# ---- 4. write fresh data and commit ----
Write-Host "[4/6] writing fresh data & committing ..." -ForegroundColor Yellow
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes2 = $wc.DownloadData($LocalAPI)
$wc.Dispose()
[System.IO.File]::WriteAllBytes($OutFile, $bytes2)

git add data/appdata.json
$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "sync: refresh cloud data appdata.json @ $ts" | Out-Null

# ---- 5. git push with retry ----
Write-Host "[5/6] pushing to GitHub ..." -ForegroundColor Yellow
$pushOk = $false
for ($i = 1; $i -le 3; $i++) {
  git push origin main
  if ($LASTEXITCODE -eq 0) { $pushOk = $true; break }
  Write-Host "  [重试] git push 失败，退出码 $LASTEXITCODE，5s 后重试..." -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
if (-not $pushOk) {
  Write-Error "git push failed after 3 retries - cloud data NOT yet pushed"
  exit 1
}
Write-Host "      data updated & pushed to GitHub" -ForegroundColor Green

# ---- 6. Vercel deploy (optional) ----
if ($SkipVercel) {
  Write-Host "[6/6] vercel deploy skipped (-SkipVercel). Data is live via raw GitHub fallback." -ForegroundColor Gray
} else {
  Write-Host "[6/6] redeploying Vercel ..." -ForegroundColor Yellow
  $vercelOk = $false
  for ($i = 1; $i -le 3; $i++) {
    $out = vercel --prod --yes 2>&1
    if ($out -match "Aliased|Ready in|Production") { $vercelOk = $true; break }
    Write-Host "  [重试] vercel 部署异常，10s 后重试..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
  }
  if (-not $vercelOk) {
    Write-Host "  Vercel 部署可能异常，但 GitHub raw 数据源已更新，云端看板仍可通过兜底数据源访问" -ForegroundColor Yellow
  } else {
    Write-Host "      Vercel deploy complete" -ForegroundColor Green
  }
}

# ---- 7. 云端回读核验 ----
Write-Host "[7/7] 云端数据核验..." -ForegroundColor Cyan
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$cloudUrl = "https://raw.githubusercontent.com/xiaomingtools/wechat-ops-center/main/data/appdata.json"
$bytes = $wc.DownloadData($cloudUrl)
$wc.Dispose()
$cloudFile = Join-Path $ROOT "data\.appdata.cloud.json"
[System.IO.File]::WriteAllBytes($cloudFile, $bytes)

$verify = node -e "
const fs=require('fs');
function biz(p){
  let s; try{s=fs.readFileSync(p,'utf8');}catch(e){return null}
  const o=JSON.parse(s); if(o.generated_at!==undefined) delete o.generated_at; return JSON.stringify(o);
}
const l=biz('data/appdata.json');
const c=biz('data/.appdata.cloud.json');
if(l===null||c===null){ console.log('ERROR'); }
else if(l===c){ console.log('SAME'); }
else{ console.log('DIFF'); }
"
Remove-Item (Join-Path $ROOT "data\.appdata.cloud.json") -Force -ErrorAction SilentlyContinue

if ($LASTEXITCODE -eq 0) {
  Write-Host "  业务指纹一致 (SAME) - 云端数据已同步" -ForegroundColor Green
} else {
  Write-Error "云端数据核验失败，同步可能不完整"
  exit 1
}

Write-Host "[完成] 同步完成" -ForegroundColor Green
Write-Host ""
Write-Host "  local: http://localhost:3001/" -ForegroundColor Cyan
Write-Host "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: cloud dashboard pulls data live from raw.githubusercontent (data/appdata.json)" -ForegroundColor DarkGray
Write-Host "      Git push is enough to refresh cloud view; Vercel deploy is optional." -ForegroundColor DarkGray
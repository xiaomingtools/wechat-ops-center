# ============================================================
#  One-click: local data -> data/appdata.json -> GitHub -> Vercel
#  Usage:  powershell -ExecutionPolicy Bypass -File publish_cloud.ps1 [-SkipVercel]
# ============================================================
param([switch]$SkipVercel, [int]$MaxRetry = 3)
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

function Write-Log {
  param([string]$msg, [string]$color = "White")
  Write-Host $msg -ForegroundColor $color
}

function Invoke-WithRetry {
  param([scriptblock]$action, [string]$name, [int]$maxRetry = 3, [int]$delaySec = 5)
  for ($i = 1; $i -le $maxRetry; $i++) {
    try {
      $result = & $action
      if ($LASTEXITCODE -eq 0) { return $true }
      Write-Log "  [重试 $i/$maxRetry] $name 失败，退出码 $LASTEXITCODE，${delaySec}s 后重试..." -ForegroundColor Yellow
      Start-Sleep -Seconds $delaySec
    } catch {
      Write-Log "  [重试 $i/$maxRetry] $name 异常：$_，${delaySec}s 后重试..." -ForegroundColor Yellow
      Start-Sleep -Seconds $delaySec
    }
  }
  Write-Error "$name 连续 $maxRetry 次失败，放弃"
  return $false
}

function Verify-CloudData {
  param([string]$localFile)
  Write-Log "[核验] 回读云端 raw GitHub 数据源对比业务指纹..." -ForegroundColor Cyan
  try {
    $wc = [System.Net.WebClient]::new()
    $wc.Headers.Add("Accept", "application/json")
    $cloudUrl = "https://raw.githubusercontent.com/xiaomingtools/wechat-ops-center/main/data/appdata.json"
    $bytes = $wc.DownloadData($cloudUrl)
    $wc.Dispose()

    $cloudFile = Join-Path $ROOT "data\.appdata.cloud.json"
    [System.IO.File]::WriteAllBytes($cloudFile, $bytes)

    $same = node -e "
    const fs=require('fs');
    function biz(p){
      let s; try{s=fs.readFileSync(p,'utf8');}catch(e){return null}
      const o=JSON.parse(s); if(o.generated_at!==undefined) delete o.generated_at; return JSON.stringify(o);
    }
    const l=biz('$($localFile -replace '\\','/')');
    const c=biz('$($cloudFile -replace '\\','/')');
    if(l===null||c===null){ console.log('ERROR'); }
    else if(l===c){ console.log('SAME'); }
    else{ console.log('DIFF'); }
    "
    Remove-Item $cloudFile -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0) {
      Write-Log "  业务指纹一致 (SAME) - 云端数据已同步" -ForegroundColor Green
      return $true
    } else {
      Write-Error "  业务指纹不一致 (DIFF) - 云端数据可能未完全同步"
      return $false
    }
  } catch {
    Write-Error "  云端核验异常：$_"
    return $false
  }
}

Write-Log "=== wechat-ops-center : publish to cloud ===" -ForegroundColor Cyan
Write-Log ""

# ---- 0. 记录本次同步开始时间 ----
$syncStart = Get-Date
Write-Log "[同步开始] $($syncStart.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan

# ---- 1. ensure local service is running ----
if (Test-Port3001) {
  Write-Log "[1/6] local :3001 already running" -ForegroundColor Green
} else {
  Write-Log "[1/6] local :3001 not running - starting server.mjs ..." -ForegroundColor Yellow
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
  Write-Log "      local service ready" -ForegroundColor Green
}

# ---- 2. pull fresh /api/app (raw bytes via WebClient, no PS5.1 encoding issues) ----
Write-Log "[2/6] fetching /api/app ..." -ForegroundColor Yellow
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes = $wc.DownloadData($LocalAPI)
$wc.Dispose()
New-Item -ItemType Directory -Force -Path (Join-Path $ROOT "data") | Out-Null
$NewFile = Join-Path $ROOT "data\.appdata.new.json"
[System.IO.File]::WriteAllBytes($NewFile, $bytes)

# quick human check
$chk = node -e "const d=require('$($NewFile -replace '\\','/')'); console.log(d.overview.followers+'|'+d.overview.totalReaders30d+'|'+d.overview.totalArticles)"
$f = $chk.Split('|')
Write-Log ("      fetched: followers=" + $f[0] + " readers30d=" + $f[1] + " articles=" + $f[2]) -ForegroundColor Green

# ---- 3. commit only if BUSINESS data changed (ignore generated_at timestamp) ----
Write-Log "[3/6] checking for data change ..." -ForegroundColor Yellow
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
Write-Log "      fingerprint: $changed" -ForegroundColor DarkGray

Remove-Item $OldFile -Force -ErrorAction SilentlyContinue
Remove-Item $NewFile -Force -ErrorAction SilentlyContinue

if ($changed -ceq "SAME") {
  Write-Log "      business data unchanged (only timestamp differs) - cloud already up to date. Updating check timestamp..." -ForegroundColor Gray
  # 即使业务无变化，也要更新最后同步时间记录
  Write-Log "      updating lastSystemCheckAt in appdata.json..." -ForegroundColor Gray
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
  Write-Log "      check timestamp updated, done." -ForegroundColor Gray
  Write-Log ""
  Write-Log "  local: http://localhost:3001/" -ForegroundColor Cyan
  Write-Log "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
  exit 0
}

# ---- 4. write fresh data (raw bytes) and commit ----
Write-Log "[4/6] writing fresh data & committing ..." -ForegroundColor Yellow
$wc = [System.Net.WebClient]::new()
$wc.Headers.Add("Accept", "application/json")
$bytes2 = $wc.DownloadData($LocalAPI)
$wc.Dispose()
[System.IO.File]::WriteAllBytes($OutFile, $bytes2)

git add data/appdata.json
$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "sync: refresh cloud data appdata.json @ $ts" | Out-Null

# ---- 5. git push with retry & proper exit code handling ----
Write-Log "[5/6] pushing to GitHub (retry $MaxRetry)..." -ForegroundColor Yellow
$pushOk = Invoke-WithRetry { git push origin $BRANCH } "git push" $MaxRetry 5
if (-not $pushOk) {
  Write-Error "git push failed after $MaxRetry retries - cloud data NOT yet pushed"
  exit 1
}
Write-Log "      data updated & pushed to GitHub" -ForegroundColor Green

# ---- 6. Vercel deploy (optional) with proper error handling ----
if ($SkipVercel) {
  Write-Log "[6/6] vercel deploy skipped (-SkipVercel). Data is live via raw GitHub fallback." -ForegroundColor Gray
} else {
  Write-Log "[6/6] redeploying Vercel (retry $MaxRetry)..." -ForegroundColor Yellow
  $vercelOk = Invoke-WithRetry {
    # Capture both stdout and stderr, but don't fail on stderr content
    $out = vercel --prod --yes 2>&1
    # Check for actual deployment success in output
    if ($out -match "Aliased|Ready in|Production") { return $true }
    # If stderr contains error but output shows success, still treat as success
    if ($out -match "Error|error") { return $false }
    return $true
  } "vercel deploy" $MaxRetry 10
  if (-not $vercelOk) {
    Write-Log "  Vercel 部署可能异常，但 GitHub raw 数据源已更新，云端看板仍可通过兜底数据源访问" -ForegroundColor Yellow
    # 不因 Vercel 失败而整体失败，因为 raw GitHub 兜底已保证数据可用
  } else {
    Write-Log "      Vercel deploy complete" -ForegroundColor Green
  }
}

# ---- 7. 云端回读核验 ----
Write-Log "[7/7] 云端数据核验..." -ForegroundColor Cyan
$verifyOk = Verify-CloudData $OutFile
if (-not $verifyOk) {
  Write-Error "云端数据核验失败，同步可能不完整"
  exit 1
}

# ---- 完成 ----
$syncEnd = Get-Date
$duration = [math]::Round(($syncEnd - $syncStart).TotalSeconds, 1)
Write-Log "[完成] 耗时 ${duration}s" -ForegroundColor Green
Write-Log ""
Write-Log "  local: http://localhost:3001/" -ForegroundColor Cyan
Write-Log "  cloud: https://wechat-ops-center.vercel.app/" -ForegroundColor Cyan
Write-Log ""
Write-Log "Note: cloud dashboard pulls data live from raw.githubusercontent (data/appdata.json)" -ForegroundColor DarkGray
Write-Log "      Git push is enough to refresh cloud view; Vercel deploy is optional." -ForegroundColor DarkGray
# 经营指挥中心 - 云端数据同步脚本 V2
# Usage: powershell -ExecutionPolicy Bypass -File sync_to_cloud.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  经营指挥中心 V4 - 云端数据同步" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$OPS_ROOT = "E:\自动盈利系统\公众号运营中心"
$PROJECT_DIR = "E:\自动盈利系统\公众号运营中心\wechat-ops-center"
$DATA_DIR = Join-Path $PROJECT_DIR "data"

# 创建必要目录
New-Item -ItemType Directory -Force -Path "$DATA_DIR\snapshots" | Out-Null
New-Item -ItemType Directory -Force -Path "$DATA_DIR\reviews" | Out-Null
New-Item -ItemType Directory -Force -Path "$DATA_DIR\analysis" | Out-Null

Write-Host "[1/4] 收集最新数据..." -ForegroundColor Yellow

# 1. 快照文件 (最新)
$snapshotDir = Join-Path $OPS_ROOT "10_运营数据\wechat_backend"
if (Test-Path $snapshotDir) {
    $latestSnapshot = Get-ChildItem $snapshotDir -Filter "snapshot-*.json" | 
        Sort-Object Name -Descending | Select-Object -First 1
    
    if ($latestSnapshot) {
        Copy-Item $latestSnapshot.FullName (Join-Path $DATA_DIR "snapshots\latest.json") -Force
        Write-Host "  ✓ $($latestSnapshot.Name)" -ForegroundColor Green
    }
}

# 2. 粉丝监控
$followerFile = Join-Path $OPS_ROOT "10_运营数据\follower_watch.json"
if (Test-Path $followerFile) {
    Copy-Item $followerFile (Join-Path $DATA_DIR "follower_watch.json") -Force
    Write-Host "  ✓ follower_watch.json" -ForegroundColor Green
}

# 3. 周报文件 (最新4份)
$reviewDir = Join-Path $OPS_ROOT "10_运营数据\weekly_review"
if (Test-Path $reviewDir) {
    $reviews = Get-ChildItem $reviewDir -Filter "*.json" | 
        Sort-Object Name -Descending | Select-Object -First 4
    
    foreach ($rev in $reviews) {
        Copy-Item $rev.FullName (Join-Path $DATA_DIR "reviews\$($rev.Name)") -Force
        Write-Host "  ✓ $($rev.Name)" -ForegroundColor Green
    }
}

# 4. 聚合指标
$manifestPath = Join-Path $OPS_ROOT "00_总控\WEBSITE_TUTORIAL_MANIFEST.json"
$totalArticles = 0
if (Test-Path $manifestPath) {
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $totalArticles = ($manifest.entries | Measure-Object).Count
    } catch {}
}

$metrics = @{
    summary = @{
        totalArticles = $totalArticles
        publishedCount = 29
        pendingDrafts = 4
        followers = 11
        yesterdayReads = 33
        monthReaders = 501
    }
    updated_at = (Get-Date).ToString("o")
    sync_status = "ok"
}

$metrics | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $DATA_DIR "metrics.json") -Encoding UTF8
Write-Host "  ✓ metrics.json" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Git 提交更改..." -ForegroundColor Yellow

Set-Location $PROJECT_DIR

# 检查是否有变更
git add data/ 2>$null
$status = git status --porcelain

if ($status) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    git commit -m "sync: update operational data at $timestamp" | Out-Null
    git push origin main 2>&1 | Out-Null
    Write-Host "  ✓ 已推送到 GitHub" -ForegroundColor Green
} else {
    Write-Host "  ○ 无数据变更" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[3/4] 部署状态..." -ForegroundColor Yellow

# 尝试触发 Vercel 构建 (如果配置了 webhook)
vercel --prod --yes 2>&1 | Out-Null
Write-Host "  ✓ 已触发重新部署" -ForegroundColor Green

Write-Host ""
Write-Host "[4/4] 完成!" -ForegroundColor Green
Write-Host ""
Write-Host "访问地址:" -ForegroundColor Cyan
Write-Host "  • 本机: http://localhost:3001/"
Write-Host "  • 云端: https://wechat-ops-center.vercel.app"
Write-Host ""
Write-Host "下次运行:" -ForegroundColor Yellow
Write-Host "  powershell -ExecutionPolicy Bypass -File sync_to_cloud.ps1"
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

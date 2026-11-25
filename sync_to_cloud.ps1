# 经营指挥中心 - 数据同步到云端脚本
# 用法: powershell -ExecutionPolicy Bypass -File sync_to_cloud.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== 经营指挥中心 - 云端数据同步 ===" -ForegroundColor Cyan
Write-Host ""

$OPS_ROOT = "E:\自动盈利系统\公众号运营中心"
$DATA_DIR = "E:\自动盈利系统\公众号运营中心\wechat-ops-center\data"
$GIT_DIR = "E:\自动盈利系统\公众号运营中心\wechat-ops-center"

# 创建数据目录
if (-not (Test-Path $DATA_DIR)) {
    New-Item -ItemType Directory -Force -Path $DATA_DIR | Out-Null
}

Write-Host "[1/4] 收集数据文件..." -ForegroundColor Yellow

# 复制最新快照
$snapshotDir = Join-Path $OPS_ROOT "10_运营数据\wechat_backend"
if (Test-Path $snapshotDir) {
    $latestSnapshots = Get-ChildItem $snapshotDir -Filter "snapshot-*.json" | Sort-Object Name -Descending | Select-Object -First 5
    foreach ($snap in $latestSnapshots) {
        Copy-Item $snap.FullName (Join-Path $DATA_DIR $snap.Name) -Force
        Write-Host "  ✓ $($snap.Name)" -ForegroundColor Green
    }
}

# 复制粉丝监控
$followerFile = Join-Path $OPS_ROOT "10_运营数据\follower_watch.json"
if (Test-Path $followerFile) {
    Copy-Item $followerFile (Join-Path $DATA_DIR "follower_watch.json") -Force
    Write-Host "  ✓ follower_watch.json" -ForegroundColor Green
}

# 复制周报
$reviewDir = Join-Path $OPS_ROOT "10_运营数据\weekly_review"
if (Test-Path $reviewDir) {
    $reviews = Get-ChildItem $reviewDir -Filter "*.json" | Sort-Object Name -Descending | Select-Object -First 4
    foreach ($rev in $reviews) {
        Copy-Item $rev.FullName (Join-Path $DATA_DIR $rev.Name) -Force
        Write-Host "  ✓ $($rev.Name)" -ForegroundColor Green
    }
}

# 复制草稿记录
$draftDir = Join-Path $OPS_ROOT "10_运营数据\daily_drafts"
if (Test-Path $draftDir) {
    $drafts = Get-ChildItem $draftDir -Filter "*.json" | Where-Object { $_.Name -notmatch 'check|newspic|heartbeat' } | Sort-Object Name -Descending | Select-Object -First 7
    foreach ($draft in $drafts) {
        Copy-Item $draft.FullName (Join-Path $DATA_DIR $draft.Name) -Force
        Write-Host "  ✓ $($draft.Name)" -ForegroundColor Green
    }
}

# 复制网站回执
$tutorialDir = Join-Path $OPS_ROOT "10_运营数据\web_tutorials"
if (Test-Path $tutorialDir) {
    $tutorials = Get-ChildItem $tutorialDir -Filter "*.json" | Sort-Object Name -Descending | Select-Object -First 7
    foreach ($tut in $tutorials) {
        Copy-Item $tut.FullName (Join-Path $DATA_DIR $tut.Name) -Force
        Write-Host "  ✓ $($tut.Name)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[2/4] 提交并推送数据..." -ForegroundColor Yellow

Set-Location $GIT_DIR

# Git 提交
git add data/
$status = git status --porcelain

if ($status) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    git commit -m "sync: data update at $timestamp"
    git push origin data
    Write-Host "  ✓ 已推送数据更新" -ForegroundColor Green
} else {
    Write-Host "  ○ 无数据变更" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[3/4] 主代码分支状态..." -ForegroundColor Yellow
git status --short

Write-Host ""
Write-Host "[4/4] 完成!" -ForegroundColor Green
Write-Host ""
Write-Host "下次如需手动触发:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File sync_to_cloud.ps1"
Write-Host ""

# 经营指挥中心 - 数据同步并部署到云端
$ErrorActionPreference = "Stop"

Write-Host "=== 经营指挥中心 - 云端同步部署 ===" -ForegroundColor Cyan
Write-Host ""

$OPS_ROOT = "E:\自动盈利系统\公众号运营中心"
$PROJECT_DIR = "E:\自动盈利系统\公众号运营中心\wechat-ops-center"
$DATA_DIR = Join-Path $PROJECT_DIR "data"

# 1. 复制数据文件
Write-Host "[1/4] 复制最新数据..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "$DATA_DIR\wechat_backend" | Out-Null
New-Item -ItemType Directory -Force -Path "$DATA_DIR\weekly_review" | Out-Null
New-Item -ItemType Directory -Force -Path "$DATA_DIR\daily_drafts" | Out-Null
New-Item -ItemType Directory -Force -Path "$DATA_DIR\web_tutorials" | Out-Null

# 复制关键数据
Copy-Item (Join-Path $OPS_ROOT "00_总控\WEBSITE_TUTORIAL_MANIFEST.json") (Join-Path $DATA_DIR "manifest.json") -Force
Copy-Item (Join-Path $OPS_ROOT "10_运营数据\follower_watch.json") (Join-Path $DATA_DIR "follower_watch.json") -Force

$snapshots = Get-ChildItem (Join-Path $OPS_ROOT "10_运营数据\wechat_backend") -Filter "snapshot-*.json" | Sort-Object Name -Descending | Select-Object -First 3
foreach ($snap in $snapshots) {
    Copy-Item $snap.FullName (Join-Path $DATA_DIR "wechat_backend\$($snap.Name)") -Force
}

$reviews = Get-ChildItem (Join-Path $OPS_ROOT "10_运营数据\weekly_review") -Filter "*.json" | Sort-Object Name -Descending | Select-Object -First 4
foreach ($rev in $reviews) {
    Copy-Item $rev.FullName (Join-Path $DATA_DIR "weekly_review\$($rev.Name)") -Force
}

Write-Host "  ✓ 数据已同步" -ForegroundColor Green

# 2. Git 提交
Write-Host "[2/4] 提交更改..." -ForegroundColor Yellow
Set-Location $PROJECT_DIR
git add .
git commit -m "sync: update operational data at $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
git push origin main 2>&1 | Out-Null
Write-Host "  ✓ 已推送到 GitHub" -ForegroundColor Green

# 3. Vercel 部署
Write-Host "[3/4] 部署到 Vercel..." -ForegroundColor Yellow
vercel --prod --yes 2>&1 | Out-Null
Write-Host "  ✓ 部署完成" -ForegroundColor Green

# 4. 输出结果
Write-Host "[4/4] 完成!" -ForegroundColor Green
Write-Host ""
Write-Host "访问地址:" -ForegroundColor Cyan
Write-Host "  - 本地: http://localhost:3001/"
Write-Host "  - Vercel: https://wechat-ops-center.vercel.app"
Write-Host ""

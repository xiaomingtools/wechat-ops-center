@echo off
chcp 65001 >nul
echo ========================================
echo   经营指挥中心 V3 - wechat-ops-center
echo ========================================
echo.
echo 本机访问: http://localhost:3001/
echo Ctrl+C 停止服务
echo.
cd /d E:\自动盈利系统\公众号运营中心\wechat-ops-center
node src\server.mjs
pause

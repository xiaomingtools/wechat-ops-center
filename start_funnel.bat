@echo off
chcp 65001 >nul
echo 前置条件: Tailscale 已登录 (tailscale status)
echo.
echo 启动服务器...
start "OpsCenterServer" cmd /c cd /d E:\自动盈利系统\公众号运营中心\wechat-ops-center && node src\server.mjs
timeout /t 3 /nobreak >nul
echo.
echo 启动 Tailscale Funnel (公网访问)...
npx tailscale funnel 3001

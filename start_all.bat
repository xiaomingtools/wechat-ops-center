@echo off
chcp 65001 >nul
echo ========================================
echo   经营指挥中心 V3 - 完整启动
echo ========================================
echo.
echo [1/2] 启动本地服务...
start "OpsServer" cmd /c "cd /d E:\自动盈利系统\公众号运营中心\wechat-ops-center && node src\server.mjs"
timeout /t 3 /nobreak >nul

echo [2/2] 启动公网隧道...
start "LocalTunnel" cmd /c "cd /d E:\自动盈利系统\公众号运营中心\wechat-ops-center && npx localtunnel --port 3001 --subdomain ops-center-wx"

echo.
echo 等待隧道建立...
timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo   ✅ 已就绪！
echo ========================================
echo.
echo 📍 本机访问: http://localhost:3001/
echo 🔗 远程访问: https://ops-center-wx.loca.lt
echo.
echo 关闭此窗口将停止所有服务
echo ========================================
pause

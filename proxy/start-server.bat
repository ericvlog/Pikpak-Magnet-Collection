@echo off
title PikPak 本地服务器
echo 正在启动 PikPak 服务器...
echo.
:: 启动本地服务器（后台运行，不阻塞）
start "PikPak Server" /B node "%~dp0server.js" > nul 2>&1
timeout /t 2 /nobreak > nul
start "" http://localhost:3000

:: 检查 ngrok 是否可用
where ngrok > nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo 检测到 ngrok，是否启动 HTTPS 隧道？[Y/N]
    echo （用于 GitHub Pages 等 HTTPS 页面调用本地代理）
    choice /c YN /n /m ""
    if errorlevel 2 goto :skip_ngrok
    echo 启动 ngrok...
    start "ngrok" ngrok http 3000 --log=stdout > nul 2>&1
    timeout /t 3 /nobreak > nul
    echo.
    echo ==========================================
    echo ngrok 启动完成！
    echo 请访问 http://127.0.0.1:4040 查看 ngrok 的 HTTPS 地址
    echo 在 GitHub Pages 的 PikPak 弹窗中填入：
    echo   https://你的ngrok地址.ngrok.io/?url=
    echo ==========================================
    echo.
    echo ⚠️ 免费版 ngrok 每次启动地址都不同，需要重新填入
    goto :end_msg
)
:skip_ngrok
echo.
echo 提示: 下载 https://ngrok.com/download 放到本目录，
echo       下次启动时可选择开启 HTTPS 隧道。
:end_msg
echo ==========================================
echo   本机:   http://localhost:3000
echo   手机:   http://10.151.76.88:3000（同一 WiFi）
echo ==========================================
echo 按任意键退出服务器...
pause > nul
taskkill /f /im node.exe > nul 2>&1
taskkill /f /im ngrok.exe > nul 2>&1

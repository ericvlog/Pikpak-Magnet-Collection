@echo off
setlocal enabledelayedexpansion

set "PROXY_DIR=%~dp0"
set "PROXY_DIR=%PROXY_DIR:\=/%"
if "%PROXY_DIR:~-1%"=="/" set "PROXY_DIR=%PROXY_DIR:~0,-1%"
set "PROXY_DIR=%PROXY_DIR:/=\%"

set "SERVER_JS=%PROXY_DIR%\server.js"
set "TUNNEL_EXE=%PROXY_DIR%\cloudflared.exe"

if not exist "%SERVER_JS%" (
    echo [ERROR] server.js not found.
    pause
    exit /b 1
)

if not exist "%TUNNEL_EXE%" (
    echo [..] Downloading cloudflared...
    curl.exe -L -o "%TUNNEL_EXE%" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    if errorlevel 1 (
        echo [FAIL] Download failed. Please manually download cloudflared to proxy\.
        echo        https://github.com/cloudflare/cloudflared/releases
        pause
        exit /b 1
    )
    echo [OK] cloudflared downloaded.
)

echo.
echo Start HTTPS tunnel (Cloudflare Tunnel)?
echo   Y - Yes (forwards to http://localhost:3000)
echo   N - No, skip tunnel
choice /c YN /n /m "Your choice (Y/N, default N): "
if errorlevel 2 goto :start_server

echo.
echo Starting cloudflared tunnel (minimized window)...
set "CF_LOG=%TEMP%\cf_tunnel_%RANDOM%.txt"
start /MIN "" "%TUNNEL_EXE%" tunnel --url http://localhost:3000 --logfile "%CF_LOG%"
echo Waiting for tunnel to connect (15s)...
ping -n 16 127.0.0.1 >nul

echo.
echo ========================================
findstr "trycloudflare.com" "%CF_LOG%" 2>nul
echo ========================================
echo.
echo Copy the URL above, then server starts automatically...
timeout /t 3 /nobreak >nul

:start_server
echo.
echo Starting local server...
echo   http://localhost:3000
echo   Press Ctrl+C to stop
echo.
node "%SERVER_JS%"
if errorlevel 1 (
    echo [FAIL] Node.js failed to start.
    pause
)
goto :eof

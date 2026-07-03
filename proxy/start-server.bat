@echo off
title PikPak 本地服务器
echo 正在启动 PikPak 服务器...
echo 启动后按提示用手机扫码或输入地址即可访问
echo.
start "" http://localhost:3000
node "%~dp0pikpak-proxy-server.js"
pause

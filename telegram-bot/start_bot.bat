@echo off
cd /d "C:\Users\plsharevme\Desktop\magnettools - Copy\telegram-bot"

echo [1/3] Check port 19876...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":19876 "') do (
    taskkill /F /PID %%p >nul 2>&1 && echo     Killed PID %%p
)

echo [2/3] Wait port release...
timeout /t 2 /nobreak >nul

echo [3/3] Start Bot...
start "Telegram Bot" node index.js

echo Bot started at http://localhost:19876
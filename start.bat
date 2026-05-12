@echo off
setlocal enabledelayedexpansion
title Flowboard AI Server
cd /d "%~dp0"

echo.
echo   Flowboard AI
echo   ───────────────────────────────────
echo.

:: Find available port starting from 3000
set PORT=3000
:findport
netstat -ano 2>nul | findstr ":!PORT! " | findstr "LISTENING" >nul 2>&1
if !errorlevel!==0 (
    echo   [!] Port !PORT! in use, trying next...
    set /a PORT+=1
    goto findport
)

echo   Starting on http://localhost:!PORT!
echo   Close this window to stop the server.
echo.
echo   ───────────────────────────────────
echo.

set PORT=!PORT!
start "" http://localhost:!PORT!
node server.js

echo.
echo   Server stopped.
pause

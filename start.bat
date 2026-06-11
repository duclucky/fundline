@echo off
setlocal
title Fundline USDC Local Server
cd /d "%~dp0"
set PORT=5190

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5190/api/config' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Fundline is already running.
  echo.
  echo Opening:
  echo http://127.0.0.1:5190
  start "" "http://127.0.0.1:5190"
  echo.
  pause
  exit /b 0
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5190/' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Port 5190 is already used by an older Fundline server.
  echo Starting the updated server on port 5191 instead.
  echo.
  set PORT=5191
)

where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\nvm4w\nodejs\node.exe" (
    set "NODE_EXE=C:\nvm4w\nodejs\node.exe"
  ) else (
    echo Node.js was not found. Please install Node.js or add it to PATH.
    echo.
    pause
    exit /b 1
  )
) else (
  set "NODE_EXE=node"
)

echo Starting Fundline USDC...
echo.
echo Open this URL in your browser:
echo http://127.0.0.1:%PORT%
echo.
echo Press Ctrl+C to stop the server.
echo.
powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:%PORT%'" >nul 2>nul
"%NODE_EXE%" server.js

echo.
echo Server stopped or failed.
pause

@echo off
setlocal
cd /d "%~dp0"
title Stratios

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed on this computer yet.
  echo A download page is opening. Install the "LTS" version with the default options,
  echo then double-click this file again.
  start "" https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo Installing what Stratios needs. This takes a few minutes the first time...
  call npm install > install-log.txt 2>&1
  if errorlevel 1 (
    echo.
    echo The install did not finish. Tell Claude "the install failed" and it can read install-log.txt.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Starting Stratios. Your browser will open http://localhost:3000 in a few seconds.
echo Leave this window open while you use the site. Close it to stop the site.
echo.
start "" cmd /c "timeout /t 10 >nul & start http://localhost:3000"
call npm run dev
echo.
pause

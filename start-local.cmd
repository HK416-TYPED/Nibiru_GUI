@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
node scripts/start-local.mjs
pause

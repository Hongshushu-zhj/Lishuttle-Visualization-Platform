@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20.19+ is required.
  pause
  exit /b 1
)
node "%~dp0scripts\web-launcher.cjs" stop
if errorlevel 1 (
  echo [ERROR] Stop failed. No process was forcefully terminated.
  pause
  exit /b 1
)

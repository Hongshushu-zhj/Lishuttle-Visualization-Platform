@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20.19+ is required. Please install Node.js first.
  pause
  exit /b 1
)
node "%~dp0scripts\web-launcher.cjs" start
if errorlevel 1 (
  echo [ERROR] Startup failed. No unknown process was stopped.
  pause
  exit /b 1
)
echo Closing this window or browser does not stop the service.
echo Run the stop launcher to stop the local service.

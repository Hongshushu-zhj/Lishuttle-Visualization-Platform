@echo off
setlocal
set "PLATFORM_DIR=%~dp0"
set "BACKEND_DIR=%PLATFORM_DIR%backend"
set "FRONTEND_DIR=%PLATFORM_DIR%frontend"
set "FRONTEND_DIST=%FRONTEND_DIR%\dist"
set "PORT=8000"
set "URL=http://127.0.0.1:%PORT%"

echo ================================================
echo   Antenna Coverage Plot Platform
echo   (Chinese docs: see README.md in this folder)
echo ================================================
echo.

where node > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\node_modules" (
    echo [1/3] Installing backend dependencies ^(first run^)...
    pushd "%BACKEND_DIR%"
    call npm install --no-audit --no-fund
    popd
) else (
    echo [1/3] Backend dependencies OK
)

if not exist "%FRONTEND_DIST%\index.html" (
    echo [2/3] Building frontend ^(first run^)...
    if not exist "%FRONTEND_DIR%\node_modules" (
        pushd "%FRONTEND_DIR%"
        call npm install --no-audit --no-fund
        popd
    )
    pushd "%FRONTEND_DIR%"
    call npm run build
    popd
) else (
    echo [2/3] Frontend build OK
)

rem Stop an old instance if the port is already in use
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo [INFO] Port %PORT% is in use by PID %%a, stopping it...
    taskkill /F /PID %%a > nul 2>&1
)
%SystemRoot%\System32\timeout.exe /t 1 /nobreak > nul

echo [3/3] Starting service...
start "" /min cmd /c "cd /d "%BACKEND_DIR%" && node server.js"

set /a tries=0
:waitloop
%SystemRoot%\System32\timeout.exe /t 1 /nobreak > nul
set /a tries+=1
node -e "require('http').get('%URL%/api/health',function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})" > nul 2>&1
if not errorlevel 1 goto ready
if %tries% lss 20 goto waitloop

echo.
echo [ERROR] Service did not start in time. Check backend\data\backend.log
pause
exit /b 1

:ready
echo.
echo ================================================
echo   Ready.  Opening browser...
echo   URL: %URL%
echo.
echo   Closing this window does NOT stop the service.
echo   To stop it, run:  stop.bat
echo ================================================
start "" %URL%
echo.
echo Press any key to close this window...
pause > nul

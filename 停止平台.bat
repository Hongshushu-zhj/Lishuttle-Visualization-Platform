@echo off
setlocal
set "PORT=8000"

echo Stopping Antenna Coverage Plot Platform ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo Stopping process PID %%a ...
    taskkill /F /PID %%a > nul 2>&1
)
echo Service stopped.
%SystemRoot%\System32\timeout.exe /t 2 /nobreak > nul

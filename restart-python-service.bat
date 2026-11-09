@echo off
echo ========================================
echo  Kill Port 8765 and Start Service
echo ========================================
echo.

REM Find and kill process on port 8765
echo [1/3] Checking port 8765...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8765') do (
    echo Found PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

REM Wait for port to be released
echo [2/3] Waiting for port release (3 seconds)...
timeout /t 3 /nobreak >nul

REM Start service
echo [3/3] Starting Python service...
echo.
cd /d %~dp0
cd workers\python
python api_service.py

pause

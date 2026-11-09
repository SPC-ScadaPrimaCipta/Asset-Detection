@echo off
setlocal enabledelayedexpansion

echo ================================================================
echo   TagFlow - Hybrid P^&ID Detection System
echo   Auto-Start All Services
echo ================================================================
echo.

REM Kill any existing Python services
echo [Step 1/5] Cleaning up existing Python processes...
taskkill /F /IM python.exe >nul 2>&1
if !errorlevel! == 0 (
    echo   ^> Killed existing Python processes
    timeout /t 2 /nobreak >nul
) else (
    echo   ^> No Python processes to kill
)

REM Check if port 8765 is free
echo [Step 2/5] Checking port 8765...
netstat -ano | findstr :8765 >nul
if !errorlevel! == 0 (
    echo   ^> Port 8765 still occupied, waiting...
    timeout /t 3 /nobreak >nul
) else (
    echo   ^> Port 8765 is free
)

REM Start Python FastAPI Service
echo [Step 3/5] Starting Python FastAPI Service (port 8765)...
cd /d "%~dp0workers\python"
start "TagFlow Python Service" cmd /k "python api_service.py"
cd /d "%~dp0"
echo   ^> Python service starting in new window...
timeout /t 3 /nobreak >nul

REM Start Next.js Dev Server
echo [Step 4/5] Starting Next.js Dev Server (port 3000)...
start "TagFlow Next.js Dev" cmd /k "npm run dev"
echo   ^> Next.js starting in new window...
timeout /t 5 /nobreak >nul

REM Start BullMQ Worker
echo [Step 5/5] Starting BullMQ Worker...
start "TagFlow BullMQ Worker" cmd /k "npm run worker"
echo   ^> BullMQ worker starting in new window...

echo.
echo ================================================================
echo   All Services Started!
echo ================================================================
echo.
echo   Python Service:    http://127.0.0.1:8765
echo   Next.js App:       http://localhost:3000
echo   BullMQ Worker:     Background processing
echo.
echo   Check the 3 terminal windows for logs.
echo.
echo   Press Ctrl+C in each window to stop services.
echo ================================================================
echo.

pause

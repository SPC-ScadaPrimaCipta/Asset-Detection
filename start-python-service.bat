@echo off
echo ====================================
echo  TagFlow Python Detection Service
echo ====================================
echo.
echo Starting FastAPI service on http://127.0.0.1:8765
echo.
echo Press Ctrl+C to stop the service
echo.

cd /d %~dp0
cd workers\python

python api_service.py

pause

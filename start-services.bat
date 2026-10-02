@echo off
echo Starting Asset Detection services...

:: Start Redis
echo [1/2] Starting Redis...
start "Redis" /MIN "D:\redis-portable\redis-server.exe"
timeout /t 2 /nobreak >nul

:: Verify Redis
node -e "require('dotenv').config({path:'.env.local'});const r=require('ioredis');const c=new r(process.env.REDIS_URL);c.ping().then(()=>{console.log('[OK] Redis running');c.disconnect()}).catch(e=>{console.error('[FAIL] Redis:',e.message);process.exit(1)})"
if %errorlevel% neq 0 (
    echo Redis failed to start. Check D:\redis-portable\redis-server.exe
    pause
    exit /b 1
)

:: Start worker
echo [2/2] Starting detection worker...
start "Detection Worker" /MIN cmd /c "node --require ts-node/register --require tsconfig-paths/register workers/detection-worker.ts 2>&1 | tee worker.log"

echo.
echo Services started. Run "npm run dev" to start the app.
echo Redis:  127.0.0.1:6379
echo Worker: background process
echo.

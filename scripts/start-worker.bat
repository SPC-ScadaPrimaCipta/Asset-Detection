@echo off
REM Start detection worker (BullMQ consumer) on Windows
REM Run this in a separate terminal alongside `npm run dev`

echo Starting detection worker...
echo Make sure PostgreSQL and Redis are running.
echo.
echo Worker will process detection jobs from queue.
echo Press Ctrl+C to stop.
echo.

REM Load .env.local if exists
if exist .env.local (
  for /f "tokens=*" %%i in ('type .env.local ^| findstr /v "^#"') do (
    set "%%i"
  )
)

REM Run worker
npx tsx workers/detection-worker.ts

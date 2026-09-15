@echo off
REM Asset Detection - Windows dev setup check

echo.
echo ===================================================
echo   Asset Detection - Environment Check
echo ===================================================
echo.

REM Check .env.local
if not exist .env.local (
  echo [ERROR] .env.local not found
  echo.
  echo Create it:
  echo   copy .env.example .env.local
  echo.
  echo Then edit with your credentials:
  echo   - DATABASE_URL (PostgreSQL)
  echo   - REDIS_URL (Redis)
  echo   - GEMINI_API_KEY (Gemini API)
  echo.
  exit /b 1
)

echo [OK] .env.local found

REM Check Node
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VER=%%i
if "%NODE_VER%"=="" (
  echo [ERROR] Node.js not found
  exit /b 1
)
echo [OK] Node.js %NODE_VER%

REM Check npm
for /f "tokens=*" %%i in ('npm --version 2^>nul') do set NPM_VER=%%i
if "%NPM_VER%"=="" (
  echo [ERROR] npm not found
  exit /b 1
)
echo [OK] npm %NPM_VER%

REM Check node_modules
if not exist node_modules (
  echo.
  echo [WARN] node_modules not found
  echo Running: npm install
  call npm install
)
echo [OK] Dependencies installed

echo.
echo ===================================================
echo   STARTUP INSTRUCTIONS (Windows)
echo ===================================================
echo.
echo 1. Make sure PostgreSQL and Redis are running
echo.
echo 2. Terminal 1 - Start Next.js dev server:
echo    npm run dev
echo    (opens http://localhost:3000)
echo.
echo 3. Terminal 2 - Start detection worker:
echo    bash scripts/start-worker.sh
echo    OR
echo    scripts\start-worker.bat
echo.
echo 4. Test flow:
echo    - Create project
echo    - Upload legend PDF (Gemini auto-extracts symbols)
echo    - Review symbols in /legends/[id]/review
echo    - Upload P&ID document
echo    - Run detection (worker processes job)
echo    - Review detections
echo    - Export to Excel
echo.
echo ===================================================
echo.

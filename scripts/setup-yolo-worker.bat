@echo off
REM Setup Python YOLO worker environment

echo Creating Python virtual environment...
python -m venv workers\yolo\venv

echo Activating environment...
call workers\yolo\venv\Scripts\activate.bat

echo Installing dependencies...
pip install --upgrade pip
pip install -r workers\yolo\requirements.txt

echo.
echo ✅ Setup complete!
echo.
echo To activate environment:
echo   call workers\yolo\venv\Scripts\activate.bat
echo.
echo To test YOLO worker:
echo   python workers\yolo\yolo_worker.py path\to\image.png
echo.

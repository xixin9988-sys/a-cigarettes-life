@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-game.ps1"
if errorlevel 1 (
  echo.
  echo Launch failed. Please read the messages above.
  pause
) else (
  timeout /t 2 >nul
)

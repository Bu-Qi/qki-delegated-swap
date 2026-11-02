@echo off
if not exist "%~dp0scanner\start-windows.cmd" (
  echo ERROR: Extract the entire ZIP before starting the scanner.
  pause
  exit /b 1
)
call "%~dp0scanner\start-windows.cmd"

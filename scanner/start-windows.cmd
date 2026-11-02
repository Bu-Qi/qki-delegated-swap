@echo off
if /i "%~1"=="--qki-console" goto qki_run
"%ComSpec%" /d /v:off /s /k ""%~f0" --qki-console"
exit /b
:qki_run
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 goto qki_no_node
node.exe "%~dp0launch.cjs"
if errorlevel 1 echo Startup failed. See the message and startup.log above.
goto :eof
:qki_no_node
echo ERROR: Node.js was not found. Install Node.js 20 or newer.
echo https://nodejs.org/
echo Close and reopen this launcher after installation.

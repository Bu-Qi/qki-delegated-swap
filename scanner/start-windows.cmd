@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或更新版本，然后重新打开本程序。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)
node -e "if (parseInt(process.versions.node,10) < 20) process.exit(1)"
if errorlevel 1 (
  echo 请升级到 Node.js 20 或更新版本后重试。
  pause
  exit /b 1
)
if not exist node_modules\ethers\package.json (
  echo 首次启动正在安装运行依赖，请等待……
  call npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查 npm 网络连接后重试。
    pause
    exit /b 1
  )
)
node server.mjs
pause

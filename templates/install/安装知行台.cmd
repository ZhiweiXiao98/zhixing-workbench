@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 22 或更高版本，再重新双击本文件。
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Node.js 版本过低。请升级到 22 或更高版本。
  pause
  exit /b 1
)
set "INTERACTIVE=1"
if not "%~1"=="" (
  set "VAULT=%~1"
  set "INTERACTIVE=0"
) else (
  set /p VAULT=请粘贴 Obsidian Vault 文件夹路径:
)
node "%~dp0scripts\zhixing.mjs" install --vault "%VAULT%"
set "INSTALL_EXIT=%ERRORLEVEL%"
if "%INTERACTIVE%"=="1" pause
exit /b %INSTALL_EXIT%

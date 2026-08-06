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
set /p VAULT=请粘贴 Obsidian Vault 文件夹路径:
node "%~dp0..\..\scripts\zhixing.mjs" install --vault "%VAULT%"
pause

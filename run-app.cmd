@echo off
setlocal

set "APP_DIR=%~dp0"
set "NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "NODE_EXE=%NODE_DIR%\node.exe"

if not exist "%NODE_EXE%" (
  set "NODE_EXE=node"
  set "NODE_DIR="
)

cd /d "%APP_DIR%"
set "PATH=%APP_DIR%node_modules\.bin;%NODE_DIR%;%PATH%"
"%NODE_EXE%" node_modules\electron\cli.js .

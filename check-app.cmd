@echo off
setlocal

set "APP_DIR=%~dp0"
set "NODE_EXE=C:\Users\owner\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" set "NODE_EXE=node"

cd /d "%APP_DIR%"
"%NODE_EXE%" scripts\check.js


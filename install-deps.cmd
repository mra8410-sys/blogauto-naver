@echo off
setlocal

set "APP_DIR=%~dp0"
set "RUNTIME_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
set "NODE_DIR=%RUNTIME_DIR%\node\bin"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "PNPM_CLI=%RUNTIME_DIR%\node\node_modules\pnpm\bin\pnpm.cjs"

if not exist "%NODE_EXE%" set "NODE_EXE=node"

cd /d "%APP_DIR%"
set "PATH=%APP_DIR%node_modules\.bin;%NODE_DIR%;%PATH%"
"%NODE_EXE%" "%PNPM_CLI%" install --no-lockfile
"%NODE_EXE%" "%PNPM_CLI%" approve-builds --all
"%NODE_EXE%" "%PNPM_CLI%" rebuild electron

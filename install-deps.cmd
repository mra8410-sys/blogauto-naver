@echo off
setlocal

set "APP_DIR=%~dp0"
set "NODE_EXE=C:\Users\owner\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "PNPM_CLI=C:\Users\owner\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs"

if not exist "%NODE_EXE%" set "NODE_EXE=node"

cd /d "%APP_DIR%"
"%NODE_EXE%" "%PNPM_CLI%" install --no-lockfile
"%NODE_EXE%" "%PNPM_CLI%" approve-builds --all
"%NODE_EXE%" "%PNPM_CLI%" rebuild electron


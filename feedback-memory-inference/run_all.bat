@echo off
REM FME — Start all inference services
REM This file is called by Windows Task Scheduler on login

cd /d "%~dp0"

REM Check if bash is available (Git Bash or WSL)
where bash >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: bash not found. Install Git for Windows from https://git-scm.com
    exit /b 1
)

if not exist logs mkdir logs

REM Start all services in background
start /b bash run_all.sh >> logs\windows-autostart.log 2>&1
echo FME services started. Check logs\windows-autostart.log for details.

@echo off
REM FME — Stop all inference services on Windows

echo Stopping FME services on Windows...

for %%p in (8000 8001 8002 8003) do (
    for /f "tokens=5" %%a in (
        'netstat -aon ^| findstr ":%%p " ^| findstr "LISTENING"'
    ) do (
        taskkill /PID %%a /F >nul 2>&1
        echo   :%%p stopped
    )
)
echo Done.

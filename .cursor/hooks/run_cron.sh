#!/bin/bash
# Resolve the FME repo directory from this script's location
FME_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

node "$FME_DIR/dist/hook/services/batch/CronService.js" >> "$FME_DIR/.cursor/hooks/feedback-memory-hook.log" 2>&1 &
echo "Cron started PID: $!"

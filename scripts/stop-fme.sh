#!/bin/bash
# FME Stop — kills all running FME processes cleanly

echo "Stopping FME services..."

# Stop via launchctl if registered
launchctl unload "$HOME/Library/LaunchAgents/com.fme.cron.plist" 2>/dev/null
launchctl unload "$HOME/Library/LaunchAgents/com.fme.inference.plist" 2>/dev/null
launchctl unload "$HOME/Library/LaunchAgents/com.fme.ollama.plist" 2>/dev/null

# Kill processes directly as fallback
pkill -f "intent/main.py" 2>/dev/null
pkill -f "metadata/main.py" 2>/dev/null
pkill -f "embedding/main.py" 2>/dev/null
pkill -f "chroma" 2>/dev/null
pkill -f "CronService" 2>/dev/null
pkill -f "ollama serve" 2>/dev/null

sleep 2
echo "✅ All FME services stopped"

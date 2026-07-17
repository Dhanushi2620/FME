#!/bin/bash
# FME Status — check what is running with RAM usage

echo "=== FME SERVICE STATUS ==="
echo ""

check_service() {
  local name="$1"
  local pattern="$2"
  if pgrep -f "$pattern" > /dev/null 2>&1; then
    ram=$(ps aux | grep "$pattern" | grep -v grep | awk '{sum+=$6} END {printf "%.0f MB", sum/1024}')
    echo "  ✅ $name — $ram"
  else
    echo "  ❌ $name — not running"
  fi
}

check_service "Ollama model (qwen2.5:3b)" "ollama_llama_server"
check_service "Ollama server         " "ollama serve"
check_service "BART :8001            " "intent"
check_service "Metadata :8002        " "metadata"
check_service "MiniLM :8003          " "embedding"
check_service "ChromaDB :8000        " "chroma"
check_service "CronService           " "CronService"

echo ""
echo "=== HEALTH CHECKS ==="
echo ""
curl -s http://127.0.0.1:8001/health > /dev/null 2>&1 && echo "  BART     :8001  ✅" || echo "  BART     :8001  ❌"
curl -s http://127.0.0.1:8002/health > /dev/null 2>&1 && echo "  Metadata :8002  ✅" || echo "  Metadata :8002  ❌"
curl -s http://127.0.0.1:8003/health > /dev/null 2>&1 && echo "  MiniLM   :8003  ✅" || echo "  MiniLM   :8003  ❌"
curl -s http://127.0.0.1:8000/api/v2/heartbeat > /dev/null 2>&1 && echo "  ChromaDB :8000  ✅" || echo "  ChromaDB :8000  ❌"
curl -s http://localhost:11434/api/tags > /dev/null 2>&1 && echo "  Ollama   :11434 ✅" || echo "  Ollama   :11434 ❌"

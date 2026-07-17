#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"
LOG_DIR="${ROOT_DIR}/logs"
mkdir -p "${LOG_DIR}"

wait_for_chroma() {
  local url="http://127.0.0.1:8000/api/v2/heartbeat"
  local attempts=30

  echo "[run_all] Waiting for ChromaDB (${url})..."

  for ((i = 1; i <= attempts; i++)); do
    if curl -sf "${url}" >/dev/null 2>&1; then
      echo "[run_all] ChromaDB is ready (${url})"
      return 0
    fi
    sleep 1
  done

  echo "[run_all] ERROR: ChromaDB did not start within 30 seconds (${url})" >&2
  return 1
}

echo "[run_all] Starting ChromaDB on :8000"
./run_chroma.sh >"${LOG_DIR}/chroma.log" 2>&1 &
CHROMA_PID=$!

if ! wait_for_chroma; then
  kill "${CHROMA_PID}" 2>/dev/null || true
  exit 1
fi

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q -r requirements.txt

export PYTHONPATH="${ROOT_DIR}"
export METADATA_PROVIDER="${METADATA_PROVIDER:-ollama}"

wait_for_health() {
  local name="$1"
  local url="$2"
  local attempts=60

  for ((i = 1; i <= attempts; i++)); do
    if curl -sf "${url}" >/dev/null 2>&1; then
      echo "[run_all] ${name} healthy (${url})"
      return 0
    fi
    sleep 2
  done

  echo "[run_all] ${name} failed health check: ${url}" >&2
  return 1
}

echo "[run_all] Starting Intent service on :8001"
./run_intent.sh >"${LOG_DIR}/intent.log" 2>&1 &
INTENT_PID=$!

echo "[run_all] Starting Metadata service on :8002"
./run_metadata.sh >"${LOG_DIR}/metadata.log" 2>&1 &
METADATA_PID=$!

echo "[run_all] Starting Embedding service on :8003"
./run_embedding.sh >"${LOG_DIR}/embedding.log" 2>&1 &
EMBEDDING_PID=$!

CRON_PID=""

cleanup() {
  kill "${CHROMA_PID}" "${INTENT_PID}" "${METADATA_PID}" "${EMBEDDING_PID}" ${CRON_PID:+"${CRON_PID}"} 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait_for_health "Intent" "http://127.0.0.1:8001/health"
wait_for_health "Metadata" "http://127.0.0.1:8002/health"
wait_for_health "Embedding" "http://127.0.0.1:8003/health"

echo "[run_all] All inference services are running."
echo "[run_all] Logs: ${LOG_DIR}/"

echo "[run_all] Starting FME Cron service..."
pkill -f CronService 2>/dev/null || true
sleep 1
node ~/Downloads/fme/dist/hook/services/batch/CronService.js >> ~/Downloads/fme/.cursor/hooks/feedback-memory-hook.log 2>&1 &
CRON_PID=$!
echo "[run_all] Cron started with PID: $CRON_PID"

echo "[run_all] Press Ctrl+C to stop."

wait

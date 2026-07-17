#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

check_health() {
  local name="$1"
  local url="$2"
  curl -sf "${url}" >/dev/null || fail "${name} unhealthy at ${url}"
  pass "${name} healthy (${url})"
}

echo "========== Inference Health =========="
check_health "Intent" "http://127.0.0.1:8001/health"
check_health "Metadata" "http://127.0.0.1:8002/health"
check_health "Embedding" "http://127.0.0.1:8003/health"

echo ""
echo "========== Ollama Health =========="
if curl -sf "http://localhost:11434/api/tags" > /dev/null 2>&1; then
    echo "   :11434  Ollama      ✓"
    pass "Ollama healthy (http://localhost:11434/api/tags)"
else
    echo "   :11434  Ollama      ✗ — run: ollama serve"
    fail "Ollama unhealthy at http://localhost:11434"
fi

echo ""
echo "========== Chroma Health =========="
curl -sf "http://127.0.0.1:8000/api/v2/heartbeat" >/dev/null \
  || fail "Chroma unhealthy at http://127.0.0.1:8000"
pass "Chroma healthy (http://127.0.0.1:8000/api/v2/heartbeat)"

echo ""
echo "========== Contract Smoke Tests =========="

INTENT_RESULT=$(curl -sf -X POST "http://127.0.0.1:8001/v1/intent/classify" \
  -H "Content-Type: application/json" \
  -d '{"text":"Why are we using Redis?","model_id":"facebook/bart-large-mnli","candidate_labels":["WRITE","READ","ANSWER_ONLY"],"multi_label":false}')
echo "${INTENT_RESULT}" | grep -q '"labels"' || fail "Intent classify response missing labels"
pass "Intent POST /v1/intent/classify"

METADATA_RESULT=$(curl -sf -X POST "http://127.0.0.1:8002/v1/metadata/extract" \
  -H "Content-Type: application/json" \
  -d '{"text":"We decided to use Redis instead of an in-memory Map","agent_id":"default","system_prompt":"extract metadata"}')
echo "${METADATA_RESULT}" | grep -q '"category"' || fail "Metadata extract response missing category"
pass "Metadata POST /v1/metadata/extract"

EMBED_RESULT=$(curl -sf -X POST "http://127.0.0.1:8003/v1/embeddings/embed" \
  -H "Content-Type: application/json" \
  -d '{"text":"Redis session cache","model_id":"sentence-transformers/all-MiniLM-L6-v2","purpose":"document","normalize":true}')
echo "${EMBED_RESULT}" | grep -q '"embedding"' || fail "Embedding response missing embedding field"
pass "Embedding POST /v1/embeddings/embed"

echo ""
echo "========== TypeScript Engine Build =========="
(
  cd "${ROOT_DIR}/.."
  npm run build:hook
)
pass "FME hook build (npm run build:hook)"

echo ""
echo "All verification checks passed."

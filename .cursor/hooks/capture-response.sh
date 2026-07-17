#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FME_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPILED_SCRIPT="${FME_ROOT}/dist/hook/demo/updateAiResponse.js"

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/cursor-response-hook.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

cat > "$TMP_FILE"

emit_fail_open() {
  echo '{"continue":true}'
}

NODE_BIN=""
for candidate in "/opt/homebrew/bin/node" "/usr/local/bin/node" "/usr/bin/node"; do
  if [[ -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node 2>/dev/null || echo '')"
fi

LOG_FILE="${HOME}/Downloads/fme/.cursor/hooks/feedback-memory-hook.log"

if [[ -n "$NODE_BIN" && -f "$COMPILED_SCRIPT" ]]; then
  if (
    cd "${FME_ROOT}"
    CURSOR_PROJECT_DIR="${CURSOR_PROJECT_DIR:-$(pwd)}" \
    "$NODE_BIN" "$COMPILED_SCRIPT" < "$TMP_FILE"
  ); then
    generationId="$("$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const p=JSON.parse(s);process.stdout.write(String(p.generation_id||""))}catch{}})' < "$TMP_FILE")"
    aiResponse="$("$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const p=JSON.parse(s);process.stdout.write(String(p.text||p.prompt||p.response||""))}catch{}})' < "$TMP_FILE")"
    echo "$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M:%S IST') [AfterResponse] captured generationId=${generationId} aiResponse=${aiResponse}" >> "$LOG_FILE"
  else
    emit_fail_open
  fi
else
  emit_fail_open
fi

exit 0

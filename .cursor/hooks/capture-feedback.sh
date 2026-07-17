#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FME_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPILED_SCRIPT="${FME_ROOT}/dist/hook/demo/processPrompt.js"
HOOK_LOG_FILE="${FME_ROOT}/.cursor/hooks/feedback-memory-hook.log"
export HOOK_LOG_FILE="${HOOK_LOG_FILE:-${FME_ROOT}/.cursor/hooks/feedback-memory-hook.log}"

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/cursor-hook.XXXXXX")"
HOOK_RESPONSE_FILE="$(mktemp "${TMPDIR:-/tmp}/cursor-hook-response.XXXXXX")"
trap 'rm -f "$TMP_FILE" "$HOOK_RESPONSE_FILE"' EXIT

cat > "$TMP_FILE"

emit_fail_open() {
  python3 -c "
import json
payload = json.load(open('${TMP_FILE}', encoding='utf-8'))
print(json.dumps({'continue': True, 'updated_input': {'prompt': payload.get('prompt', '')}}))
"
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

if [[ -n "$NODE_BIN" && -f "$COMPILED_SCRIPT" ]]; then
  if (
    cd "${FME_ROOT}"
    HOOK_LOG_FILE="${HOOK_LOG_FILE}" \
    CURSOR_PROJECT_DIR="${CURSOR_PROJECT_DIR:-$(pwd)}" \
    "$NODE_BIN" "$COMPILED_SCRIPT" --hook-payload "$TMP_FILE"
  ) > "$HOOK_RESPONSE_FILE" 2>&1; then
    cat "$HOOK_RESPONSE_FILE"
  else
    emit_fail_open
  fi
else
  emit_fail_open
fi

exit 0

#!/bin/bash
# Parse FME performance logs and show summary

# Match hookLogger.ts resolveLogPath() resolution order exactly:
# 1. HOOK_LOG_FILE env var if set
# 2. $CURSOR_PROJECT_DIR/.cursor/hooks/feedback-memory-hook.log
# 3. fallback: fme/.cursor/hooks/feedback-memory-hook.log (relative to this script)
resolve_log_path() {
  if [[ -n "${HOOK_LOG_FILE:-}" ]]; then
    echo "${HOOK_LOG_FILE}"
    return 0
  fi

  if [[ -n "${CURSOR_PROJECT_DIR:-}" ]]; then
    echo "${CURSOR_PROJECT_DIR}/.cursor/hooks/feedback-memory-hook.log"
    return 0
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  echo "${script_dir}/../.cursor/hooks/feedback-memory-hook.log"
}

LOG="$(resolve_log_path)"

echo "=== FME Latency Summary ==="
echo "Log: ${LOG}"
echo ""

if [[ ! -f "$LOG" ]]; then
  echo "No log file found at ${LOG}"
  exit 0
fi

# Extract PERF lines and compute averages
grep '"type":"PERF"' "$LOG" | python3 -c "
import sys, json, statistics

lines = [json.loads(l) for l in sys.stdin if l.strip()]
if not lines:
    print('No performance data yet.')
    exit()

hook_lines = [l for l in lines if l.get('phase', 'hook') == 'hook']
write_lines = [l for l in lines if l.get('phase') == 'write_background']

if not hook_lines:
    hook_lines = lines

total = [l['totalMs'] for l in hook_lines]
intent = [l['intentMs'] for l in hook_lines]
read   = [l['readMs'] for l in hook_lines]
write  = [l['writeMs'] for l in write_lines if l.get('writeMs', 0) > 0]

print(f'Hook PERF entries:   {len(hook_lines)}')
print(f'Write PERF entries:  {len(write_lines)}')
print(f'')
print(f'Total hook latency:')
print(f'  avg: {statistics.mean(total):.0f}ms')
print(f'  p50: {statistics.median(total):.0f}ms')
print(f'  max: {max(total):.0f}ms')
print(f'')
print(f'Intent detection:    avg {statistics.mean(intent):.0f}ms')
print(f'Read pipeline:       avg {statistics.mean(read):.0f}ms')
if write:
    print(f'Write pipeline:      avg {statistics.mean(write):.0f}ms (background)')
print(f'')
print(f'Enriched prompts:    {sum(1 for l in hook_lines if l.get(\"enriched\"))} / {len(hook_lines)}')
print(f'Write queued:          {sum(1 for l in hook_lines if l.get(\"writeStatus\") == \"queued\")}')
print(f'Write completed:       {sum(1 for l in write_lines if l.get(\"writeStatus\") == \"completed\")}')
print(f'Duplicate skipped:     {sum(1 for l in write_lines if l.get(\"writeStatus\") == \"duplicate_skipped\")}')
print(f'Storage failed:        {sum(1 for l in write_lines if l.get(\"writeStatus\") == \"storage_failed\")}')
print(f'Write failed:          {sum(1 for l in write_lines if l.get(\"writeStatus\") == \"write_failed\")}')
"

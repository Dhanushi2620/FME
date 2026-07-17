#!/usr/bin/env bash
set -euo pipefail

PORTS=(8000 8001 8002 8003)

for port in "${PORTS[@]}"; do
  pids="$(lsof -ti ":${port}" 2>/dev/null || true)"

  if [[ -n "${pids}" ]]; then
    echo "[stop_all] Stopping port ${port} (PID(s): ${pids})"
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
  else
    echo "[stop_all] Port ${port} was not running"
  fi
done

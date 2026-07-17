#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

CHROMA_DATA_DIR="${ROOT_DIR}/chroma-data"
mkdir -p "${CHROMA_DATA_DIR}"

if [[ ! -d ".venv-chroma" ]]; then
  python3 -m venv .venv-chroma
fi

# shellcheck disable=SC1091
source .venv-chroma/bin/activate

pip install -q chromadb==0.6.3

exec chroma run --host 127.0.0.1 --port 8000 --path "${CHROMA_DATA_DIR}"

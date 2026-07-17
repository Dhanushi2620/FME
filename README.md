# Feedback Memory Engine (FME)

Persistent engineering memory for Cursor AI.
Captures corrections, decisions, and anti-patterns across sessions.

## Prerequisites

### macOS / Linux
- Python 3.9+
- Node.js 18+
- Ollama (installed automatically by `setup.sh`)

### Windows Requirements
- Windows 10 or Windows 11
- Git for Windows (provides bash): https://git-scm.com
  (required to run `.sh` scripts)
- winget (pre-installed on Windows 11, available for Windows 10)
- Node.js 18+ for Windows
- Python 3.9+ for Windows

## One-Time Setup

### macOS / Linux

```bash
git clone <repo-url>
cd fme
chmod +x setup.sh
./setup.sh
```

### Windows Note

On Windows, run `setup.sh` from **Git Bash** (not PowerShell or CMD):

```bash
git clone <fme-repo-url>
cd fme
bash setup.sh
```

Ollama installs as a system tray app and auto-starts on every login.
Sidecars are registered with Windows Task Scheduler — auto-start 30s after login.

Setup takes 15-20 minutes (model download).
After that — no daily commands ever needed.

## What It Does

- Captures: corrections, decisions, anti-patterns, task learnings
- Stores: vector embeddings in ChromaDB (local, private)
- Retrieves: relevant prior context and injects into every prompt
- Works: across all your Cursor projects automatically

## How It Works

Every prompt you send in Cursor:
1. Always searches ChromaDB for relevant memories
2. If relevant memories found — enriches your prompt with context
3. If the prompt contains a correction or decision — stores it
4. Your AI answers are now grounded in your team's prior decisions

## Architecture

| Service | Port | Role |
|---------|------|------|
| ChromaDB | 8000 | Vector store (native Python) |
| Intent | 8001 | BART-MNLI classification |
| Metadata | 8002 | Default: Ollama qwen3:3b · Fallback: `METADATA_PROVIDER=rule-based` |
| Embedding | 8003 | MiniLM sentence embeddings |
| Ollama | 11434 | Qwen3:3b (default metadata provider) |

Metadata extraction: Ollama local runtime (qwen3:3b)
- Runs on developer machine via localhost:11434
- Free, private, data never leaves machine
- JSON schema constrained output — no parsing errors
- Fallback: set `METADATA_PROVIDER=rule-based` for zero-dependency mode

## Developer Commands

### macOS / Linux

```bash
cd feedback-memory-inference
./run_all.sh     # start everything
./stop_all.sh    # stop everything
./verify_all.sh  # check all services
```

### Windows

```bat
cd feedback-memory-inference
run_all.bat      # start everything
stop_all.bat     # stop everything
```

Or from Git Bash: `./run_all.sh` / `./stop_all.sh`

# Feedback Memory Engine (FME)

FME gives Cursor AI a persistent memory across sessions.
Captures developer corrections, team decisions, anti-patterns and
workflows — stores them locally using BART + Ollama + ChromaDB —
and automatically enriches every future prompt with relevant context.
100% local. $0 cloud cost. No API keys.

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
git clone https://github.com/Dhanushi2620/FME
cd fme
chmod +x setup.sh
./setup.sh
```

### Windows Note

On Windows, run `setup.sh` from **Git Bash** (not PowerShell or CMD):

```bash
git clone https://github.com/Dhanushi2620/FME
cd fme
bash setup.sh
```

Ollama installs as a system tray app and auto-starts on every login.
Sidecars are registered with Windows Task Scheduler — auto-start 30s after login.

Setup takes 15-20 minutes (model download).
After that — no daily commands ever needed.

## LaunchD Auto-Start (macOS)

After running setup.sh, register FME to auto-start on every Mac login:

```bash
bash scripts/setup-launchd.sh
```

This registers 3 LaunchD agents:
- `com.fme.ollama` — Ollama serve (keeps model ready)
- `com.fme.inference` — BART + Metadata + MiniLM + ChromaDB
- `com.fme.cron` — CronService (15min batch + 24hr skill extraction)

After registration — open Cursor, FME works. No manual start ever needed.

## Service Management

```bash
# Check status + RAM usage
bash scripts/status-fme.sh

# Stop all services
bash scripts/stop-fme.sh

# Start all services manually (without LaunchD)
cd feedback-memory-inference
METADATA_PROVIDER=ollama METADATA_MODEL=qwen2.5:3b OLLAMA_URL=http://localhost:11434 ./run_all.sh &

# Restart everything (one command)
pkill -f "intent/main.py" ; pkill -f "metadata/main.py" ; pkill -f "embedding/main.py" ; pkill -f "chroma" ; pkill -f CronService ; sleep 3 && ~/ollama serve > /tmp/ollama.log 2>&1 & sleep 8 && cd feedback-memory-inference && METADATA_PROVIDER=ollama METADATA_MODEL=qwen2.5:3b OLLAMA_URL=http://localhost:11434 ./run_all.sh & sleep 25 && ./verify_all.sh
```

## LaunchD Commands (macOS)

```bash
# Check registered services
launchctl list | grep fme

# Start via LaunchD
launchctl start com.fme.ollama
launchctl start com.fme.inference
launchctl start com.fme.cron

# Stop via LaunchD
launchctl stop com.fme.cron
launchctl stop com.fme.inference
launchctl stop com.fme.ollama

# Permanently unregister (remove from boot)
launchctl unload ~/Library/LaunchAgents/com.fme.ollama.plist
launchctl unload ~/Library/LaunchAgents/com.fme.inference.plist
launchctl unload ~/Library/LaunchAgents/com.fme.cron.plist
```

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

## Pipeline Overview

| Pipeline | Trigger | Developer waits? |
|---|---|---|
| READ | Every prompt, always | Yes — ~500ms blocking |
| WRITE (batch) | Every 15 min via CronService | No — background |
| Rule Evaluation | Per memory stored | No — fire-and-forget |
| Skill Extraction | Every 24 hours | No — background |

**WRITE pipeline flow:**

## Performance (Measured)

| Component | RAM | Latency |
|---|---|---|
| Ollama qwen2.5:3b | ~2,500 MB | 8-15s per extraction |
| BART-MNLI :8001 | ~160 MB | ~1,100ms warm |
| Metadata sidecar :8002 | ~42 MB | included in Ollama |
| MiniLM :8003 | ~15 MB | ~50ms |
| ChromaDB :8000 | ~25 MB | 1-2s upsert |
| **Developer wait** | — | **~500ms (READ only)** |
| **Background batch** | — | **~60-100s (invisible)** |

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

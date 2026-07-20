#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFERENCE_DIR="$REPO_DIR/feedback-memory-inference"
OS="$(uname -s)"

is_windows() {
    [[ "$OS" == "Windows_NT" ]] || echo "$OS" | grep -qiE 'mingw|msys|cygwin'
}

activate_chroma_venv() {
    if [[ -f "$INFERENCE_DIR/.venv-chroma/Scripts/activate" ]]; then
        # shellcheck disable=SC1091
        source "$INFERENCE_DIR/.venv-chroma/Scripts/activate"
    else
        # shellcheck disable=SC1091
        source "$INFERENCE_DIR/.venv-chroma/bin/activate"
    fi
}

echo "================================================"
echo "  FME — One-Time Developer Setup"
echo "================================================"
echo ""
echo "IMPORTANT: Keep this repo at this location."
echo "Path: $REPO_DIR"
if is_windows; then
    echo "Task Scheduler will start services from this path."
else
    echo "launchd/systemd will start services from this path."
fi
echo "Do not move this folder after setup."
echo ""

# Prerequisites
if is_windows; then
    echo "Checking Windows prerequisites..."

    if ! command -v bash &> /dev/null; then
        echo "ERROR: bash not found."
        echo "Install Git for Windows (includes Git Bash): https://git-scm.com/download/win"
        exit 1
    fi

    if [[ -z "${MSYSTEM:-}" && -z "${WSL_DISTRO_NAME:-}" ]]; then
        echo "WARNING: Run this script from Git Bash or WSL, not CMD or PowerShell."
        echo "  Git for Windows: https://git-scm.com/download/win"
    fi

    if ! command -v winget &> /dev/null; then
        echo "ERROR: winget not found."
        echo "Install App Installer from the Microsoft Store, or use Windows 11."
        echo "Manual Ollama install: https://ollama.com/download/windows"
        exit 1
    fi

    echo "   Git Bash / bash: OK"
    echo "   winget: $(winget --version 2>/dev/null || echo 'available')"
    echo ""
fi

# Step 1: Install Ollama
echo "[1/6] Checking Ollama..."
if command -v ollama &> /dev/null; then
    echo "   Ollama already installed."
else
    if [[ "$OS" == "Darwin" ]]; then
        brew install ollama
    elif [[ "$OS" == "Linux" ]]; then
        curl -fsSL https://ollama.com/install.sh | sh
    elif is_windows; then
        echo "   Installing Ollama via winget..."
        winget install Ollama.Ollama \
            --accept-source-agreements \
            --accept-package-agreements
        echo "   Ollama installed. Auto-starts in system tray on every login."
    else
        echo "   Unsupported OS: $OS"
        echo "   Install Ollama manually from https://ollama.com then re-run."
        exit 1
    fi
fi

# Step 2: Pull model (skip if already present) and warm up
echo "[2/6] Ensuring Qwen2.5:3b model is available..."
if ollama list 2>/dev/null | grep -q "qwen2.5:3b"; then
    echo "   Qwen2.5:3b already cached."
else
    echo "   Pulling Qwen2.5:3b (~2.5GB one-time download)..."
    ollama pull qwen2.5:3b
    echo "   Model cached at ~/.ollama/models/ — one-time download."
fi
echo "   Warming up qwen2.5:3b (loads model into memory)..."
ollama run qwen2.5:3b "warmup" > /dev/null 2>&1 || true

# Step 3: Python deps
echo "[3/6] Installing Python dependencies..."
cd "$INFERENCE_DIR"
python3 -m venv .venv-chroma
activate_chroma_venv
pip install --quiet chromadb==0.6.3
deactivate

# Step 4: Build hook
echo "[4/6] Building FME hook..."
cd "$REPO_DIR"
npm install --silent
npm run build:hook

# Step 5: Register auto-start
echo "[5/6] Registering auto-start..."
if [[ "$OS" == "Darwin" ]]; then
    PLIST="$HOME/Library/LaunchAgents/com.fme.services.plist"
    cat > "$PLIST" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.fme.services</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${INFERENCE_DIR}/run_all.sh</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key>
    <string>${INFERENCE_DIR}/logs/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>${INFERENCE_DIR}/logs/launchd-error.log</string>
</dict>
</plist>
PLIST_EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "   macOS launchd service registered. Auto-starts on every login."

elif [[ "$OS" == "Linux" ]]; then
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/fme-services.service" << SVC_EOF
[Unit]
Description=FME Inference Services
After=network.target
[Service]
ExecStart=${INFERENCE_DIR}/run_all.sh
Restart=always
RestartSec=5
[Install]
WantedBy=default.target
SVC_EOF
    systemctl --user daemon-reload
    systemctl --user enable fme-services
    systemctl --user start fme-services
    echo "   Linux systemd service registered."

elif is_windows; then
    echo "   Windows detected."

    if [[ ! -f "$INFERENCE_DIR/run_all.bat" ]]; then
        echo "ERROR: $INFERENCE_DIR/run_all.bat not found."
        echo "Re-clone the repo or restore run_all.bat from the FME package."
        exit 1
    fi

    # Register Task Scheduler for auto-start on login (ONLOGON — no admin rights)
    TASK_NAME="FME-Inference-Services"
    SCRIPT_PATH=$(cygpath -w "$INFERENCE_DIR/run_all.bat" 2>/dev/null || \
        echo "$INFERENCE_DIR/run_all.bat")

    schtasks /create \
        /tn "$TASK_NAME" \
        /tr "\"$SCRIPT_PATH\"" \
        /sc ONLOGON \
        /delay 0000:30 \
        /f \
        > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo "   Windows Task Scheduler registered: $TASK_NAME"
        echo "   Sidecars will auto-start 30 seconds after login."
    else
        STARTUP_DIR="$APPDATA/Microsoft/Windows/Start Menu/Programs/Startup"
        mkdir -p "$STARTUP_DIR"
        cp "$INFERENCE_DIR/run_all.bat" "$STARTUP_DIR/fme-start.bat"
        echo "   Startup folder fallback used: $STARTUP_DIR/fme-start.bat"
        echo "   Sidecars will auto-start on next login."
    fi

    # Windows global hooks install
    CURSOR_WIN_DIR="${APPDATA}/.cursor"
    mkdir -p "$CURSOR_WIN_DIR/hooks"
    echo "$REPO_DIR" > "$CURSOR_WIN_DIR/fme-root.txt"
    cat > "$CURSOR_WIN_DIR/hooks.json" <<'HOOKS_EOF'
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "hooks/capture-feedback.sh",
        "timeout": 30
      }
    ]
  }
}
HOOKS_EOF
    cp "$REPO_DIR/.cursor/hooks/capture-feedback.sh" \
       "$CURSOR_WIN_DIR/hooks/capture-feedback.sh"
    chmod +x "$CURSOR_WIN_DIR/hooks/capture-feedback.sh"
    echo "   Cursor hooks installed for Windows."
fi

# Step 6: Install hooks globally (macOS / Linux)
if ! is_windows; then
    echo "[6/6] Installing Cursor hooks globally..."
    mkdir -p "$HOME/.cursor/hooks"
    echo "$REPO_DIR" > "$HOME/.cursor/fme-root.txt"
    cat > "$HOME/.cursor/hooks.json" <<'HOOKS_EOF'
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "hooks/capture-feedback.sh",
        "timeout": 30
      }
    ]
  }
}
HOOKS_EOF
    cp "$REPO_DIR/.cursor/hooks/capture-feedback.sh" \
       "$HOME/.cursor/hooks/capture-feedback.sh"
    chmod +x "$HOME/.cursor/hooks/capture-feedback.sh"
else
    echo "[6/6] Cursor hooks already installed (Windows step above)."
fi

# Verify
echo ""
echo "Verifying services (waiting 8 seconds)..."
sleep 8
for port in 8000 8001 8002 8003; do
    if curl -sf "http://127.0.0.1:$port/health" > /dev/null 2>&1 || \
       curl -sf "http://127.0.0.1:$port/api/v2/heartbeat" > /dev/null 2>&1; then
        echo "   :$port  ✓"
    else
        echo "   :$port  ✗ (still starting — check logs/)"
    fi
done

echo ""
echo "================================================"
echo "  Setup complete."
echo "  Open any project in Cursor."
echo "  FME runs silently. No daily commands needed."
echo "================================================"

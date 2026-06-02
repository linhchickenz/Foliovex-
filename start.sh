#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}    Portfolio Optimizer         ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# ── Backend setup ──────────────────────────────────────────────
echo -e "${YELLOW}[1/4] Setting up Python environment...${NC}"
cd "$BACKEND_DIR"

if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "      Created virtual environment"
fi

venv/bin/pip install -r requirements.txt -q --disable-pip-version-check
echo "      Python dependencies ready"

# ── Frontend setup ─────────────────────────────────────────────
echo -e "${YELLOW}[2/4] Setting up frontend...${NC}"
cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
    npm install --silent
    echo "      Installed npm packages"
fi
echo "      Frontend dependencies ready"

# ── Start backend ──────────────────────────────────────────────
echo -e "${YELLOW}[3/4] Starting Flask backend on :8000...${NC}"
cd "$BACKEND_DIR"
venv/bin/python3 app.py &
BACKEND_PID=$!

# ── Start frontend ─────────────────────────────────────────────
echo -e "${YELLOW}[4/4] Starting Vite dev server on :5173...${NC}"
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

# ── Ready ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  Portfolio Optimizer is running!${NC}"
echo "  ┌─────────────────────────────────┐"
echo "  │  Frontend  →  http://localhost:5173  │"
echo "  │  Backend   →  http://localhost:8000  │"
echo "  └─────────────────────────────────┘"
echo ""
echo "  Press Ctrl+C to stop both servers."
echo ""

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$BACKEND_PID"  2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait  "$BACKEND_PID"  2>/dev/null || true
    wait  "$FRONTEND_PID" 2>/dev/null || true
    echo "Done."
    exit 0
}

trap cleanup SIGINT SIGTERM
wait

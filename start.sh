#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Burien Station Plant Library — local dev launcher (macOS).
#
# Builds the frontend, then opens three separate Terminal windows running:
#   1. Azurite   (blob storage emulator, port 10000)
#   2. Backend   (FastAPI / uvicorn, port 8000)
#   3. Frontend  (Vite dev server, port 5173)
#
# NOTE: The backend needs a reachable Cosmos DB. Start the Cosmos DB emulator
#       (or point COSMOS_* in backend/.env at a real account) before using the
#       app. `docker compose up cosmos` will start just the emulator.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Building frontend..."
cd "$ROOT/frontend"
npm install
npm run build
cd "$ROOT"

# Opens a new macOS Terminal window and runs a command (starting from repo root).
open_terminal() {
  local cmd="$1"
  osascript -e "tell application \"Terminal\" to do script \"cd '$ROOT' && $cmd\"" >/dev/null
}

echo "==> Launching Azurite, backend, and frontend in separate Terminal windows..."

# 1. Azurite (blob emulator)
open_terminal "mkdir -p .azurite && npx --yes azurite --silent --location .azurite --blobHost 127.0.0.1 --blobPort 10000"

# 2. Backend (create venv + install deps on first run, ensure .env exists)
open_terminal "cd backend && { [ -d .venv ] || python3 -m venv .venv; } && source .venv/bin/activate && pip install -q -r requirements.txt && { [ -f .env ] || cp .env.example .env; } && uvicorn app.main:app --reload --port 8000"

# 3. Frontend (Vite dev server, proxies /api to backend on :8000)
open_terminal "cd frontend && npm run dev"

echo "==> Done."
echo "    Frontend : http://localhost:5173"
echo "    Backend  : http://localhost:8000/docs"
echo "    Azurite  : http://localhost:10000"
echo
echo "    A fresh database has no properties yet — the app opens the"
echo "    onboarding wizard to create your first Property + Home garden."
echo "    To load demo data instead, run:  python backend/seed.py"

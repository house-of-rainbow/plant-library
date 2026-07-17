#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Burien Station Plant Library — local dev launcher (macOS).
#
# Builds the frontend, then opens four separate Terminal windows running:
#   1. Azurite   (blob storage emulator, port 10000)
#   2. Backend   (FastAPI / uvicorn, port 8000)
#   3. MCP       (FastMCP HTTP server, port 8100)
#   4. Frontend  (Vite dev server, port 5173)
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$ROOT/backend/.env" ]]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
fi

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
# Force local Azurite endpoints for this launcher process (independent of .env)
# so startup doesn't hang on container-only hostnames like "azurite".
open_terminal "cd backend && { [ -d .venv ] || python3 -m venv .venv; } && source .venv/bin/activate && pip install -q -r requirements.txt && set -a && source .env && set +a && export AZURE_STORAGE_CONNECTION_STRING='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' && export AZURE_STORAGE_PUBLIC_BASE_URL='http://127.0.0.1:10000/devstoreaccount1' && python -m app.server --reload --port 8000"

# 3. MCP (reuses backend env + data layer, but serves its own HTTP endpoint)
open_terminal "cd mcp && { [ -d .venv ] || python3 -m venv .venv; } && source .venv/bin/activate && pip install -q -r requirements.txt && set -a && source ../backend/.env && set +a && export AZURE_STORAGE_CONNECTION_STRING='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' && export AZURE_STORAGE_PUBLIC_BASE_URL='http://127.0.0.1:10000/devstoreaccount1' && export MCP_PORT=8100 && python server.py"

# 4. Frontend (wait for backend health, then run Vite dev server)
open_terminal "echo 'Waiting for backend on http://127.0.0.1:8000/api/health ...' && until curl -fsS http://127.0.0.1:8000/api/health >/dev/null; do sleep 2; done && cd frontend && npm run dev"

echo "==> Done."
echo "    Frontend : http://localhost:5173"
echo "    Backend  : http://localhost:8000/docs"
echo "    MCP      : http://localhost:8100/mcp/"
echo "    Azurite  : http://localhost:10000"
echo
echo "    A fresh database has no properties yet — the app opens the"
echo "    onboarding wizard to create your first Property + Home garden."
echo "    To load demo data instead, run:  python backend/seed.py"

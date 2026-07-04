# 🪴 Burien Station Plant Library

A sleek, Three.js-powered app for managing a prosumer plant collection. Track
species care templates and individual specimens, log care events, and use
QR/NFC labels to jump straight to a plant on your phone.

Two experiences, one app:

- **Administration** (desktop/tablet) — the INPUT phase: manage species, add
  and edit plants, upload photos, print labels.
- **Operations** (mobile) — the OUTPUT phase: a fast care queue, one-tap
  watering, and scan-a-label to instantly pull up a plant.

## Stack

| Layer     | Tech |
| --------- | ---- |
| Frontend  | Vite + React + TypeScript, react-three-fiber + drei, Tailwind CSS, Framer Motion, TanStack Query |
| Backend   | Python FastAPI (async), Pydantic v2 |
| Database  | Azure Cosmos DB (NoSQL API) |
| Images    | Azure Blob Storage (Azurite locally) |
| Auth      | Microsoft EntraID (single-tenant; stubbed for local dev) |
| Hosting   | Azure Container Apps (deployment not yet implemented) |

Secrets are **only** read from environment variables. Nothing is hard-coded.

## Data model

- **PlantClass** — a species/taxon (e.g. *Monstera Deliciosa*) holding default
  care requirements (watering interval, sunlight, fertilizing, repotting,
  humidity/temperature, toxicity, notes).
- **PlantInstance** — an individual plant you own. References a class, inherits
  its care defaults, and can **override** any of them. Keeps its own care/event
  log, photos, location, health status, and a stable id used for scanning.

Scan URIs look like `…/scan/plant_ab12cd34ef` and work for both QR codes and
NFC tags.

## Quick start (Docker)

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs

> The Cosmos DB emulator can take a minute to become healthy on first run.

Seed some demo data (after the backend is up):

```bash
pip install httpx
python backend/seed.py
```

## Local development (without Docker)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env         # adjust as needed
uvicorn app.main:app --reload
```

Requires a reachable Cosmos DB (emulator or cloud) and, for image uploads,
Azurite or a real storage account. `AUTH_DISABLED=true` skips EntraID locally.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev                  # http://localhost:5173, proxies /api to :8000
```

## Configuration

All configuration is via environment variables — see
[`backend/.env.example`](backend/.env.example) and
[`frontend/.env.example`](frontend/.env.example).

Key backend variables:

- `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE`, `COSMOS_*_CONTAINER`
- `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_PUBLIC_BASE_URL`
- `AUTH_DISABLED`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_API_AUDIENCE`
- `SCAN_BASE_URL`

## API overview

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET/POST | `/api/classes` | List / create species |
| GET/PATCH/DELETE | `/api/classes/{id}` | Read / update / delete species |
| GET/POST | `/api/instances` | List / create plants (`?class_id=` filter) |
| GET/PATCH/DELETE | `/api/instances/{id}` | Read (enriched care status) / update / delete |
| POST | `/api/instances/{id}/events` | Log a care event (water, fertilize, …) |
| GET | `/api/scan/{plant_id}` | Resolve a scanned label to a plant |
| GET | `/api/scan/{plant_id}/qr.png` | Printable QR label |
| POST | `/api/images` | Upload a plant photo to blob storage |
| GET | `/api/dashboard/summary` | Care due/overdue aggregation |

## Notifications

In-app only for now: the dashboard and Operations queue compute
watering **due soon** / **overdue** and highlight plants needing attention.
External delivery (email/push) can be layered on later.
# Mini Gauntlet — Cloud Posture Scanner

Mini Gauntlet is a containerized multi-cloud security posture scanner with a **Python (FastAPI + SQLite)** backend, a **React + TypeScript** dashboard, **Docker Compose** orchestration, and a **GitHub Actions CI** pipeline.

* **CI Pipeline (Green Run):** `<REPLACE_WITH_YOUR_GITHUB_ACTIONS_RUN_URL_AFTER_PUSH>`

---

## Quick Start (Docker Compose)

Start the entire stack (API + Dashboard + persistent SQLite volume) with a single command:

```bash
docker compose up --build
```

* **Dashboard:** http://localhost:3000
* **REST API & OpenAPI Docs:** http://localhost:8000/docs
* **Health Check:** http://localhost:8000/api/health

Stop the stack (preserving database volume):
```bash
docker compose down
```

---

## Running Locally & Executing Tests

### Backend (Python 3.11+)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install ".[dev]"

# Lint & run unit + API tests
ruff check app tests
pytest -v

# Start dev server
uvicorn app.main:app --reload --port 8000
```

### Frontend (Node 20+)
```bash
cd frontend
npm install

# Lint, type-check & run component tests
npm run lint
npm run typecheck
npm test

# Start dev server (proxies /api to localhost:8000)
npm run dev
```

---

## Architecture Overview

1. **Plugin Check Registry (`backend/app/scanner/registry.py` & `checks.py`)**:
   * All 10 checks across AWS, Azure, and GCP register via `@registry.register(...)`. Adding a new check requires writing a single decorated function with zero changes to the runner, database layer, or API routes.
2. **Concurrent Scanner Engine (`backend/app/scanner/engine.py`)**:
   * Reads `INVENTORY_PATH` (default `data/inventory.json`) and scans cloud accounts concurrently via `ThreadPoolExecutor` (`SCAN_WORKERS=4` by default). With account latencies of 1.5s, 3.0s, 1.0s, and 2.5s, full snapshot scans finish in ~3.0s.
   * Evaluates age-based rules (`AWS-IAM-02`) strictly against `snapshot_taken_at` for deterministic results.
   * Handles collection-level `errors` (`CANNOT_SCAN` with no `resource_id`), missing collections (0 findings), and malformed records (`CANNOT_SCAN` + warning log without aborting the scan).
3. **REST API & Persistence (`backend/app/main.py` & `database.py`)**:
   * `POST /api/scans` returns `202 Accepted` immediately and executes the scan in a FastAPI background task, persisting scans and findings to SQLite (`DB_PATH`) with indexed ordering (`FAIL` -> `CANNOT_SCAN` -> `PASS`, then severity `CRITICAL` -> `LOW`, `check_id`, `resource_id`).
4. **React + TypeScript Dashboard (`frontend/src/`)**:
   * Displays scan history with local timezone timestamps, live polling (`1.5s`) while scans are `RUNNING`, overall and per-account posture scores (`N/A` when `PASS + FAIL == 0`), severity breakdowns, and paginated/filterable findings.
   * Renders all snapshot strings strictly through React JSX text interpolation to neutralize XSS payloads in untrusted cloud metadata.

---

## Key Decisions & Trade-Offs

* **SQLite with WAL mode vs. PostgreSQL container**: SQLite mounted on a named Docker volume (`gauntlet_db`) satisfies restart persistence with zero extra container overhead while keeping `docker compose up --build` fast and lightweight. In production (`DEPLOY.md`), this swaps cleanly to Amazon RDS PostgreSQL.
* **Database-level sort rank columns (`status_rank`, `severity_rank`)**: Precomputing integer ranks on insert makes filtered pagination (`LIMIT`/`OFFSET`) fast and deterministic in SQL without loading all findings into memory.
* **Nginx reverse proxy in frontend container**: Serving the compiled Vite bundle via Nginx on `:3000` and proxying `/api/*` to `http://api:8000` keeps the production container tiny (~45 MB), runs as a non-root user, and avoids CORS or hardcoded host issues.

---

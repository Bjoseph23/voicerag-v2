#!/usr/bin/env bash
# Local dev: backend on :8000 (auto-reload) + Vite on :5173 (proxies /api and /realtime). Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
(cd backend && uv run uvicorn app.main:app --port 8000 --reload) &
(cd frontend && npm run dev -- --port 5173) &
wait

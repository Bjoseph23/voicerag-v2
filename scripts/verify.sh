#!/usr/bin/env bash
# One command to prove it works. Run from the repo root.
#   ./scripts/verify.sh         lint + unit tests + frontend build (no Azure calls)
#   ./scripts/verify.sh --e2e   also live checks against Azure: realtime smoke test + Playwright (phone + desktop)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> backend: ruff + pytest"
(cd backend && uv run -q ruff check app tests scripts && uv run -q pytest -q)

echo "==> frontend: lint + build"
(cd frontend && { [ -d node_modules ] || npm ci; } && npm run lint --silent && npm run build --silent >/dev/null)

if [[ "${1:-}" == "--e2e" ]]; then
  PORT=8000
  if ! curl -sf "localhost:$PORT/api/health" >/dev/null; then
    echo "==> starting backend on :$PORT"
    (cd backend && uv run -q uvicorn app.main:app --port $PORT >/tmp/voicerag-verify.log 2>&1 &)
    for _ in $(seq 1 30); do curl -sf "localhost:$PORT/api/health" >/dev/null && break; sleep 1; done
  fi
  echo "==> live realtime smoke test (voice + search + citations)"
  (cd backend && uv run -q python scripts/smoke_realtime.py "ws://localhost:$PORT/realtime")
  echo "==> Playwright (mobile + desktop), screenshots in frontend/test-results/screens/"
  (cd frontend && npx playwright test --reporter=line)
fi
echo "==> verify passed"

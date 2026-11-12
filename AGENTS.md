# VoiceRAG v2: agent guide
Voice-first "talk to your documents" app: phone-friendly assistant-ui frontend + FastAPI realtime middle tier over
Azure OpenAI Realtime (GA v1) and Azure AI Search. Working = you speak, it searches your docs and answers aloud with
citations, fast. Owner: Bill (`Bjoseph23`). Rebuild of `../aisearch-openai-rag-audio`.

## Stack
- `backend/`: Python 3.12, uv, FastAPI, aiohttp (upstream WebSocket), azure-search-documents, azure-storage-blob.
- `frontend/`: Vite + React 19 + TS + Tailwind v4 + shadcn (base-nova) + **assistant-ui 0.15** (+ zustand, vite-plugin-pwa).
- Architecture + why: [ADR 0001](docs/decisions/0001-architecture.md). Plan: `plan.md`. Intent: `intent.md`.

## Commands
- Install: `cd backend && uv sync` · `cd frontend && npm ci`
- Dev: `./scripts/dev.sh` → http://localhost:5173 (Vite proxies `/api` + `/realtime` to :8000)
- Prod-like: `cd frontend && npm run build`, then `cd backend && uv run uvicorn app.main:app --port 8000` → http://localhost:8000
- **Verify (run before saying done):** `./scripts/verify.sh` (no Azure calls). With Azure: `./scripts/verify.sh --e2e`
  (live voice smoke test + Playwright phone/desktop; screenshots in `frontend/test-results/screens/`).
- Phone test: mic needs HTTPS → `cloudflared tunnel --url http://localhost:8000` and open the https URL.

## Key files
- `backend/app/realtime.py`: the bridge. Server owns prompt/tools/voice; browser messages are allow-listed
  (`sanitize_client_message`). **`handle_server_event` must return a NEW dict when it changes a message**; returning
  the same object forwards the raw upstream text (this once leaked the system prompt).
- `backend/app/tools.py`: `search` (hybrid vector query). Its top 3 results are sent to the browser as citations
  (`extension.grounding`); there is deliberately no `report_grounding` tool (slower, unreliable, see ADR 0001).
- `backend/app/documents.py`: blob upload → run indexer `rag-1-indexer` → index `rag-1`; deletes also remove chunks by `parent_id`.
- `frontend/src/voice/realtime-adapter.ts`: assistant-ui `RealtimeVoiceAdapter` over our `/realtime` WS. `audio.ts`: worklet mic + gapless player + barge-in.
- `frontend/src/voice/text-adapter.ts`: typed chat via the same `/realtime` (text-only output).

## Config (backend/.env, never commit; template `backend/.env.example`)
- `REALTIME_PROVIDER=azure|foundry` switches `gpt-realtime-mini` (AZURE_OPENAI_*) ↔ Foundry `gpt-realtime` (FOUNDRY_*).
- Search is the **free tier**: no semantic ranker → keep `AZURE_SEARCH_SEMANTIC_CONFIGURATION` empty; 50 MB index limit.
- Storage: Entra ID (your `az login`) needs **Storage Blob Data Contributor** on `softwizfoundryst`, or set `AZURE_STORAGE_CONNECTION_STRING`.

## Gotchas
- assistant-ui `useAuiState` selectors must return primitives (objects → infinite render, React #185).
- shadcn base-nova: Tooltip uses `delay`, not Radix `delayDuration`.
- Test audio: `cd backend && PYTHONPATH=. uv run python scripts/make_test_audio.py "question" ../frontend/e2e/question.wav`.

## Deploy
- Not deployed (Bill: "deploy later"). Target when asked: Azure Container Apps (consumption, scale to zero, free grant),
  image on GHCR, built-in Entra auth. 🔴 branch + Bill's OK first.

## Session workflow (shared with Codex + Claude Code)
- `CHECKLIST.md` holds the current goal, today's items and the handoff. Keep it current; use the `handoff` skill before ending.
- `PAPERCUTS.md`: append `date | what failed | workaround | status` whenever something breaks or needs a workaround.
- `docs/decisions/`: one short ADR per decision (template: `~/.agents/templates/ADR.md`).

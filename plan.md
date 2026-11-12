# Plan: VoiceRAG v2  (status: approved 2026-11-12; steps 1–9 built, see CHECKLIST.md)

## Architecture
```
Phone / laptop browser                     Backend (FastAPI, one container)                Azure
┌─────────────────────────────┐  WS   ┌──────────────────────────────────┐  WS   ┌──────────────────────────┐
│ Vite + React 19 + Tailwind 4│──────▶│ /realtime  middle tier           │──────▶│ Realtime model           │
│ assistant-ui Thread + Voice │◀──────│  • prompt + tools added here     │◀──────│ (gpt-realtime-mini now,  │
│ custom WebSocket adapter    │       │  • runs search / grounding       │       │  Foundry gpt-realtime    │
│ AudioWorklet mic + playback │       │                                  │       │  later = env swap)       │
│ Documents page (upload/list)│─HTTP─▶│ /api/documents  upload/list/del  │──────▶│ Blob Storage → Indexer   │
└─────────────────────────────┘       │ /api/auth (later)                │       │ → AI Search index        │
                                      └──────────────────────────────────┘       └──────────────────────────┘
```
**Why this shape:** keeps today's fast server-side path (keys, prompt and tools never reach the browser) and gives
the new UI on top. The one container serves the built frontend, so deployment is simple.

## Steps
| # | Step | Touches | Verified by |
|---|------|---------|-------------|
| 1 | Scaffold repo: AGENTS.md, CHECKLIST, PAPERCUTS, ADR 0001, `verify` script | root | `./scripts/verify.sh` runs |
| 2 | Backend: FastAPI + uv, port the middle tier (GA API) + search/grounding tools, settings via env (endpoint/model/key swappable) | `backend/` | pytest unit tests (session translation, tool flow with fakes) + the scripted WS test from v1 (real Azure answer with grounding) |
| 3 | Frontend shell: Vite + React 19 + TS + Tailwind v4 + assistant-ui (shadcn registry `thread`, `voice`), mobile-first layout | `frontend/` | build + lint; Playwright screenshots at 390px and 1280px |
| 4 | Custom voice adapter: `createVoiceSession` over our `/realtime` WS; AudioWorklet mic (24 kHz PCM16) + gapless playback; barge-in (stop audio when you talk); transcripts → thread; volume → orb | `frontend/src/voice/` | Real voice test on laptop; timing log of mic-stop → first audio (target: same as v1) |
| 5 | Citations: grounding sources show as chips under the answer; tap opens the chunk text | frontend + backend | Ask a CV question → see source chip |
| 6 | Typed messages in the same session (`sendText`), so you can type when you can't talk | adapter | Type a question → spoken + text answer |
| 7 | Documents: `/api/documents` upload (PDF/DOCX/MD/TXT) → Blob → run indexer → poll status; list + delete; Documents screen with progress | `backend/documents.py`, frontend page | Upload a file → ask about it → grounded answer |
| 8 | Mobile polish: iOS Safari audio unlock, mic-permission screen, PWA install (home-screen icon), small bundle | frontend | Test on your phone over an HTTPS tunnel (cloudflared) |
| 9 | Switch to Foundry `gpt-realtime` endpoint via env; compare speed/quality vs mini | `.env` only | Same WS test on both |
| 10 | **(Later, 🔴)** Secure deploy: login + rate limit + Container Apps / Railway, secrets in env | infra | Phone on mobile data, logged in |

## Out of scope (for now)
- Chat history saved across sessions, multiple users, sharing.
- WebRTC transport (possible later upgrade for poor mobile networks; needs a server "sideband" connection for tools).
- Reusing assistant-ui's built-in OpenAI adapter (it can't run our server-side search).

## Decisions (Bill, 2026-11-12)
1. **Name:** `voicerag-v2`.
2. **Indexing:** (a) reuse the existing blob + indexer pipeline behind `rag-1`. Agent looks up storage/indexer names via the Search API / `az` first.
3. **Deploy (step 10): deferred, only when Bill asks.** Target: free. Azure Container Apps consumption plan, scale to zero (inside the monthly free grant), image on GitHub Container Registry (free, avoids ~$5/mo ACR), Container Apps built-in Entra login. Cloudflare Tunnel for phone testing in step 8. Fallback: Render free (slow wake, far region).
   Note: hosting is free; Azure OpenAI + AI Search usage is still billed.

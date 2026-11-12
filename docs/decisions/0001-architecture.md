# 0001: Custom assistant-ui voice adapter over our own realtime middle tier

- **Date:** 2026-11-12
- **Status:** accepted

## Context
Bill wanted a modern UI (assistant-ui voice / OpenAI Realtime guides) without losing the speed of the original
VoiceRAG server, and the assistant must answer from his own documents in Azure AI Search.

## Decision
Use assistant-ui for the UI and its `RealtimeVoiceAdapter` contract, but implement the adapter ourselves
(`createVoiceSession`) over a WebSocket to our FastAPI middle tier, which bridges to Azure OpenAI Realtime GA (v1).
The server owns the prompt, voice and tools and runs `search`; it sends the top 3 search results to the browser as
citations itself (no `report_grounding` tool). Documents use the existing Blob →
indexer (integrated vectorization) → `rag-1` pipeline.

## Why / alternatives
- assistant-ui's built-in `OpenAIRealtimeVoiceAdapter` connects the browser to api.openai.com over WebRTC and does
  not forward tools, so it can't search our index and doesn't target Azure. Rejected.
- WebRTC + server "sideband" for tools: better on bad mobile networks, more moving parts. Possible later upgrade.
- Dropped the original `report_grounding` tool: it cost the model an extra tool round trip before speaking, was
  sometimes skipped (no citations), and made the model write/say labels like "[S1]". Trade-off: chips show the top
  passages found, not the ones the model claims it used.
- Measured 2026-11-12, time to first audio on questions needing a search: **2.1–2.7 s** (old app 4.0–4.4 s;
  this app with `report_grounding` 2.6–3.9 s). Citations 6/6.

## Consequences
- Keys, prompt and tools never reach the browser; browser messages are allow-listed.
- Switching models is an env change (`REALTIME_PROVIDER`).
- assistant-ui is ~195 KB gzip; mitigated with vendor chunks + PWA precache (instant repeat loads).

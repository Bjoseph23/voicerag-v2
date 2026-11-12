# CHECKLIST
<!-- Read automatically at the start of every Codex / Claude Code chat.
     Agents: keep this current. Tick items as you finish them, and rewrite "Handoff" at the end of each session.
     Bill: edit freely. -->

## Goal right now
- VoiceRAG v2: fast voice + chat over my documents, great on phone (see `plan.md`).

## Today
- [ ] Bill tries it on his phone over an HTTPS tunnel (step 8): install cloudflared, `cloudflared tunnel --url http://localhost:8000`
- [x] Committed + private repo https://github.com/Bjoseph23/voicerag-v2 (2026-11-12)

## Backlog
- [ ] Better user captions: try `gpt-4o-mini-transcribe` instead of `whisper-1` (live captions sometimes wrong)
- [ ] Persona / prompt tuning (old app had a hip-hop persona) and voice choice
- [ ] Decide default model: mini (faster) vs Foundry gpt-realtime (fuller answers)
- [ ] Reconnect automatically if the WebSocket drops on mobile networks
- [ ] Step 10 (later, 🔴): deploy to Azure Container Apps (free grant) + Entra login

## Done (recent)
- [x] Steps 1–2: repo, FastAPI middle tier on Realtime GA, search + cached grounding, 8 unit tests (2026-11-12)
- [x] Steps 3–6: assistant-ui UI, custom voice adapter (worklet mic, gapless playback, barge-in), call screen, source chips + passages, typed chat (2026-11-12)
- [x] Step 7: Documents tab + API. Live: upload → indexed in 11 s → voice answer cites it → delete leaves 0 chunks. Bill's account got Storage Blob Data Contributor on softwizfoundryst (approved).
- [x] Citations are now sent by the server from search results (dropped report_grounding): first audio 2.1–2.7 s (old app 4.0–4.4 s), 6/6 cited
- [x] Free-tier indexer throttle (one manual run per 180 s) handled with background retry
- [x] Step 8 (partly): PWA (home-screen install, cached shell), safe areas, iOS audio unlock; Playwright phone + desktop 6/6 pass
- [x] Step 9: Foundry `gpt-realtime` works via `REALTIME_PROVIDER=foundry` (3.7–4.9 s vs mini 2.8–3.9 s first audio)

## Handoff (last session)
- **Status:** Steps 1–9 built and verified live: voice, typed chat, citations, upload/index/delete, phone + desktop (Playwright, spoken WAV as fake mic). Not deployed. On GitHub (private).
- **Next step:** Bill tries it himself (laptop: http://localhost:8000, phone: tunnel), then gives feedback / persona / model choice.
- **Gotchas:** see AGENTS.md. Free Search tier (no semantic ranker). Backend dev server may still be running on :8000.
- **Updated:** 2026-11-12 by claude

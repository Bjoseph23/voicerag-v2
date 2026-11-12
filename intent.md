# Intent: VoiceRAG v2

**In Bill's words:** "It works, but not how I want it to. The UI is very boring." Rebuild VoiceRAG from scratch with
assistant-ui (voice + OpenAI Realtime guides). Talk to *my* documents, so I need to upload docs to Azure AI Search
for indexing. Keep it as fast and "realtime" as the current server ("very nice, I like this"). Use the newer Microsoft
Foundry endpoint later (`new_endpint` / `Key` in the old `.env`). Secure deployment later so I can use it from
another phone, so the UI must be fast and good on mobile.

- **Who:** Bill (personal / learning project), used from his laptop and phone.
- **Reference app:** `../aisearch-openai-rag-audio` (migrated to Realtime GA on 2026-11-12, works end to end).
- **Must-haves:** modern voice UI (assistant-ui), document upload + indexing, low latency, mobile-first, secure later.

## Notes
- assistant-ui's built-in `OpenAIRealtimeVoiceAdapter` goes **browser → OpenAI over WebRTC**, calls `api.openai.com`, and
  does **not** forward tools. Our RAG needs the server to run `search` → so we write a **custom adapter**
  (`createVoiceSession`) that talks to our own middle tier over WebSocket, like today.
- Foundry endpoint = same v1 realtime API (`/openai/v1/realtime?model=gpt-realtime`) → config swap, not a rewrite.
- Existing index `rag-1` was built by an Azure AI Search indexer from blob storage (integrated vectorization).
- Phone mic needs HTTPS (browser rule), so phone testing needs a tunnel or a deploy.

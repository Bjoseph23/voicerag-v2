# VoiceRAG v2: talk to your documents

A voice-first assistant that answers questions **out loud, from your own documents**, fast. Tap the mic, ask a
question, and it searches your files and replies in a natural voice with clickable sources. You can also type.
It's built for phones (installable as a home-screen app) and works on desktop.

A rebuild of Microsoft's [VoiceRAG sample](https://github.com/Azure-Samples/aisearch-openai-rag-audio) with a new
UI ([assistant-ui](https://www.assistant-ui.com)), document upload and a faster server.

| | |
|---|---|
| **Voice calls** | Full-screen call view with an animated orb, live captions and source chips. Interrupt it any time by talking. |
| **Typed chat** | Same knowledge, same sources, when you can't talk. |
| **Your documents** | Upload PDF, Word, PowerPoint, Excel, Markdown or text. Azure AI Search chunks and embeds them automatically. |
| **Citations** | Every answer shows which documents it came from. Tap to read the passages. |
| **Fast** | About 2–3 s from the end of your question to the first spoken word, including the document search (the original sample took about 4 s). |
| **Phone-ready** | Mobile-first layout, iOS audio handled, installable PWA, instant repeat loads. |

## How it works

```
 Phone / laptop browser                 FastAPI backend                         Azure
┌─────────────────────────┐   WS   ┌─────────────────────────────┐   WS   ┌───────────────────────┐
│ React + assistant-ui    │───────▶│ /realtime  middle tier      │───────▶│ OpenAI Realtime (GA)  │
│ custom voice adapter    │◀───────│  · adds prompt, voice, tools│◀───────│ gpt-realtime(-mini)   │
│ mic worklet · playback  │        │  · runs `search` itself     │        └───────────────────────┘
│                         │  HTTP  │  · sends citations          │ search ┌───────────────────────┐
│ Documents tab           │───────▶│ /api/documents              │───────▶│ AI Search index       │
└─────────────────────────┘        └─────────────────────────────┘        │  ▲ indexer (chunk +   │
                                                │ upload                   │  │ embed)             │
                                                └─────────────────────────▶│ Blob Storage          │
                                                                           └───────────────────────┘
```

1. The browser streams your microphone (24 kHz PCM) over a WebSocket to the backend.
2. The backend forwards it to the realtime model, adding the system prompt, voice and the `search` tool. The browser
   never sees keys, the prompt or tool calls, and its messages are allow-listed.
3. When the model calls `search`, the backend queries Azure AI Search (hybrid keyword + vector), gives the passages to
   the model and sends the top ones to the browser as citations.
4. The model answers in audio, which plays immediately. Talking over it stops playback (barge-in).

Why it's built this way: [docs/decisions/0001-architecture.md](docs/decisions/0001-architecture.md).

## Quick start

**Needs:** Python 3.12 + [uv](https://docs.astral.sh/uv/), Node 20+, and Azure resources: an OpenAI realtime deployment,
an AI Search index with an indexer over a Blob container (integrated vectorization).

```bash
# 1. Configure
cp backend/.env.example backend/.env      # fill in endpoints + keys

# 2. Install
(cd backend && uv sync) && (cd frontend && npm ci)

# 3. Run (dev, hot reload): UI on http://localhost:5173
./scripts/dev.sh

#    or production-like: one server on http://localhost:8000
(cd frontend && npm run build) && (cd backend && uv run uvicorn app.main:app --port 8000)
```

**On your phone:** browsers only allow the microphone over HTTPS, so tunnel the local server:
`cloudflared tunnel --url http://localhost:8000` and open the `https://…trycloudflare.com` link.
Use "Add to Home Screen" to install it like an app.

## Configuration (`backend/.env`)

| Variable | What it does |
|---|---|
| `REALTIME_PROVIDER` | `azure` → `AZURE_OPENAI_*` (e.g. `gpt-realtime-mini`, fastest) · `foundry` → `FOUNDRY_*` (e.g. `gpt-realtime`, fuller answers) |
| `AZURE_OPENAI_ENDPOINT` / `_API_KEY` / `_REALTIME_DEPLOYMENT` | Azure OpenAI realtime model |
| `FOUNDRY_ENDPOINT` / `_API_KEY` / `_REALTIME_DEPLOYMENT` | Alternative realtime model on Microsoft Foundry |
| `REALTIME_VOICE` | `alloy`, `echo`, `shimmer`, `verse`… |
| `SYSTEM_PROMPT` | Optional override of the assistant's personality/rules |
| `AZURE_SEARCH_ENDPOINT` / `_API_KEY` / `_INDEX` / `_INDEXER` | Search index and the indexer that fills it |
| `AZURE_SEARCH_SEMANTIC_CONFIGURATION` | Leave empty on the free tier (no semantic ranker) |
| `AZURE_STORAGE_ACCOUNT` / `_CONTAINER` / `_PREFIX` | Where uploads go (the indexer's data source) |
| `AZURE_STORAGE_CONNECTION_STRING` | Optional. If empty, uses Entra ID (`az login` locally, managed identity in Azure); your account needs **Storage Blob Data Contributor** |

## Testing

```bash
./scripts/verify.sh          # lint, 8 backend unit tests, frontend build (no Azure calls)
./scripts/verify.sh --e2e    # + live voice smoke test and Playwright on phone and desktop viewports
```

The Playwright suite drives a **real voice call**: Chrome uses a recorded spoken question
(`frontend/e2e/question.wav`) as its microphone and checks that the spoken answer, captions and sources appear.
Screenshots land in `frontend/test-results/screens/`. Regenerate the audio with
`cd backend && PYTHONPATH=. uv run python scripts/make_test_audio.py "Your question?" ../frontend/e2e/question.wav`.

## Project layout

```
backend/app/
  main.py         FastAPI app: /realtime, /api/documents, /api/config, serves the built UI
  realtime.py     browser ⇄ Azure realtime bridge (session control, allow-list, tool calls)
  tools.py        `search` tool over Azure AI Search (+ citations)
  documents.py    upload → Blob → run indexer; list with status; delete (also removes index chunks)
  config.py       settings from env
frontend/src/
  voice/          assistant-ui voice adapter, audio capture/playback, typed-chat adapter
  components/app/ call view, sources, documents tab
  App.tsx         layout and runtime
scripts/          dev.sh, verify.sh
docs/decisions/   architecture decisions (ADRs)
```

## Notes and limits

- **Free Azure AI Search tier:** an indexer can be started manually only once every 3 minutes, so a new upload can take
  up to ~3 minutes to become searchable (the server retries automatically). Indexes are capped at 50 MB.
- The caption of what *you* said comes from a separate transcription model and can be imperfect. The assistant itself
  hears your audio directly.
- **Not deployed yet.** Planned: Azure Container Apps (scale to zero, within the monthly free grant) with built-in
  Microsoft sign-in.

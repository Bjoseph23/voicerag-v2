"""Live end-to-end check: ask a question over /realtime, expect search + grounding + audio.

Usage: uv run python scripts/smoke_realtime.py [ws://localhost:8000/realtime] ["question"]
Prints time to first audio and the answer transcript. Exit code 1 on failure.
"""

import asyncio
import json
import sys
import time

import aiohttp

URL = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:8000/realtime"
QUESTION = sys.argv[2] if len(sys.argv) > 2 else "Which university did Bill study at?"


async def main() -> int:
    async with aiohttp.ClientSession() as s, s.ws_connect(URL) as ws:
        await ws.send_json({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": QUESTION}]}})
        t0 = time.perf_counter()
        await ws.send_json({"type": "response.create"})
        first_audio, transcript, sources, audio_bytes = None, "", [], 0
        async def loop():
            nonlocal first_audio, transcript, sources, audio_bytes
            async for m in ws:
                d = json.loads(m.data)
                t = d.get("type")
                if t == "error":
                    print("ERROR", d)
                    return
                if t == "extension.grounding":
                    sources = [x["title"] for x in d["sources"]]
                if t == "response.output_audio.delta":
                    first_audio = first_audio or time.perf_counter() - t0
                    audio_bytes += len(d["delta"]) * 3 // 4
                if t == "response.output_audio_transcript.delta":
                    transcript += d["delta"]
                if t == "response.done" and transcript:
                    return
        await asyncio.wait_for(loop(), 60)
        ok = bool(transcript and first_audio and sources)
        print(f"first audio: {first_audio and round(first_audio, 2)}s | audio: {audio_bytes // 1024} KB | sources: {sources}")
        print(f"answer: {transcript[:300]}")
        print("PASS" if ok else "FAIL")
        return 0 if ok else 1

sys.exit(asyncio.run(main()))

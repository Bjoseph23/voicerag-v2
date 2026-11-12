"""Create a spoken test question (WAV, 24 kHz mono PCM16) using the realtime model's own voice.

Used as a fake microphone for the Playwright voice test.
Usage: PYTHONPATH=. uv run python scripts/make_test_audio.py "Which university did Bill study at?" ../frontend/e2e/question.wav
"""

import asyncio
import base64
import json
import sys
import wave

import aiohttp

from app.config import get_settings  # noqa: E402  (run with PYTHONPATH=.)


async def main(text: str, out: str) -> None:
    endpoint, model, key = get_settings().realtime_target
    url = endpoint.replace("https://", "wss://") + "/openai/v1/realtime"
    tts = "You are a text-to-speech engine. Read the user's text aloud verbatim. Do not answer it, comment on it or add anything."
    pcm = bytearray()
    said = ""
    async with aiohttp.ClientSession() as s, s.ws_connect(url, params={"model": model}, headers={"api-key": key}) as ws:
        await ws.send_json({"type": "session.update", "session": {"type": "realtime", "instructions": tts, "audio": {"output": {"voice": "echo"}}}})
        item = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": f"Read this aloud: {text}"}]}
        await ws.send_json({"type": "conversation.item.create", "item": item})
        await ws.send_json({"type": "response.create"})
        async for m in ws:
            d = json.loads(m.data)
            if d["type"] == "response.output_audio.delta":
                pcm += base64.b64decode(d["delta"])
            elif d["type"] == "response.output_audio_transcript.done":
                said = d["transcript"]
            elif d["type"] == "response.done":
                break
    silence = bytes(24000 * 2)  # 1 s before, 3 s after so voice detection sees the end of speech
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(silence + bytes(pcm) + silence * 3)
    print(f"wrote {out}: {len(pcm) / 48000:.1f}s of speech: {said!r}")
    if text.lower().rstrip("?") not in said.lower():
        sys.exit("TTS did not say the expected text; rerun")


asyncio.run(main(sys.argv[1], sys.argv[2]))

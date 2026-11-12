"""Realtime middle tier: browser <-> this server <-> Azure OpenAI Realtime (GA v1 API).

The server owns the session: it sets the instructions, voice and tools, runs tool calls itself
(search over the user's documents) and hides those calls from the browser. The browser only
streams audio/text and receives audio, transcripts and `extension.grounding` (citations).
"""

import asyncio
import json
import logging
import time
from typing import Any

import aiohttp
from fastapi import WebSocket, WebSocketDisconnect

from .config import Settings
from .tools import RagTools

logger = logging.getLogger("voicerag.realtime")

# Message types the browser may send. Anything else is dropped.
CLIENT_ALLOWED = {
    "session.update",
    "input_audio_buffer.append",
    "input_audio_buffer.clear",
    "input_audio_buffer.commit",
    "conversation.item.create",
    "conversation.item.truncate",
    "response.create",
    "response.cancel",
}
# Server events about tool calls that the browser doesn't need to see.
HIDDEN_SERVER_EVENTS = {"response.function_call_arguments.delta", "response.function_call_arguments.done"}
TOOL_ITEM_TYPES = {"function_call", "function_call_output"}


def build_session(settings: Settings, tools: RagTools, client_session: dict[str, Any] | None = None) -> dict[str, Any]:
    """Server-controlled session config, merged with the few fields the browser may choose."""
    client_session = client_session or {}
    client_input = (client_session.get("audio") or {}).get("input") or {}
    audio_input: dict[str, Any] = {
        "turn_detection": {"type": "server_vad", "silence_duration_ms": 500, "prefix_padding_ms": 300},
        "transcription": {"model": "whisper-1"},
        "noise_reduction": {"type": "near_field"},
    }
    for key in ("turn_detection", "transcription", "noise_reduction"):
        if key in client_input:
            audio_input[key] = client_input[key]
    session: dict[str, Any] = {
        "type": "realtime",
        "instructions": settings.system_prompt,
        "audio": {"input": audio_input, "output": {"voice": settings.realtime_voice}},
        "tools": tools.schemas,
        "tool_choice": "auto",
    }
    modalities = client_session.get("output_modalities")
    if modalities in (["text"], ["audio"]):
        session["output_modalities"] = modalities
    return session


def sanitize_client_message(msg: dict[str, Any], settings: Settings, tools: RagTools) -> dict[str, Any] | None:
    """Return the message to forward upstream, or None to drop it."""
    t = msg.get("type")
    if t not in CLIENT_ALLOWED:
        return None
    if t == "session.update":
        return {"type": "session.update", "session": build_session(settings, tools, msg.get("session"))}
    if t == "conversation.item.create":
        item = msg.get("item") or {}
        # Only plain text/audio messages from the user, or earlier assistant text replayed as chat history.
        # The browser can't fake tool results or system messages.
        role, content = item.get("role"), item.get("content") or []
        allowed = {"user": {"input_text", "input_audio"}, "assistant": {"output_text"}}.get(role)
        if item.get("type") != "message" or not allowed or not content or any(c.get("type") not in allowed for c in content):
            return None
    if t == "response.create":
        # The browser can't override instructions/tools per response.
        return {"type": "response.create"}
    return msg


def strip_session(msg: dict[str, Any]) -> dict[str, Any]:
    """Copy of a session event without the prompt and tool definitions (the browser must not see them)."""
    session = msg.get("session")
    if not isinstance(session, dict):
        return msg
    return {**msg, "session": {**session, "instructions": "", "tools": []}}


class RealtimeBridge:
    """One browser connection bridged to one upstream realtime connection."""

    def __init__(self, settings: Settings, tools: RagTools, http: aiohttp.ClientSession):
        self.settings = settings
        self.tools = tools
        self.http = http
        self.tool_tasks: dict[str, list[asyncio.Task]] = {}  # response_id -> running tool calls

    async def run(self, client: WebSocket) -> None:
        endpoint, model, key = self.settings.realtime_target
        ws_url = endpoint.replace("https://", "wss://", 1) + "/openai/v1/realtime"
        async with self.http.ws_connect(ws_url, params={"model": model}, headers={"api-key": key}, heartbeat=20, max_msg_size=0) as upstream:
            await upstream.send_json({"type": "session.update", "session": build_session(self.settings, self.tools)})
            to_up = asyncio.create_task(self._client_to_upstream(client, upstream))
            to_client = asyncio.create_task(self._upstream_to_client(client, upstream))
            done, pending = await asyncio.wait({to_up, to_client}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                if (exc := task.exception()) and not isinstance(exc, (WebSocketDisconnect, asyncio.CancelledError)):
                    logger.warning("bridge ended with %r", exc)

    async def _client_to_upstream(self, client: WebSocket, upstream: aiohttp.ClientWebSocketResponse) -> None:
        while True:
            raw = await client.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            out = sanitize_client_message(msg, self.settings, self.tools)
            if out is None:
                continue
            # Audio chunks are the hot path: forward the original string untouched.
            await upstream.send_str(raw if out is msg else json.dumps(out))

    async def _upstream_to_client(self, client: WebSocket, upstream: aiohttp.ClientWebSocketResponse) -> None:
        async for m in upstream:
            if m.type != aiohttp.WSMsgType.TEXT:
                if m.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                    break
                continue
            msg = json.loads(m.data)
            out = await self.handle_server_event(msg, client, upstream)
            if out is not None:
                await client.send_text(m.data if out is msg else json.dumps(out))
        await client.close()

    async def handle_server_event(self, msg: dict[str, Any], client: WebSocket, upstream: Any) -> dict[str, Any] | None:
        """Process one upstream event. Returns what to forward to the browser (None = hide).

        Returning the same object means "forward the raw upstream text unchanged" (fast path), so any
        change MUST return a new dict, never mutate `msg` in place.
        """
        t = msg.get("type", "")
        if t in HIDDEN_SERVER_EVENTS:
            return None
        if t in ("session.created", "session.updated"):
            return strip_session(msg)
        item = msg.get("item") or {}
        if t.startswith("conversation.item.") and item.get("type") in TOOL_ITEM_TYPES:
            return None
        if t == "response.output_item.added" and item.get("type") == "function_call":
            return None
        if t == "response.output_item.done" and item.get("type") == "function_call":
            task = asyncio.create_task(self._run_tool(item, client, upstream))
            self.tool_tasks.setdefault(msg.get("response_id", ""), []).append(task)
            return None
        if t == "response.done":
            response = msg.get("response") or {}
            tasks = self.tool_tasks.pop(response.get("id", ""), [])
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
                await upstream.send_json({"type": "response.create"})  # let the model answer with the tool results
            output = response.get("output")
            if isinstance(output, list) and any(o.get("type") in TOOL_ITEM_TYPES for o in output):
                return {**msg, "response": {**response, "output": [o for o in output if o.get("type") not in TOOL_ITEM_TYPES]}}
            return msg
        return msg

    async def _run_tool(self, item: dict[str, Any], client: WebSocket, upstream: Any) -> None:
        name, call_id = item.get("name", ""), item.get("call_id", "")
        fn = self.tools.get(name)
        started = time.perf_counter()
        try:
            args = json.loads(item.get("arguments") or "{}")
            result = await fn(args) if fn else None
            output = result.for_model if result else json.dumps({"error": f"unknown tool {name}"})
        except Exception as exc:  # never let one tool failure kill the voice session
            logger.exception("tool %s failed", name)
            result, output = None, json.dumps({"error": str(exc)})
        await upstream.send_json({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": call_id, "output": output}})
        logger.info("tool %s took %d ms", name, (time.perf_counter() - started) * 1000)
        if result and result.for_client is not None:
            await client.send_text(json.dumps({"type": "extension.grounding", "response_id": item.get("id"), **result.for_client}))

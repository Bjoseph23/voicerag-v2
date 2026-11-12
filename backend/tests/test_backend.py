import asyncio
import json

import pytest

from app.config import Settings
from app.documents import parent_id_for, safe_filename
from app.realtime import RealtimeBridge, build_session, sanitize_client_message
from app.tools import RagTools, ToolResult


class FakeTools(RagTools):
    def __init__(self):
        self.s = Settings(_env_file=None)
        self.calls = []

    def get(self, name):
        async def fn(args):
            self.calls.append((name, args))
            return ToolResult("Document: cv.pdf\ntext", {"sources": [{"chunk_id": "c1", "title": "cv.pdf", "chunk": "text"}]})
        return fn if name == "search" else None


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, m):
        self.sent.append(m)

    async def send_text(self, t):
        self.sent.append(json.loads(t))


def settings():
    return Settings(_env_file=None, system_prompt="SECRET PROMPT", realtime_voice="verse")


def test_session_is_server_controlled():
    s = build_session(settings(), FakeTools(), {"instructions": "hacked", "tools": [], "audio": {"input": {"turn_detection": {"type": "semantic_vad"}}}})
    assert s["instructions"] == "SECRET PROMPT"
    assert [t["name"] for t in s["tools"]] == ["search"]
    assert s["audio"]["output"]["voice"] == "verse"
    assert s["audio"]["input"]["turn_detection"] == {"type": "semantic_vad"}
    assert s["type"] == "realtime"


def test_client_cannot_inject_tool_results_or_override():
    t, st = FakeTools(), settings()
    assert sanitize_client_message({"type": "conversation.item.create", "item": {"type": "function_call_output"}}, st, t) is None
    assert sanitize_client_message({"type": "conversation.item.create", "item": {"type": "message", "role": "system"}}, st, t) is None
    assert sanitize_client_message({"type": "response.create", "response": {"instructions": "x"}}, st, t) == {"type": "response.create"}
    assert sanitize_client_message({"type": "session.delete"}, st, t) is None
    hist = {"type": "conversation.item.create", "item": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "hi"}]}}
    assert sanitize_client_message(hist, st, t) is hist
    fake = {"type": "conversation.item.create", "item": {"type": "message", "role": "assistant", "content": [{"type": "function_call"}]}}
    assert sanitize_client_message(fake, st, t) is None
    audio = {"type": "input_audio_buffer.append", "audio": "AAAA"}
    assert sanitize_client_message(audio, st, t) is audio  # hot path forwarded untouched


def test_tool_flow_hidden_from_client_and_grounding_sent():
    async def run():
        tools, client, upstream = FakeTools(), FakeWS(), FakeWS()
        b = RealtimeBridge(settings(), tools, None)
        call = {"type": "function_call", "id": "i1", "call_id": "call1", "name": "search", "arguments": '{"query": "uni"}'}
        assert await b.handle_server_event({"type": "response.output_item.added", "item": call}, client, upstream) is None
        assert await b.handle_server_event({"type": "response.output_item.done", "response_id": "r1", "item": call}, client, upstream) is None
        done = await b.handle_server_event({"type": "response.done", "response": {"id": "r1", "output": [call, {"type": "message"}]}}, client, upstream)
        assert done["response"]["output"] == [{"type": "message"}]  # new object, so it gets re-serialized
        types = [m["type"] for m in upstream.sent]
        assert types == ["conversation.item.create", "response.create"]
        assert [m["type"] for m in client.sent] == ["extension.grounding"]
        assert client.sent[0]["sources"][0]["title"] == "cv.pdf"
        assert tools.calls == [("search", {"query": "uni"})]
    asyncio.run(run())


def test_session_events_strip_prompt():
    async def run():
        b = RealtimeBridge(settings(), FakeTools(), None)
        msg = {"type": "session.updated", "session": {"instructions": "SECRET PROMPT", "tools": [1]}}
        out = await b.handle_server_event(msg, FakeWS(), FakeWS())
        # Must be a NEW object: returning `msg` itself means the raw (unstripped) text is forwarded.
        assert out is not msg
        assert out["session"]["instructions"] == "" and out["session"]["tools"] == []
        assert "SECRET" not in json.dumps(out)
    asyncio.run(run())


@pytest.mark.parametrize("raw,expected", [("../../etc/passwd", "passwd"), ("C:\\x\\My CV.pdf", "My CV.pdf"), ("a<b>.md", "a_b_.md")])
def test_safe_filename(raw, expected):
    assert safe_filename(raw) == expected


def test_parent_id_matches_indexer_key():
    url = "https://softwizfoundryst.blob.core.windows.net/azure-search/folder1/Bill_Mageni_CV.pdf"
    assert parent_id_for(url) == "aHR0cHM6Ly9zb2Z0d2l6Zm91bmRyeXN0LmJsb2IuY29yZS53aW5kb3dzLm5ldC9henVyZS1zZWFyY2gvZm9sZGVyMS9CaWxsX01hZ2VuaV9DVi5wZGY1"

"""VoiceRAG v2 backend: realtime voice bridge + document management + serves the built frontend."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import aiohttp
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError
from azure.search.documents.aio import SearchClient
from fastapi import FastAPI, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .documents import ALLOWED_EXTENSIONS, DocumentStore, safe_filename
from .realtime import RealtimeBridge
from .tools import RagTools

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("azure").setLevel(logging.WARNING)
logger = logging.getLogger("voicerag")

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    app.state.http = aiohttp.ClientSession()
    app.state.search = SearchClient(s.azure_search_endpoint, s.azure_search_index, AzureKeyCredential(s.azure_search_api_key))
    app.state.tools = RagTools(s, app.state.search)
    app.state.docs = DocumentStore(s, app.state.search) if (s.azure_storage_account or s.azure_storage_connection_string) else None
    try:  # warm up the search connection (TLS + auth) so the first voice question isn't slower
        await (await app.state.search.search(search_text="warmup", top=1)).get_count()
    except Exception as exc:
        logger.warning("search warmup failed: %s", exc)
    endpoint, model, _ = s.realtime_target
    logger.info("realtime provider=%s model=%s", s.realtime_provider, model)
    yield
    await app.state.http.close()
    await app.state.search.close()
    if app.state.docs:
        await app.state.docs.close()


app = FastAPI(title="VoiceRAG v2", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/api/config")
async def config() -> dict:
    s = get_settings()
    _, model, _ = s.realtime_target
    return {"provider": s.realtime_provider, "model": model, "voice": s.realtime_voice, "allowed_extensions": sorted(ALLOWED_EXTENSIONS), "max_upload_mb": s.max_upload_mb}


@app.websocket("/realtime")
async def realtime(ws: WebSocket) -> None:
    await ws.accept()
    bridge = RealtimeBridge(get_settings(), ws.app.state.tools, ws.app.state.http)
    try:
        await bridge.run(ws)
    except WebSocketDisconnect:
        pass
    except aiohttp.WSServerHandshakeError as exc:
        logger.error("upstream realtime handshake failed: %s %s", exc.status, exc.message)
        await ws.close(code=1011, reason="Upstream realtime connection failed")


def _docs(request: Request) -> DocumentStore:
    store = request.app.state.docs
    if store is None:
        raise HTTPException(503, "Document storage is not configured (AZURE_STORAGE_ACCOUNT)")
    return store


def _azure_error(exc: Exception) -> HTTPException:
    logger.exception("azure call failed")
    msg = getattr(exc, "message", None) or str(exc)
    if "AuthorizationPermissionMismatch" in msg or "AuthenticationFailed" in msg or "DefaultAzureCredential failed" in msg or "AADSTS" in msg:
        return HTTPException(502, "Storage access denied. Run `az login` or set AZURE_STORAGE_CONNECTION_STRING.")
    return HTTPException(502, f"Azure error: {msg[:300]}")


@app.get("/api/documents")
async def list_documents(request: Request) -> dict:
    try:
        return await _docs(request).list()
    except HTTPException:
        raise
    except Exception as exc:
        raise _azure_error(exc) from exc


@app.post("/api/documents")
async def upload_documents(request: Request, files: list[UploadFile]) -> dict:
    store = _docs(request)
    limit = get_settings().max_upload_mb * 1024 * 1024
    uploaded = []
    for f in files:
        name = safe_filename(f.filename or "")
        if not name or Path(name).suffix.lower() not in ALLOWED_EXTENSIONS:
            raise HTTPException(400, f"Unsupported file type: {f.filename}")
        data = await f.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, f"{name} is over {get_settings().max_upload_mb} MB")
        try:
            uploaded.append(await store.upload(name, data, f.content_type))
        except Exception as exc:
            raise _azure_error(exc) from exc
    return {"uploaded": uploaded}


@app.delete("/api/documents/{name}")
async def delete_document(request: Request, name: str) -> dict:
    safe = safe_filename(name)
    if safe != name:
        raise HTTPException(400, "Invalid file name")
    try:
        await _docs(request).delete(safe)
    except Exception as exc:
        raise _azure_error(exc) from exc
    return {"deleted": safe}


@app.post("/api/documents/reindex")
async def reindex(request: Request) -> dict:
    try:
        await _docs(request).trigger_indexer()
    except HttpResponseError as exc:
        raise _azure_error(exc) from exc
    return {"ok": True}


# Built frontend (single container in production). In dev, Vite serves the UI and proxies here.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str) -> FileResponse:
        file = (FRONTEND_DIST / path).resolve()
        if path and file.is_file() and FRONTEND_DIST in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})

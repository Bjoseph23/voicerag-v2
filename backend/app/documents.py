"""Documents: upload to Blob Storage, let the Azure AI Search indexer chunk + embed them, list, delete."""

import asyncio
import base64
import logging
import re
from datetime import UTC, datetime
from typing import Any

from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from azure.search.documents.aio import SearchClient
from azure.search.documents.indexes.aio import SearchIndexerClient
from azure.storage.blob.aio import BlobServiceClient, ContainerClient

from .config import Settings

logger = logging.getLogger("voicerag.documents")

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".md", ".txt", ".html", ".htm", ".json", ".csv"}
SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def safe_filename(name: str) -> str:
    """Strip folders and odd characters so a file can't escape the upload prefix."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    base = SAFE_NAME.sub("_", base).strip(" .")
    return base[:120]


def parent_id_for(blob_url: str) -> str:
    """The indexer's document key: URL-token base64 of the blob path (no padding + padding count)."""
    encoded = base64.urlsafe_b64encode(blob_url.encode()).decode()
    stripped = encoded.rstrip("=")
    return stripped + str(len(encoded) - len(stripped))


class DocumentStore:
    def __init__(self, settings: Settings, search_client: SearchClient):
        self.s = settings
        self.search = search_client
        self.indexer = SearchIndexerClient(settings.azure_search_endpoint, AzureKeyCredential(settings.azure_search_api_key))
        self._rerun: asyncio.Task | None = None
        if settings.azure_storage_connection_string:
            service = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string, retry_total=1)
        else:
            from azure.identity.aio import DefaultAzureCredential

            # Locally this uses your `az login`; in Azure, the app's managed identity. Skip slow probes locally.
            cred = DefaultAzureCredential(exclude_interactive_browser_credential=True, exclude_visual_studio_code_credential=True)
            service = BlobServiceClient(f"https://{settings.azure_storage_account}.blob.core.windows.net", credential=cred, retry_total=1)
        self.container: ContainerClient = service.get_container_client(settings.azure_storage_container)

    async def close(self) -> None:
        await self.container.close()
        await self.indexer.close()

    def blob_name(self, filename: str) -> str:
        return f"{self.s.azure_storage_prefix}{filename}"

    async def indexer_status(self) -> dict[str, Any]:
        st = await self.indexer.get_indexer_status(self.s.azure_search_indexer)
        last = st.last_result
        return {
            # st.status == "running" only means the indexer is enabled/healthy; a run in progress is lastResult "inProgress".
            "running": last is not None and last.status == "inProgress",
            "last_status": last.status if last else None,
            "last_end": last.end_time.isoformat() if last and last.end_time else None,
            "errors": [{"key": e.key, "message": e.error_message} for e in (last.errors if last else [])][:20],
        }

    async def list(self) -> dict[str, Any]:
        status = await self.indexer_status()
        last_end = datetime.fromisoformat(status["last_end"]) if status["last_end"] else None
        failed = {e["key"] or "" for e in status["errors"]}
        docs = []
        async for b in self.container.list_blobs(name_starts_with=self.s.azure_storage_prefix):
            name = b.name[len(self.s.azure_storage_prefix):]
            if not name or "/" in name:
                continue
            modified: datetime = b.last_modified
            if any(name in k for k in failed):
                state = "error"
            elif last_end and modified <= last_end and not status["running"]:
                state = "ready"
            else:
                state = "indexing"
            docs.append({"name": name, "size": b.size, "modified": modified.isoformat(), "state": state})
        docs.sort(key=lambda d: d["modified"], reverse=True)
        return {"documents": docs, "indexer": status}

    async def upload(self, filename: str, data: bytes, content_type: str | None) -> dict[str, Any]:
        from azure.storage.blob import ContentSettings

        blob = self.container.get_blob_client(self.blob_name(filename))
        await blob.upload_blob(data, overwrite=True, content_settings=ContentSettings(content_type=content_type or "application/octet-stream"))
        await self.trigger_indexer()
        return {"name": filename, "size": len(data), "modified": datetime.now(UTC).isoformat(), "state": "indexing"}

    async def delete(self, filename: str) -> None:
        blob = self.container.get_blob_client(self.blob_name(filename))
        url = blob.url
        try:
            await blob.delete_blob()
        except ResourceNotFoundError:
            pass
        # The data source has no deletion detection, so remove this file's chunks from the index ourselves.
        pid = parent_id_for(url)
        keys = []
        results = await self.search.search(search_text="*", filter=f"parent_id eq '{pid}'", select=[self.s.azure_search_identifier_field], top=1000)
        async for r in results:
            keys.append({self.s.azure_search_identifier_field: r[self.s.azure_search_identifier_field]})
        if keys:
            await self.search.delete_documents(keys)
        logger.info("deleted %s (%d chunks)", filename, len(keys))

    async def trigger_indexer(self) -> None:
        """Run the indexer now; if Azure says "busy" or "too soon", retry in the background until it accepts."""
        try:
            await self.indexer.run_indexer(self.s.azure_search_indexer)
        except HttpResponseError as exc:
            if not _is_retryable(exc):
                raise
            logger.info("indexer busy/throttled, will retry: %s", (exc.message or "")[:100])
            if self._rerun is None or self._rerun.done():
                self._rerun = asyncio.create_task(self._rerun_when_allowed())

    async def _rerun_when_allowed(self) -> None:
        for _ in range(40):  # ~10 minutes
            await asyncio.sleep(15)
            try:
                await self.indexer.run_indexer(self.s.azure_search_indexer)
                logger.info("indexer run started (deferred)")
                return
            except HttpResponseError as exc:
                if not _is_retryable(exc):
                    logger.warning("indexer rerun failed: %s", exc.message)
                    return


def _is_retryable(exc: HttpResponseError) -> bool:
    # 409 = already running. Free tier: "On-demand indexer invocation is permitted every 180 seconds" (429/403).
    return exc.status_code in (409, 429) or "permitted every" in (exc.message or "")

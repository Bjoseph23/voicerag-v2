"""RAG tool the realtime model can call. It runs on the server; the browser only receives the citations."""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from azure.search.documents.aio import SearchClient
from azure.search.documents.models import VectorizableTextQuery

from .config import Settings

logger = logging.getLogger("voicerag.tools")

SEARCH_SCHEMA = {
    "type": "function",
    "name": "search",
    "description": "Search the knowledge base (the user's documents). Returns passages wrapped in <result document=...> "
    "tags. Translate the query to English if needed.",
    "parameters": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "Search query"}},
        "required": ["query"],
        "additionalProperties": False,
    },
}


CITED_RESULTS = 3


@dataclass
class ToolResult:
    """`for_model` goes back to the model; `for_client` (if set) is sent to the browser."""

    for_model: str
    for_client: dict[str, Any] | None = None


ToolFn = Callable[[dict[str, Any]], Awaitable[ToolResult]]


class RagTools:
    def __init__(self, settings: Settings, search_client: SearchClient):
        self.s = settings
        self.client = search_client

    @property
    def schemas(self) -> list[dict[str, Any]]:
        return [SEARCH_SCHEMA]

    def get(self, name: str) -> ToolFn | None:
        return {"search": self.search}.get(name)

    async def search(self, args: dict[str, Any]) -> ToolResult:
        s = self.s
        query = str(args.get("query", "")).strip()
        logger.info("search: %r", query)
        vector_queries = []
        if s.azure_search_use_vector_query:
            vector_queries.append(VectorizableTextQuery(text=query, k_nearest_neighbors=50, fields=s.azure_search_embedding_field))
        results = await self.client.search(
            search_text=query,
            query_type="semantic" if s.azure_search_semantic_configuration else "simple",
            semantic_configuration_name=s.azure_search_semantic_configuration or None,
            top=5,
            vector_queries=vector_queries,
            select=[s.azure_search_identifier_field, s.azure_search_title_field, s.azure_search_content_field],
        )
        out, sources = [], []
        async for r in results:
            src = {"chunk_id": r[s.azure_search_identifier_field], "title": r.get(s.azure_search_title_field) or "", "chunk": r[s.azure_search_content_field]}
            sources.append(src)
            out.append(f"<result document=\"{src['title']}\">\n{src['chunk']}\n</result>")
        # Citations go straight to the browser (top results), so the model needs no second tool call before speaking.
        return ToolResult("\n\n".join(out) or "No results found.", {"sources": sources[:CITED_RESULTS]} if sources else None)


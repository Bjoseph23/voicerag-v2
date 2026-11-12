"""App settings, read from environment variables (and backend/.env for local dev)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

DEFAULT_SYSTEM_PROMPT = """
You are a friendly, upbeat voice assistant for the user's personal knowledge base (their uploaded documents).
Only answer questions using information you found with the 'search' tool. Do not answer from your own knowledge.
The user is listening, so keep answers short and natural: one or two sentences unless they ask for more.
Never read out file names, IDs or other technical identifiers.
Always follow these steps:
1. ALWAYS call the 'search' tool before answering any question, even if you think you know the answer.
2. Answer only from the search results. If the answer isn't there, say you don't know.
""".strip()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # Realtime model: "azure" = AZURE_OPENAI_* (gpt-realtime-mini), "foundry" = FOUNDRY_* (gpt-realtime)
    realtime_provider: Literal["azure", "foundry"] = "azure"
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_realtime_deployment: str = "gpt-realtime-mini"
    foundry_endpoint: str = ""
    foundry_api_key: str = ""
    foundry_realtime_deployment: str = "gpt-realtime"
    realtime_voice: str = "alloy"
    system_prompt: str = DEFAULT_SYSTEM_PROMPT

    # Azure AI Search (index built by an indexer with integrated vectorization)
    azure_search_endpoint: str = ""
    azure_search_api_key: str = ""
    azure_search_index: str = "rag-1"
    azure_search_indexer: str = "rag-1-indexer"
    azure_search_semantic_configuration: str = ""
    azure_search_identifier_field: str = "chunk_id"
    azure_search_content_field: str = "chunk"
    azure_search_title_field: str = "title"
    azure_search_embedding_field: str = "text_vector"
    azure_search_use_vector_query: bool = True

    # Blob storage the indexer reads from. Connection string optional; otherwise Entra ID (az login / managed identity).
    azure_storage_account: str = ""
    azure_storage_container: str = "azure-search"
    azure_storage_prefix: str = "folder1/"
    azure_storage_connection_string: str = ""

    max_upload_mb: int = 25

    @property
    def realtime_target(self) -> tuple[str, str, str]:
        """(https endpoint, deployment/model, api key) for the selected provider."""
        if self.realtime_provider == "foundry":
            return self.foundry_endpoint.rstrip("/"), self.foundry_realtime_deployment, self.foundry_api_key
        return self.azure_openai_endpoint.rstrip("/"), self.azure_openai_realtime_deployment, self.azure_openai_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()

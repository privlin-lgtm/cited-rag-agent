"""Protocols the concrete embedding model and vector store implementations satisfy.

Depending on these instead of importing sentence_transformers/chromadb/anthropic directly
lets any layer be swapped (a different embedding model, a different vector database) without
touching the code that calls it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


@dataclass
class RetrievedChunk:
    text: str
    source: str


class VectorStore(Protocol):
    def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
        documents: list[str],
    ) -> None: ...

    def delete_by_source(self, source: str) -> None: ...

    def query(self, embedding: list[float], top_k: int) -> list[RetrievedChunk]: ...

    def list_sources(self) -> list[str]: ...

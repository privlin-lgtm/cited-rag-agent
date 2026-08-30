"""High-level facade combining an Embedder and a VectorStore."""

from __future__ import annotations

from rag.ingest import Chunk
from rag.interfaces import Embedder, RetrievedChunk, VectorStore


class KnowledgeBase:
    def __init__(self, embedder: Embedder, store: VectorStore) -> None:
        self._embedder = embedder
        self._store = store

    def add_chunks(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        for source in sorted({c.source for c in chunks}):
            self._store.delete_by_source(source)

        embeddings = self._embedder.embed([c.text for c in chunks])
        ids = [f"{c.source}::{c.chunk_index}" for c in chunks]
        metadatas = [{"source": c.source, "chunk_index": c.chunk_index} for c in chunks]
        documents = [c.text for c in chunks]
        self._store.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=documents)

    def retrieve(self, question: str, top_k: int = 5) -> list[RetrievedChunk]:
        if top_k <= 0:
            raise ValueError(f"top_k must be positive, got {top_k}")
        embedding = self._embedder.embed([question])[0]
        return self._store.query(embedding, top_k)

    def list_sources(self) -> list[str]:
        return self._store.list_sources()

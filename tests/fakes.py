"""In-memory fakes for the Embedder/VectorStore protocols, used across the test suite."""

from __future__ import annotations

from rag.interfaces import RetrievedChunk


class FakeEmbedder:
    """Returns a fixed-length zero vector per text; values don't matter for these tests."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] for _ in texts]


class FakeVectorStore:
    def __init__(self, initial_chunks: list[RetrievedChunk] | None = None) -> None:
        self.upserted: list[dict] = []
        self.deleted_sources: list[str] = []
        self._chunks = list(initial_chunks or [])

    def upsert(self, ids, embeddings, metadatas, documents) -> None:
        self.upserted.append(
            {"ids": ids, "embeddings": embeddings, "metadatas": metadatas, "documents": documents}
        )
        self._chunks = [
            RetrievedChunk(text=doc, source=meta["source"])
            for doc, meta in zip(documents, metadatas)
        ]

    def delete_by_source(self, source: str) -> None:
        self.deleted_sources.append(source)

    def query(self, embedding, top_k: int) -> list[RetrievedChunk]:
        return self._chunks[:top_k]

    def list_sources(self) -> list[str]:
        return sorted({c.source for c in self._chunks})

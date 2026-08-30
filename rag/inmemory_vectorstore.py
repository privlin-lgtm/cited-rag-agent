"""Pure-Python, dependency-free VectorStore implementation.

This exists to prove the VectorStore protocol in interfaces.py is genuinely swappable, not just
declared: it has zero third-party dependencies (no chromadb, no disk I/O), yet satisfies the same
contract as ChromaVectorStore -- see tests/test_vectorstore_contract.py, which runs the identical
test suite against both implementations. It also doubles as a fast, ephemeral backend for --store
memory (no persistence, cleared when the process exits).
"""

from __future__ import annotations

import math

from rag.interfaces import RetrievedChunk


class InMemoryVectorStore:
    def __init__(self) -> None:
        self._ids: list[str] = []
        self._embeddings: list[list[float]] = []
        self._metadatas: list[dict] = []
        self._documents: list[str] = []

    def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
        documents: list[str],
    ) -> None:
        for id_, embedding, metadata, document in zip(ids, embeddings, metadatas, documents):
            if id_ in self._ids:
                index = self._ids.index(id_)
                self._embeddings[index] = embedding
                self._metadatas[index] = metadata
                self._documents[index] = document
            else:
                self._ids.append(id_)
                self._embeddings.append(embedding)
                self._metadatas.append(metadata)
                self._documents.append(document)

    def delete_by_source(self, source: str) -> None:
        keep = [i for i, meta in enumerate(self._metadatas) if meta["source"] != source]
        self._ids = [self._ids[i] for i in keep]
        self._embeddings = [self._embeddings[i] for i in keep]
        self._metadatas = [self._metadatas[i] for i in keep]
        self._documents = [self._documents[i] for i in keep]

    def query(self, embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        scored = sorted(
            range(len(self._embeddings)),
            key=lambda i: _cosine_similarity(embedding, self._embeddings[i]),
            reverse=True,
        )
        return [
            RetrievedChunk(text=self._documents[i], source=self._metadatas[i]["source"])
            for i in scored[:top_k]
        ]

    def list_sources(self) -> list[str]:
        return sorted({meta["source"] for meta in self._metadatas})


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

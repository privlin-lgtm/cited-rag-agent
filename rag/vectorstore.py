"""Persistent local vector store backed by ChromaDB, implementing the VectorStore protocol."""

from __future__ import annotations

import logging
from pathlib import Path

import chromadb

from rag.config import PERSIST_DIR
from rag.interfaces import RetrievedChunk

logger = logging.getLogger(__name__)


class ChromaVectorStore:
    def __init__(
        self, collection_name: str = "knowledge_base", persist_dir: Path = PERSIST_DIR
    ) -> None:
        self._collection_name = collection_name
        self._persist_dir = persist_dir
        self._collection = None

    @property
    def collection(self):
        if self._collection is None:
            logger.debug(
                "opening Chroma collection %r at %s", self._collection_name, self._persist_dir
            )
            client = chromadb.PersistentClient(path=str(self._persist_dir))
            self._collection = client.get_or_create_collection(self._collection_name)
        return self._collection

    def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
        documents: list[str],
    ) -> None:
        self.collection.upsert(
            ids=ids, embeddings=embeddings, metadatas=metadatas, documents=documents
        )

    def delete_by_source(self, source: str) -> None:
        self.collection.delete(where={"source": source})

    def query(self, embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        result = self.collection.query(query_embeddings=[embedding], n_results=top_k)
        return [
            RetrievedChunk(text=doc, source=meta["source"])
            for doc, meta in zip(result["documents"][0], result["metadatas"][0])
        ]

    def list_sources(self) -> list[str]:
        metadatas = self.collection.get(include=["metadatas"])["metadatas"]
        return sorted({m["source"] for m in metadatas})

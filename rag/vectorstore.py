"""Persistent local vector store backed by ChromaDB."""

from __future__ import annotations

from pathlib import Path

import chromadb

from rag.embeddings import embed
from rag.ingest import Chunk

PERSIST_DIR = Path(__file__).resolve().parent.parent / ".chroma"
COLLECTION_NAME = "knowledge_base"


def get_collection():
    client = chromadb.PersistentClient(path=str(PERSIST_DIR))
    return client.get_or_create_collection(COLLECTION_NAME)


def add_chunks(chunks: list[Chunk]) -> None:
    if not chunks:
        return
    collection = get_collection()
    for source in sorted({c.source for c in chunks}):
        collection.delete(where={"source": source})
    embeddings = embed([c.text for c in chunks])
    ids = [f"{c.source}::{c.chunk_index}" for c in chunks]
    metadatas = [{"source": c.source, "chunk_index": c.chunk_index} for c in chunks]
    documents = [c.text for c in chunks]
    collection.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=documents)


def query(question: str, top_k: int = 5):
    collection = get_collection()
    question_embedding = embed([question])[0]
    return collection.query(query_embeddings=[question_embedding], n_results=top_k)


def list_sources() -> list[str]:
    collection = get_collection()
    metadatas = collection.get(include=["metadatas"])["metadatas"]
    return sorted({m["source"] for m in metadatas})

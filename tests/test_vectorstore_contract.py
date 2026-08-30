"""Contract tests run against every VectorStore implementation.

This is what proves the VectorStore protocol in interfaces.py is genuinely swappable rather than
just declared: the exact same behavioral suite runs against both ChromaVectorStore (real, on-disk
Chroma) and InMemoryVectorStore (pure Python, zero dependencies). Both must pass identically.

No embedding model is involved -- these tests pass raw float vectors directly, since embedding
happens in KnowledgeBase, not in the store itself (see rag/knowledge_base.py).
"""

from __future__ import annotations

import pytest

from rag.inmemory_vectorstore import InMemoryVectorStore
from rag.vectorstore import ChromaVectorStore


def _make_chroma(tmp_path):
    return ChromaVectorStore(collection_name="contract-test", persist_dir=tmp_path / "chroma")


def _make_memory(tmp_path):
    return InMemoryVectorStore()


@pytest.fixture(params=[_make_chroma, _make_memory], ids=["chroma", "memory"])
def store(request, tmp_path):
    return request.param(tmp_path)


def test_upsert_then_query_returns_the_chunk(store):
    store.upsert(
        ids=["a::0"],
        embeddings=[[1.0, 0.0]],
        metadatas=[{"source": "a", "chunk_index": 0}],
        documents=["hello"],
    )

    results = store.query([1.0, 0.0], top_k=1)

    assert len(results) == 1
    assert results[0].text == "hello"
    assert results[0].source == "a"


def test_query_ranks_the_more_similar_embedding_first(store):
    store.upsert(
        ids=["a::0", "b::0"],
        embeddings=[[1.0, 0.0], [0.0, 1.0]],
        metadatas=[{"source": "a", "chunk_index": 0}, {"source": "b", "chunk_index": 0}],
        documents=["matches", "unrelated"],
    )

    results = store.query([1.0, 0.0], top_k=2)

    assert results[0].text == "matches"


def test_query_respects_top_k(store):
    store.upsert(
        ids=["a::0", "b::0", "c::0"],
        embeddings=[[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]],
        metadatas=[
            {"source": "a", "chunk_index": 0},
            {"source": "b", "chunk_index": 0},
            {"source": "c", "chunk_index": 0},
        ],
        documents=["one", "two", "three"],
    )

    assert len(store.query([1.0, 0.0], top_k=2)) == 2


def test_delete_by_source_removes_only_that_sources_chunks(store):
    store.upsert(
        ids=["a::0", "b::0"],
        embeddings=[[1.0, 0.0], [0.0, 1.0]],
        metadatas=[{"source": "a", "chunk_index": 0}, {"source": "b", "chunk_index": 0}],
        documents=["gone", "stays"],
    )

    store.delete_by_source("a")

    assert store.list_sources() == ["b"]


def test_delete_by_source_on_unknown_source_is_a_no_op(store):
    store.upsert(
        ids=["a::0"],
        embeddings=[[1.0, 0.0]],
        metadatas=[{"source": "a", "chunk_index": 0}],
        documents=["stays"],
    )

    store.delete_by_source("does-not-exist")

    assert store.list_sources() == ["a"]


def test_upsert_with_existing_id_replaces_rather_than_duplicates(store):
    store.upsert(
        ids=["a::0"],
        embeddings=[[1.0, 0.0]],
        metadatas=[{"source": "a", "chunk_index": 0}],
        documents=["old"],
    )
    store.upsert(
        ids=["a::0"],
        embeddings=[[1.0, 0.0]],
        metadatas=[{"source": "a", "chunk_index": 0}],
        documents=["new"],
    )

    results = store.query([1.0, 0.0], top_k=10)

    assert len(results) == 1
    assert results[0].text == "new"


def test_list_sources_on_empty_store_is_empty(store):
    assert store.list_sources() == []


def test_query_on_empty_store_returns_no_results(store):
    assert store.query([1.0, 0.0], top_k=5) == []

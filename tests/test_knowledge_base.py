"""Unit tests for the KnowledgeBase facade: add/retrieve orchestration and edge cases."""

import pytest

from rag.ingest import Chunk
from rag.interfaces import RetrievedChunk
from rag.knowledge_base import KnowledgeBase

from .fakes import FakeEmbedder, FakeVectorStore


def test_add_chunks_with_empty_list_does_not_touch_the_store():
    store = FakeVectorStore()
    kb = KnowledgeBase(FakeEmbedder(), store)

    kb.add_chunks([])

    assert store.upserted == []
    assert store.deleted_sources == []


def test_add_chunks_deletes_stale_entries_for_each_source_before_upserting():
    store = FakeVectorStore()
    kb = KnowledgeBase(FakeEmbedder(), store)
    chunks = [
        Chunk(text="a", source="notes.md", chunk_index=0),
        Chunk(text="b", source="notes.md", chunk_index=1),
        Chunk(text="c", source="other.md", chunk_index=0),
    ]

    kb.add_chunks(chunks)

    assert store.deleted_sources == ["notes.md", "other.md"]
    assert len(store.upserted) == 1
    assert store.upserted[0]["ids"] == ["notes.md::0", "notes.md::1", "other.md::0"]


def test_retrieve_rejects_zero_top_k():
    kb = KnowledgeBase(FakeEmbedder(), FakeVectorStore())
    with pytest.raises(ValueError):
        kb.retrieve("question", top_k=0)


def test_retrieve_rejects_negative_top_k():
    kb = KnowledgeBase(FakeEmbedder(), FakeVectorStore())
    with pytest.raises(ValueError):
        kb.retrieve("question", top_k=-3)


def test_retrieve_on_empty_store_returns_no_chunks():
    kb = KnowledgeBase(FakeEmbedder(), FakeVectorStore())
    assert kb.retrieve("anything") == []


def test_retrieve_returns_chunks_from_the_store():
    chunk = RetrievedChunk(text="hello", source="notes.md")
    kb = KnowledgeBase(FakeEmbedder(), FakeVectorStore([chunk]))
    assert kb.retrieve("anything") == [chunk]


def test_list_sources_on_empty_store_returns_empty_list():
    kb = KnowledgeBase(FakeEmbedder(), FakeVectorStore())
    assert kb.list_sources() == []

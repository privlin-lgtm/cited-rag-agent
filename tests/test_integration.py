"""End-to-end tests against the REAL embedder and vector store -- not fakes.

Marked `integration` and excluded from the default fast run (`pytest -m "not integration"` is
what CI's unit-test job runs); these download the sentence-transformers model on first run and
do real disk I/O, so they're much slower than the rest of the suite. Run explicitly with:

    pytest -m integration

This is deliberately the layer the unit suite (which runs entirely against in-memory fakes)
cannot cover: both of the real bugs found in this project's code review -- citations being eaten
by Rich's markup parser, and stale chunks surviving a re-ingest -- were integration-level issues
at the boundary with a real dependency, not logic bugs the fakes would ever have caught.
"""

from __future__ import annotations

import pytest

from rag.embeddings import SentenceTransformerEmbedder
from rag.ingest import Chunk
from rag.knowledge_base import KnowledgeBase
from rag.vectorstore import ChromaVectorStore

pytestmark = pytest.mark.integration


def _make_kb(tmp_path, collection_name: str) -> KnowledgeBase:
    store = ChromaVectorStore(collection_name=collection_name, persist_dir=tmp_path / "chroma")
    return KnowledgeBase(SentenceTransformerEmbedder(), store)


def test_add_chunks_then_retrieve_finds_the_semantically_relevant_chunk(tmp_path):
    kb = _make_kb(tmp_path, "integration-relevance")
    kb.add_chunks(
        [
            Chunk(
                text="Chroma is a local, embedded vector database with no separate server.",
                source="notes.md",
                chunk_index=0,
            ),
            Chunk(
                text="Bananas are a good source of potassium.",
                source="unrelated.md",
                chunk_index=0,
            ),
        ]
    )

    results = kb.retrieve("What vector database runs embedded with no server process?", top_k=1)

    assert len(results) == 1
    assert results[0].source == "notes.md"


def test_reingesting_a_shrunk_file_removes_stale_chunks_end_to_end(tmp_path):
    kb = _make_kb(tmp_path, "integration-stale-cleanup")

    kb.add_chunks(
        [
            Chunk(text="alpha content", source="note.md", chunk_index=0),
            Chunk(text="beta content", source="note.md", chunk_index=1),
        ]
    )
    kb.add_chunks([Chunk(text="alpha content", source="note.md", chunk_index=0)])

    results = kb.retrieve("alpha content", top_k=10)

    assert len(results) == 1
    assert results[0].text == "alpha content"

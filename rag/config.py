"""Centralized configuration, overridable via environment variables."""

from __future__ import annotations

import os
from pathlib import Path

EMBEDDING_MODEL = os.environ.get("RAG_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
LLM_MODEL = os.environ.get("RAG_LLM_MODEL", "claude-sonnet-5")
PERSIST_DIR = Path(
    os.environ.get("RAG_DATA_DIR", str(Path(__file__).resolve().parent.parent / ".chroma"))
)
DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 200

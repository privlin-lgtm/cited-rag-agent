"""Load source files and split them into overlapping text chunks."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

from rag.config import DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".md"}


@dataclass
class Chunk:
    text: str
    source: str
    chunk_index: int


def read_text_from_file(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    return path.read_text(encoding="utf-8", errors="ignore")


def chunk_text(
    text: str, chunk_size: int = DEFAULT_CHUNK_SIZE, overlap: int = DEFAULT_CHUNK_OVERLAP
) -> list[str]:
    if chunk_size <= 0:
        raise ValueError(f"chunk_size must be positive, got {chunk_size}")
    if overlap >= chunk_size:
        raise ValueError(f"overlap ({overlap}) must be smaller than chunk_size ({chunk_size})")

    words = text.split()
    if not words:
        return []

    chunks = []
    step = chunk_size - overlap
    for start in range(0, len(words), step):
        chunk_words = words[start : start + chunk_size]
        chunks.append(" ".join(chunk_words))
        if start + chunk_size >= len(words):
            break
    return chunks


def discover_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() in SUPPORTED_EXTENSIONS else []
    return sorted(
        p for p in path.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def load_chunks(
    path: Path, chunk_size: int = DEFAULT_CHUNK_SIZE, overlap: int = DEFAULT_CHUNK_OVERLAP
) -> tuple[list[Chunk], list[tuple[Path, Exception]]]:
    files = discover_files(path)
    logger.debug("discovered %d candidate file(s) under %s", len(files), path)

    chunks: list[Chunk] = []
    errors: list[tuple[Path, Exception]] = []
    for file in files:
        try:
            text = read_text_from_file(file)
        except Exception as e:
            logger.warning("failed to read %s: %s", file, e)
            errors.append((file, e))
            continue
        source = str(file.resolve())
        file_chunks = chunk_text(text, chunk_size, overlap)
        logger.debug("%s -> %d chunk(s)", file, len(file_chunks))
        for i, chunk in enumerate(file_chunks):
            chunks.append(Chunk(text=chunk, source=source, chunk_index=i))
    return chunks, errors

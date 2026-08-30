"""Load source files and split them into overlapping text chunks."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

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


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    words = text.split()
    if not words:
        return []

    chunks = []
    step = max(chunk_size - overlap, 1)
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


def load_chunks(path: Path, chunk_size: int = 1000, overlap: int = 200) -> list[Chunk]:
    files = discover_files(path)
    chunks: list[Chunk] = []
    for file in files:
        text = read_text_from_file(file)
        for i, chunk in enumerate(chunk_text(text, chunk_size, overlap)):
            chunks.append(Chunk(text=chunk, source=str(file), chunk_index=i))
    return chunks

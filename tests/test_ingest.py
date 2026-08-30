"""Unit tests for chunking and file discovery, including edge cases."""

from pathlib import Path

import pytest

from rag.ingest import chunk_text, discover_files, load_chunks


# --- chunk_text -------------------------------------------------------------


def test_chunk_text_empty_string_returns_no_chunks():
    assert chunk_text("") == []


def test_chunk_text_whitespace_only_returns_no_chunks():
    assert chunk_text("   \n\t  ") == []


def test_chunk_text_single_word_returns_one_chunk():
    assert chunk_text("hello", chunk_size=5, overlap=1) == ["hello"]


def test_chunk_text_shorter_than_chunk_size_returns_one_chunk():
    assert chunk_text("a b c", chunk_size=100, overlap=10) == ["a b c"]


def test_chunk_text_respects_size_and_overlap():
    text = " ".join(str(i) for i in range(10))  # "0 1 2 ... 9"
    assert chunk_text(text, chunk_size=4, overlap=1) == ["0 1 2 3", "3 4 5 6", "6 7 8 9"]


def test_chunk_text_exact_multiple_of_chunk_size_has_no_trailing_empty_chunk():
    text = " ".join(str(i) for i in range(8))
    chunks = chunk_text(text, chunk_size=4, overlap=0)
    assert chunks == ["0 1 2 3", "4 5 6 7"]


def test_chunk_text_rejects_overlap_equal_to_chunk_size():
    with pytest.raises(ValueError):
        chunk_text("a b c d e", chunk_size=3, overlap=3)


def test_chunk_text_rejects_overlap_greater_than_chunk_size():
    with pytest.raises(ValueError):
        chunk_text("a b c d e", chunk_size=3, overlap=10)


def test_chunk_text_rejects_zero_chunk_size():
    with pytest.raises(ValueError):
        chunk_text("a b c", chunk_size=0)


def test_chunk_text_rejects_negative_chunk_size():
    with pytest.raises(ValueError):
        chunk_text("a b c", chunk_size=-5)


def test_chunk_text_allows_zero_overlap():
    text = " ".join(str(i) for i in range(6))
    assert chunk_text(text, chunk_size=3, overlap=0) == ["0 1 2", "3 4 5"]


# --- discover_files -----------------------------------------------------------


def test_discover_files_single_supported_file(tmp_path: Path):
    f = tmp_path / "note.txt"
    f.write_text("hi")
    assert discover_files(f) == [f]


def test_discover_files_single_unsupported_file(tmp_path: Path):
    f = tmp_path / "image.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\n")
    assert discover_files(f) == []


def test_discover_files_nonexistent_path_returns_empty(tmp_path: Path):
    assert discover_files(tmp_path / "does-not-exist.md") == []


def test_discover_files_empty_directory_returns_empty(tmp_path: Path):
    assert discover_files(tmp_path) == []


def test_discover_files_directory_with_only_unsupported_files(tmp_path: Path):
    (tmp_path / "image.png").write_bytes(b"\x89PNG")
    (tmp_path / "archive.zip").write_bytes(b"PK\x03\x04")
    assert discover_files(tmp_path) == []


def test_discover_files_filters_by_extension_recursively(tmp_path: Path):
    (tmp_path / "note.md").write_text("hi")
    (tmp_path / "ignore.png").write_bytes(b"\x89PNG")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "deep.txt").write_text("hi")

    found = discover_files(tmp_path)
    assert {f.name for f in found} == {"note.md", "deep.txt"}


# --- load_chunks (per-file resilience) ---------------------------------------


def test_load_chunks_on_empty_directory_returns_nothing(tmp_path: Path):
    chunks, errors = load_chunks(tmp_path)
    assert chunks == []
    assert errors == []


def test_load_chunks_skips_corrupt_pdf_and_continues(tmp_path: Path):
    good = tmp_path / "good.txt"
    good.write_text("alpha bravo charlie")
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"this is not a real pdf")  # binary/malformed file with a supported extension

    chunks, errors = load_chunks(tmp_path, chunk_size=10, overlap=0)

    assert len(errors) == 1
    assert errors[0][0] == bad
    assert len(chunks) == 1
    assert chunks[0].source == str(good.resolve())


def test_load_chunks_all_files_corrupt_returns_no_chunks_but_reports_all_errors(tmp_path: Path):
    (tmp_path / "a.pdf").write_bytes(b"not a pdf")
    (tmp_path / "b.pdf").write_bytes(b"also not a pdf")

    chunks, errors = load_chunks(tmp_path)

    assert chunks == []
    assert len(errors) == 2


def test_load_chunks_invalid_chunk_size_raises_before_touching_files(tmp_path: Path):
    (tmp_path / "note.txt").write_text("hello world")
    with pytest.raises(ValueError):
        load_chunks(tmp_path, chunk_size=5, overlap=5)


def test_load_chunks_same_file_ingested_from_different_relative_paths_has_same_source(
    tmp_path: Path, monkeypatch
):
    f = tmp_path / "note.txt"
    f.write_text("alpha bravo charlie")

    monkeypatch.chdir(tmp_path)
    chunks_relative, _ = load_chunks(Path("note.txt"))
    chunks_absolute, _ = load_chunks(f.resolve())

    assert chunks_relative[0].source == chunks_absolute[0].source

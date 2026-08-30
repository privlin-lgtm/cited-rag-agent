"""Command-line interface: ingest documents and ask questions against them."""

from __future__ import annotations

import argparse
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console
from rich.markup import escape

from rag import qa
from rag.config import DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE
from rag.embeddings import SentenceTransformerEmbedder
from rag.ingest import load_chunks
from rag.knowledge_base import KnowledgeBase
from rag.vectorstore import ChromaVectorStore

console = Console()


def cmd_ingest(args: argparse.Namespace, kb: KnowledgeBase) -> None:
    path = Path(args.path)
    if not path.exists():
        console.print(f"[red]Path not found:[/red] {escape(str(path))}")
        return

    try:
        chunks, errors = load_chunks(path, chunk_size=args.chunk_size, overlap=args.overlap)
    except ValueError as e:
        console.print(f"[red]{escape(str(e))}[/red]")
        return

    for file, error in errors:
        console.print(f"[yellow]Skipped {escape(str(file))} ({escape(str(error))})[/yellow]")

    if not chunks:
        console.print(f"[yellow]No supported files ingested under {escape(str(path))}[/yellow]")
        return

    kb.add_chunks(chunks)
    sources = sorted({c.source for c in chunks})
    console.print(f"[green]Ingested {len(chunks)} chunks from {len(sources)} file(s):[/green]")
    for source in sources:
        console.print(f"  - {escape(source)}")


def cmd_ask(args: argparse.Namespace, kb: KnowledgeBase) -> None:
    try:
        qa.ask(
            kb,
            args.question,
            top_k=args.top_k,
            on_token=lambda text: console.print(text, end="", markup=False),
        )
    except ValueError as e:
        console.print(f"[red]{escape(str(e))}[/red]")
        return
    console.print()


def cmd_list(args: argparse.Namespace, kb: KnowledgeBase) -> None:
    sources = kb.list_sources()
    if not sources:
        console.print("[yellow]No documents ingested yet.[/yellow]")
        return
    for source in sources:
        console.print(f"  - {escape(source)}")


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(prog="rag", description="Personal Knowledge RAG System")
    parser.add_argument(
        "--collection", default="knowledge_base", help="Vector store collection to use"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest", help="Ingest a file or directory")
    ingest_parser.add_argument("path", help="File or directory to ingest (PDF, .txt, .md)")
    ingest_parser.add_argument(
        "--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE, help="Words per chunk"
    )
    ingest_parser.add_argument(
        "--overlap", type=int, default=DEFAULT_CHUNK_OVERLAP, help="Overlapping words between chunks"
    )
    ingest_parser.set_defaults(func=cmd_ingest)

    ask_parser = subparsers.add_parser("ask", help="Ask a question about ingested documents")
    ask_parser.add_argument("question", help="Your question")
    ask_parser.add_argument("--top-k", type=int, default=5, help="Number of chunks to retrieve")
    ask_parser.set_defaults(func=cmd_ask)

    list_parser = subparsers.add_parser("list", help="List ingested documents")
    list_parser.set_defaults(func=cmd_list)

    args = parser.parse_args()

    kb = KnowledgeBase(
        embedder=SentenceTransformerEmbedder(),
        store=ChromaVectorStore(collection_name=args.collection),
    )
    args.func(args, kb)


if __name__ == "__main__":
    main()

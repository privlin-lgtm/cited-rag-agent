"""Structured logging setup for the CLI."""

from __future__ import annotations

import logging


def configure_logging(verbose: bool = False) -> None:
    # Third-party libraries (httpx, chromadb, ...) stay at WARNING regardless of --verbose --
    # only this project's own loggers (rag.*) go to DEBUG, so --verbose surfaces our own
    # ingest/retrieval trace instead of drowning it in framework noise.
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("rag").setLevel(logging.DEBUG if verbose else logging.WARNING)

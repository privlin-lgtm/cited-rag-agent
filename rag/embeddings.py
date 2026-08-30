"""Local embedding model (sentence-transformers) implementing the Embedder protocol."""

from __future__ import annotations

from sentence_transformers import SentenceTransformer

from rag.config import EMBEDDING_MODEL


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str = EMBEDDING_MODEL) -> None:
        self._model_name = model_name
        self._model: SentenceTransformer | None = None

    @property
    def model(self) -> SentenceTransformer:
        if self._model is None:
            self._model = SentenceTransformer(self._model_name)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts, convert_to_numpy=True).tolist()

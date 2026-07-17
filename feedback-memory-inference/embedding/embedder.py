"""MiniLM embedding model wrapper."""

from __future__ import annotations

import math
import threading
from typing import Optional

DEFAULT_MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_DIMENSIONS = 384

_model_lock = threading.Lock()
_model_cache: dict[str, object] = {}


def _get_model(model_id: str):
    with _model_lock:
        if model_id not in _model_cache:
            from sentence_transformers import SentenceTransformer

            _model_cache[model_id] = SentenceTransformer(model_id)
        return _model_cache[model_id]


def _l2_normalize(vector: list[float]) -> list[float]:
    magnitude = math.sqrt(sum(value * value for value in vector))

    if magnitude == 0:
        return vector

    return [value / magnitude for value in vector]


def embed_text(
    text: str,
    model_id: str,
    normalize: bool,
) -> Optional[list[float]]:
    cleaned = text.strip()

    if not cleaned:
        return None

    resolved_model = model_id or DEFAULT_MODEL_ID
    model = _get_model(resolved_model)
    vector = model.encode(cleaned, normalize_embeddings=False)
    values = [float(value) for value in vector.tolist()]

    if normalize:
        return _l2_normalize(values)

    return values

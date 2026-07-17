"""
Embedding Service — port 8003

HTTP contract matches MiniLMEmbeddingProvider:
  GET  /health
  POST /v1/embeddings/embed
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from embedding.embedder import DEFAULT_DIMENSIONS, DEFAULT_MODEL_ID, embed_text

app = FastAPI(title="Feedback Memory Embedding Service", version="1.0.0")


class EmbedRequest(BaseModel):
    text: str
    model_id: str = Field(default=DEFAULT_MODEL_ID, alias="model_id")
    purpose: Literal["document", "query"] = "document"
    normalize: bool = False

    model_config = {"populate_by_name": True}


class EmbedResponse(BaseModel):
    embedding: list[float]
    dimensions: int


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/embeddings/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    text = request.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    try:
        vector = embed_text(
            text=text,
            model_id=request.model_id,
            normalize=request.normalize,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if vector is None or len(vector) != DEFAULT_DIMENSIONS:
        raise HTTPException(status_code=422, detail="embedding generation failed")

    return EmbedResponse(embedding=vector, dimensions=len(vector))


def main() -> None:
    import uvicorn

    uvicorn.run("embedding.main:app", host="127.0.0.1", port=8003, reload=False)


if __name__ == "__main__":
    main()

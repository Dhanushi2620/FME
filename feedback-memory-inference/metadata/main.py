"""
Metadata Extraction Service — port 8002

HTTP contract matches OllamaMetadataExtractionProvider:
  GET  /health
  POST /v1/metadata/extract
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict

from metadata.providers.base import ExtractionRequest
from metadata.providers.factory import create_metadata_provider
from metadata.providers.ollama import (
    OllamaConnectionError,
    OllamaExtractionError,
    OllamaMetadataProvider,
    check_ollama_health,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Feedback Memory Metadata Service", version="1.0.0")
provider = create_metadata_provider()


class ExtractRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None
    agent_id: Optional[str] = None
    system_prompt: Optional[str] = None
    model_id: Optional[str] = None
    category: Optional[str] = None
    ai_response: Optional[str] = None


class ExtractResponse(BaseModel):
    category: str
    summary: str
    technologies: list[str]
    topics: list[str]
    concepts: list[str]
    confidence: float


def _uses_ollama_provider() -> bool:
    provider_id = os.environ.get("METADATA_PROVIDER", "ollama").strip().lower()
    return provider_id == "ollama" or isinstance(provider, OllamaMetadataProvider)


@app.get("/health")
def health() -> dict[str, str]:
    if _uses_ollama_provider() and not check_ollama_health():
        logger.error("Metadata health check failed: Ollama is down at configured URL")
        raise HTTPException(status_code=503, detail="Ollama is unavailable")

    return {"status": "ok"}


@app.post("/v1/metadata/extract", response_model=ExtractResponse)
def extract(request: ExtractRequest) -> ExtractResponse:
    text = request.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    provided_category = request.category.strip() if request.category else None
    if provided_category:
        logger.info(
            "Category provided by BART: %s — skipping classification",
            provided_category,
        )

    try:
        result = provider.extract(
            ExtractionRequest(
                text=text,
                conversation_id=request.conversation_id,
                message_id=request.message_id,
                agent_id=request.agent_id,
                system_prompt=request.system_prompt,
                model_id=request.model_id,
                category=provided_category,
                ai_response=request.ai_response,
            )
        )
    except OllamaConnectionError as error:
        logger.error("Metadata extraction unavailable: %s", error)
        raise HTTPException(status_code=503, detail=str(error)) from error
    except OllamaExtractionError as error:
        logger.error("Metadata extraction failed: %s", error)
        raise HTTPException(status_code=422, detail=str(error)) from error

    if result is None:
        raise HTTPException(status_code=422, detail="metadata extraction failed")

    return ExtractResponse(
        category=provided_category if provided_category else result.category,
        summary=result.summary,
        technologies=result.technologies,
        topics=result.topics,
        concepts=result.concepts,
        confidence=result.confidence,
    )


def main() -> None:
    import uvicorn

    uvicorn.run("metadata.main:app", host="127.0.0.1", port=8002, reload=False)


if __name__ == "__main__":
    main()

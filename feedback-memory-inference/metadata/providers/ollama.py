"""Ollama-backed metadata extraction via local LLM (qwen2.5:3b default)."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional

import httpx

from metadata.providers.base import ExtractionRequest, ExtractionResult, MetadataProvider

logger = logging.getLogger(__name__)


class OllamaServiceError(Exception):
    """Base error for Ollama metadata provider failures."""


class OllamaConnectionError(OllamaServiceError):
    """Ollama is unreachable or did not respond in time."""


class OllamaExtractionError(OllamaServiceError):
    """Ollama responded but metadata extraction failed."""

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MODEL = os.getenv("METADATA_MODEL", "qwen2.5:3b")

SCHEMA = {
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": ["Correction", "Decision", "AntiPattern", "TaskLearning"],
        },
        "summary": {"type": "string"},
        "technologies": {"type": "array", "items": {"type": "string"}},
        "topics": {"type": "array", "items": {"type": "string"}},
        "concepts": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
    },
    "required": [
        "category",
        "summary",
        "technologies",
        "topics",
        "concepts",
        "confidence",
    ],
}

SYSTEM_PROMPT = """You are an engineering memory extractor.
Given a developer message, extract structured metadata.

category:
  Correction   - corrects an AI mistake or wrong assumption
  Decision     - a persistent architectural or implementation choice
  AntiPattern  - a pattern the team must never repeat
  TaskLearning - a repeatable workflow or procedure

summary: one clean sentence capturing the core engineering knowledge.
technologies: specific tools, libraries, frameworks mentioned.
topics: broader domains (caching, auth, state-management etc).
concepts: abstract principles (idempotency, single-source-of-truth etc).
confidence: 0.0-1.0 based on how clearly this is engineering knowledge.

You MUST respond with ONLY a valid JSON object.
No explanation, no markdown, no code blocks.
Exactly this structure:
{
  "category": "Correction|Decision|AntiPattern|TaskLearning",
  "summary": "one clean sentence",
  "technologies": [],
  "topics": [],
  "concepts": [],
  "confidence": 0.0
}"""

SYSTEM_PROMPT_KNOWN_CATEGORY = """You are an engineering memory extractor.
The category is already known — do NOT re-classify it.
Extract ONLY: summary, technologies, topics, concepts, confidence.

summary: one clean sentence capturing the core engineering knowledge.
technologies: specific tools, libraries, frameworks mentioned.
topics: broader domains (caching, auth, state-management etc).
concepts: abstract principles (idempotency, single-source-of-truth etc).
confidence: 0.0-1.0 based on how clearly this is engineering knowledge.

You MUST respond with ONLY a valid JSON object.
No explanation, no markdown, no code blocks.
Exactly this structure:
{
  "category": "Correction|Decision|AntiPattern|TaskLearning",
  "summary": "one clean sentence",
  "technologies": [],
  "topics": [],
  "concepts": [],
  "confidence": 0.0
}"""

VALID_CATEGORIES = {"Correction", "Decision", "AntiPattern", "TaskLearning"}


def _build_user_content(request: ExtractionRequest) -> str:
    text = request.text.strip()
    ai_response = (request.ai_response or "").strip()
    category = (request.category or "").strip()

    if ai_response:
        known_category = category or "unknown"
        return (
            f"Developer said: {text}\n"
            f"Cursor AI responded: {ai_response}\n"
            f"\n"
            f"Category is already known: {known_category}\n"
            f"Extract ONLY: summary, technologies, topics, concepts, confidence\n"
            f"Do not re-classify the category."
        )

    return text


def check_ollama_health(timeout_seconds: float = 3.0) -> bool:
    """Probe Ollama liveness via /api/tags."""
    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.get(f"{OLLAMA_URL}/api/tags")
            return response.status_code == 200
    except (httpx.ConnectError, httpx.TimeoutException):
        return False
    except Exception:
        return False


def extract_with_ollama(text: str, model: Optional[str] = None) -> Optional[dict]:
    """Call Ollama /api/chat with JSON-schema constrained output."""
    resolved_model = model or MODEL

    with httpx.Client(timeout=25.0) as client:
        response = client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": resolved_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": text},
                ],
                "stream": False,
                "options": {"temperature": 0.1, "num_ctx": 2048},
            },
        )
        response.raise_for_status()
        payload = response.json()

    content = payload.get("message", {}).get("content")
    if not isinstance(content, str):
        return None

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
        else:
            raise OllamaExtractionError("No valid JSON in response")

    return parsed


def _as_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(entry).strip() for entry in value if str(entry).strip()]


def _to_extraction_result(parsed: dict) -> Optional[ExtractionResult]:
    category = parsed.get("category")
    summary = parsed.get("summary")

    if not isinstance(category, str) or category not in VALID_CATEGORIES:
        return None

    if not isinstance(summary, str) or not summary.strip():
        return None

    confidence = parsed.get("confidence", 0.8)
    if not isinstance(confidence, (int, float)):
        confidence = 0.8

    return ExtractionResult(
        category=category,
        summary=summary.strip(),
        technologies=_as_string_list(parsed.get("technologies")),
        topics=_as_string_list(parsed.get("topics")),
        concepts=_as_string_list(parsed.get("concepts")),
        confidence=float(confidence),
    )


class OllamaMetadataProvider(MetadataProvider):
    """MetadataProvider adapter used by the :8002 FastAPI service."""

    def extract(self, request: ExtractionRequest) -> Optional[ExtractionResult]:
        text = request.text.strip()
        if not text:
            return None

        model = request.model_id or MODEL
        provided_category = (request.category or "").strip() or None
        user_content = _build_user_content(request)

        if request.system_prompt:
            system_prompt = request.system_prompt
        elif provided_category:
            system_prompt = SYSTEM_PROMPT_KNOWN_CATEGORY
        else:
            system_prompt = SYSTEM_PROMPT

        try:
            with httpx.Client(timeout=25.0) as client:
                response = client.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_content},
                        ],
                        "stream": False,
                        "options": {"temperature": 0.1, "num_ctx": 2048},
                    },
                )
                response.raise_for_status()
                payload = response.json()

            content = payload.get("message", {}).get("content")
            if not isinstance(content, str):
                logger.error(
                    "Ollama metadata extraction failed: missing message content (model=%s)",
                    model,
                )
                raise OllamaExtractionError(
                    "Ollama response missing message content"
                )

            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                match = re.search(r"\{.*\}", content, re.DOTALL)
                if match:
                    parsed = json.loads(match.group())
                else:
                    raise OllamaExtractionError("No valid JSON in response")

            # When BART already classified, force that category so Ollama cannot override it.
            if provided_category:
                parsed["category"] = provided_category

            result = _to_extraction_result(parsed)
            if result is None:
                logger.error(
                    "Ollama metadata extraction failed: invalid structured output (model=%s)",
                    model,
                )
                raise OllamaExtractionError(
                    "Ollama returned metadata that failed validation"
                )

            return result
        except OllamaServiceError:
            raise
        except httpx.ConnectError as error:
            logger.error(
                "Ollama connection failed at %s: %s",
                OLLAMA_URL,
                error,
            )
            raise OllamaConnectionError(
                f"Cannot connect to Ollama at {OLLAMA_URL}"
            ) from error
        except httpx.TimeoutException as error:
            logger.error("Ollama metadata request timed out (model=%s): %s", model, error)
            raise OllamaConnectionError(
                f"Ollama request timed out for model {model}"
            ) from error
        except httpx.HTTPStatusError as error:
            logger.error(
                "Ollama metadata request failed with HTTP %s (model=%s): %s",
                error.response.status_code,
                model,
                error,
            )
            raise OllamaExtractionError(
                f"Ollama returned HTTP {error.response.status_code}"
            ) from error
        except json.JSONDecodeError as error:
            logger.error("Ollama metadata extraction failed: invalid JSON (model=%s): %s", model, error)
            raise OllamaExtractionError("Ollama returned invalid JSON") from error
        except Exception as error:
            logger.error(
                "Ollama metadata extraction failed unexpectedly (model=%s): %s",
                model,
                error,
            )
            raise OllamaExtractionError(str(error)) from error

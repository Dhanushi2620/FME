"""Rule-based local metadata extraction (no external APIs)."""

from __future__ import annotations

import re
from typing import Optional

from metadata.providers.base import ExtractionRequest, ExtractionResult, MetadataProvider

TECHNOLOGY_TERMS = [
    "Redis",
    "JWT",
    "Firebase",
    "MongoDB",
    "PostgreSQL",
    "Elasticsearch",
    "ChromaDB",
    "Node Cluster",
    "Docker",
    "Kubernetes",
    "GraphQL",
    "TypeScript",
    "React",
    "Express",
]

TOPIC_KEYWORDS: dict[str, list[str]] = {
    "authentication": ["jwt", "auth", "login", "token", "firebase"],
    "session management": ["session", "redis", "cookie"],
    "caching": ["cache", "redis", "memcached"],
    "database": ["mongo", "postgres", "sql", "database", "atlas"],
    "rate limiting": ["rate limit", "throttle", "quota"],
    "logging": ["log", "elasticsearch", "monitoring"],
    "deployment": ["cluster", "docker", "kubernetes", "deploy"],
}

CATEGORY_PATTERNS: list[tuple[str, str, float]] = [
    ("Decision", r"\bwe\s+decided\b", 0.93),
    ("Decision", r"\bwe\s+chose\b", 0.9),
    ("Correction", r"\buse\s+.+\s+instead\s+of\s+.+\b", 0.92),
    ("Correction", r"\b(?:switch|move)\s+to\s+.+\b", 0.88),
    ("AntiPattern", r"\bnever\s+use\b", 0.91),
    ("AntiPattern", r"\bdo\s+not\s+use\b", 0.88),
    ("TaskLearning", r"\bthe\s+fix\s+was\b", 0.9),
    ("TaskLearning", r"\blearned\s+that\b", 0.85),
]


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def _extract_technologies(text: str) -> list[str]:
    found: list[str] = []
    lower = text.lower()

    for term in TECHNOLOGY_TERMS:
        if term.lower() in lower and term not in found:
            found.append(term)

    return found


def _extract_topics(text: str) -> list[str]:
    lower = text.lower()
    topics: list[str] = []

    for topic, keywords in TOPIC_KEYWORDS.items():
        if any(keyword in lower for keyword in keywords):
            topics.append(topic)

    return topics


def _extract_concepts(text: str) -> list[str]:
    concepts: list[str] = []

    for match in re.finditer(
        r"\b(?:in-memory\s+\w+|rate\s+limiting|token\s+refresh|connection\s+pooling)\b",
        text,
        flags=re.IGNORECASE,
    ):
        concept = match.group(0).strip()
        if concept not in concepts:
            concepts.append(concept)

    if not concepts and len(text.split()) >= 4:
        concepts.append(" ".join(text.split()[:6]))

    return concepts[:5]


class RuleBasedMetadataProvider(MetadataProvider):
    def extract(self, request: ExtractionRequest) -> Optional[ExtractionResult]:
        text = _normalize_text(request.text)

        if not text:
            return None

        provided_category = (request.category or "").strip() or None
        category: Optional[str] = provided_category
        confidence = 0.0

        if provided_category is None:
            for candidate_category, pattern, score in CATEGORY_PATTERNS:
                if re.search(pattern, text, flags=re.IGNORECASE):
                    category = candidate_category
                    confidence = score
                    break

            if category is None:
                if text.endswith("?"):
                    return None
                category = "Decision"
                confidence = 0.75
        else:
            confidence = 0.9

        return ExtractionResult(
            category=category,
            summary=text,
            technologies=_extract_technologies(text),
            topics=_extract_topics(text),
            concepts=_extract_concepts(text),
            confidence=confidence,
        )

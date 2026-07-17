"""BART-MNLI zero-shot intent classifier with local feedback heuristics."""

from __future__ import annotations

import re
import threading
from typing import Any, Optional

DEFAULT_MODEL_ID = "facebook/bart-large-mnli"

# Descriptive hypotheses improve zero-shot scores while preserving label keys
# expected by BartIntentProvider (WRITE / READ / ANSWER_ONLY).
LABEL_HYPOTHESES: dict[str, str] = {
    "WRITE": "developer feedback that should be stored as engineering memory",
    "READ": "a question that requires retrieving stored engineering memory",
    "ANSWER_ONLY": "a general coding request that does not need memory retrieval",
}

# Legacy / explicit feedback phrases (match anywhere in the message).
WRITE_PATTERNS = [
    # Memory / policy statements
    re.compile(r"\bremember\s+that\b", re.IGNORECASE),
    re.compile(r"\bgoing\s+forward\b", re.IGNORECASE),
    re.compile(r"\bfrom\s+now\s+on\b", re.IGNORECASE),
    re.compile(r"\bour\s+standard\s+is\b", re.IGNORECASE),
    re.compile(r"\bour\s+convention\s+is\b", re.IGNORECASE),
    re.compile(r"\bwe\s+decided\b", re.IGNORECASE),
    # Preferences and prohibitions
    re.compile(r"\balways\s+use\b", re.IGNORECASE),
    re.compile(r"\balways\s+prefer\b", re.IGNORECASE),
    re.compile(r"\bnever\s+use\b", re.IGNORECASE),
    re.compile(r"\bnever\s+do\b", re.IGNORECASE),
    re.compile(r"\b(?:do\s+not\s+use|don't\s+use)\b", re.IGNORECASE),
    re.compile(r"\bavoid\s+(?:using\s+)?\w+", re.IGNORECASE),
    # Substitutions and corrections
    re.compile(r"\buse\s+.+\s+instead\s+of\s+.+\b", re.IGNORECASE),
    re.compile(r"\bprefer\s+.+\s+over\s+.+\b", re.IGNORECASE),
    re.compile(r"\b(?:switch|move)\s+to\s+.+\b", re.IGNORECASE),
    re.compile(r"\bthe\s+fix\s+was\b", re.IGNORECASE),
]

# Common engineering-correction imperatives at the start of the message.
WRITE_IMPERATIVE_START = re.compile(
    r"^\s*(?:please\s+)?(?:"
    r"always\s+use|do\s+not\s+use|don't\s+use|"
    r"use|replace|prefer|avoid|implement|store|cache|index|"
    r"validate|authenticate|encrypt|protect|generate|create|add|remove|"
    r"move\s+to|switch\s+to"
    r")\b",
    re.IGNORECASE,
)

# Correction context phrases that usually indicate persistable feedback.
WRITE_CORRECTION_ENDINGS = [
    re.compile(r"\binstead\s+of\b", re.IGNORECASE),
    re.compile(r"\brather\s+than\b", re.IGNORECASE),
    re.compile(r"\bbecause\b", re.IGNORECASE),
    re.compile(r"\bto\s+improve\b", re.IGNORECASE),
    re.compile(r"\bfor\s+better\s+performance\b", re.IGNORECASE),
    re.compile(r"\bfor\s+security\b", re.IGNORECASE),
    re.compile(r"\bto\s+avoid\b", re.IGNORECASE),
]

READ_PATTERNS = [
    re.compile(r"^\s*(?:why|how|what|when|where)\b.+\?\s*$", re.IGNORECASE),
    re.compile(r"\bwhy\s+(?:are|do|did|should)\s+we\b", re.IGNORECASE),
    re.compile(r"^\s*how\s+does\b", re.IGNORECASE),
    re.compile(r"^\s*explain\b", re.IGNORECASE),
]

# Common coding-task phrasing that should defer to BART instead of imperative WRITE.
TASK_REQUEST_START = re.compile(
    r"^\s*(?:"
    r"create\s+(?:a|an)|"
    r"write\s+unit\s+tests|"
    r"build\s+(?:a|an)|"
    r"generate\s+(?:a|an)"
    r")\b",
    re.IGNORECASE,
)

_classifier_lock = threading.Lock()
_classifier_cache: dict[str, Any] = {}


def _rule_based_intent_hint(text: str, candidate_labels: list[str]) -> Optional[str]:
    normalized = text.strip()

    if not normalized:
        return None

    for pattern in READ_PATTERNS:
        if pattern.search(normalized) and "READ" in candidate_labels:
            return "READ"

    if TASK_REQUEST_START.search(normalized):
        return None

    if "WRITE" in candidate_labels:
        for pattern in WRITE_PATTERNS:
            if pattern.search(normalized):
                return "WRITE"

        if WRITE_IMPERATIVE_START.search(normalized):
            return "WRITE"

        for pattern in WRITE_CORRECTION_ENDINGS:
            if pattern.search(normalized):
                return "WRITE"

    return None


def _build_hint_scores(
    candidate_labels: list[str], hint: str
) -> list[dict[str, float | str]]:
    return [
        {
            "label": label,
            "score": 0.95 if label == hint else 0.02,
        }
        for label in candidate_labels
    ]


def _get_classifier(model_id: str):
    with _classifier_lock:
        if model_id not in _classifier_cache:
            from transformers import pipeline

            _classifier_cache[model_id] = pipeline(
                "zero-shot-classification",
                model=model_id,
            )
        return _classifier_cache[model_id]


def classify_zero_shot(
    text: str,
    model_id: str,
    candidate_labels: list[str],
    multi_label: bool,
) -> list[dict[str, float | str]]:
    if not text.strip() or not candidate_labels:
        return []

    hint = _rule_based_intent_hint(text, candidate_labels)
    if hint is not None:
        return _build_hint_scores(candidate_labels, hint)

    resolved_model = model_id or DEFAULT_MODEL_ID
    classifier = _get_classifier(resolved_model)

    hypotheses = [
        LABEL_HYPOTHESES.get(label, label) for label in candidate_labels
    ]

    result = classifier(
        text,
        candidate_labels=hypotheses,
        multi_label=multi_label,
        hypothesis_template="This developer message is {}.",
    )

    labels_out = result.get("labels", [])
    scores_out = result.get("scores", [])

    hypothesis_to_label = dict(zip(hypotheses, candidate_labels))
    mapped: list[dict[str, float | str]] = []

    for hypothesis, score in zip(labels_out, scores_out):
        label_key = hypothesis_to_label.get(hypothesis, candidate_labels[0])
        mapped.append({"label": label_key, "score": float(score)})

    return mapped

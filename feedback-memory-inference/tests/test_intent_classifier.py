"""Unit tests for deterministic intent heuristics in intent.classifier."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from intent.classifier import (
    _build_hint_scores,
    _rule_based_intent_hint,
    classify_zero_shot,
)

CANDIDATE_LABELS = ["WRITE", "READ", "ANSWER_ONLY"]
RULE_WRITE_CONFIDENCE = 0.95


class WriteFeedbackPhraseTests(unittest.TestCase):
    """Positive cases: engineering feedback should match deterministic WRITE."""

    POSITIVE_CASES = [
        "Remember that JWT tokens must expire within 15 minutes.",
        "Always use parameterized queries for SQL access.",
        "Always prefer composition over inheritance in React components.",
        "Going forward, all API routes must validate input with Zod.",
        "From now on, use structured logging instead of console.log.",
        "Never use localStorage for authentication tokens.",
        "Never do synchronous file I/O in request handlers.",
        "Use PostgreSQL instead of MongoDB for transactional data.",
        "Prefer Redis over in-memory caches for shared session state.",
        "Avoid using any in TypeScript unless absolutely necessary.",
        "The fix was to await the database connection before handling requests.",
        "We decided to standardize on bcrypt for password hashing.",
        "Our standard is to return RFC 7807 problem details for API errors.",
        "Our convention is to keep controllers thin and services stateless.",
    ]

    def test_write_feedback_phrases_match_hint(self) -> None:
        for text in self.POSITIVE_CASES:
            with self.subTest(text=text):
                self.assertEqual(
                    _rule_based_intent_hint(text, CANDIDATE_LABELS),
                    "WRITE",
                )

    def test_write_feedback_phrases_return_rule_confidence(self) -> None:
        for text in self.POSITIVE_CASES:
            with self.subTest(text=text):
                scores = _build_hint_scores(CANDIDATE_LABELS, "WRITE")
                write_score = next(
                    entry["score"] for entry in scores if entry["label"] == "WRITE"
                )
                self.assertEqual(write_score, RULE_WRITE_CONFIDENCE)


class NonFeedbackPhraseTests(unittest.TestCase):
    """Negative cases: general coding tasks should not match deterministic WRITE."""

    NEGATIVE_CASES = [
        "Create a React component for the login form.",
        "Explain Redis pub/sub and when to use it.",
        "How does JWT work in a stateless API?",
        "Write unit tests for the authentication service.",
    ]

    def test_non_feedback_phrases_do_not_match_write_hint(self) -> None:
        for text in self.NEGATIVE_CASES:
            with self.subTest(text=text):
                self.assertNotEqual(
                    _rule_based_intent_hint(text, CANDIDATE_LABELS),
                    "WRITE",
                )


class BartBypassTests(unittest.TestCase):
    """When a WRITE rule matches, BART inference must not run."""

    def test_classify_zero_shot_skips_bart_on_write_rule_match(self) -> None:
        text = "Remember that all secrets belong in environment variables."

        with patch("intent.classifier._get_classifier") as mock_get_classifier:
            scores = classify_zero_shot(
                text=text,
                model_id="facebook/bart-large-mnli",
                candidate_labels=CANDIDATE_LABELS,
                multi_label=False,
            )

        mock_get_classifier.assert_not_called()

        top = max(scores, key=lambda entry: float(entry["score"]))
        self.assertEqual(top["label"], "WRITE")
        self.assertEqual(top["score"], RULE_WRITE_CONFIDENCE)

    def test_classify_zero_shot_invokes_bart_when_no_rule_matches(self) -> None:
        text = "Create a React component for the login form."

        mock_classifier = MagicMock(
            return_value={
                "labels": [
                    "a general coding request that does not need memory retrieval",
                    "developer feedback that should be stored as engineering memory",
                    "a question that requires retrieving stored engineering memory",
                ],
                "scores": [0.82, 0.12, 0.06],
            }
        )

        with patch("intent.classifier._get_classifier", return_value=mock_classifier):
            scores = classify_zero_shot(
                text=text,
                model_id="facebook/bart-large-mnli",
                candidate_labels=CANDIDATE_LABELS,
                multi_label=False,
            )

        mock_classifier.assert_called_once()
        top = max(scores, key=lambda entry: float(entry["score"]))
        self.assertEqual(top["label"], "ANSWER_ONLY")


if __name__ == "__main__":
    unittest.main()

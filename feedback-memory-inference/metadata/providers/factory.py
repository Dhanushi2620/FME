"""Metadata provider factory — swap backends via METADATA_PROVIDER env var."""

from __future__ import annotations

import os

from metadata.providers.base import MetadataProvider
from metadata.providers.ollama import OllamaMetadataProvider
from metadata.providers.rule_based import RuleBasedMetadataProvider


def create_metadata_provider() -> MetadataProvider:
    provider_id = os.environ.get("METADATA_PROVIDER", "ollama").strip().lower()

    if provider_id == "ollama":
        return OllamaMetadataProvider()

    if provider_id == "rule-based":
        return RuleBasedMetadataProvider()

    raise ValueError(f"Unknown metadata provider: {provider_id}")

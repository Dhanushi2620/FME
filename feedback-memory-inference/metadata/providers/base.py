"""Base types for metadata extraction providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ExtractionRequest:
    text: str
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None
    agent_id: Optional[str] = None
    system_prompt: Optional[str] = None
    model_id: Optional[str] = None
    category: Optional[str] = None
    ai_response: Optional[str] = None


@dataclass
class ExtractionResult:
    category: str
    summary: str
    technologies: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    concepts: list[str] = field(default_factory=list)
    confidence: float = 0.0


class MetadataProvider(ABC):
    @abstractmethod
    def extract(self, request: ExtractionRequest) -> Optional[ExtractionResult]:
        raise NotImplementedError

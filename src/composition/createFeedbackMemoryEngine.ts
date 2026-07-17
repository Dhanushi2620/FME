/**
 * Feedback Memory Engine Composition Root
 *
 * Single entry point that constructs and exposes the Feedback Memory Engine
 * services. Consumers (WRITE pipeline, READ pipeline, hook, MCP, tests) should
 * depend on {@link createFeedbackMemoryEngine} — never on individual service
 * constructors or provider factories directly.
 *
 * This module performs dependency composition only. It does not detect intent,
 * extract metadata, embed text, store vectors, retrieve memories, rank, enrich,
 * or route prompts.
 */

import {
  createEmbeddingService,
  EmbeddingService,
} from "../services/embedding";
import {
  createMetadataExtractionService,
  MetadataExtractionService,
} from "../services/extraction";
import {
  createIntentDetectionService,
  IntentDetectionService,
} from "../services/intent";
import {
  createVectorStoreService,
  VectorStoreService,
} from "../services/vector-store";

/**
 * Fully initialized Feedback Memory Engine exposed to consumers.
 */
export interface FeedbackMemoryEngine {
  intent: IntentDetectionService;
  metadata: MetadataExtractionService;
  embedding: EmbeddingService;
  vectorStore: VectorStoreService;
}

/**
 * Optional service overrides for dependency injection in tests or custom wiring.
 */
export interface FeedbackMemoryEngineOptions {
  intent?: IntentDetectionService;
  metadata?: MetadataExtractionService;
  embedding?: EmbeddingService;
  vectorStore?: VectorStoreService;
}

/**
 * Constructs a {@link FeedbackMemoryEngine} with default or injected services.
 */
export const createFeedbackMemoryEngine = (
  options: FeedbackMemoryEngineOptions = {}
): FeedbackMemoryEngine => {
  return {
    intent: options.intent ?? createIntentDetectionService(),
    metadata: options.metadata ?? createMetadataExtractionService(),
    embedding: options.embedding ?? createEmbeddingService(),
    vectorStore: options.vectorStore ?? createVectorStoreService(),
  };
};

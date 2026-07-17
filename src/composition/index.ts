/**
 * Composition root — provider registry, factories, and dependency wiring.
 */
export {
  createIntentDetectionProvider,
  registerIntentDetectionProvider,
  UnknownIntentProviderError,
} from "./IntentProviderFactory";
export {
  createMetadataExtractionProvider,
  registerMetadataExtractionProvider,
  UnknownMetadataProviderError,
} from "./MetadataProviderFactory";
export {
  createEmbeddingProvider,
  registerEmbeddingProvider,
  UnknownEmbeddingProviderError,
} from "./EmbeddingProviderFactory";
export {
  createVectorStoreProvider,
  registerVectorStoreProvider,
  UnknownVectorStoreProviderError,
} from "./VectorStoreProviderFactory";
export {
  createFeedbackMemoryEngine,
} from "./createFeedbackMemoryEngine";
export type {
  FeedbackMemoryEngine,
  FeedbackMemoryEngineOptions,
} from "./createFeedbackMemoryEngine";

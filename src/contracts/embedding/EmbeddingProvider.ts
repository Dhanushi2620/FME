/**
 * Embedding Provider Contract
 *
 * Defines the interface that all text embedding implementations must satisfy.
 * Embedding providers convert normalized text into dense numeric vectors used by
 * the memory read and write paths for semantic retrieval and storage.
 *
 * Business logic depends exclusively on this contract — never on MiniLM, BGE, E5,
 * OpenAI Embeddings, or any specific model or inference backend. Implementations
 * are swappable via configuration without changing services, pipelines, or hooks.
 */

/**
 * Declares how the embedding will be used.
 *
 * Some models apply different encoding strategies for queries vs documents.
 * Providers interpret this hint according to their backend capabilities.
 */
export type EmbeddingPurpose = "query" | "document";

/**
 * Input supplied to an embedding provider.
 */
export interface EmbeddingInput {
  /**
   * Normalized text to embed.
   * Callers should pass trimmed, normalized strings; providers must tolerate empty input.
   */
  text: string;

  /**
   * Optional usage hint for asymmetric embedding models.
   * Defaults to `"document"` when omitted.
   */
  purpose?: EmbeddingPurpose;
}

/**
 * Result returned by an embedding provider for a single text input.
 */
export interface EmbeddingResult {
  /**
   * Dense numeric embedding vector for the input text.
   * Length must equal {@link EmbeddingResult.dimensions}.
   */
  vector: number[];

  /**
   * Dimensionality of {@link EmbeddingResult.vector}.
   * Must match {@link EmbeddingProvider.getDimensions} for the provider instance.
   */
  dimensions: number;

  /**
   * Optional model identifier reported by the provider for logging and diagnostics.
   * Sourced from configuration — must not be referenced by business rules.
   */
  modelId?: string;
}

/**
 * Contract for embedding providers.
 *
 * Each implementation wraps a specific embedding backend (local model, remote inference
 * service, vendor API, etc.) and returns normalized {@link EmbeddingResult} values.
 */
export interface EmbeddingProvider {
  /**
   * Stable, configuration-friendly identifier for this provider instance
   * (e.g. `"minilm-l6-v2"`, `"bge-small"`, `"e5-base"`, `"openai"`).
   * Used by the composition layer for registry lookup — not for runtime branching in services.
   */
  readonly providerId: string;

  /**
   * Converts normalized text into a dense embedding vector.
   *
   * Implementations must:
   * - Return a finite numeric vector with consistent dimensionality.
   * - Return a zero-length vector or throw only for unrecoverable infrastructure errors,
   *   depending on provider policy (callers apply fail-open where appropriate).
   * - Never embed business logic about storage, retrieval, or validation.
   */
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;

  /**
   * Returns the dimensionality of vectors produced by this provider instance.
   * Enables vector store initialization and validation without performing inference.
   */
  getDimensions(): number;

  /**
   * Optional liveness probe for providers that depend on external inference services.
   */
  healthCheck?(): Promise<boolean>;
}

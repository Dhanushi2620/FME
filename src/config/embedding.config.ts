/**
 * Embedding Configuration
 *
 * Configures how normalized text is converted into dense embedding vectors for
 * memory write and read paths. This module selects and parameterizes
 * {@link EmbeddingProvider} implementations — it does not define the
 * {@link EmbeddingResult} schema (see contracts/embedding).
 *
 * Swap providers by changing `provider.id` and matching `provider.options` only.
 */

/**
 * Registry identifiers for embedding providers.
 *
 * The composition layer resolves `id` to a concrete provider implementation.
 * Adding a future provider requires extending this union and its corresponding
 * options entry in {@link EmbeddingProviderOptionsMap}.
 */
export type EmbeddingProviderId =
  | "minilm-l6-v2"
  | "bge"
  | "e5"
  | "openai"
  | "custom";

/**
 * Inference endpoint settings shared across embedding providers.
 * Interpreted exclusively by provider implementations — never by business logic.
 */
export interface EmbeddingInferenceConfig {
  /**
   * Base URL of the remote embedding inference service.
   */
  serviceUrl?: string;

  /**
   * Maximum time in milliseconds to wait for an embedding response.
   */
  timeoutMs?: number;

  /**
   * Vendor or HuggingFace model identifier
   * (e.g. `"sentence-transformers/all-MiniLM-L6-v2"`, `"BAAI/bge-small-en-v1.5"`).
   */
  modelId?: string;
}

/** Options for the MiniLM-L6-v2 embedding provider. */
export interface MinilmEmbeddingProviderOptions {
  inference?: EmbeddingInferenceConfig;

  /**
   * Expected dimensionality of vectors produced by this model.
   * Used by providers and vector store initialization — not hardcoded in services.
   */
  dimensions: number;

  /** When true, L2-normalize vectors before returning. */
  normalize?: boolean;
}

/** Options for a BGE embedding provider. */
export interface BgeEmbeddingProviderOptions {
  inference?: EmbeddingInferenceConfig;
  dimensions: number;
  normalize?: boolean;
}

/** Options for an E5 embedding provider. */
export interface E5EmbeddingProviderOptions {
  inference?: EmbeddingInferenceConfig;
  dimensions: number;
  normalize?: boolean;
}

/** Options for an OpenAI embedding provider. */
export interface OpenAiEmbeddingProviderOptions {
  inference?: EmbeddingInferenceConfig;
  dimensions: number;
  apiKeyEnvVar?: string;
}

/** Open-ended options bag for custom or experimental providers. */
export type CustomEmbeddingProviderOptions = Record<string, unknown>;

/**
 * Maps each {@link EmbeddingProviderId} to its strongly typed options shape.
 * The provider factory passes `options` verbatim to the matching implementation.
 */
export interface EmbeddingProviderOptionsMap {
  "minilm-l6-v2": MinilmEmbeddingProviderOptions;
  bge: BgeEmbeddingProviderOptions;
  e5: E5EmbeddingProviderOptions;
  openai: OpenAiEmbeddingProviderOptions;
  custom: CustomEmbeddingProviderOptions;
}

/**
 * Provider selection block consumed by the future embedding provider factory.
 * Discriminated on `id` so options are type-safe per provider.
 */
export type EmbeddingProviderConfig<
  TProviderId extends EmbeddingProviderId = EmbeddingProviderId,
> = {
  id: TProviderId;
  options: EmbeddingProviderOptionsMap[TProviderId];
};

/**
 * Top-level embedding configuration.
 */
export interface EmbeddingConfig {
  /** Active provider selection and provider-specific options. */
  provider: EmbeddingProviderConfig;
}

export const DEFAULT_MINILM_EMBEDDING_OPTIONS: MinilmEmbeddingProviderOptions = {
  inference: {
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
    serviceUrl: "http://127.0.0.1:8003",
    timeoutMs: 5_000,
  },
  dimensions: 384,
  normalize: true,
};

/**
 * Default embedding configuration.
 *
 * Swap providers by changing `provider.id` and the matching `provider.options`
 * entry — no business logic changes required.
 */
export const EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: {
    id: "minilm-l6-v2",
    options: DEFAULT_MINILM_EMBEDDING_OPTIONS,
  },
};

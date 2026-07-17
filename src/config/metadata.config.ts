/**
 * Metadata Extraction Configuration
 *
 * Configures how developer feedback is transformed into structured engineering
 * knowledge on the WRITE path. This module selects and parameterizes
 * {@link MetadataExtractionProvider} implementations — it does not define the
 * {@link ExtractedMetadata} schema (see contracts/extraction).
 *
 * Swap providers by changing `provider.id` and matching `provider.options` only.
 */

/**
 * Registry identifiers for metadata extraction providers.
 *
 * The composition layer resolves `id` to a concrete provider implementation.
 * Adding a future provider requires extending this union and its corresponding
 * options entry in {@link MetadataExtractionProviderOptionsMap}.
 */
export type MetadataExtractionProviderId =
  | "cursor-agent"
  | "qwen"
  | "gemma"
  | "claude"
  | "custom";

/**
 * Inference endpoint settings shared across metadata extraction providers.
 * Interpreted exclusively by provider implementations — never by business logic.
 */
export interface MetadataExtractionInferenceConfig {
  /**
   * Base URL of the remote agent or LLM inference service.
   */
  serviceUrl?: string;

  /**
   * Maximum time in milliseconds to wait for an extraction response.
   */
  timeoutMs?: number;

  /**
   * Vendor or model identifier (e.g. `"qwen2.5-7b-instruct"`, `"claude-3-5-sonnet"`).
   */
  modelId?: string;
}

/**
 * Confidence threshold applied by metadata extraction services after a provider
 * returns a result. Providers emit raw scores; services compare against this cutoff.
 */
export interface MetadataExtractionThresholdsConfig {
  /**
   * Minimum confidence required to accept extracted metadata for downstream
   * validation and storage.
   */
  minConfidence: number;
}

/** Options for the Cursor Agent metadata extraction provider. */
export interface CursorAgentMetadataProviderOptions {
  inference?: MetadataExtractionInferenceConfig;

  /**
   * Agent identifier used by the Cursor Agent backend.
   */
  agentId?: string;

  /**
   * System prompt template guiding structured metadata extraction output.
   */
  systemPrompt?: string;
}

/** Options for a Qwen-based metadata extraction provider. */
export interface QwenMetadataProviderOptions {
  inference?: MetadataExtractionInferenceConfig;
  maxTokens?: number;
  temperature?: number;
}

/** Options for a Gemma-based metadata extraction provider. */
export interface GemmaMetadataProviderOptions {
  inference?: MetadataExtractionInferenceConfig;
  maxTokens?: number;
  temperature?: number;
}

/** Options for a Claude-based metadata extraction provider. */
export interface ClaudeMetadataProviderOptions {
  inference?: MetadataExtractionInferenceConfig;
  maxTokens?: number;
  apiVersion?: string;
}

/** Open-ended options bag for custom or experimental providers. */
export type CustomMetadataProviderOptions = Record<string, unknown>;

/**
 * Maps each {@link MetadataExtractionProviderId} to its strongly typed options shape.
 * The provider factory passes `options` verbatim to the matching implementation.
 */
export interface MetadataExtractionProviderOptionsMap {
  "cursor-agent": CursorAgentMetadataProviderOptions;
  qwen: QwenMetadataProviderOptions;
  gemma: GemmaMetadataProviderOptions;
  claude: ClaudeMetadataProviderOptions;
  custom: CustomMetadataProviderOptions;
}

/**
 * Provider selection block consumed by the future metadata provider factory.
 * Discriminated on `id` so options are type-safe per provider.
 */
export type MetadataExtractionProviderConfig<
  TProviderId extends MetadataExtractionProviderId = MetadataExtractionProviderId,
> = {
  id: TProviderId;
  options: MetadataExtractionProviderOptionsMap[TProviderId];
};

/**
 * Top-level metadata extraction configuration.
 */
export interface MetadataExtractionConfig {
  /** Active provider selection and provider-specific options. */
  provider: MetadataExtractionProviderConfig;

  /** Confidence threshold used by metadata extraction services — not by providers. */
  thresholds: MetadataExtractionThresholdsConfig;
}

export const DEFAULT_METADATA_EXTRACTION_THRESHOLDS: MetadataExtractionThresholdsConfig =
  {
    minConfidence: 0.7,
  };

export const DEFAULT_QWEN_METADATA_OPTIONS: QwenMetadataProviderOptions = {
  inference: {
    serviceUrl: "http://127.0.0.1:8002",
    timeoutMs: 25_000,
    modelId: "qwen2.5:3b",
  },
  temperature: 0.1,
};

/** @deprecated Use {@link DEFAULT_QWEN_METADATA_OPTIONS} — kept for registry compatibility. */
export const DEFAULT_CURSOR_AGENT_METADATA_OPTIONS: CursorAgentMetadataProviderOptions =
  {
    inference: {
      serviceUrl: "http://127.0.0.1:8002",
      timeoutMs: 25_000,
      modelId: "qwen2.5:3b",
    },
    agentId: "default",
  };

/**
 * Default metadata extraction configuration.
 *
 * Uses the :8002 metadata sidecar with Ollama (qwen2.5:3b) as the backend.
 * Set METADATA_PROVIDER=rule-based on the Python service for zero-dependency fallback.
 */
export const METADATA_CONFIG: MetadataExtractionConfig = {
  provider: {
    id: "qwen",
    options: DEFAULT_QWEN_METADATA_OPTIONS,
  },
  thresholds: DEFAULT_METADATA_EXTRACTION_THRESHOLDS,
};

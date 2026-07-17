/**
 * Metadata Extraction Provider Contract
 *
 * Defines the interface that all metadata extraction implementations must satisfy.
 * When a prompt is classified as WRITE, a metadata extraction provider transforms
 * the developer's feedback into structured engineering knowledge suitable for
 * memory storage.
 *
 * Business logic depends exclusively on this contract — never on Cursor Agent,
 * a specific LLM, or any extraction backend. Implementations are swappable via
 * configuration without changing services, pipelines, or hook integration.
 */

/**
 * Feedback categories representing types of persistable engineering knowledge.
 *
 * These align with the Feedback Memory Engine taxonomy and are distinct from
 * pipeline intent labels (WRITE / READ / ANSWER_ONLY) handled by intent detection.
 */
export type FeedbackCategory =
  | "Correction"
  | "Decision"
  | "AntiPattern"
  | "TaskLearning";

/**
 * Input supplied to a metadata extraction provider.
 */
export interface MetadataExtractionInput {
  /**
   * Developer prompt or feedback text to extract metadata from.
   */
  text: string;

  /**
   * Optional conversation identifier for context-aware extraction in future providers.
   */
  conversationId?: string;

  /**
   * Optional message identifier for tracing, idempotency, and observability.
   */
  messageId?: string;

  /**
   * Pre-determined feedback category when classification already ran upstream
   * (e.g. batch BART path). Providers should not re-classify when set.
   */
  category?: FeedbackCategory;

  /**
   * Optional assistant response paired with the developer text for richer extraction.
   */
  aiResponse?: string;
}

/**
 * Structured metadata returned by a metadata extraction provider.
 *
 * Suitable for downstream validation and memory storage. Does not include storage
 * identifiers, duplicate detection, or validation outcomes.
 */
export interface ExtractedMetadata {
  /**
   * Feedback category describing the type of engineering knowledge captured.
   */
  category: FeedbackCategory;

  /**
   * Concise normalized summary of the feedback suitable for embedding and retrieval.
   * This is the primary human-readable memory statement.
   */
  summary: string;

  /**
   * Technologies explicitly mentioned or implied by the feedback
   * (e.g. `"JWT"`, `"Redis"`, `"PostgreSQL"`).
   */
  technologies: string[];

  /**
   * High-level subject areas the feedback relates to
   * (e.g. `"authentication"`, `"session management"`).
   */
  topics: string[];

  /**
   * Specific engineering concepts referenced in the feedback
   * (e.g. `"token refresh"`, `"connection pooling"`).
   */
  concepts: string[];

  /**
   * Provider confidence in the extracted metadata, normalized to the inclusive range [0, 1].
   * Downstream services may apply configurable acceptance thresholds.
   */
  confidence: number;
}

/**
 * Result envelope returned by {@link MetadataExtractionProvider.extractMetadata}.
 */
export interface MetadataExtractionResult {
  /**
   * Structured metadata when extraction succeeds.
   * Absent when the provider cannot extract meaningful metadata from the input.
   */
  metadata?: ExtractedMetadata;

  /**
   * Optional provider-specific label or rule identifier for logging and diagnostics.
   * Must not be referenced by business rules.
   */
  detectedLabel?: string;

  /**
   * Human-readable error when extraction fails, validation rejects the payload,
   * or confidence falls below the configured service threshold.
   */
  error?: string;
}

/**
 * Contract for metadata extraction providers.
 *
 * Each implementation wraps a specific extraction backend (Cursor Agent, local LLM,
 * rule-based parser, etc.) and translates its output into {@link ExtractedMetadata}.
 */
export interface MetadataExtractionProvider {
  /**
   * Stable, configuration-friendly identifier for this provider instance
   * (e.g. `"cursor-agent"`, `"qwen"`, `"rule-based"`).
   * Used by the composition layer for registry lookup — not for runtime branching in services.
   */
  readonly providerId: string;

  /**
   * Extracts structured metadata from developer feedback text.
   *
   * Implementations must:
   * - Map all internal category labels to {@link FeedbackCategory} values.
   * - Populate `summary` with a concise, storage-ready statement.
   * - Normalize `confidence` to [0, 1].
   * - Return an empty result (no `metadata`) when extraction is not possible.
   * - May throw only for unrecoverable infrastructure errors (caller applies fail-open policy).
   */
  extractMetadata(
    input: MetadataExtractionInput
  ): Promise<MetadataExtractionResult>;

  /**
   * Optional liveness probe for providers that depend on external agent or LLM services.
   */
  healthCheck?(): Promise<boolean>;
}

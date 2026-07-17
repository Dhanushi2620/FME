/**
 * Intent Detection Provider Contract
 *
 * Defines the interface that all intent detection implementations must satisfy.
 * Business logic depends exclusively on this contract — never on a concrete model,
 * library, or inference backend.
 *
 * Implementations are swappable via configuration (e.g. rule-based, BART-MNLI,
 * ModernBERT, DistilBERT, Cursor Agent). Changing providers must not require
 * changes to services, pipelines, or the hook integration layer.
 */

/**
 * Pipeline-level intent labels returned by every intent detection provider.
 *
 * Intent detection classifies prompts into one of three pipeline intents only.
 * Feedback subtypes (Correction, Decision, etc.) belong to metadata extraction.
 */
export type DetectedIntent = "WRITE" | "READ" | "ANSWER_ONLY" | "Unknown";

/**
 * Input supplied to an intent detection provider.
 */
export interface IntentDetectionInput {
  /**
   * Prompt or message text to classify.
   * Callers may pass raw or pre-normalized text; providers must tolerate both.
   */
  text: string;

  /**
   * Optional conversation identifier for context-aware detection in future providers.
   */
  conversationId?: string;

  /**
   * Optional message identifier for tracing, idempotency, and observability.
   */
  messageId?: string;
}

/**
 * Result returned by an intent detection provider.
 */
export interface IntentDetectionResult {
  /**
   * Pipeline intent label mapped from the provider's internal classification.
   */
  intent: DetectedIntent;

  /**
   * Provider confidence in the detected intent, normalized to the inclusive range [0, 1].
   * Business logic compares this against configurable thresholds — not hardcoded in providers.
   */
  confidence: number;

  /**
   * Always an empty string from intent detection providers.
   * Statement extraction is performed by metadata extraction on the WRITE path.
   */
  statement: string;

  /**
   * Optional provider-specific label identifier for logging and diagnostics.
   * Must not be referenced by business rules.
   */
  detectedLabel?: string;
}

/**
 * Contract for intent detection providers.
 *
 * Each implementation wraps a specific classification backend and translates its
 * output into {@link IntentDetectionResult}.
 */
export interface IntentDetectionProvider {
  /**
   * Stable, configuration-friendly identifier for this provider instance.
   * Sourced from configuration — not hardcoded in the implementation.
   */
  readonly providerId: string;

  /**
   * Classifies the input text and returns a pipeline-level intent result.
   *
   * Implementations must:
   * - Map all internal labels to {@link DetectedIntent} values.
   * - Normalize confidence to [0, 1].
   * - Return `Unknown` with low confidence on expected classification failures.
   * - May throw only for unrecoverable infrastructure errors (caller applies fail-open policy).
   */
  detectIntent(input: IntentDetectionInput): Promise<IntentDetectionResult>;

  /**
   * Optional liveness probe for providers that depend on external inference services.
   */
  healthCheck?(): Promise<boolean>;
}

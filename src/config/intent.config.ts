/**
 * Intent classification labels produced by intent detection providers.
 *
 * LEGACY (WRITE / READ / ANSWER_ONLY): used by WritePipeline / MCP add-memory and the
 * BartIntentProvider 3-way path. The live Cursor hook does NOT classify prompts this
 * way — it buffers every prompt and always runs READ; batch WRITE uses BART 5-way
 * labels in BatchWriteService (Correction, Decision, AntiPattern, TaskLearning,
 * NotMemoryWorthy).
 *
 * Intent detection answers: which pipeline should handle this prompt?
 * It does not classify feedback subtypes — that belongs to the batch WRITE path.
 */
export type IntentClassificationLabel = "WRITE" | "READ" | "ANSWER_ONLY";

/**
 * Registry identifiers for intent detection providers.
 *
 * The composition layer resolves `id` to a concrete provider implementation.
 * Adding a future provider requires extending this union and its corresponding
 * options entry in {@link IntentDetectionProviderOptionsMap}.
 */
export type IntentDetectionProviderId =
  | "bart-mnli"
  | "rule-based"
  | "modern-bert"
  | "distilbert"
  | "cursor-agent"
  | "custom";

/**
 * Model and inference endpoint settings shared across ML-backed providers.
 * Interpreted exclusively by provider implementations — never by business logic.
 */
export interface IntentDetectionModelConfig {
  /**
   * Vendor or HuggingFace model identifier (e.g. `"facebook/bart-large-mnli"`).
   */
  modelId?: string;

  /**
   * Base URL of a remote inference service. When omitted, the provider uses its
   * built-in default or local inference strategy.
   */
  serviceUrl?: string;

  /**
   * Maximum time in milliseconds to wait for an inference response.
   */
  timeoutMs?: number;
}

/**
 * Minimum confidence thresholds per intent classification label.
 *
 * Applied after a provider returns a result to determine whether the top-scoring
 * label is accepted. Does not encode routing rules or feedback taxonomy.
 */
export interface IntentDetectionThresholdsConfig {
  /** Minimum confidence to accept a `WRITE` classification. */
  write: number;

  /** Minimum confidence to accept a `READ` classification. */
  read: number;

  /** Minimum confidence to accept an `ANSWER_ONLY` classification. */
  answerOnly: number;

  /**
   * Confidence floor when no label meets its threshold. Downstream services
   * apply configured fallback handling for unclassified prompts.
   */
  fallback: number;
}

/** Options for the Phase 2 rule-based keyword/regex classifier provider. */
export interface RuleBasedIntentProviderOptions {
  /** When true, classification is case-sensitive. */
  caseSensitive?: boolean;
}

/** Options for the BART-MNLI zero-shot intent detection provider. */
export interface BartMnliIntentProviderOptions {
  model?: IntentDetectionModelConfig;

  /**
   * Candidate labels forwarded to the zero-shot classifier. Must be
   * {@link IntentClassificationLabel} values only.
   */
  candidateLabels?: readonly IntentClassificationLabel[];

  /** When true, the classifier may return multiple labels above threshold. */
  multiLabel?: boolean;
}

/** Options for a ModernBERT-based intent detection provider. */
export interface ModernBertIntentProviderOptions {
  model?: IntentDetectionModelConfig;
  candidateLabels?: readonly IntentClassificationLabel[];
  maxSequenceLength?: number;
}

/** Options for a DistilBERT-based intent detection provider. */
export interface DistilBertIntentProviderOptions {
  model?: IntentDetectionModelConfig;
  candidateLabels?: readonly IntentClassificationLabel[];
  maxSequenceLength?: number;
}

/** Options for a Cursor Agent-based intent detection provider. */
export interface CursorAgentIntentProviderOptions {
  /**
   * Agent or model identifier used by the Cursor Agent backend.
   */
  agentId?: string;

  /**
   * Maximum time in milliseconds to wait for the agent response.
   */
  timeoutMs?: number;

  /**
   * System prompt template guiding structured intent classification output.
   */
  systemPrompt?: string;
}

/** Open-ended options bag for custom or experimental providers. */
export type CustomIntentProviderOptions = Record<string, unknown>;

/**
 * Maps each {@link IntentDetectionProviderId} to its strongly typed options shape.
 * The provider factory passes `options` verbatim to the matching implementation.
 */
export interface IntentDetectionProviderOptionsMap {
  "bart-mnli": BartMnliIntentProviderOptions;
  "rule-based": RuleBasedIntentProviderOptions;
  "modern-bert": ModernBertIntentProviderOptions;
  distilbert: DistilBertIntentProviderOptions;
  "cursor-agent": CursorAgentIntentProviderOptions;
  custom: CustomIntentProviderOptions;
}

/**
 * Provider selection block consumed by the future provider factory.
 * Discriminated on `id` so options are type-safe per provider.
 */
export type IntentDetectionProviderConfig<
  TProviderId extends IntentDetectionProviderId = IntentDetectionProviderId,
> = {
  id: TProviderId;
  options: IntentDetectionProviderOptionsMap[TProviderId];
};

/**
 * Top-level intent detection configuration.
 */
export interface IntentDetectionConfig {
  /** Active provider selection and provider-specific options. */
  provider: IntentDetectionProviderConfig;

  /** Per-label confidence thresholds for accepting a classification result. */
  thresholds: IntentDetectionThresholdsConfig;
}

/**
 * Default intent classification labels for ML-backed providers.
 * LEGACY 3-way routing labels — not used by the live Cursor hook / Cron batch path.
 */
export const DEFAULT_INTENT_CANDIDATE_LABELS: readonly IntentClassificationLabel[] =
  ["WRITE", "READ", "ANSWER_ONLY"] as const;

export const DEFAULT_INTENT_DETECTION_THRESHOLDS: IntentDetectionThresholdsConfig =
  {
    write: 0.75,
    read: 0.6,
    answerOnly: 0.6,
    fallback: 0.0,
  };

export const DEFAULT_BART_MNLI_PROVIDER_OPTIONS: BartMnliIntentProviderOptions =
  {
    model: {
      modelId: "facebook/bart-large-mnli",
      serviceUrl: "http://127.0.0.1:8001",
      timeoutMs: 5_000,
    },
    candidateLabels: DEFAULT_INTENT_CANDIDATE_LABELS,
    multiLabel: false,
  };

/**
 * Default intent detection configuration.
 *
 * LEGACY: powers the 3-way WRITE/READ/ANSWER_ONLY classifier for WritePipeline/MCP.
 * Live hook path ignores this and uses buffer + READ + BatchWriteService 5-way BART.
 *
 * Swap providers by changing `provider.id` and the matching `provider.options`
 * entry — no business logic changes required.
 */
export const INTENT_CONFIG: IntentDetectionConfig = {
  provider: {
    id: "bart-mnli",
    options: DEFAULT_BART_MNLI_PROVIDER_OPTIONS,
  },
  thresholds: DEFAULT_INTENT_DETECTION_THRESHOLDS,
};

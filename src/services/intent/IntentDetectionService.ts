/**
 * Intent Detection Service
 *
 * Public API for intent classification. All consumers (hook, MCP, pipelines) should
 * depend on this service — never on {@link IntentDetectionProvider} implementations
 * or the provider factory directly.
 *
 * The service obtains the configured provider via {@link createIntentDetectionProvider},
 * delegates classification, and applies confidence thresholds from intent configuration.
 * Provider-specific details (BART, ModernBERT, Cursor Agent, etc.) remain hidden.
 */

import {
  DetectedIntent,
  IntentDetectionInput,
  IntentDetectionProvider,
  IntentDetectionResult,
} from "../../contracts/intent";
import {
  INTENT_CONFIG,
  IntentDetectionConfig,
  IntentDetectionThresholdsConfig,
} from "../../config/intent.config";
import { createIntentDetectionProvider } from "../../composition/IntentProviderFactory";

const UNKNOWN_RESULT: IntentDetectionResult = {
  intent: "Unknown",
  confidence: 0,
  statement: "",
};

const getThresholdForIntent = (
  intent: DetectedIntent,
  thresholds: IntentDetectionThresholdsConfig
): number => {
  switch (intent) {
    case "WRITE":
      return thresholds.write;
    case "READ":
      return thresholds.read;
    case "ANSWER_ONLY":
      return thresholds.answerOnly;
    case "Unknown":
      return thresholds.fallback;
  }
};

const applyConfidenceThresholds = (
  result: IntentDetectionResult,
  thresholds: IntentDetectionThresholdsConfig
): IntentDetectionResult => {
  if (result.intent === "Unknown") {
    return result;
  }

  const requiredConfidence = getThresholdForIntent(result.intent, thresholds);

  if (result.confidence >= requiredConfidence) {
    return result;
  }

  return {
    intent: "Unknown",
    confidence: result.confidence,
    statement: "",
    detectedLabel: result.detectedLabel,
  };
};

export type IntentDetectionServiceOptions = {
  config?: IntentDetectionConfig;
  createProvider?: (config: IntentDetectionConfig) => IntentDetectionProvider;
};

/**
 * Service responsible for intent detection across the Feedback Memory Engine.
 */
export class IntentDetectionService {
  private readonly config: IntentDetectionConfig;

  private readonly provider: IntentDetectionProvider;

  constructor(options: IntentDetectionServiceOptions = {}) {
    this.config = options.config ?? INTENT_CONFIG;
    const createProvider = options.createProvider ?? createIntentDetectionProvider;
    this.provider = createProvider(this.config);
  }

  /**
   * Classifies the input prompt using the configured provider and applies
   * configured confidence thresholds before returning the final result.
   */
  async detectIntent(
    input: IntentDetectionInput
  ): Promise<IntentDetectionResult> {
    try {
      const providerResult = await this.provider.detectIntent(input);
      return applyConfidenceThresholds(providerResult, this.config.thresholds);
    } catch {
      return UNKNOWN_RESULT;
    }
  }
}

/**
 * Creates an {@link IntentDetectionService} using the supplied or default configuration.
 */
export const createIntentDetectionService = (
  options: IntentDetectionServiceOptions = {}
): IntentDetectionService => {
  return new IntentDetectionService(options);
};

/**
 * Metadata Extraction Service
 *
 * Public API for structured engineering metadata extraction on the WRITE path.
 * All consumers (write pipeline, hook, MCP) should depend on this service — never
 * on {@link MetadataExtractionProvider} implementations or the provider factory directly.
 *
 * The service obtains the configured provider via {@link createMetadataExtractionProvider},
 * delegates extraction, and applies confidence thresholds from metadata configuration.
 * Provider-specific details (Cursor Agent, Qwen, Gemma, Claude, etc.) remain hidden.
 */

import {
  MetadataExtractionInput,
  MetadataExtractionProvider,
  MetadataExtractionResult,
} from "../../contracts/extraction";
import {
  METADATA_CONFIG,
  MetadataExtractionConfig,
} from "../../config/metadata.config";
import { createMetadataExtractionProvider } from "../../composition/MetadataProviderFactory";
import { logMetadataFinal, logMetadataValidation } from "../../utils/metadataExtractionDiagnostics";

const applyConfidenceThreshold = (
  result: MetadataExtractionResult,
  minConfidence: number,
  providerId: string
): MetadataExtractionResult => {
  if (result.error) {
    return result;
  }

  if (!result.metadata) {
    return {
      ...result,
      error: result.error ?? "Metadata provider returned no metadata.",
    };
  }

  if (result.metadata.confidence >= minConfidence) {
    logMetadataValidation({
      providerId,
      accepted: true,
      reason: `confidence ${result.metadata.confidence} >= threshold ${minConfidence}`,
    });
    return result;
  }

  const error = `Metadata confidence ${result.metadata.confidence} is below threshold ${minConfidence}`;

  logMetadataValidation({
    providerId,
    accepted: false,
    reason: error,
  });
  logMetadataFinal({
    providerId,
    error,
  });

  return {
    detectedLabel: result.detectedLabel,
    error,
  };
};

export type MetadataExtractionServiceOptions = {
  config?: MetadataExtractionConfig;
  provider?: MetadataExtractionProvider;
  createProvider?: (config: MetadataExtractionConfig) => MetadataExtractionProvider;
};

/**
 * Service responsible for metadata extraction across the Feedback Memory Engine.
 */
export class MetadataExtractionService {
  private readonly config: MetadataExtractionConfig;

  private readonly provider: MetadataExtractionProvider;

  constructor(options: MetadataExtractionServiceOptions = {}) {
    this.config = options.config ?? METADATA_CONFIG;

    if (options.provider) {
      this.provider = options.provider;
      return;
    }

    const createProvider =
      options.createProvider ?? createMetadataExtractionProvider;
    this.provider = createProvider(this.config);
  }

  /**
   * Extracts structured metadata using the configured provider and applies
   * configured confidence thresholds before returning the final result.
   */
  async extractMetadata(
    input: MetadataExtractionInput
  ): Promise<MetadataExtractionResult> {
    try {
      const providerResult = await this.provider.extractMetadata(input);

      if (providerResult.error) {
        return providerResult;
      }

      return applyConfidenceThreshold(
        providerResult,
        this.config.thresholds.minConfidence,
        this.provider.providerId
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Metadata extraction failed with an unknown error.";

      logMetadataFinal({
        providerId: this.provider.providerId,
        error: message,
      });

      return { error: message };
    }
  }
}

/**
 * Creates a {@link MetadataExtractionService} using the supplied or default configuration.
 */
export const createMetadataExtractionService = (
  options: MetadataExtractionServiceOptions = {}
): MetadataExtractionService => {
  return new MetadataExtractionService(options);
};

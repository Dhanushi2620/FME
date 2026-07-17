/**
 * Embedding Service
 *
 * Public API for converting normalized text into embedding vectors on the WRITE
 * and READ paths. All consumers (pipelines, hook, MCP) should depend on this
 * service — never on {@link EmbeddingProvider} implementations or the provider
 * factory directly.
 *
 * The service obtains the configured provider via {@link createEmbeddingProvider}
 * and delegates embedding generation. Provider-specific details (MiniLM, BGE, E5,
 * OpenAI, etc.) remain hidden from consumers.
 */

import {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
} from "../../contracts/embedding";
import { EMBEDDING_CONFIG, EmbeddingConfig } from "../../config/embedding.config";
import { createEmbeddingProvider } from "../../composition/EmbeddingProviderFactory";

const createEmptyResult = (dimensions: number): EmbeddingResult => {
  return {
    vector: [],
    dimensions,
  };
};

export type EmbeddingServiceOptions = {
  config?: EmbeddingConfig;
  provider?: EmbeddingProvider;
  createProvider?: (config: EmbeddingConfig) => EmbeddingProvider;
};

/**
 * Service responsible for text embedding across the Feedback Memory Engine.
 */
export class EmbeddingService {
  private readonly provider: EmbeddingProvider;

  constructor(options: EmbeddingServiceOptions = {}) {
    const config = options.config ?? EMBEDDING_CONFIG;

    if (options.provider) {
      this.provider = options.provider;
      return;
    }

    const createProvider = options.createProvider ?? createEmbeddingProvider;
    this.provider = createProvider(config);
  }

  /**
   * Generates an embedding vector for the input text using the configured provider.
   */
  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    try {
      return await this.provider.embed(input);
    } catch {
      return createEmptyResult(this.provider.getDimensions());
    }
  }
}

/**
 * Creates an {@link EmbeddingService} using the supplied or default configuration.
 */
export const createEmbeddingService = (
  options: EmbeddingServiceOptions = {}
): EmbeddingService => {
  return new EmbeddingService(options);
};

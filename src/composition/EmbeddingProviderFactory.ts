/**
 * Embedding Provider Factory
 *
 * Single composition point that maps configured provider identifiers to concrete
 * {@link EmbeddingProvider} implementations. This is the ONLY module in the
 * application that may import provider classes from `providers/embedding/`.
 *
 * Callers receive the {@link EmbeddingProvider} interface — never a concrete class.
 */

import { EmbeddingProvider } from "../contracts/embedding";
import {
  EMBEDDING_CONFIG,
  EmbeddingConfig,
  EmbeddingProviderId,
} from "../config/embedding.config";
import { MiniLMEmbeddingProvider } from "../providers/embedding/minilm";

/** Thrown when configuration references an unregistered embedding provider id. */
export class UnknownEmbeddingProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`Unknown embedding provider: ${providerId}`);
    this.name = "UnknownEmbeddingProviderError";
    this.providerId = providerId;
  }
}

type EmbeddingProviderFactoryFn = (
  config: EmbeddingConfig
) => EmbeddingProvider;

/**
 * Registry of embedding provider constructors keyed by configuration id.
 *
 * To add a new provider:
 * 1. Implement {@link EmbeddingProvider} under `providers/embedding/<name>/`.
 * 2. Add one entry here mapping the config id to `new Provider(config)`.
 * 3. No changes required in services, pipelines, hooks, or MCP.
 */
const EMBEDDING_PROVIDER_REGISTRY: Partial<
  Record<EmbeddingProviderId, EmbeddingProviderFactoryFn>
> = {
  "minilm-l6-v2": (config) => new MiniLMEmbeddingProvider(config),
};

/**
 * Constructs the configured {@link EmbeddingProvider}.
 *
 * Reads `config.provider.id` to select the implementation. Defaults to
 * {@link EMBEDDING_CONFIG} when no configuration is supplied.
 */
export const createEmbeddingProvider = (
  config: EmbeddingConfig = EMBEDDING_CONFIG
): EmbeddingProvider => {
  const providerId = config.provider.id;
  const factory = EMBEDDING_PROVIDER_REGISTRY[providerId];

  if (!factory) {
    throw new UnknownEmbeddingProviderError(providerId);
  }

  return factory(config);
};

/**
 * Registers an embedding provider factory at runtime.
 *
 * Intended for custom or experimental providers without modifying the static registry.
 */
export const registerEmbeddingProvider = (
  providerId: EmbeddingProviderId,
  factory: EmbeddingProviderFactoryFn
): void => {
  EMBEDDING_PROVIDER_REGISTRY[providerId] = factory;
};

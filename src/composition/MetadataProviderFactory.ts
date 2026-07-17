/**
 * Metadata Provider Factory
 *
 * Single composition point that maps configured provider identifiers to concrete
 * {@link MetadataExtractionProvider} implementations. This is the ONLY module in the
 * application that may import provider classes from `providers/extraction/`.
 *
 * Callers receive the {@link MetadataExtractionProvider} interface — never a concrete class.
 */

import { MetadataExtractionProvider } from "../contracts/extraction";
import {
  METADATA_CONFIG,
  MetadataExtractionConfig,
  MetadataExtractionProviderId,
} from "../config/metadata.config";
import { OllamaMetadataExtractionProvider } from "../providers/extraction/ollama";

/** Thrown when configuration references an unregistered metadata provider id. */
export class UnknownMetadataProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`Unknown metadata extraction provider: ${providerId}`);
    this.name = "UnknownMetadataProviderError";
    this.providerId = providerId;
  }
}

type MetadataProviderFactoryFn = (
  config: MetadataExtractionConfig
) => MetadataExtractionProvider;

/**
 * Registry of metadata provider constructors keyed by configuration id.
 *
 * To add a new provider:
 * 1. Implement {@link MetadataExtractionProvider} under `providers/extraction/<name>/`.
 * 2. Add one entry here mapping the config id to `new Provider(config)`.
 * 3. No changes required in services, pipelines, hooks, or MCP.
 */
const METADATA_PROVIDER_REGISTRY: Partial<
  Record<MetadataExtractionProviderId, MetadataProviderFactoryFn>
> = {
  "cursor-agent": (config) => new OllamaMetadataExtractionProvider(config),
  qwen: (config) => new OllamaMetadataExtractionProvider(config),
};

/**
 * Constructs the configured {@link MetadataExtractionProvider}.
 *
 * Reads `config.provider.id` to select the implementation. Defaults to
 * {@link METADATA_CONFIG} when no configuration is supplied.
 */
export const createMetadataExtractionProvider = (
  config: MetadataExtractionConfig = METADATA_CONFIG
): MetadataExtractionProvider => {
  const providerId = config.provider.id;
  const factory = METADATA_PROVIDER_REGISTRY[providerId];

  if (!factory) {
    throw new UnknownMetadataProviderError(providerId);
  }

  return factory(config);
};

/**
 * Registers a metadata provider factory at runtime.
 *
 * Intended for custom or experimental providers without modifying the static registry.
 */
export const registerMetadataExtractionProvider = (
  providerId: MetadataExtractionProviderId,
  factory: MetadataProviderFactoryFn
): void => {
  METADATA_PROVIDER_REGISTRY[providerId] = factory;
};

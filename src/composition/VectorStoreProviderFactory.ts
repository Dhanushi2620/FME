/**
 * Vector Store Provider Factory
 *
 * Single composition point that maps configured provider identifiers to concrete
 * {@link VectorStoreProvider} implementations. This is the ONLY module in the
 * application that may import provider classes from `providers/vector-store/`.
 *
 * Callers receive the {@link VectorStoreProvider} interface — never a concrete class.
 */

import { VectorStoreProvider } from "../contracts/vector-store";
import {
  VECTOR_STORE_CONFIG,
  VectorStoreConfig,
  VectorStoreProviderId,
} from "../config/vector-store.config";
import { ChromaDbVectorStoreProvider } from "../providers/vector-store/chromadb";

/** Thrown when configuration references an unregistered vector store provider id. */
export class UnknownVectorStoreProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`Unknown vector store provider: ${providerId}`);
    this.name = "UnknownVectorStoreProviderError";
    this.providerId = providerId;
  }
}

type VectorStoreProviderFactoryFn = (
  config: VectorStoreConfig
) => VectorStoreProvider;

/**
 * Registry of vector store provider constructors keyed by configuration id.
 *
 * To add a new provider:
 * 1. Implement {@link VectorStoreProvider} under `providers/vector-store/<name>/`.
 * 2. Add one entry here mapping the config id to `new Provider(config)`.
 * 3. No changes required in services, pipelines, hooks, or MCP.
 */
const VECTOR_STORE_PROVIDER_REGISTRY: Partial<
  Record<VectorStoreProviderId, VectorStoreProviderFactoryFn>
> = {
  chromadb: (config) => new ChromaDbVectorStoreProvider(config),
};

/**
 * Constructs the configured {@link VectorStoreProvider}.
 *
 * Reads `config.provider.id` to select the implementation. Defaults to
 * {@link VECTOR_STORE_CONFIG} when no configuration is supplied.
 */
export const createVectorStoreProvider = (
  config: VectorStoreConfig = VECTOR_STORE_CONFIG
): VectorStoreProvider => {
  const providerId = config.provider.id;
  const factory = VECTOR_STORE_PROVIDER_REGISTRY[providerId];

  if (!factory) {
    throw new UnknownVectorStoreProviderError(providerId);
  }

  return factory(config);
};

/**
 * Registers a vector store provider factory at runtime.
 *
 * Intended for custom or experimental providers without modifying the static registry.
 */
export const registerVectorStoreProvider = (
  providerId: VectorStoreProviderId,
  factory: VectorStoreProviderFactoryFn
): void => {
  VECTOR_STORE_PROVIDER_REGISTRY[providerId] = factory;
};

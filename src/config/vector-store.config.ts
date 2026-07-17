/**
 * Vector Store Configuration
 *
 * Configures how embedding vectors and memory metadata are persisted and searched.
 * This module selects and parameterizes {@link VectorStoreProvider} implementations —
 * it does not define the {@link VectorMemoryRecord} schema (see contracts/vector-store).
 *
 * Swap providers by changing `provider.id` and matching `provider.options` only.
 */

/**
 * Registry identifiers for vector store providers.
 *
 * The composition layer resolves `id` to a concrete provider implementation.
 * Adding a future provider requires extending this union and its corresponding
 * options entry in {@link VectorStoreProviderOptionsMap}.
 */
export type VectorStoreProviderId =
  | "chromadb"
  | "qdrant"
  | "pinecone"
  | "faiss"
  | "in-memory"
  | "custom";

/**
 * Connection settings shared across vector store providers.
 * Interpreted exclusively by provider implementations — never by business logic.
 */
export interface VectorStoreConnectionConfig {
  /**
   * Base URL or host endpoint for the vector database service.
   */
  endpoint?: string;

  /**
   * Maximum time in milliseconds to wait for storage operations.
   */
  timeoutMs?: number;

  /**
   * Name of the collection, index, or namespace used to store memory vectors.
   */
  collectionName?: string;
}

/** Options for the ChromaDB vector store provider. */
export interface ChromaDbVectorStoreProviderOptions {
  connection?: VectorStoreConnectionConfig;

  /** Optional Chroma tenant identifier. */
  tenant?: string;

  /** Optional Chroma database identifier. */
  database?: string;
}

/** Options for a Qdrant vector store provider. */
export interface QdrantVectorStoreProviderOptions {
  connection?: VectorStoreConnectionConfig;

  /** Environment variable name containing the Qdrant API key, if required. */
  apiKeyEnvVar?: string;
}

/** Options for a Pinecone vector store provider. */
export interface PineconeVectorStoreProviderOptions {
  connection?: VectorStoreConnectionConfig;

  /** Environment variable name containing the Pinecone API key. */
  apiKeyEnvVar?: string;

  /** Pinecone environment or cloud region identifier. */
  environment?: string;
}

/** Options for a FAISS vector store provider. */
export interface FaissVectorStoreProviderOptions {
  connection?: VectorStoreConnectionConfig;

  /** Filesystem path to the FAISS index file, when using local persistence. */
  indexPath?: string;
}

/** Options for an in-memory vector store provider. */
export interface InMemoryVectorStoreProviderOptions {
  connection?: VectorStoreConnectionConfig;

  /** Maximum number of records retained in memory, if bounded. */
  maxRecords?: number;
}

/** Open-ended options bag for custom or experimental providers. */
export type CustomVectorStoreProviderOptions = Record<string, unknown>;

/**
 * Maps each {@link VectorStoreProviderId} to its strongly typed options shape.
 * The provider factory passes `options` verbatim to the matching implementation.
 */
export interface VectorStoreProviderOptionsMap {
  chromadb: ChromaDbVectorStoreProviderOptions;
  qdrant: QdrantVectorStoreProviderOptions;
  pinecone: PineconeVectorStoreProviderOptions;
  faiss: FaissVectorStoreProviderOptions;
  "in-memory": InMemoryVectorStoreProviderOptions;
  custom: CustomVectorStoreProviderOptions;
}

/**
 * Provider selection block consumed by the future vector store provider factory.
 * Discriminated on `id` so options are type-safe per provider.
 */
export type VectorStoreProviderConfig<
  TProviderId extends VectorStoreProviderId = VectorStoreProviderId,
> = {
  id: TProviderId;
  options: VectorStoreProviderOptionsMap[TProviderId];
};

/**
 * Top-level vector store configuration.
 */
export interface VectorStoreConfig {
  /** Active provider selection and provider-specific options. */
  provider: VectorStoreProviderConfig;

  /**
   * Minimum similarity score (0–1) to treat a WRITE as a duplicate of an
   * existing memory. Checked before upsert on the WRITE path.
   */
  deduplicationSimilarityThreshold?: number;
}

export const DEFAULT_DEDUPLICATION_SIMILARITY_THRESHOLD = 0.92;

export const DEFAULT_CHROMADB_VECTOR_STORE_OPTIONS: ChromaDbVectorStoreProviderOptions =
  {
    connection: {
      endpoint: "http://127.0.0.1:8000",
      collectionName: "feedback_memories",
      timeoutMs: 5_000,
    },
    tenant: "default_tenant",
    database: "default_database",
  };

/**
 * Default vector store configuration.
 *
 * Swap providers by changing `provider.id` and the matching `provider.options`
 * entry — no business logic changes required.
 */
export const VECTOR_STORE_CONFIG: VectorStoreConfig = {
  provider: {
    id: "chromadb",
    options: DEFAULT_CHROMADB_VECTOR_STORE_OPTIONS,
  },
  deduplicationSimilarityThreshold: DEFAULT_DEDUPLICATION_SIMILARITY_THRESHOLD,
};

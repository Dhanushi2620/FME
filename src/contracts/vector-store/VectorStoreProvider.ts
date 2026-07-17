/**
 * Vector Store Provider Contract
 *
 * Defines the interface that all vector storage implementations must satisfy.
 * Vector store providers persist embedding vectors with associated memory metadata
 * and support similarity search for the READ path.
 *
 * Business logic depends exclusively on this contract — never on ChromaDB, Qdrant,
 * Pinecone, FAISS, or any specific storage backend. Implementations are swappable
 * via configuration without changing services, pipelines, or hook integration.
 *
 * This contract does NOT define duplicate detection, ranking, selection, or prompt
 * enrichment — those responsibilities belong to higher layers.
 */

/**
 * Domain metadata stored alongside an embedding vector.
 *
 * Represents persistable memory fields without coupling to a specific database schema.
 */
export interface VectorMemoryMetadata {
  /** Unique memory identifier. */
  id: string;

  /** Feedback category (e.g. Correction, Decision, AntiPattern, TaskLearning). */
  category: string;

  /** Primary human-readable memory statement used for display and retrieval context. */
  summary: string;

  /** Conversation identifier for exclusion and traceability. */
  conversationId: string;

  /** Message identifier for exclusion and idempotency. */
  messageId: string;

  /** Optional technology tags associated with the memory. */
  technologies?: string[];

  /** Optional topic tags associated with the memory. */
  topics?: string[];

  /** Optional concept tags associated with the memory. */
  concepts?: string[];

  /** Optional extraction confidence score in the inclusive range [0, 1]. */
  confidence?: number;
}

/**
 * A memory record consisting of an embedding vector and associated metadata.
 */
export interface VectorMemoryRecord {
  /** Unique memory identifier — must match {@link VectorMemoryMetadata.id}. */
  id: string;

  /** Dense embedding vector for similarity search. */
  vector: number[];

  /** Structured metadata payload stored with the vector. */
  metadata: VectorMemoryMetadata;
}

/**
 * Input for upserting a memory record into the vector store.
 */
export interface VectorUpsertMemoryInput {
  record: VectorMemoryRecord;
}

/**
 * Optional filters applied during vector search.
 */
export interface VectorSearchFilter {
  /** Restrict results to one or more feedback categories. */
  categories?: string[];

  /** Exclude memories belonging to this conversation. */
  excludeConversationId?: string;

  /** Exclude a specific message within a conversation. */
  excludeMessageId?: string;
}

/**
 * Input for similarity search against stored memory vectors.
 */
export interface VectorSearchInput {
  /** Query embedding vector. */
  vector: number[];

  /** Maximum number of results to return. */
  topK: number;

  /** Optional metadata filters applied before or after vector search. */
  filter?: VectorSearchFilter;

  /** Optional minimum similarity score in the inclusive range [0, 1]. */
  minScore?: number;
}

/**
 * A single search hit returned by the vector store.
 */
export interface VectorSearchHit {
  /** Memory identifier. */
  id: string;

  /** Similarity score between the query vector and stored vector. */
  score: number;

  /** Metadata payload associated with the stored vector. */
  metadata: VectorMemoryMetadata;
}

/**
 * Input for listing stored memories without similarity search.
 */
export interface VectorListMemoriesInput {
  /** Maximum number of memories to return. */
  limit?: number;
}

/**
 * Result returned by {@link VectorStoreProvider.listMemories}.
 */
export interface VectorListMemoriesResult {
  /** Stored memory metadata records, in provider-defined order. */
  memories: VectorMemoryMetadata[];
}

/**
 * Result returned by {@link VectorStoreProvider.search}.
 */
export interface VectorSearchResult {
  hits: VectorSearchHit[];
}

/**
 * Input for deleting memories from the vector store.
 */
export interface VectorDeleteInput {
  /** Memory identifiers to delete. */
  ids: string[];
}

/**
 * Contract for vector store providers.
 *
 * Each implementation wraps a specific storage backend and exposes a uniform
 * interface for persisting, searching, and deleting embedded memories.
 */
export interface VectorStoreProvider {
  /**
   * Stable, configuration-friendly identifier for this provider instance
   * (e.g. `"chromadb"`, `"qdrant"`, `"pinecone"`, `"faiss"`, `"in-memory"`).
   * Used by the composition layer for registry lookup — not for runtime branching in services.
   */
  readonly providerId: string;

  /**
   * Inserts or updates a memory record in the vector store.
   *
   * Implementations must persist both the embedding vector and metadata payload.
   * Duplicate detection is handled by higher layers — not by the vector store contract.
   */
  upsertMemory(input: VectorUpsertMemoryInput): Promise<void>;

  /**
   * Performs similarity search over stored memory vectors.
   *
   * Returns ranked hits by vector similarity only. Result ordering beyond vector
   * score, ranking blends, and Top-K selection belong to higher layers.
   */
  search(input: VectorSearchInput): Promise<VectorSearchResult>;

  /**
   * Lists stored memories for browsing without similarity search.
   *
   * Returns metadata only — not ranked or enriched. Semantic retrieval belongs
   * to {@link search} and the READ pipeline.
   */
  listMemories(input: VectorListMemoriesInput): Promise<VectorListMemoriesResult>;

  /**
   * Deletes one or more memories from the vector store by identifier.
   */
  delete(input: VectorDeleteInput): Promise<void>;

  /**
   * Probes storage backend availability.
   */
  healthCheck(): Promise<boolean>;
}

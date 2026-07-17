/**
 * Vector Store Service
 *
 * Public API for persisting, searching, and deleting embedded memory records on
 * the WRITE and READ paths. All consumers (pipelines, hook, MCP) should depend
 * on this service — never on {@link VectorStoreProvider} implementations or the
 * provider factory directly.
 *
 * The service obtains the configured provider via {@link createVectorStoreProvider}
 * and delegates storage operations. Provider-specific details (ChromaDB, Qdrant,
 * Pinecone, FAISS, in-memory, etc.) remain hidden from consumers.
 */

import {
  VectorDeleteInput,
  VectorListMemoriesInput,
  VectorListMemoriesResult,
  VectorSearchInput,
  VectorSearchResult,
  VectorStoreProvider,
  VectorUpsertMemoryInput,
} from "../../contracts/vector-store";
import {
  VECTOR_STORE_CONFIG,
  VectorStoreConfig,
} from "../../config/vector-store.config";
import { createVectorStoreProvider } from "../../composition/VectorStoreProviderFactory";

const EMPTY_SEARCH_RESULT: VectorSearchResult = { hits: [] };
const EMPTY_LIST_MEMORIES_RESULT: VectorListMemoriesResult = { memories: [] };
const DEFAULT_LIST_MEMORIES_LIMIT = 50;

export type VectorStoreServiceOptions = {
  config?: VectorStoreConfig;
  provider?: VectorStoreProvider;
  createProvider?: (config: VectorStoreConfig) => VectorStoreProvider;
};

/**
 * Service responsible for vector storage across the Feedback Memory Engine.
 */
export class VectorStoreService {
  private readonly provider: VectorStoreProvider;

  constructor(options: VectorStoreServiceOptions = {}) {
    const config = options.config ?? VECTOR_STORE_CONFIG;

    if (options.provider) {
      this.provider = options.provider;
      return;
    }

    const createProvider = options.createProvider ?? createVectorStoreProvider;
    this.provider = createProvider(config);
  }

  /**
   * Inserts or updates a memory record in the configured vector store.
   *
   * @returns `true` when the provider persisted the record; `false` on failure
   * (fail-open — does not throw).
   */
  async upsertMemory(input: VectorUpsertMemoryInput): Promise<boolean> {
    try {
      await this.provider.upsertMemory(input);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Performs similarity search over stored memory vectors.
   */
  async search(input: VectorSearchInput): Promise<VectorSearchResult> {
    try {
      return await this.provider.search(input);
    } catch {
      return EMPTY_SEARCH_RESULT;
    }
  }

  /**
   * Lists stored memories for browsing without similarity search.
   */
  async listMemories(
    input: VectorListMemoriesInput = {}
  ): Promise<VectorListMemoriesResult> {
    try {
      return await this.provider.listMemories({
        limit: input.limit ?? DEFAULT_LIST_MEMORIES_LIMIT,
      });
    } catch {
      return EMPTY_LIST_MEMORIES_RESULT;
    }
  }

  /**
   * Deletes one or more memories from the vector store by identifier.
   */
  async delete(input: VectorDeleteInput): Promise<void> {
    try {
      await this.provider.delete(input);
    } catch {
      return;
    }
  }

  /**
   * Probes storage backend availability.
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await this.provider.healthCheck();
    } catch {
      return false;
    }
  }
}

/**
 * Creates a {@link VectorStoreService} using the supplied or default configuration.
 */
export const createVectorStoreService = (
  options: VectorStoreServiceOptions = {}
): VectorStoreService => {
  return new VectorStoreService(options);
};

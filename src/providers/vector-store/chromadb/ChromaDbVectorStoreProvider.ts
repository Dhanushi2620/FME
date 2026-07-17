/**
 * ChromaDB Vector Store Provider
 *
 * Provider responsibility
 * -----------------------
 * Persists and queries embedded memory records via the ChromaDB HTTP API.
 * Implements {@link VectorStoreProvider}.
 *
 * Provider boundary
 * -----------------
 * This module is the only layer that knows about ChromaDB REST paths, tenant
 * routing, collection resolution, and Chroma metadata serialization. It does
 * NOT perform ranking, selection, duplicate detection, hook integration, or
 * pipeline orchestration.
 *
 * Configuration usage
 * -------------------
 * All runtime values are read from {@link VectorStoreConfig} at construction
 * time — endpoint, timeout, collection name, tenant, and database are never
 * hardcoded in this module.
 *
 * Failure handling
 * ----------------
 * Connection and HTTP failures return empty search results or resolve silently
 * for mutating operations. This provider does not throw for expected backend
 * failures.
 */

import {
  VectorDeleteInput,
  VectorListMemoriesInput,
  VectorListMemoriesResult,
  VectorMemoryMetadata,
  VectorSearchFilter,
  VectorSearchHit,
  VectorSearchInput,
  VectorSearchResult,
  VectorStoreProvider,
  VectorUpsertMemoryInput,
} from "../../../contracts/vector-store";
import {
  ChromaDbVectorStoreProviderOptions,
  VECTOR_STORE_CONFIG,
  VectorStoreConfig,
} from "../../../config/vector-store.config";

const HEARTBEAT_PATH = "/api/v2/heartbeat";
const EMPTY_SEARCH_RESULT: VectorSearchResult = { hits: [] };
const EMPTY_LIST_MEMORIES_RESULT: VectorListMemoriesResult = { memories: [] };

type ChromaCollectionResponse = {
  id?: string;
  name?: string;
};

type ChromaQueryResponse = {
  ids?: string[][];
  metadatas?: (Record<string, unknown> | null)[][];
  distances?: number[][];
};

type ChromaGetResponse = {
  ids?: string[];
  metadatas?: (Record<string, unknown> | null)[];
};

type ChromaHttpRequest = {
  endpoint: string;
  timeoutMs: number;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
};

/** Connection settings resolved from {@link VectorStoreConfig}. */
export type ChromaDbConnectionContext = {
  endpoint: string;
  timeoutMs: number;
  tenant: string;
  database: string;
  collectionName: string;
};

/**
 * Abstraction over the ChromaDB HTTP API.
 * Enables injection of mock clients in tests without importing HTTP details.
 */
export interface ChromaDbHttpClient {
  heartbeat(request: ChromaDbConnectionContext): Promise<boolean>;
  createCollection(request: ChromaDbConnectionContext): Promise<string | null>;
  upsertRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      body: {
        ids: string[];
        embeddings: number[][];
        metadatas: Record<string, string | number | boolean>[];
      };
    }
  ): Promise<boolean>;
  queryRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      body: Record<string, unknown>;
    }
  ): Promise<ChromaQueryResponse | null>;
  getRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      body: {
        limit?: number;
        offset?: number;
        include?: string[];
      };
    }
  ): Promise<ChromaGetResponse | null>;
  deleteRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      ids: string[];
    }
  ): Promise<boolean>;
}

const normalizeEndpoint = (endpoint: string): string => {
  return endpoint.replace(/\/$/, "");
};

const buildCollectionBasePath = (
  tenant: string,
  database: string
): string => {
  return `/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(database)}/collections`;
};

const executeChromaRequest = async <T>(
  request: ChromaHttpRequest
): Promise<T | null> => {
  const url = `${normalizeEndpoint(request.endpoint)}${request.path}`;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  if (request.timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  }

  try {
    const response = await fetch(url, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      return {} as T;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

/**
 * Default HTTP client for ChromaDB.
 * Provider-specific — never imported by business logic or services.
 */
export class HttpChromaDbClient implements ChromaDbHttpClient {
  async heartbeat(request: ChromaDbConnectionContext): Promise<boolean> {
    const payload = await executeChromaRequest<{ "nanosecond heartbeat"?: number }>(
      {
        ...request,
        method: "GET",
        path: HEARTBEAT_PATH,
      }
    );

    return payload !== null;
  }

  async createCollection(
    request: ChromaDbConnectionContext
  ): Promise<string | null> {
    const payload = await executeChromaRequest<ChromaCollectionResponse>({
      endpoint: request.endpoint,
      timeoutMs: request.timeoutMs,
      method: "POST",
      path: buildCollectionBasePath(request.tenant, request.database),
      body: {
        name: request.collectionName,
        get_or_create: true,
      },
    });

    return typeof payload?.id === "string" ? payload.id : null;
  }

  async upsertRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      body: {
        ids: string[];
        embeddings: number[][];
        metadatas: Record<string, string | number | boolean>[];
      };
    }
  ): Promise<boolean> {
    const payload = await executeChromaRequest<unknown>({
      endpoint: request.endpoint,
      timeoutMs: request.timeoutMs,
      method: "POST",
      path: `${buildCollectionBasePath(request.tenant, request.database)}/${encodeURIComponent(request.collectionId)}/upsert`,
      body: request.body,
    });

    return payload !== null;
  }

  async queryRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      body: Record<string, unknown>;
    }
  ): Promise<ChromaQueryResponse | null> {
    return executeChromaRequest<ChromaQueryResponse>({
      endpoint: request.endpoint,
      timeoutMs: request.timeoutMs,
      method: "POST",
      path: `${buildCollectionBasePath(request.tenant, request.database)}/${encodeURIComponent(request.collectionId)}/query`,
      body: request.body,
    });
  }

  async getRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      body: {
        limit?: number;
        offset?: number;
        include?: string[];
      };
    }
  ): Promise<ChromaGetResponse | null> {
    return executeChromaRequest<ChromaGetResponse>({
      endpoint: request.endpoint,
      timeoutMs: request.timeoutMs,
      method: "POST",
      path: `${buildCollectionBasePath(request.tenant, request.database)}/${encodeURIComponent(request.collectionId)}/get`,
      body: request.body,
    });
  }

  async deleteRecords(
    request: ChromaDbConnectionContext & {
      collectionId: string;
      ids: string[];
    }
  ): Promise<boolean> {
    const payload = await executeChromaRequest<unknown>({
      endpoint: request.endpoint,
      timeoutMs: request.timeoutMs,
      method: "POST",
      path: `${buildCollectionBasePath(request.tenant, request.database)}/${encodeURIComponent(request.collectionId)}/delete`,
      body: { ids: request.ids },
    });

    return payload !== null;
  }
}

const parseStringArray = (value: unknown): string[] | undefined => {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const readMetadataString = (
  metadata: Record<string, unknown>,
  key: keyof VectorMemoryMetadata
): string => {
  const value = metadata[key];

  return typeof value === "string" ? value : "";
};

const toChromaMetadata = (
  metadata: VectorMemoryMetadata
): Record<string, string | number | boolean> => {
  const chromaMetadata: Record<string, string | number | boolean> = {
    id: metadata.id,
    category: metadata.category,
    summary: metadata.summary,
    conversationId: metadata.conversationId,
    messageId: metadata.messageId,
    confidence:
      typeof metadata.confidence === "number"
        ? metadata.confidence
        : parseFloat(String(metadata.confidence || "0")),
  };

  if (metadata.technologies?.length) {
    chromaMetadata.technologies = JSON.stringify(metadata.technologies);
  }

  if (metadata.topics?.length) {
    chromaMetadata.topics = JSON.stringify(metadata.topics);
  }

  if (metadata.concepts?.length) {
    chromaMetadata.concepts = JSON.stringify(metadata.concepts);
  }

  return chromaMetadata;
};

const fromChromaMetadata = (
  id: string,
  metadata: Record<string, unknown> | null
): VectorMemoryMetadata | null => {
  if (!metadata) {
    return null;
  }

  const category = readMetadataString(metadata, "category");
  const summary = readMetadataString(metadata, "summary");
  const conversationId = readMetadataString(metadata, "conversationId");
  const messageId = readMetadataString(metadata, "messageId");

  if (!category || !summary || !conversationId || !messageId) {
    return null;
  }

  return {
    id: readMetadataString(metadata, "id") || id,
    category,
    summary,
    conversationId,
    messageId,
    technologies: parseStringArray(metadata.technologies),
    topics: parseStringArray(metadata.topics),
    concepts: parseStringArray(metadata.concepts),
    confidence:
      typeof metadata.confidence === "number"
        ? metadata.confidence
        : parseFloat(String(metadata.confidence || "0")),
  };
};

const distanceToScore = (distance: number): number => {
  if (!Number.isFinite(distance)) {
    return 0;
  }

  return Math.max(0, Math.min(1, 1 - distance));
};

const buildWhereFilter = (
  filter?: VectorSearchFilter
): Record<string, unknown> | undefined => {
  if (!filter) {
    return undefined;
  }

  const clauses: Record<string, unknown>[] = [];

  if (filter.categories?.length) {
    clauses.push({
      category: { $in: filter.categories },
    });
  }

  if (filter.excludeConversationId) {
    clauses.push({
      conversationId: { $ne: filter.excludeConversationId },
    });
  }

  if (filter.excludeMessageId) {
    clauses.push({
      messageId: { $ne: filter.excludeMessageId },
    });
  }

  if (clauses.length === 0) {
    return undefined;
  }

  if (clauses.length === 1) {
    return clauses[0];
  }

  return { $and: clauses };
};

const mapQueryResponse = (
  response: ChromaQueryResponse,
  minScore?: number
): VectorSearchResult => {
  const resultIds = response.ids?.[0] ?? [];
  const resultMetadatas = response.metadatas?.[0] ?? [];
  const resultDistances = response.distances?.[0] ?? [];
  const hits: VectorSearchHit[] = [];

  for (let index = 0; index < resultIds.length; index += 1) {
    const id = resultIds[index];
    const metadata = fromChromaMetadata(id, resultMetadatas[index] ?? null);
    const score = distanceToScore(resultDistances[index] ?? Number.NaN);

    if (!metadata) {
      continue;
    }

    if (minScore !== undefined && score < minScore) {
      continue;
    }

    hits.push({
      id,
      score,
      metadata,
    });
  }

  return { hits };
};

const mapGetResponse = (response: ChromaGetResponse): VectorListMemoriesResult => {
  const resultIds = response.ids ?? [];
  const resultMetadatas = response.metadatas ?? [];
  const memories: VectorMemoryMetadata[] = [];

  for (let index = 0; index < resultIds.length; index += 1) {
    const id = resultIds[index];
    const metadata = fromChromaMetadata(id, resultMetadatas[index] ?? null);

    if (!metadata) {
      continue;
    }

    memories.push(metadata);
  }

  return { memories };
};

/**
 * ChromaDB implementation of {@link VectorStoreProvider}.
 */
export class ChromaDbVectorStoreProvider implements VectorStoreProvider {
  readonly providerId: string;

  private readonly options: ChromaDbVectorStoreProviderOptions;

  private collectionIdPromise: Promise<string | null> | null = null;

  constructor(
    config: VectorStoreConfig = VECTOR_STORE_CONFIG,
    private readonly httpClient: ChromaDbHttpClient = new HttpChromaDbClient()
  ) {
    this.providerId = config.provider.id;
    this.options = config.provider.options as ChromaDbVectorStoreProviderOptions;
  }

  async upsertMemory(input: VectorUpsertMemoryInput): Promise<void> {
    const { record } = input;

    if (!record.id || record.vector.length === 0) {
      return;
    }

    const requestContext = this.getRequestContext();

    if (!requestContext) {
      return;
    }

    const collectionId = await this.resolveCollectionId(requestContext);

    if (!collectionId) {
      return;
    }

    await this.httpClient.upsertRecords({
      ...requestContext,
      collectionId,
      body: {
        ids: [record.id],
        embeddings: [record.vector],
        metadatas: [toChromaMetadata(record.metadata)],
      },
    });
  }

  async search(input: VectorSearchInput): Promise<VectorSearchResult> {
    if (input.vector.length === 0 || input.topK <= 0) {
      return EMPTY_SEARCH_RESULT;
    }

    const requestContext = this.getRequestContext();

    if (!requestContext) {
      return EMPTY_SEARCH_RESULT;
    }

    const collectionId = await this.resolveCollectionId(requestContext);

    if (!collectionId) {
      return EMPTY_SEARCH_RESULT;
    }

    const where = buildWhereFilter(input.filter);
    const queryBody: Record<string, unknown> = {
      query_embeddings: [input.vector],
      n_results: input.topK,
      include: ["metadatas", "distances"],
    };

    if (where) {
      queryBody.where = where;
    }

    const response = await this.httpClient.queryRecords({
      ...requestContext,
      collectionId,
      body: queryBody,
    });

    if (!response) {
      return EMPTY_SEARCH_RESULT;
    }

    return mapQueryResponse(response, input.minScore);
  }

  async listMemories(
    input: VectorListMemoriesInput
  ): Promise<VectorListMemoriesResult> {
    const limit = input.limit ?? 0;

    if (limit <= 0) {
      return EMPTY_LIST_MEMORIES_RESULT;
    }

    const requestContext = this.getRequestContext();

    if (!requestContext) {
      return EMPTY_LIST_MEMORIES_RESULT;
    }

    const collectionId = await this.resolveCollectionId(requestContext);

    if (!collectionId) {
      return EMPTY_LIST_MEMORIES_RESULT;
    }

    const response = await this.httpClient.getRecords({
      ...requestContext,
      collectionId,
      body: {
        limit,
        include: ["metadatas"],
      },
    });

    if (!response) {
      return EMPTY_LIST_MEMORIES_RESULT;
    }

    return mapGetResponse(response);
  }

  async delete(input: VectorDeleteInput): Promise<void> {
    if (input.ids.length === 0) {
      return;
    }

    const requestContext = this.getRequestContext();

    if (!requestContext) {
      return;
    }

    const collectionId = await this.resolveCollectionId(requestContext);

    if (!collectionId) {
      return;
    }

    await this.httpClient.deleteRecords({
      ...requestContext,
      collectionId,
      ids: input.ids,
    });
  }

  async healthCheck(): Promise<boolean> {
    const requestContext = this.getRequestContext();

    if (!requestContext) {
      return false;
    }

    return this.httpClient.heartbeat(requestContext);
  }

  private getRequestContext(): ChromaDbConnectionContext | null {
    const connection = this.options.connection ?? {};
    const endpoint = connection.endpoint;
    const collectionName = connection.collectionName;
    const tenant = this.options.tenant;
    const database = this.options.database;

    if (!endpoint || !collectionName || !tenant || !database) {
      return null;
    }

    return {
      endpoint,
      timeoutMs: connection.timeoutMs ?? 0,
      tenant,
      database,
      collectionName,
    };
  }

  private resolveCollectionId(
    requestContext: ChromaDbConnectionContext
  ): Promise<string | null> {
    if (!this.collectionIdPromise) {
      this.collectionIdPromise = this.httpClient.createCollection(
        requestContext
      );
    }

    return this.collectionIdPromise;
  }
}

/**
 * MiniLM-L6-v2 Embedding Provider
 *
 * Provider responsibility
 * -----------------------
 * Converts normalized text into dense embedding vectors by delegating inference
 * to a configured remote embedding service. Implements {@link EmbeddingProvider}.
 *
 * Provider boundary
 * -----------------
 * This module is the only layer that knows about MiniLM, HuggingFace model IDs,
 * and the remote embedding HTTP API. It does NOT perform vector storage, retrieval,
 * ranking, validation, duplicate detection, or hook integration.
 *
 * Model loading
 * -------------
 * The MiniLM model is not loaded inside this process. A separate inference service
 * (configured via `inference.serviceUrl` and `inference.modelId`) owns model loading
 * and execution. This provider is a thin HTTP client.
 *
 * Configuration usage
 * -------------------
 * All runtime values are injected via {@link EmbeddingConfig}. Provider id, inference
 * endpoint, timeout, model id, dimensions, and normalize flag are read from
 * configuration at construction time — nothing is hardcoded in this module.
 *
 * Failure handling
 * ----------------
 * Invalid input and inference failures return an empty embedding result without throwing.
 */

import {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingPurpose,
  EmbeddingResult,
} from "../../../contracts/embedding";
import {
  EmbeddingConfig,
  MinilmEmbeddingProviderOptions,
} from "../../../config/embedding.config";

/** Request payload sent to the MiniLM embedding inference service. */
export type MinilmEmbeddingRequest = {
  text: string;
  purpose: EmbeddingPurpose;
  modelId: string;
  serviceUrl: string;
  timeoutMs: number;
  normalize: boolean;
};

/** Raw embedding payload returned by the inference service. */
export type MinilmEmbeddingPayload = {
  embedding?: unknown;
};

/**
 * Abstraction over the MiniLM embedding inference backend.
 * Enables injection of mock clients in tests without importing HTTP details.
 */
export interface MinilmEmbeddingClient {
  embed(request: MinilmEmbeddingRequest): Promise<number[] | null>;
}

const EMBED_PATH = "/v1/embeddings/embed";
const HEALTH_PATH = "/health";

const normalizeText = (text: string): string => {
  return text.trim().replace(/\s+/g, " ");
};

const createEmptyResult = (dimensions: number): EmbeddingResult => {
  return {
    vector: [],
    dimensions,
  };
};

const parseEmbeddingVector = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const vector: number[] = [];

  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return null;
    }

    vector.push(entry);
  }

  return vector;
};

const l2Normalize = (vector: number[]): number[] => {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0)
  );

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
};

/**
 * Default HTTP client for the MiniLM embedding inference service.
 * Provider-specific — never imported by business logic or services.
 */
export class HttpMinilmEmbeddingClient implements MinilmEmbeddingClient {
  async embed(request: MinilmEmbeddingRequest): Promise<number[] | null> {
    const url = `${request.serviceUrl.replace(/\/$/, "")}${EMBED_PATH}`;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (request.timeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: request.text,
          model_id: request.modelId,
          purpose: request.purpose,
          normalize: request.normalize,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as MinilmEmbeddingPayload;
      return parseEmbeddingVector(payload.embedding);
    } catch {
      return null;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

/**
 * MiniLM-L6-v2 implementation of {@link EmbeddingProvider}.
 */
export class MiniLMEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: string;

  private readonly options: MinilmEmbeddingProviderOptions;

  constructor(
    config: EmbeddingConfig,
    private readonly embeddingClient: MinilmEmbeddingClient = new HttpMinilmEmbeddingClient()
  ) {
    this.providerId = config.provider.id;
    this.options = config.provider.options as MinilmEmbeddingProviderOptions;
  }

  /**
   * Returns configured embedding dimensionality without performing inference.
   */
  getDimensions(): number {
    return this.options.dimensions;
  }

  /**
   * Embeds normalized text via the configured MiniLM inference service.
   */
  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const dimensions = this.getDimensions();
    const text = normalizeText(input.text);

    if (!text) {
      return createEmptyResult(dimensions);
    }

    const inference = this.options.inference ?? {};

    if (!inference.serviceUrl || !inference.modelId) {
      return createEmptyResult(dimensions);
    }

    const vector = await this.embeddingClient.embed({
      text,
      purpose: input.purpose ?? "document",
      modelId: inference.modelId,
      serviceUrl: inference.serviceUrl,
      timeoutMs: inference.timeoutMs ?? 0,
      normalize: this.options.normalize ?? false,
    });

    if (!vector || vector.length !== dimensions) {
      return createEmptyResult(dimensions);
    }

    const finalVector =
      this.options.normalize === true ? l2Normalize(vector) : vector;

    return {
      vector: finalVector,
      dimensions,
      modelId: inference.modelId,
    };
  }

  /**
   * Probes the configured embedding service liveness endpoint.
   */
  async healthCheck(): Promise<boolean> {
    const serviceUrl = this.options.inference?.serviceUrl;

    if (!serviceUrl) {
      return false;
    }

    const url = `${serviceUrl.replace(/\/$/, "")}${HEALTH_PATH}`;
    const timeoutMs = this.options.inference?.timeoutMs ?? 0;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

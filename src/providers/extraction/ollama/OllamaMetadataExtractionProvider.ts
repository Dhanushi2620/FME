/**
 * Ollama Metadata Extraction Provider
 *
 * Provider responsibility
 * -----------------------
 * Transforms developer feedback text into structured {@link ExtractedMetadata}
 * by delegating extraction to the Ollama metadata sidecar (HTTP :8002).
 *
 * Provider boundary
 * -----------------
 * This module is the only layer that knows about the metadata sidecar HTTP API.
 * It implements {@link MetadataExtractionProvider} and maps sidecar responses
 * to domain metadata fields.
 *
 * It does NOT perform validation, duplicate detection, embedding, vector storage,
 * persistence, hook integration, or service orchestration.
 *
 * Configuration usage
 * -------------------
 * All runtime values are injected via {@link MetadataExtractionConfig}. Provider id,
 * inference endpoint, timeout, and optional system prompt are read from configuration
 * at construction time — nothing is hardcoded in this module.
 *
 * Expected output
 * ---------------
 * Returns {@link MetadataExtractionResult} with populated {@link ExtractedMetadata}
 * on success, or an error message when extraction is not possible.
 */

import {
  ExtractedMetadata,
  FeedbackCategory,
  MetadataExtractionInput,
  MetadataExtractionProvider,
  MetadataExtractionResult,
} from "../../../contracts/extraction";
import {
  MetadataExtractionConfig,
  MetadataExtractionInferenceConfig,
} from "../../../config/metadata.config";
import { MetadataExtractionRequestError } from "./MetadataExtractionRequestError";
import {
  logMetadataFinal,
  logMetadataRawResponse,
  logMetadataRequest,
  logMetadataValidation,
} from "../../../utils/metadataExtractionDiagnostics";

/** Runtime options consumed by the Ollama metadata sidecar HTTP client. */
export type OllamaMetadataProviderOptions = {
  inference?: MetadataExtractionInferenceConfig;
  agentId?: string;
  systemPrompt?: string;
};

/** Request payload sent to the Ollama metadata extraction sidecar. */
export type OllamaMetadataExtractionRequest = {
  text: string;
  conversationId?: string;
  messageId?: string;
  agentId?: string;
  category?: FeedbackCategory;
  aiResponse?: string;
  /** Omit to let the metadata sidecar apply its structured JSON system prompt. */
  systemPrompt?: string;
  serviceUrl: string;
  timeoutMs: number;
  modelId?: string;
};

/** Raw metadata payload returned by the Ollama metadata sidecar. */
export type OllamaMetadataExtractionPayload = {
  category?: string;
  summary?: string;
  technologies?: unknown;
  topics?: unknown;
  concepts?: unknown;
  confidence?: number;
};

/**
 * Abstraction over the Ollama metadata sidecar backend.
 * Enables injection of mock clients in tests without importing HTTP details.
 */
export interface OllamaMetadataExtractionClient {
  extractMetadata(
    request: OllamaMetadataExtractionRequest
  ): Promise<OllamaMetadataExtractionPayload>;
}

const EXTRACT_PATH = "/v1/metadata/extract";
const HEALTH_PATH = "/health";

const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = [
  "Correction",
  "Decision",
  "AntiPattern",
  "TaskLearning",
];

const isFeedbackCategory = (value: string): value is FeedbackCategory => {
  return FEEDBACK_CATEGORIES.includes(value as FeedbackCategory);
};

const normalizeText = (text: string): string => {
  return text.trim().replace(/\s+/g, " ");
};

const clampConfidence = (score: number): number => {
  if (!Number.isFinite(score)) {
    return 0;
  }

  if (score < 0) {
    return 0;
  }

  if (score > 1) {
    return 1;
  }

  return score;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const parseErrorResponseBody = async (
  response: Response
): Promise<string | undefined> => {
  try {
    const body = (await response.json()) as { detail?: unknown };

    if (typeof body.detail === "string") {
      return body.detail;
    }

    if (body.detail !== undefined) {
      return JSON.stringify(body.detail);
    }
  } catch {
    try {
      const text = await response.text();
      return text.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
};

export const validateExtractedMetadataPayload = (
  payload: OllamaMetadataExtractionPayload
): { metadata?: ExtractedMetadata; validationError?: string } => {
  if (
    typeof payload.category !== "string" ||
    !isFeedbackCategory(payload.category)
  ) {
    return {
      validationError: `Invalid or missing category: ${JSON.stringify(payload.category)}`,
    };
  }

  if (typeof payload.summary !== "string" || payload.summary.trim().length === 0) {
    return {
      validationError: `Invalid or missing summary: ${JSON.stringify(payload.summary)}`,
    };
  }

  return {
    metadata: {
      category: payload.category,
      summary: payload.summary.trim(),
      technologies: normalizeStringArray(payload.technologies),
      topics: normalizeStringArray(payload.topics),
      concepts: normalizeStringArray(payload.concepts),
      confidence: clampConfidence(payload.confidence ?? 0),
    },
  };
};

/**
 * Default HTTP client for the Ollama metadata extraction sidecar.
 * Provider-specific — never imported by business logic or services.
 */
export class HttpOllamaMetadataExtractionClient
  implements OllamaMetadataExtractionClient
{
  async extractMetadata(
    request: OllamaMetadataExtractionRequest
  ): Promise<OllamaMetadataExtractionPayload> {
    const url = `${request.serviceUrl.replace(/\/$/, "")}${EXTRACT_PATH}`;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (request.timeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    }

    try {
      const requestBody: Record<string, unknown> = {
        text: request.text,
        conversation_id: request.conversationId,
        message_id: request.messageId,
        model_id: request.modelId,
      };

      if (request.agentId) {
        requestBody.agent_id = request.agentId;
      }

      if (request.systemPrompt) {
        requestBody.system_prompt = request.systemPrompt;
      }

      if (request.category) {
        requestBody.category = request.category;
      }

      if (request.aiResponse) {
        requestBody.ai_response = request.aiResponse;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await parseErrorResponseBody(response);
        const message =
          detail ??
          `Metadata extraction request failed with status ${response.status}`;

        throw new MetadataExtractionRequestError(
          message,
          response.status,
          detail
        );
      }

      return (await response.json()) as OllamaMetadataExtractionPayload;
    } catch (error) {
      if (error instanceof MetadataExtractionRequestError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new MetadataExtractionRequestError(
          `Metadata extraction request timed out after ${request.timeoutMs}ms`
        );
      }

      const message =
        error instanceof Error ? error.message : "Metadata extraction request failed";

      throw new MetadataExtractionRequestError(
        `Metadata service unreachable at ${request.serviceUrl}: ${message}`
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

/**
 * Ollama sidecar implementation of {@link MetadataExtractionProvider}.
 */
export class OllamaMetadataExtractionProvider
  implements MetadataExtractionProvider
{
  readonly providerId: string;

  private readonly options: OllamaMetadataProviderOptions;

  constructor(
    config: MetadataExtractionConfig,
    private readonly extractionClient: OllamaMetadataExtractionClient = new HttpOllamaMetadataExtractionClient()
  ) {
    this.providerId = config.provider.id;
    this.options = config.provider.options as OllamaMetadataProviderOptions;
  }

  /**
   * Extracts structured metadata from developer feedback via the Ollama sidecar.
   */
  async extractMetadata(
    input: MetadataExtractionInput
  ): Promise<MetadataExtractionResult> {
    const text = normalizeText(input.text);
    const aiResponse = input.aiResponse?.trim() || undefined;

    if (!text) {
      const error = "Metadata extraction input text is empty after normalization.";
      logMetadataFinal({ providerId: this.providerId, error });
      return { error };
    }

    const inference = this.options.inference ?? {};
    const systemPrompt = this.options.systemPrompt?.trim() || undefined;

    if (!inference.serviceUrl) {
      const error = "Metadata extraction serviceUrl is not configured.";
      logMetadataFinal({ providerId: this.providerId, error });
      return { error };
    }

    logMetadataRequest({
      providerId: this.providerId,
      serviceUrl: inference.serviceUrl,
      modelId: inference.modelId,
      messageId: input.messageId,
      conversationId: input.conversationId,
      textPreview: text,
    });

    try {
      const payload = await this.extractionClient.extractMetadata({
        text,
        conversationId: input.conversationId,
        messageId: input.messageId,
        agentId: this.options.agentId,
        category: input.category,
        aiResponse,
        systemPrompt,
        serviceUrl: inference.serviceUrl,
        timeoutMs: inference.timeoutMs ?? 0,
        modelId: inference.modelId,
      });

      logMetadataRawResponse({
        providerId: this.providerId,
        statusCode: 200,
        payload,
      });

      const validation = validateExtractedMetadataPayload(payload);

      if (!validation.metadata) {
        const validationError =
          validation.validationError ?? "Metadata payload failed validation.";

        logMetadataValidation({
          providerId: this.providerId,
          accepted: false,
          reason: validationError,
        });
        logMetadataFinal({ providerId: this.providerId, error: validationError });

        return { error: validationError };
      }

      logMetadataValidation({
        providerId: this.providerId,
        accepted: true,
      });
      logMetadataFinal({
        providerId: this.providerId,
        metadata: validation.metadata,
      });

      return {
        metadata: validation.metadata,
        detectedLabel: validation.metadata.category,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Metadata extraction failed with an unknown error.";
      const statusCode =
        error instanceof MetadataExtractionRequestError
          ? error.statusCode
          : undefined;

      logMetadataRawResponse({
        providerId: this.providerId,
        statusCode,
        error: message,
      });
      logMetadataFinal({ providerId: this.providerId, error: message });

      return { error: message };
    }
  }

  /**
   * Probes the configured Ollama metadata sidecar liveness endpoint.
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

/**
 * Structured stderr diagnostics for metadata extraction.
 */

import { createLogger } from "../logging";

const logger = createLogger("MetadataExtraction");

const truncate = (value: string, maxLength = 120): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
};

const emit = (event: string, data: Record<string, unknown>): void => {
  logger.info(event, data);
};

export const logMetadataRequest = (input: {
  providerId: string;
  serviceUrl: string;
  modelId?: string;
  messageId?: string;
  conversationId?: string;
  textPreview: string;
}): void => {
  emit("request", {
    providerId: input.providerId,
    serviceUrl: input.serviceUrl,
    modelId: input.modelId ?? "(default)",
    messageId: input.messageId ?? "(none)",
    conversationId: input.conversationId ?? "(none)",
    textPreview: truncate(input.textPreview),
  });
};

export const logMetadataRawResponse = (input: {
  providerId: string;
  statusCode?: number;
  payload?: unknown;
  error?: string;
}): void => {
  emit("raw_response", {
    providerId: input.providerId,
    statusCode: input.statusCode ?? "(none)",
    payload: input.payload ?? null,
    error: input.error,
  });
};

export const logMetadataValidation = (input: {
  providerId: string;
  accepted: boolean;
  reason?: string;
}): void => {
  emit("validation", {
    providerId: input.providerId,
    accepted: input.accepted,
    reason: input.reason,
  });
};

export const logMetadataFinal = (input: {
  providerId: string;
  metadata?: {
    category: string;
    summary: string;
    technologies: string[];
    topics: string[];
    concepts: string[];
    confidence: number;
  };
  error?: string;
}): void => {
  emit("final", {
    providerId: input.providerId,
    metadata: input.metadata ?? null,
    error: input.error,
  });
};

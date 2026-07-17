/**
 * Write Pipeline Contract
 *
 * Public API for the Feedback Memory Engine WRITE path. Consumers (hook, MCP)
 * should depend on this pipeline — not on individual engine services.
 *
 * This module orchestrates the full WRITE path: intent detection, metadata
 * extraction, business validation, embedding, and vector storage.
 */

import { DetectedIntent } from "../../contracts/intent";
import { ExtractedMetadata } from "../../contracts/extraction";
import { FeedbackMemoryEngine } from "../../composition/createFeedbackMemoryEngine";
import {
  DEFAULT_DEDUPLICATION_SIMILARITY_THRESHOLD,
  VECTOR_STORE_CONFIG,
} from "../../config/vector-store.config";
import { RuleEvaluator } from "../../services/evaluation/RuleEvaluator";
import { createLogger } from "../../logging";

const logger = createLogger("WritePipeline");

/**
 * Input supplied to the WRITE pipeline.
 */
export interface WritePipelineInput {
  /** Developer prompt or feedback text to evaluate and persist. */
  text: string;

  /** Conversation identifier for traceability and exclusion during retrieval. */
  conversationId: string;

  /** Message identifier for idempotency and observability. */
  messageId: string;
}

/**
 * Outcome returned by the WRITE pipeline.
 *
 * Provides enough detail for hooks, MCP, and tests to observe intent
 * classification, skip reasons, storage outcomes, and extracted metadata without
 * coupling to provider implementations.
 */
export interface WritePipelineResult {
  /** Whether the pipeline completed without error. */
  success: boolean;

  /** Whether the pipeline intentionally skipped persistence. */
  skipped: boolean;

  /** Whether a memory record was stored in the vector store. */
  stored: boolean;

  /** Human-readable explanation when the pipeline skips or fails. */
  reason?: string;

  /** Detected intent label applied during the WRITE path. */
  intent?: DetectedIntent;

  /** Identifier assigned to the stored memory, when persistence succeeds. */
  memoryId?: string;

  /** Structured metadata extracted from the input, when available. */
  metadata?: ExtractedMetadata;

  /** Dimensionality of the embedding vector produced for storage, when available. */
  embeddingDimensions?: number;

  /** Identifier of an existing memory when deduplication skips the upsert. */
  duplicateOf?: string;
}

/**
 * Orchestrates the Feedback Memory Engine WRITE path.
 *
 * Accepts a fully composed {@link FeedbackMemoryEngine} and exposes a single
 * entry point for persisting developer feedback as retrievable memory.
 */
export class WritePipeline {
  constructor(private readonly engine: FeedbackMemoryEngine) {}

  /**
   * Executes the WRITE pipeline for the supplied input.
   *
   * Runs the full WRITE path end-to-end through the composed engine services.
   */
  async execute(input: WritePipelineInput): Promise<WritePipelineResult> {
    let detectedIntent: DetectedIntent | undefined;
    let metadata: ExtractedMetadata | undefined;
    let embeddingDimensions: number | undefined;

    try {
      const intentResult = await this.engine.intent.detectIntent({
        text: input.text,
      });
      detectedIntent = intentResult.intent;

      if (detectedIntent !== "WRITE") {
        return {
          success: false,
          skipped: true,
          stored: false,
          reason: "Intent is not WRITE",
          intent: detectedIntent,
        };
      }

      const metadataResult = await this.engine.metadata.extractMetadata({
        text: input.text,
        conversationId: input.conversationId,
        messageId: input.messageId,
      });

      metadata = metadataResult.metadata;

      if (!metadata) {
        return {
          success: false,
          skipped: false,
          stored: false,
          intent: detectedIntent,
          reason:
            metadataResult.error ?? "Metadata extraction returned no metadata.",
        };
      }

      if (!metadata.category) {
        return {
          success: false,
          skipped: false,
          stored: false,
          intent: detectedIntent,
          metadata,
          reason: "Metadata category is missing.",
        };
      }

      if (!metadata.summary || metadata.summary.trim().length === 0) {
        return {
          success: false,
          skipped: false,
          stored: false,
          intent: detectedIntent,
          metadata,
          reason: "Metadata summary is missing.",
        };
      }

      const embedding = await this.engine.embedding.embed({
        text: metadata.summary,
        purpose: "document",
      });

      if (embedding.vector.length === 0) {
        return {
          success: false,
          skipped: false,
          stored: false,
          intent: detectedIntent,
          metadata,
          reason: "Embedding generation failed.",
        };
      }

      embeddingDimensions = embedding.dimensions;

      const deduplicationThreshold =
        VECTOR_STORE_CONFIG.deduplicationSimilarityThreshold ??
        DEFAULT_DEDUPLICATION_SIMILARITY_THRESHOLD;

      // Deduplication: search for near-identical existing memory across all sessions.
      const dupCheck = await this.engine.vectorStore.search({
        vector: embedding.vector,
        topK: 1,
        minScore: 0,
        filter: {
          excludeMessageId: input.messageId,
        },
      });

      if (
        dupCheck.hits.length > 0 &&
        dupCheck.hits[0].score > deduplicationThreshold
      ) {
        return {
          success: true,
          skipped: true,
          stored: false,
          reason: "Duplicate memory — similar memory already exists",
          duplicateOf: dupCheck.hits[0].id,
          intent: detectedIntent,
          metadata,
          embeddingDimensions,
        };
      }

      const stored = await this.engine.vectorStore.upsertMemory({
        record: {
          id: input.messageId,
          vector: embedding.vector,
          metadata: {
            id: input.messageId,
            category: metadata.category,
            summary: metadata.summary,
            conversationId: input.conversationId,
            messageId: input.messageId,
            technologies: metadata.technologies,
            topics: metadata.topics,
            concepts: metadata.concepts,
            confidence: metadata.confidence,
          },
        },
      });

      if (!stored) {
        return {
          success: false,
          skipped: false,
          stored: false,
          intent: detectedIntent,
          metadata,
          embeddingDimensions,
          reason: "Vector store upsert failed.",
        };
      }

      try {
        await new RuleEvaluator().evaluate(metadata, {
          developerText: input.text,
        });
      } catch (error) {
        logger.error("RuleEvaluator failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        success: true,
        skipped: false,
        stored: true,
        memoryId: input.messageId,
        intent: detectedIntent,
        metadata,
        embeddingDimensions,
      };
    } catch (error) {
      return {
        success: false,
        skipped: false,
        stored: false,
        intent: detectedIntent,
        metadata,
        embeddingDimensions,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

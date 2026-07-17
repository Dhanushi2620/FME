/**
 * Read Pipeline Contract
 *
 * Public API for the Feedback Memory Engine retrieval path. Consumers (hook, MCP)
 * should depend on this pipeline — not on individual engine services.
 *
 * This module orchestrates retrieval end-to-end: query embedding, vector search,
 * ranking, selection, context building, and prompt enrichment. Intent is not
 * consulted — callers invoke this pipeline unconditionally.
 */

import { VectorSearchHit } from "../../contracts/vector-store";
import { FeedbackMemoryEngine } from "../../composition/createFeedbackMemoryEngine";
import { RETRIEVAL_CONFIG } from "../../config/retrieval.config";
import { enrichPrompt } from "../../retrieval/enrichment";
import { rankCandidates } from "../../retrieval/ranking";
import { selectTopMemories } from "../../retrieval/selection";
import { SelectedCandidate } from "../../types/selection.types";
import { RetrievalCandidate } from "../../types/retrieval.types";

const toRetrievalCandidate = (hit: VectorSearchHit): RetrievalCandidate => {
  return {
    memory: {
      id: hit.metadata.id || hit.id,
      type: hit.metadata.category,
      conversationId: hit.metadata.conversationId,
      messageId: hit.metadata.messageId,
      statement: hit.metadata.summary,
      matchedRule: "vector-search",
    },
    matchedTerms: [],
    overlapRatio: hit.score,
    matchStrength: hit.score,
  };
};

/**
 * Input supplied to the READ pipeline.
 */
export interface ReadPipelineInput {
  /** Developer prompt or query text to retrieve context for. */
  text: string;

  /** Conversation identifier for exclusion and traceability. */
  conversationId: string;

  /** Message identifier for observability and idempotency. */
  messageId: string;

  /**
   * Memories written in the same hook call, injected directly into retrieval
   * without waiting for the vector store round trip.
   */
  sameCallMemories?: RetrievalCandidate[];
}

/**
 * Outcome returned by the READ pipeline.
 *
 * Provides enough detail for hooks, MCP, and tests to observe intent
 * classification, retrieval outcomes, and prompt enrichment without coupling
 * to provider implementations.
 */
export interface ReadPipelineResult {
  /** Whether the pipeline completed without error. */
  success: boolean;

  /** Whether the original prompt was enriched with retrieved memory context. */
  enriched: boolean;

  /** Human-readable explanation when the pipeline skips, fails, or finds nothing. */
  reason?: string;

  /** Dimensionality of the query embedding vector, when generated. */
  queryEmbeddingDimensions?: number;

  /** Selected memory candidates produced during the READ path, when available. */
  retrievedMemories?: SelectedCandidate[];

  /** Prompt enriched with retrieved memory context, when enrichment succeeds. */
  enrichedPrompt?: string;
}

/**
 * Orchestrates the Feedback Memory Engine READ path.
 *
 * Accepts a fully composed {@link FeedbackMemoryEngine} and exposes a single
 * entry point for retrieving and enriching prompts with relevant memories.
 */
export class ReadPipeline {
  constructor(private readonly engine: FeedbackMemoryEngine) {}

  /**
   * Executes the READ pipeline for the supplied input.
   *
   * Runs the full READ path end-to-end through the composed engine services and
   * retrieval modules.
   */
  async execute(input: ReadPipelineInput): Promise<ReadPipelineResult> {
    try {
      const embedding = await this.engine.embedding.embed({
        text: input.text,
        purpose: "query",
      });

      if (embedding.vector.length === 0) {
        return {
          success: false,
          enriched: false,
          reason: "Query embedding generation failed.",
        };
      }

      const searchResult = await this.engine.vectorStore.search({
        vector: embedding.vector,
        topK: RETRIEVAL_CONFIG.vectorSearchTopK,
        minScore: RETRIEVAL_CONFIG.vectorSearchMinScore,
        filter: {
          excludeConversationId: input.conversationId,
          excludeMessageId: input.messageId,
        },
      });

      if (searchResult.hits.length === 0 && !input.sameCallMemories?.length) {
        return {
          success: true,
          enriched: false,
          queryEmbeddingDimensions: embedding.dimensions,
          retrievedMemories: [],
          reason: "No related memories found.",
        };
      }

      const vectorCandidates = searchResult.hits.map(toRetrievalCandidate);
      const injectedCandidates = input.sameCallMemories ?? [];
      const allCandidates = [...injectedCandidates, ...vectorCandidates];

      if (allCandidates.length === 0) {
        return {
          success: true,
          enriched: false,
          queryEmbeddingDimensions: embedding.dimensions,
          retrievedMemories: [],
          reason: "No related memories found.",
        };
      }

      const rankedMemories = rankCandidates(allCandidates, {
        conversationId: input.conversationId,
      });

      const selectedMemories = selectTopMemories(rankedMemories);

      if (selectedMemories.length === 0) {
        return {
          success: true,
          enriched: false,
          queryEmbeddingDimensions: embedding.dimensions,
          retrievedMemories: selectedMemories,
          reason: "No memories passed selection thresholds.",
        };
      }

      const enrichment = enrichPrompt({
        prompt: input.text,
        selectedCandidates: selectedMemories,
      });

      return {
        success: true,
        enriched: true,
        queryEmbeddingDimensions: embedding.dimensions,
        retrievedMemories: selectedMemories,
        enrichedPrompt: enrichment.enrichedPrompt,
      };
    } catch (error) {
      return {
        success: false,
        enriched: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

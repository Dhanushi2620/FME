/**
 * Cursor beforeSubmitPrompt hook integration.
 *
 * Buffers every prompt for later cron batch WRITE processing.
 * Retrieval (READ) runs blocking on every prompt.
 *
 * Production hook execution uses compiled output from `npm run build:hook`
 * (see `tsconfig.hook.json`). Rebuild after changing this module or its
 * dependencies before running the Cursor hook via `dist/hook/`.
 */

import {
  createFeedbackMemoryEngine,
  FeedbackMemoryEngine,
} from "../../composition";
import { DetectedIntent } from "../../contracts/intent";
import { ReadPipeline } from "../../pipelines/read";
import { appendToBuffer } from "../../services/batch/BufferManager";
import { HookLogger } from "./hookLogger";
import { createLogger } from "../../logging";

const integrationLogger = createLogger("feedback-memory-hook");

function debugHook(message: string, data?: unknown): void {
  integrationLogger.debug(message, data !== undefined ? { data } : undefined);
}

export type BeforeSubmitPromptInput = {
  text: string;
  conversationId: string;
  messageId: string;
  hookLogger?: HookLogger;
};

export type BeforeSubmitPromptOutput = {
  outputPrompt: string;
  /** No longer classified per-prompt; returned as Unknown for API compatibility. */
  intent: DetectedIntent;
  /** Reserved for optional background work after the hook returns. */
  pendingWrite?: Promise<void>;
};

const createRequestEngine = (): FeedbackMemoryEngine => {
  return createFeedbackMemoryEngine();
};

export const processBeforeSubmitPrompt = async (
  input: BeforeSubmitPromptInput
): Promise<BeforeSubmitPromptOutput> => {
  const originalPrompt = input.text;
  const engine = createRequestEngine();
  const readPipeline = new ReadPipeline(engine);

  debugHook("beforeSubmitPrompt invoked", {
    conversationId: input.conversationId,
    messageId: input.messageId,
  });
  debugHook("beforeSubmitPrompt original prompt", {
    prompt: originalPrompt,
  });

  const t0 = Date.now();
  let readMs = 0;
  let readResult: Awaited<ReturnType<ReadPipeline["execute"]>> | undefined;
  let pipelineError: unknown;
  let pendingWrite: Promise<void> | undefined;

  try {
    const pipelineInput = {
      text: input.text,
      conversationId: input.conversationId,
      messageId: input.messageId,
    };

    // Buffer every prompt — cron BatchWriteService processes later.
    debugHook("beforeSubmitPrompt buffer", {
      executed: true,
      mode: "buffer",
    });

    appendToBuffer({
      conversationId: input.conversationId,
      generationId: input.messageId,
      developerText: input.text,
      aiResponse: "",
      timestamp:
        new Date()
          .toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
          .replace(",", "") + " IST",
    });

    const readStart = Date.now();
    readResult = await readPipeline.execute(pipelineInput);
    readMs = Date.now() - readStart;
    const retrievedMemories = readResult.retrievedMemories ?? [];

    input.hookLogger?.memoryRetrieval(retrievedMemories.length);

    if (retrievedMemories.length > 0) {
      input.hookLogger?.retrievedMemories(
        retrievedMemories.map((candidate) => ({
          category: candidate.memory.type,
          summary: candidate.memory.statement,
          statement: candidate.memory.statement,
          score: candidate.breakdown.finalScore,
          selectionRank: candidate.selectionRank,
        }))
      );
    }

    const outputPrompt = readResult.enriched
      ? (readResult.enrichedPrompt ?? originalPrompt)
      : originalPrompt;

    if (readResult.enriched) {
      input.hookLogger?.promptEnrichment({
        enriched: true,
        retrievedMemories: retrievedMemories.length,
        finalPromptLength: outputPrompt.length,
      });
    } else {
      input.hookLogger?.promptEnrichment({
        enriched: false,
        reason: readResult.reason ?? "No related memories found",
      });
    }

    debugHook("beforeSubmitPrompt memory retrieval", {
      count: retrievedMemories.length,
      enriched: readResult.enriched,
      reason: readResult.reason ?? null,
    });
    debugHook("beforeSubmitPrompt returned prompt", {
      intent: "BUFFERED",
      outputPrompt,
      enriched: readResult.enriched,
    });

    return {
      outputPrompt,
      intent: "Unknown",
      pendingWrite,
    };
  } catch (error) {
    pipelineError = error;
    input.hookLogger?.failed(error);

    debugHook("beforeSubmitPrompt exception", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      outputPrompt: originalPrompt,
      intent: "Unknown",
    };
  } finally {
    const totalMs = Date.now() - t0;

    input.hookLogger?.logPerformance({
      phase: "hook",
      intent: "BUFFERED",
      intentMs: 0,
      writeMs: 0,
      readMs,
      totalMs,
      enriched: readResult?.enriched ?? false,
      writeStatus: "buffered",
      timestamp: new Date().toISOString(),
      error: pipelineError !== undefined,
      errorMessage:
        pipelineError instanceof Error
          ? pipelineError.message
          : pipelineError !== undefined
            ? String(pipelineError)
            : undefined,
    });
  }
};

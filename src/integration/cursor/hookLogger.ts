/**
 * Lightweight append-only hook logger for Cursor beforeSubmitPrompt runs.
 * Uses fs, path, process, and Winston for structured stderr diagnostics.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "../../logging";

const logger = createLogger("HookLogger");

const SEPARATOR = "--------------------------------------------------";
const PROMPT_MAX_LENGTH = 200;
const SUMMARY_MAX_LENGTH = 200;

const resolveLogPath = (): string | null => {
  const configured = process.env.HOOK_LOG_FILE?.trim();
  if (configured) {
    return configured;
  }

  logger.warn("HOOK_LOG_FILE is not set; hook file logging disabled.");
  return null;
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
};

const appendToLog = (block: string): void => {
  const logPath = resolveLogPath();
  if (!logPath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, block, "utf8");
  } catch {
    // Logging must never affect hook execution.
  }
};

const formatTimestamp = (): string => {
  return new Date().toISOString();
};

export type PerformancePhase = "hook" | "write_background";

export type WritePerformanceStatus =
  | "not_applicable"
  | "queued"
  | "buffered"
  | "completed"
  | "duplicate_skipped"
  | "storage_failed"
  | "write_failed";

export type HookPerformanceEntry = {
  phase: PerformancePhase;
  intent: string;
  intentMs: number;
  writeMs: number;
  readMs: number;
  totalMs: number;
  enriched: boolean;
  writeStatus: WritePerformanceStatus;
  stored?: boolean;
  timestamp: string;
  error?: boolean;
  errorMessage?: string;
  memoryId?: string;
  reason?: string;
};

export class HookLogger {
  private readonly startedAtMs: number;
  private hasFailed = false;

  constructor(
    private readonly conversationId: string,
    private readonly generationId: string
  ) {
    this.startedAtMs = Date.now();
  }

  started(prompt?: string): void {
    const lines = [
      SEPARATOR,
      `${formatTimestamp()} INFO Hook started`,
      `conversationId=${this.conversationId}`,
      `generationId=${this.generationId}`,
    ];

    if (prompt !== undefined && prompt.length > 0) {
      lines.push(`prompt=${truncate(prompt, PROMPT_MAX_LENGTH)}`);
    }

    lines.push(SEPARATOR, "");
    appendToLog(`${lines.join("\n")}\n`);
  }

  intentDetected(intent: string, confidence: number): void {
    appendToLog(
      [
        "INFO Intent detected",
        `intent=${intent}`,
        `confidence=${confidence}`,
        "",
      ].join("\n")
    );
  }

  writePipeline(executed: boolean): void {
    appendToLog(
      ["INFO Write pipeline", `executed=${executed}`, ""].join("\n")
    );
  }

  memoryRetrieval(count: number): void {
    appendToLog(
      ["INFO Memory retrieval", `count=${count}`, ""].join("\n")
    );
  }

  selectedPipeline(pipeline: string): void {
    appendToLog(
      ["INFO Selected pipeline", `pipeline=${pipeline}`, ""].join("\n")
    );
  }

  metadataExtracted(category?: string, summary?: string): void {
    appendToLog(
      [
        "INFO Metadata extracted",
        `category=${category ?? "(none)"}`,
        `summary=${truncate(summary ?? "(none)", SUMMARY_MAX_LENGTH)}`,
        "",
      ].join("\n")
    );
  }

  vectorStoreUpsert(input: {
    stored: boolean;
    memoryId?: string;
    success?: boolean;
    skipped?: boolean;
    reason?: string;
  }): void {
    const lines = [
      "INFO Vector store upsert",
      `stored=${input.stored}`,
      `memoryId=${input.memoryId ?? "(none)"}`,
    ];

    if (input.success !== undefined) {
      lines.push(`success=${input.success}`);
    }

    if (input.skipped !== undefined) {
      lines.push(`skipped=${input.skipped}`);
    }

    if (input.reason) {
      lines.push(`reason=${input.reason}`);
    }

    lines.push("");
    appendToLog(`${lines.join("\n")}\n`);
  }

  deduplicationSkipped(input: {
    duplicateOf: string;
    score?: number;
    reason?: string;
  }): void {
    const lines = [
      "INFO Deduplication skipped",
      `duplicateOf=${input.duplicateOf}`,
    ];

    if (input.score !== undefined) {
      lines.push(`score=${input.score}`);
    }

    if (input.reason) {
      lines.push(`reason=${input.reason}`);
    }

    lines.push("");
    appendToLog(`${lines.join("\n")}\n`);
  }

  retrievedMemories(
    memories: ReadonlyArray<{
      category?: string;
      summary?: string;
      statement?: string;
      score?: number;
      selectionRank: number;
    }>
  ): void {
    const lines = ["INFO Retrieved memories", ""];

    memories.forEach((memory, index) => {
      const summaryText =
        memory.summary?.trim() ||
        memory.statement?.trim() ||
        "(none)";

      lines.push(`[${index + 1}]`);
      lines.push(`category=${memory.category ?? "(none)"}`);
      lines.push(`summary=${truncate(summaryText, SUMMARY_MAX_LENGTH)}`);

      if (memory.score !== undefined) {
        lines.push(`score=${memory.score}`);
      }

      lines.push(`selectionRank=${memory.selectionRank}`);
      lines.push("");
    });

    appendToLog(`${lines.join("\n")}\n`);
  }

  promptEnrichment(input: {
    enriched: boolean;
    retrievedMemories?: number;
    finalPromptLength?: number;
    reason?: string;
  }): void {
    const lines = ["INFO Prompt enrichment", `enriched=${input.enriched}`];

    if (input.enriched) {
      if (input.retrievedMemories !== undefined) {
        lines.push(`retrievedMemories=${input.retrievedMemories}`);
      }

      if (input.finalPromptLength !== undefined) {
        lines.push(`finalPromptLength=${input.finalPromptLength}`);
      }
    } else if (input.reason) {
      lines.push(`reason=${input.reason}`);
    }

    lines.push("");
    appendToLog(`${lines.join("\n")}\n`);
  }

  completed(): void {
    if (this.hasFailed) {
      return;
    }

    const executionTimeMs = Date.now() - this.startedAtMs;

    appendToLog(
      [
        "INFO Hook completed",
        `executionTime=${executionTimeMs}ms`,
        "",
        SEPARATOR,
        "",
      ].join("\n")
    );
  }

  failed(error: unknown): void {
    this.hasFailed = true;

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? "(no stack trace)" : "(no stack trace)";

    appendToLog(
      [
        "ERROR Hook failed",
        `error=${message}`,
        `stack=${stack}`,
        "",
        SEPARATOR,
        "",
      ].join("\n")
    );
  }

  logPerformance(data: HookPerformanceEntry): void {
    const line = JSON.stringify({
      type: "PERF",
      ...data,
    });

    try {
      const logPath = resolveLogPath();
      if (!logPath) {
        return;
      }

      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${line}\n`, "utf8");
    } catch {
      // Logging must never affect hook execution.
    }
  }
}

export const createHookLogger = (input: {
  conversationId: string;
  generationId: string;
}): HookLogger => {
  return new HookLogger(input.conversationId, input.generationId);
};

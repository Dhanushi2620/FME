import { PromptEnrichment } from "./enrichment.types";

export type FeedbackMemoryEngineExecutionStatus = "success" | "failure";

export type FeedbackMemoryEngineTiming = {
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
};

export type FeedbackMemoryEngineResult = {
  enrichment: PromptEnrichment;
  status: FeedbackMemoryEngineExecutionStatus;
  timing: FeedbackMemoryEngineTiming;
  errorMessage?: string;
};

import { SelectedCandidate } from "./selection.types";

export type PromptContextMemory = {
  id: string;
  type: string;
  statement: string;
  selectionRank: number;
  finalScore: number;
};

export type PromptContext = {
  memories: PromptContextMemory[];
  orderedMemoryIds: string[];
  memoryCount: number;
};

export type PromptEnrichment = {
  originalPrompt: string;
  formattedContext: string;
  enrichedPrompt: string;
  injectedMemoryIds: string[];
};

export type EnrichPromptInput = {
  prompt: string;
  selectedCandidates: SelectedCandidate[];
};

export type BuildPromptContextInput = {
  selectedCandidates: SelectedCandidate[];
};

export type EnrichPromptOptions = {
  contextSeparator?: string;
};

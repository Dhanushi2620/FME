import { SelectedCandidate } from "../../types/selection.types";
import {
  BuildPromptContextInput,
  PromptContext,
  PromptContextMemory,
} from "../../types/enrichment.types";

const compareBySelectionRank = (
  left: SelectedCandidate,
  right: SelectedCandidate
): number => {
  return left.selectionRank - right.selectionRank;
};

const toPromptContextMemory = (
  candidate: SelectedCandidate
): PromptContextMemory => {
  return {
    id: candidate.memory.id,
    type: candidate.memory.type,
    statement: candidate.memory.statement,
    selectionRank: candidate.selectionRank,
    finalScore: candidate.breakdown.finalScore,
  };
};

export const buildPromptContext = (
  input: BuildPromptContextInput
): PromptContext => {
  const orderedCandidates = [...input.selectedCandidates].sort(
    compareBySelectionRank
  );
  const memories = orderedCandidates.map(toPromptContextMemory);
  const orderedMemoryIds = memories.map((memory) => memory.id);

  return {
    memories,
    orderedMemoryIds,
    memoryCount: memories.length,
  };
};

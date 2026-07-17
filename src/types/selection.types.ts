import { RankedCandidate } from "./ranking.types";

export type SelectionDeduplicationConfig = {
  enabled: boolean;
  normalizeStatements: boolean;
};

export type SelectionConfig = {
  topK: number;
  minFinalScore: number;
  /** Minimum raw vector similarity (overlap/match strength) required for selection. */
  minSemanticScore: number;
  deduplication: SelectionDeduplicationConfig;
};

export type SelectedCandidate = RankedCandidate & {
  selectionRank: number;
};

export type SelectTopMemoriesOptions = {
  config?: SelectionConfig;
};

import { SELECTION_CONFIG } from "../../config/selection.config";
import { RankedCandidate } from "../../types/ranking.types";
import {
  SelectedCandidate,
  SelectionConfig,
  SelectTopMemoriesOptions,
} from "../../types/selection.types";

const compareRankedCandidates = (
  left: RankedCandidate,
  right: RankedCandidate
): number => {
  const scoreDifference = right.breakdown.finalScore - left.breakdown.finalScore;

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return left.memory.id.localeCompare(right.memory.id);
};

const getSemanticScore = (candidate: RankedCandidate): number => {
  return (candidate.overlapRatio + candidate.matchStrength) / 2;
};

const passesMinimumScore = (
  candidate: RankedCandidate,
  config: SelectionConfig
): boolean => {
  if (getSemanticScore(candidate) < config.minSemanticScore) {
    return false;
  }

  return candidate.breakdown.finalScore >= config.minFinalScore;
};

const normalizeStatement = (statement: string): string => {
  return statement.trim().replace(/\s+/g, " ").toLowerCase();
};

const getDeduplicationKey = (
  candidate: RankedCandidate,
  config: SelectionConfig
): string => {
  if (config.deduplication.normalizeStatements) {
    return normalizeStatement(candidate.memory.statement);
  }

  return candidate.memory.statement.trim();
};

const deduplicateCandidates = (
  candidates: RankedCandidate[],
  config: SelectionConfig
): RankedCandidate[] => {
  if (!config.deduplication.enabled) {
    return candidates;
  }

  const seenKeys = new Set<string>();
  const deduplicated: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const key = getDeduplicationKey(candidate, config);

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    deduplicated.push(candidate);
  }

  return deduplicated;
};

const applyTopK = (
  candidates: RankedCandidate[],
  config: SelectionConfig
): RankedCandidate[] => {
  if (config.topK <= 0) {
    return [];
  }

  return candidates.slice(0, config.topK);
};

const toSelectedCandidate = (
  candidate: RankedCandidate,
  selectionRank: number
): SelectedCandidate => {
  return {
    ...candidate,
    selectionRank,
  };
};

export const selectTopMemories = (
  candidates: RankedCandidate[],
  options: SelectTopMemoriesOptions = {}
): SelectedCandidate[] => {
  const config = options.config ?? SELECTION_CONFIG;

  const sorted = [...candidates].sort(compareRankedCandidates);
  const aboveMinimumScore = sorted.filter((candidate) =>
    passesMinimumScore(candidate, config)
  );
  const deduplicated = deduplicateCandidates(aboveMinimumScore, config);
  const limited = applyTopK(deduplicated, config);

  return limited.map((candidate, index) =>
    toSelectedCandidate(candidate, index + 1)
  );
};

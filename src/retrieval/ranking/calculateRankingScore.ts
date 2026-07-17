import { RANKING_CONFIG } from "../../config/ranking.config";
import { RetrievalCandidate } from "../../types/retrieval.types";
import {
  RankingBreakdown,
  RankingConfig,
  RankingContext,
  RankedCandidate,
  RankCandidatesOptions,
} from "../../types/ranking.types";

type SignalValues = Pick<
  RankingBreakdown,
  "keywordScore" | "typeBonus" | "conversationBonus"
>;

type SignalCalculator = (
  candidate: RetrievalCandidate,
  context: RankingContext,
  config: RankingConfig
) => number;

const calculateKeywordSimilarityScore: SignalCalculator = (candidate) => {
  return (candidate.overlapRatio + candidate.matchStrength) / 2;
};

const calculateMemoryTypeBonus: SignalCalculator = (candidate, _context, config) => {
  return config.typeBonuses[candidate.memory.type] ?? 0;
};

const calculateConversationMatchBonus: SignalCalculator = (
  candidate,
  context,
  config
) => {
  if (candidate.memory.conversationId !== context.conversationId) {
    return 0;
  }

  return config.conversationMatchBonus;
};

const SIGNAL_CALCULATORS: Record<keyof SignalValues, SignalCalculator> = {
  keywordScore: calculateKeywordSimilarityScore,
  typeBonus: calculateMemoryTypeBonus,
  conversationBonus: calculateConversationMatchBonus,
};

const SIGNAL_CONFIG_KEYS: Record<
  keyof SignalValues,
  keyof RankingConfig["signals"]
> = {
  keywordScore: "keywordSimilarity",
  typeBonus: "memoryTypeBonus",
  conversationBonus: "conversationMatchBonus",
};

const computeSignalValues = (
  candidate: RetrievalCandidate,
  context: RankingContext,
  config: RankingConfig
): SignalValues => {
  return {
    keywordScore: calculateKeywordSimilarityScore(candidate, context, config),
    typeBonus: calculateMemoryTypeBonus(candidate, context, config),
    conversationBonus: calculateConversationMatchBonus(
      candidate,
      context,
      config
    ),
  };
};

const computeFinalScore = (
  signalValues: SignalValues,
  config: RankingConfig
): number => {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const signalKey of Object.keys(SIGNAL_CALCULATORS) as Array<
    keyof SignalValues
  >) {
    const signalConfigKey = SIGNAL_CONFIG_KEYS[signalKey];
    const signalConfig = config.signals[signalConfigKey];

    if (!signalConfig.enabled) {
      continue;
    }

    weightedSum += signalValues[signalKey] * signalConfig.weight;
    totalWeight += signalConfig.weight;
  }

  if (totalWeight === 0) {
    return 0;
  }

  return weightedSum / totalWeight;
};

export const calculateRankingScore = (
  candidate: RetrievalCandidate,
  context: RankingContext,
  config: RankingConfig = RANKING_CONFIG
): RankedCandidate => {
  const signalValues = computeSignalValues(candidate, context, config);
  const finalScore = computeFinalScore(signalValues, config);

  const breakdown: RankingBreakdown = {
    ...signalValues,
    finalScore,
  };

  return {
    ...candidate,
    breakdown,
  };
};

export const rankCandidates = (
  candidates: RetrievalCandidate[],
  context: RankingContext,
  options: RankCandidatesOptions = {}
): RankedCandidate[] => {
  const config = options.config ?? RANKING_CONFIG;

  return candidates.map((candidate) =>
    calculateRankingScore(candidate, context, config)
  );
};

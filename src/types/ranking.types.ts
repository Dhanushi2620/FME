import { RetrievalCandidate } from "./retrieval.types";

export type RankingSignalConfig = {
  weight: number;
  enabled: boolean;
};

export type RankingConfig = {
  signals: {
    keywordSimilarity: RankingSignalConfig;
    memoryTypeBonus: RankingSignalConfig;
    conversationMatchBonus: RankingSignalConfig;
  };
  typeBonuses: Record<string, number>;
  conversationMatchBonus: number;
};

export type RankingContext = {
  conversationId: string;
};

export type RankingBreakdown = {
  keywordScore: number;
  typeBonus: number;
  conversationBonus: number;
  finalScore: number;
};

export type RankedCandidate = RetrievalCandidate & {
  breakdown: RankingBreakdown;
};

export type RankCandidatesOptions = {
  config?: RankingConfig;
};

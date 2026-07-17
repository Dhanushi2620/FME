import { RankingConfig } from "../types/ranking.types";

export const RANKING_CONFIG: RankingConfig = {
  signals: {
    keywordSimilarity: { weight: 0.65, enabled: true },
    memoryTypeBonus: { weight: 0.15, enabled: true },
    conversationMatchBonus: { weight: 0.2, enabled: true },
  },
  typeBonuses: {
    Correction: 1.0,
    AntiPattern: 0.9,
    Decision: 0.8,
    TaskLearning: 0.7,
  },
  conversationMatchBonus: 1.0,
};

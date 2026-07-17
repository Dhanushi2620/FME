import { SelectionConfig } from "../types/selection.types";

export const SELECTION_CONFIG: SelectionConfig = {
  topK: 5,
  minFinalScore: 0.48,
  minSemanticScore: 0.45,
  deduplication: {
    enabled: true,
    normalizeStatements: true,
  },
};

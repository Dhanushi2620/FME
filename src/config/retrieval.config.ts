import { RetrievalConfig } from "../types/retrieval.types";

export const RETRIEVAL_CONFIG: RetrievalConfig = {
  minOverlapRatio: 0.1,
  minMatchStrength: 0.05,
  minMatchedTerms: 1,
  vectorSearchTopK: 5,
  vectorSearchMinScore: 0.42,
};

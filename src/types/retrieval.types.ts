import { FeedbackMemory } from "./memory.types";

export type RetrievalConfig = {
  minOverlapRatio: number;
  minMatchStrength: number;
  minMatchedTerms: number;
  /** Maximum vector search hits to retrieve on the READ pipeline path. */
  vectorSearchTopK: number;
  /** Minimum similarity score for vector search hits on the READ pipeline path. */
  vectorSearchMinScore: number;
};

export type RetrievalCandidate = {
  memory: FeedbackMemory;
  matchedTerms: string[];
  overlapRatio: number;
  matchStrength: number;
};

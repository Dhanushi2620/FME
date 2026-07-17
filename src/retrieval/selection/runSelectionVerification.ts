import { rankCandidates } from "../ranking/calculateRankingScore";
import { selectTopMemories } from "./selectTopMemories";
import { RetrievalCandidate } from "../../types/retrieval.types";

const createCandidate = (input: {
  id: string;
  statement: string;
  type: string;
  semanticScore: number;
}): RetrievalCandidate => ({
  memory: {
    id: input.id,
    type: input.type,
    conversationId: "other-conversation",
    messageId: input.id,
    statement: input.statement,
    matchedRule: "vector-search",
  },
  matchedTerms: [],
  overlapRatio: input.semanticScore,
  matchStrength: input.semanticScore,
});

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

export const runSelectionVerification = (): void => {
  const context = { conversationId: "current-conversation" };

  const unrelatedDatabaseMemory = createCandidate({
    id: "mongo-postgres",
    statement: "Switch from MongoDB to PostgreSQL for transactional workloads.",
    type: "Decision",
    semanticScore: 0.3,
  });

  const relatedRedisMemory = createCandidate({
    id: "redis-pubsub",
    statement: "Always use Redis Pub/Sub instead of in-memory events.",
    type: "Decision",
    semanticScore: 0.72,
  });

  const unrelatedRanked = rankCandidates([unrelatedDatabaseMemory], context);
  const unrelatedSelected = selectTopMemories(unrelatedRanked);

  assert(
    unrelatedSelected.length === 0,
    "Unrelated low-similarity memory must not be selected"
  );

  const mixedRanked = rankCandidates(
    [unrelatedDatabaseMemory, relatedRedisMemory],
    context
  );
  const mixedSelected = selectTopMemories(mixedRanked);

  assert(
    mixedSelected.length === 1,
    "Only the semantically related memory should be selected"
  );
  assert(
    mixedSelected[0]?.memory.id === "redis-pubsub",
    "Selected memory must be the related Redis Pub/Sub entry"
  );

  const typeInflatedOnly = rankCandidates(
    [
      createCandidate({
        id: "inflated",
        statement: "Use PostgreSQL instead of MongoDB.",
        type: "Correction",
        semanticScore: 0.38,
      }),
    ],
    context
  );
  const inflatedSelected = selectTopMemories(typeInflatedOnly);

  assert(
    inflatedSelected.length === 0,
    "Type bonus must not select memories below the semantic floor"
  );
};

if (require.main === module) {
  runSelectionVerification();
  process.stdout.write("Retrieval precision verification passed.\n");
}

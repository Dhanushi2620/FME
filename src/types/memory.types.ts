export type FeedbackMemory = {
  id: string;
  type: string;
  conversationId: string;
  messageId: string;
  statement: string;
  matchedRule: string;
};

export type FeedbackMemoriesStore = {
  memories: FeedbackMemory[];
};

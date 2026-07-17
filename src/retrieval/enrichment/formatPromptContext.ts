import { PromptContext } from "../../types/enrichment.types";

const CONTEXT_HEADER = "Relevant project feedback";

const formatMemoryEntry = (
  memory: PromptContext["memories"][number]
): string => {
  return `${memory.selectionRank}. [${memory.type}] ${memory.statement}`;
};

export const formatPromptContext = (context: PromptContext): string => {
  if (context.memoryCount === 0) {
    return "";
  }

  const lines = [
    `## ${CONTEXT_HEADER}`,
    "",
    ...context.memories.map(formatMemoryEntry),
  ];

  return lines.join("\n");
};

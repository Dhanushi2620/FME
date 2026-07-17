import type { VectorListMemoriesResult } from "../../../contracts/vector-store";
import type { FeedbackMemoryEngine } from "../../../composition";
import type { RegisteredMcpTool } from "../dispatcher";

export const LIST_MEMORIES_TOOL_NAME = "list_memories";

export type ListMemoriesToolInput = {
  limit?: number;
};

const LIST_MEMORIES_TOOL_DESCRIPTION = "List stored feedback memories.";

const LIST_MEMORIES_INPUT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    limit: {
      type: "number",
      description: "Maximum number of memories to return.",
    },
  },
  required: [] as string[],
};

/**
 * Creates the {@link LIST_MEMORIES_TOOL_NAME} MCP tool definition.
 *
 * Listing is delegated to {@link VectorStoreService.listMemories}; this module
 * only supplies tool metadata and the execute callback.
 */
export function createListMemoriesTool(
  engine: FeedbackMemoryEngine
): RegisteredMcpTool<ListMemoriesToolInput, VectorListMemoriesResult> {
  return {
    metadata: {
      name: LIST_MEMORIES_TOOL_NAME,
      description: LIST_MEMORIES_TOOL_DESCRIPTION,
      inputSchema: LIST_MEMORIES_INPUT_JSON_SCHEMA,
    },
    execute: async (
      args: ListMemoriesToolInput
    ): Promise<VectorListMemoriesResult> => {
      return engine.vectorStore.listMemories({
        limit: args.limit,
      });
    },
  };
}

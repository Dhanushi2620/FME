import type { FeedbackMemoryEngine } from "../../../composition";
import { ReadPipeline } from "../../../pipelines/read";
import type { ReadPipelineResult } from "../../../pipelines/read";
import type { RegisteredMcpTool } from "../dispatcher";

export const SEARCH_MEMORIES_TOOL_NAME = "search_memories";

export type SearchMemoriesToolInput = {
  text: string;
  conversationId: string;
  messageId: string;
};

const SEARCH_MEMORIES_TOOL_DESCRIPTION =
  "Retrieve and enrich prompts with relevant memories via the READ pipeline.";

const SEARCH_MEMORIES_INPUT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    text: {
      type: "string",
      description: "Developer prompt or query text.",
    },
    conversationId: {
      type: "string",
      description: "Conversation identifier.",
    },
    messageId: {
      type: "string",
      description: "Message identifier.",
    },
  },
  required: ["text", "conversationId", "messageId"],
};

/**
 * Creates the {@link SEARCH_MEMORIES_TOOL_NAME} MCP tool definition.
 *
 * All business logic is delegated to {@link ReadPipeline}; this module only
 * supplies tool metadata and the execute callback.
 */
export function createSearchMemoriesTool(
  engine: FeedbackMemoryEngine
): RegisteredMcpTool<SearchMemoriesToolInput, ReadPipelineResult> {
  return {
    metadata: {
      name: SEARCH_MEMORIES_TOOL_NAME,
      description: SEARCH_MEMORIES_TOOL_DESCRIPTION,
      inputSchema: SEARCH_MEMORIES_INPUT_JSON_SCHEMA,
    },
    execute: async (
      args: SearchMemoriesToolInput
    ): Promise<ReadPipelineResult> => {
      const readPipeline = new ReadPipeline(engine);

      return readPipeline.execute(args);
    },
  };
}

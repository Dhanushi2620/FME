import type { FeedbackMemoryEngine } from "../../../composition";
import { WritePipeline } from "../../../pipelines/write";
import type { WritePipelineResult } from "../../../pipelines/write";
import type { RegisteredMcpTool } from "../dispatcher";

export const ADD_MEMORY_TOOL_NAME = "add_memory";

export type AddMemoryToolInput = {
  text: string;
  conversationId: string;
  messageId: string;
};

const ADD_MEMORY_TOOL_DESCRIPTION =
  "Persist developer feedback as retrievable memory via the WRITE pipeline.";

const ADD_MEMORY_INPUT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    text: {
      type: "string",
      description: "Developer prompt or feedback text.",
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
 * Creates the {@link ADD_MEMORY_TOOL_NAME} MCP tool definition.
 *
 * All business logic is delegated to {@link WritePipeline}; this module only
 * supplies tool metadata and the execute callback.
 */
export function createAddMemoryTool(
  engine: FeedbackMemoryEngine
): RegisteredMcpTool<AddMemoryToolInput, WritePipelineResult> {
  return {
    metadata: {
      name: ADD_MEMORY_TOOL_NAME,
      description: ADD_MEMORY_TOOL_DESCRIPTION,
      inputSchema: ADD_MEMORY_INPUT_JSON_SCHEMA,
    },
    execute: async (args: AddMemoryToolInput): Promise<WritePipelineResult> => {
      const writePipeline = new WritePipeline(engine);

      return writePipeline.execute(args);
    },
  };
}

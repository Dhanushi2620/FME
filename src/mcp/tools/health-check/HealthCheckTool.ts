import type { FeedbackMemoryEngine } from "../../../composition";
import type { RegisteredMcpTool } from "../dispatcher";

export const HEALTH_CHECK_TOOL_NAME = "health_check";

export type HealthCheckToolResult = {
  healthy: boolean;
  vectorStore: boolean;
};

const HEALTH_CHECK_TOOL_DESCRIPTION =
  "Check whether the Feedback Memory Engine is operational.";

const HEALTH_CHECK_INPUT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [] as string[],
};

/**
 * Creates the {@link HEALTH_CHECK_TOOL_NAME} MCP tool definition.
 *
 * Health verification is delegated to {@link VectorStoreService.healthCheck};
 * this module only shapes the MCP response.
 */
export function createHealthCheckTool(
  engine: FeedbackMemoryEngine
): RegisteredMcpTool<Record<string, never>, HealthCheckToolResult> {
  return {
    metadata: {
      name: HEALTH_CHECK_TOOL_NAME,
      description: HEALTH_CHECK_TOOL_DESCRIPTION,
      inputSchema: HEALTH_CHECK_INPUT_JSON_SCHEMA,
    },
    execute: async (
      _args: Record<string, never>
    ): Promise<HealthCheckToolResult> => {
      const vectorStore = await engine.vectorStore.healthCheck();

      return {
        healthy: vectorStore,
        vectorStore,
      };
    },
  };
}

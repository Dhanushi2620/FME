import type { FeedbackMemoryEngine } from "../../composition";
import type { FeedbackMemoryMcpServerHandle } from "../FeedbackMemoryMcpServer";
import { createAddMemoryTool } from "./add-memory";
import { McpToolDispatcher } from "./dispatcher";
import { createHealthCheckTool } from "./health-check";
import { createListMemoriesTool } from "./list-memories";
import { createSearchMemoriesTool } from "./search-memories";

/**
 * Dependencies available to Feedback Memory MCP tool registration.
 */
export type FeedbackMemoryToolRegistrationContext = {
  server: FeedbackMemoryMcpServerHandle;
  engine: FeedbackMemoryEngine;
};

/**
 * Registers all Feedback Memory MCP tools on the server via a single dispatcher.
 */
export function registerFeedbackMemoryTools(
  context: FeedbackMemoryToolRegistrationContext
): void {
  const dispatcher = new McpToolDispatcher();

  dispatcher.registerTool(createAddMemoryTool(context.engine));
  dispatcher.registerTool(createSearchMemoriesTool(context.engine));
  dispatcher.registerTool(createHealthCheckTool(context.engine));
  dispatcher.registerTool(createListMemoriesTool(context.engine));

  dispatcher.install(context.server);
}

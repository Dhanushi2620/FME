/**
 * Feedback Memory MCP Server bootstrap.
 *
 * Hosts the long-lived MCP process that exposes Feedback Memory tools via
 * {@link registerFeedbackMemoryTools}. This module creates the engine and
 * underlying MCP Server, then registers all tool handlers.
 */

import {
  createFeedbackMemoryEngine,
  FeedbackMemoryEngine,
} from "../composition";
import { registerFeedbackMemoryTools } from "./tools";

const FEEDBACK_MEMORY_MCP_SERVER_NAME = "feedback-memory";
const FEEDBACK_MEMORY_MCP_SERVER_VERSION = "1.0.0";

/** Opaque handle for the underlying @modelcontextprotocol/sdk Server instance. */
export type FeedbackMemoryMcpServerHandle = object;

type McpServerConstructor = new (
  info: { name: string; version: string },
  options: { capabilities: Record<string, never> }
) => FeedbackMemoryMcpServerHandle;

function createMcpServer(): FeedbackMemoryMcpServerHandle {
  // Loaded at runtime so TS 4.9 is not forced to parse MCP SDK typings (Zod v4).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Server } = require("@modelcontextprotocol/sdk/server") as {
    Server: McpServerConstructor;
  };

  return new Server(
    {
      name: FEEDBACK_MEMORY_MCP_SERVER_NAME,
      version: FEEDBACK_MEMORY_MCP_SERVER_VERSION,
    },
    {
      capabilities: {},
    }
  );
}

/**
 * Bootstrap for the Feedback Memory MCP server process.
 *
 * Each instance owns one {@link FeedbackMemoryEngine} and one MCP server handle.
 * Instances are reusable and safe to create per long-lived MCP process.
 */
export class FeedbackMemoryMcpServer {
  private readonly engine: FeedbackMemoryEngine;

  private readonly server: FeedbackMemoryMcpServerHandle;

  constructor() {
    this.engine = createFeedbackMemoryEngine();
    this.server = createMcpServer();
    this.registerTools();
  }

  /**
   * Registers MCP tool handlers via {@link registerFeedbackMemoryTools}.
   */
  private registerTools(): void {
    registerFeedbackMemoryTools({
      server: this.server,
      engine: this.engine,
    });
  }

  /**
   * Returns the underlying MCP Server instance for transport wiring.
   */
  getServer(): FeedbackMemoryMcpServerHandle {
    return this.server;
  }
}

import { FeedbackMemoryMcpServer } from "./FeedbackMemoryMcpServer";
import { createLogger } from "../logging";

const logger = createLogger("McpServer");

type McpServerWithConnect = {
  connect: (transport: unknown) => Promise<void>;
};

type StdioServerTransportConstructor = new () => unknown;

function loadStdioServerTransport(): StdioServerTransportConstructor {
  // Loaded at runtime so TS 4.9 is not forced to parse MCP SDK typings (Zod v4).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js") as {
    StdioServerTransport: StdioServerTransportConstructor;
  };

  return StdioServerTransport;
}

/**
 * Boots the Feedback Memory MCP server over stdio and keeps the process alive
 * while serving MCP requests.
 */
export async function startMcpServer(): Promise<void> {
  try {
    const feedbackMemoryMcpServer = new FeedbackMemoryMcpServer();
    const server = feedbackMemoryMcpServer.getServer() as McpServerWithConnect;
    const StdioServerTransport = loadStdioServerTransport();
    const transport = new StdioServerTransport();

    await server.connect(transport);

    logger.info("Feedback Memory MCP server started on stdio.");
  } catch (error) {
    logger.error("Failed to start Feedback Memory MCP server.", {
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

const isDirectExecution =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;

if (isDirectExecution) {
  void (async () => {
    try {
      await startMcpServer();
    } catch {
      process.exit(1);
    }
  })();
}

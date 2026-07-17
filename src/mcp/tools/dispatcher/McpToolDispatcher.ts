import type { FeedbackMemoryMcpServerHandle } from "../../FeedbackMemoryMcpServer";

/** JSON Schema describing MCP tool input (protocol-level, not business validation). */
export type McpToolInputJsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required: string[];
};

/** Metadata advertised via tools/list for a single MCP tool. */
export type McpToolMetadata = {
  name: string;
  description: string;
  inputSchema: McpToolInputJsonSchema;
};

/** A tool contributed to the Feedback Memory MCP server. */
export type RegisteredMcpTool<TArgs = Record<string, unknown>, TResult = unknown> = {
  metadata: McpToolMetadata;
  execute: (args: TArgs) => Promise<TResult>;
};

type McpToolServer = {
  registerCapabilities: (capabilities: { tools: Record<string, never> }) => void;
  setRequestHandler: (
    schema: unknown,
    handler: (request: unknown) => unknown | Promise<unknown>
  ) => void;
};

type CallToolRequest = {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
};

type McpErrorTypes = {
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
  McpError: new (code: number, message: string) => Error;
  ErrorCode: { InvalidParams: number };
};

function loadMcpErrorTypes(): McpErrorTypes {
  // Loaded at runtime so TS 4.9 is not forced to parse MCP SDK typings (Zod v4).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("@modelcontextprotocol/sdk/types.js");
}

/**
 * Central MCP tool dispatcher for the Feedback Memory server.
 *
 * Installs exactly one {@link ListToolsRequestSchema} handler and one
 * {@link CallToolRequestSchema} handler, dispatching execution to registered tools.
 */
export class McpToolDispatcher {
  private readonly tools = new Map<string, RegisteredMcpTool>();

  private installed = false;

  /**
   * Registers a tool for listing and dispatch.
   *
   * Must be called before {@link install}.
   */
  registerTool<TArgs, TResult>(tool: RegisteredMcpTool<TArgs, TResult>): void {
    if (this.installed) {
      throw new Error(
        `Cannot register tool "${tool.metadata.name}" after dispatcher installation.`
      );
    }

    if (this.tools.has(tool.metadata.name)) {
      throw new Error(`Tool ${tool.metadata.name} is already registered.`);
    }

    // Heterogeneous registry: erase per-tool arg types at the map boundary.
    this.tools.set(tool.metadata.name, tool as RegisteredMcpTool);
  }

  /**
   * Installs the single ListTools and CallTool handlers on the MCP server.
   */
  install(server: FeedbackMemoryMcpServerHandle): void {
    if (this.installed) {
      throw new Error("McpToolDispatcher is already installed.");
    }

    const mcpServer = server as McpToolServer;
    const { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } =
      loadMcpErrorTypes();

    mcpServer.registerCapabilities({ tools: {} });

    mcpServer.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: Array.from(this.tools.values()).map((tool) => ({
        name: tool.metadata.name,
        description: tool.metadata.description,
        inputSchema: tool.metadata.inputSchema,
      })),
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const callRequest = request as CallToolRequest;
      const tool = this.tools.get(callRequest.params.name);
      if (!tool) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Tool ${callRequest.params.name} not found`
        );
      }

      const args = callRequest.params.arguments;
      if (!args) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Tool arguments are required."
        );
      }

      return tool.execute(args);
    });

    this.installed = true;
  }
}

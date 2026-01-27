import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../../auth";

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

interface ToolExtra {
	signal: AbortSignal;
	authInfo?: {
		token: string;
		clientId: string;
		scopes: string[];
		extra?: { mcpContext?: McpContext };
	};
}

type InputSchema = Record<string, unknown>;

export function registerTool(
	name: string,
	config: { description: string; inputSchema: InputSchema },
	handler: (
		params: Record<string, unknown>,
		ctx: McpContext,
	) => Promise<ToolResult>,
) {
	return (server: McpServer) => {
		server.tool(
			name,
			config.description,
			config.inputSchema,
			async (params: Record<string, unknown>, extra: ToolExtra) => {
				const ctx = extra.authInfo?.extra?.mcpContext;
				if (!ctx) {
					throw new Error("No MCP context available - authentication required");
				}
				return handler(params, ctx);
			},
		);
	};
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../../auth";

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InputSchema = Record<string, any>;

export function registerTool(
	name: string,
	config: { description: string; inputSchema: InputSchema },
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handler: (params: any, ctx: McpContext) => Promise<ToolResult>,
) {
	return (server: McpServer) => {
		server.tool(
			name,
			config.description,
			config.inputSchema,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			async (params: any, extra: any) => {
				const authInfo = extra.authInfo as
					| { extra?: { mcpContext?: McpContext } }
					| undefined;
				const ctx = authInfo?.extra?.mcpContext;
				if (!ctx) {
					throw new Error("No MCP context available - authentication required");
				}
				return handler(params, ctx);
			},
		);
	};
}

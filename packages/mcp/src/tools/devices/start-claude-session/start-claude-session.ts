import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeOnDevice, getMcpContext } from "../../utils";

export function register(server: McpServer) {
	server.registerTool(
		"start_claude_session",
		{
			description:
				"Start an autonomous Claude Code session for a task. Creates a new workspace and launches Claude in plan mode with the task context.",
			inputSchema: {
				deviceId: z.string().describe("Target device ID"),
				taskId: z.string().describe("Task ID to work on"),
			},
		},
		async (args, extra) => {
			const ctx = getMcpContext(extra);
			const deviceId = args.deviceId as string;
			const taskId = args.taskId as string;

			if (!deviceId) {
				return {
					content: [{ type: "text", text: "Error: deviceId is required" }],
					isError: true,
				};
			}

			if (!taskId) {
				return {
					content: [{ type: "text", text: "Error: taskId is required" }],
					isError: true,
				};
			}

			return executeOnDevice({
				ctx,
				deviceId,
				tool: "start_claude_session",
				params: { taskId },
			});
		},
	);
}

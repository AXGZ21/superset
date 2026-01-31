import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@superset/db/client";
import { taskStatuses, tasks } from "@superset/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { executeOnDevice, getMcpContext } from "../../utils";

function buildPrompt(task: {
	id: string;
	title: string;
	slug: string;
	description: string | null;
	priority: string;
	statusName: string | null;
	labels: string[] | null;
}): string {
	const lines: string[] = [];

	lines.push(`You are working on task "${task.title}" (${task.slug}).`);
	lines.push("");

	lines.push(`Priority: ${task.priority}`);
	if (task.statusName) {
		lines.push(`Status: ${task.statusName}`);
	}
	if (task.labels && task.labels.length > 0) {
		lines.push(`Labels: ${task.labels.join(", ")}`);
	}
	lines.push("");

	lines.push("## Task Description");
	lines.push("");
	lines.push(task.description || "No description provided.");
	lines.push("");

	lines.push("## Instructions");
	lines.push("");
	lines.push(
		"You are running fully autonomously. Do not ask questions or wait for user feedback — make all decisions independently based on the codebase and task description.",
	);
	lines.push("");
	lines.push(
		"IMPORTANT: Do NOT write any code or make any changes to files. Your job is ONLY to explore and plan.",
	);
	lines.push("");
	lines.push(
		"1. Explore the codebase to understand the relevant code and architecture",
	);
	lines.push("2. Create a detailed execution plan for this task including:");
	lines.push("   - Purpose and scope of the changes");
	lines.push("   - Key assumptions");
	lines.push(
		"   - Concrete implementation steps with specific files to modify",
	);
	lines.push("   - How to validate the changes work correctly");
	lines.push(
		`3. When your plan is complete, use the Superset MCP \`update_task\` tool to update task "${task.id}" with your full plan in the description field`,
	);
	lines.push("");
	lines.push(
		"Do NOT implement the plan. Only explore, plan, and update the task.",
	);

	return lines.join("\n");
}

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

			// Fetch task data
			const status = alias(taskStatuses, "status");
			const [task] = await db
				.select({
					id: tasks.id,
					slug: tasks.slug,
					title: tasks.title,
					description: tasks.description,
					priority: tasks.priority,
					statusName: status.name,
					labels: tasks.labels,
				})
				.from(tasks)
				.leftJoin(status, eq(tasks.statusId, status.id))
				.where(
					and(
						eq(tasks.id, taskId),
						eq(tasks.organizationId, ctx.organizationId),
						isNull(tasks.deletedAt),
					),
				)
				.limit(1);

			if (!task) {
				return {
					content: [{ type: "text", text: "Error: Task not found" }],
					isError: true,
				};
			}

			// Build the full claude command server-side
			const prompt = buildPrompt(task);
			const command = [
				"claude --dangerously-skip-permissions \"$(cat <<'SUPERSET_PROMPT'",
				prompt,
				"SUPERSET_PROMPT",
				')"',
			].join("\n");

			return executeOnDevice({
				ctx,
				deviceId,
				tool: "start_claude_session",
				params: { command, name: task.slug },
			});
		},
	);
}

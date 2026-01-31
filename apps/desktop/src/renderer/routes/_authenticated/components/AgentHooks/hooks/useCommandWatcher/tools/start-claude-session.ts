import type { SelectTask, SelectTaskStatus } from "@superset/db/schema";
import { useWorkspaceInitStore } from "renderer/stores/workspace-init";
import { z } from "zod";
import type { CommandResult, ToolContext, ToolDefinition } from "./types";

const schema = z.object({
	taskId: z.string(),
});

function buildPrompt(
	task: SelectTask,
	status: SelectTaskStatus | null,
): string {
	const lines: string[] = [];

	lines.push(`You are working on task "${task.title}" (${task.slug}).`);
	lines.push("");

	lines.push(`Priority: ${task.priority}`);
	if (status) {
		lines.push(`Status: ${status.name}`);
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
		"1. Explore the codebase to understand the relevant code and architecture",
	);
	lines.push("2. Create a detailed execution plan for this task including:");
	lines.push("   - Purpose and scope of the changes");
	lines.push("   - Key assumptions");
	lines.push(
		"   - Concrete implementation steps with specific files to modify",
	);
	lines.push("   - How to validate the changes work correctly");
	lines.push("3. Once your plan is solid, begin implementing it");
	lines.push(
		`4. When you are done, use the Superset MCP \`update_task\` tool to update task "${task.id}" with a summary of your plan in the description field`,
	);
	lines.push("");
	lines.push("Be thorough in your exploration before writing any code.");

	return lines.join("\n");
}

async function execute(
	params: z.infer<typeof schema>,
	ctx: ToolContext,
): Promise<CommandResult> {
	// 1. Fetch task from local DB
	const task = ctx.getTask(params.taskId);
	if (!task) {
		return { success: false, error: `Task not found: ${params.taskId}` };
	}

	const status = task.statusId ? ctx.getTaskStatus(task.statusId) : null;

	// 2. Construct prompt
	const prompt = buildPrompt(task, status ?? null);

	// 3. Build claude command (heredoc for safe escaping)
	const claudeCommand = `claude --allowedTools "mcp__superset*" --permission-mode plan "$(cat <<'SUPERSET_PROMPT'\n${prompt}\nSUPERSET_PROMPT\n)"`;

	// 4. Derive projectId from current workspace or most recent
	const workspaces = ctx.getWorkspaces();
	if (!workspaces || workspaces.length === 0) {
		return { success: false, error: "No workspaces available" };
	}

	let projectId: string | null = null;
	const activeWorkspaceId = ctx.getActiveWorkspaceId();
	if (activeWorkspaceId) {
		const activeWorkspace = workspaces.find(
			(ws) => ws.id === activeWorkspaceId,
		);
		if (activeWorkspace) {
			projectId = activeWorkspace.projectId;
		}
	}

	if (!projectId) {
		const sorted = [...workspaces].sort(
			(a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
		);
		projectId = sorted[0].projectId;
	}

	try {
		// 5. Create workspace
		const result = await ctx.createWorktree.mutateAsync({ projectId });

		// 6. Append claude command to pending terminal setup
		const store = useWorkspaceInitStore.getState();
		const pending = store.pendingTerminalSetups[result.workspace.id];
		store.addPendingTerminalSetup({
			workspaceId: result.workspace.id,
			projectId: pending?.projectId ?? projectId,
			initialCommands: [...(pending?.initialCommands ?? []), claudeCommand],
			defaultPreset: pending?.defaultPreset ?? null,
		});

		// 7. Navigate
		await ctx.navigateToWorkspace(result.workspace.id);

		return {
			success: true,
			data: {
				workspaceId: result.workspace.id,
				branch: result.workspace.branch,
			},
		};
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof Error
					? error.message
					: "Failed to start Claude session",
		};
	}
}

export const startClaudeSession: ToolDefinition<typeof schema> = {
	name: "start_claude_session",
	schema,
	execute,
};

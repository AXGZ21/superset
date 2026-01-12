import { trpc } from "renderer/lib/trpc";

type CloseContext = {
	previousGrouped: ReturnType<
		typeof trpc.useUtils
	>["workspaces"]["getAllGrouped"]["getData"] extends () => infer R
		? R
		: never;
	previousActive: ReturnType<
		typeof trpc.useUtils
	>["workspaces"]["getActive"]["getData"] extends () => infer R
		? R
		: never;
};

/**
 * Closes a workspace without deleting the worktree.
 * Uses getAllGrouped as source of truth since it's always cached by the sidebar.
 */
export function useCloseWorkspace(
	options?: Parameters<typeof trpc.workspaces.close.useMutation>[0],
) {
	const utils = trpc.useUtils();

	return trpc.workspaces.close.useMutation({
		...options,
		onMutate: async ({ id }) => {
			await Promise.all([
				utils.workspaces.getAllGrouped.cancel(),
				utils.workspaces.getActive.cancel(),
			]);

			const previousGrouped = utils.workspaces.getAllGrouped.getData();
			const previousActive = utils.workspaces.getActive.getData();

			if (previousGrouped) {
				utils.workspaces.getAllGrouped.setData(
					undefined,
					previousGrouped
						.map((group) => ({
							...group,
							workspaces: group.workspaces.filter((w) => w.id !== id),
						}))
						.filter((group) => group.workspaces.length > 0),
				);
			}

			// Prevent "no workspace" flash by switching to next workspace
			if (previousActive?.id === id) {
				const remainingWorkspaces = previousGrouped
					?.flatMap((g) =>
						g.workspaces
							.filter((w) => w.id !== id)
							.map((w) => ({ workspace: w, project: g.project })),
					)
					.sort((a, b) => b.workspace.lastOpenedAt - a.workspace.lastOpenedAt);

				if (remainingWorkspaces && remainingWorkspaces.length > 0) {
					const { workspace: nextWorkspace, project } = remainingWorkspaces[0];

					const worktreeData =
						nextWorkspace.type === "worktree"
							? {
									branch: nextWorkspace.branch,
									baseBranch: null,
									gitStatus: {
										branch: nextWorkspace.branch,
										needsRebase: false,
										lastRefreshed: Date.now(),
									},
								}
							: null;

					utils.workspaces.getActive.setData(undefined, {
						id: nextWorkspace.id,
						projectId: nextWorkspace.projectId,
						worktreeId: nextWorkspace.worktreeId,
						branch: nextWorkspace.branch,
						name: nextWorkspace.name,
						tabOrder: nextWorkspace.tabOrder,
						createdAt: nextWorkspace.createdAt,
						updatedAt: nextWorkspace.updatedAt,
						lastOpenedAt: nextWorkspace.lastOpenedAt,
						isUnread: nextWorkspace.isUnread,
						type: nextWorkspace.type,
						worktreePath: nextWorkspace.worktreePath,
						deletingAt: null,
						project: {
							id: project.id,
							name: project.name,
							mainRepoPath: project.mainRepoPath,
						},
						worktree: worktreeData,
					});
				} else {
					utils.workspaces.getActive.setData(undefined, null);
				}
			}

			return { previousGrouped, previousActive } as CloseContext;
		},
		onError: (_err, _variables, context) => {
			if (context?.previousGrouped !== undefined) {
				utils.workspaces.getAllGrouped.setData(
					undefined,
					context.previousGrouped,
				);
			}
			if (context?.previousActive !== undefined) {
				utils.workspaces.getActive.setData(undefined, context.previousActive);
			}
		},
		onSuccess: async (...args) => {
			// Only invalidate getAllGrouped, not getActive - we already set it optimistically
			// and invalidating it causes a brief flash while refetching
			await utils.workspaces.getAllGrouped.invalidate();
			// Close updates project metadata (lastOpenedAt, etc.)
			await utils.projects.getRecents.invalidate();
			await options?.onSuccess?.(...args);
		},
	});
}

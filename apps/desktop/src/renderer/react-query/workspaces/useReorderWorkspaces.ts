import { trpc } from "renderer/lib/trpc";

export function useReorderWorkspaces(
	options?: Parameters<typeof trpc.workspaces.reorder.useMutation>[0],
) {
	const utils = trpc.useUtils();

	return trpc.workspaces.reorder.useMutation({
		...options,
		onSuccess: async (...args) => {
			await utils.workspaces.getAllGrouped.invalidate();
			await options?.onSuccess?.(...args);
		},
	});
}

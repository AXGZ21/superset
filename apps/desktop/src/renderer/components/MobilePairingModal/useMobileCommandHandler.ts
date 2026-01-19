import { toast } from "@superset/ui/sonner";
import { useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useTabsStore } from "renderer/stores/tabs/store";

interface MobileCommand {
	id: string;
	transcript: string;
	targetType: "terminal" | "claude" | "task";
	targetId: string | null;
	createdAt: string;
}

/**
 * Hook to handle incoming mobile commands and execute them in the terminal.
 *
 * This hook subscribes to the mobile command stream and writes commands
 * to the active terminal pane when they come in.
 */
export function useMobileCommandHandler(workspaceId: string | null) {
	const writeMutation = electronTrpc.terminal.write.useMutation();
	const tabStore = useTabsStore();

	// Use ref to avoid recreating subscription on mutation changes
	const writeMutationRef = useRef(writeMutation);
	writeMutationRef.current = writeMutation;

	const tabStoreRef = useRef(tabStore);
	tabStoreRef.current = tabStore;

	const workspaceIdRef = useRef(workspaceId);
	workspaceIdRef.current = workspaceId;

	// Subscribe to mobile commands
	electronTrpc.mobile.onMobileCommand.useSubscription(undefined, {
		onData: (command: MobileCommand) => {
			console.log("[mobile-handler] Received command:", command);

			// Only handle terminal and claude commands (task handling would be different)
			if (command.targetType !== "terminal" && command.targetType !== "claude") {
				console.log("[mobile-handler] Skipping non-terminal command:", command.targetType);
				return;
			}

			const currentWorkspaceId = workspaceIdRef.current;
			if (!currentWorkspaceId) {
				console.warn("[mobile-handler] No active workspace");
				toast.error("No active workspace to send command to");
				return;
			}

			// Get the active tab for this workspace
			const store = tabStoreRef.current;
			const activeTabId = store.activeTabIds[currentWorkspaceId];
			if (!activeTabId) {
				console.warn("[mobile-handler] No active tab");
				toast.error("No active tab to send command to");
				return;
			}

			// Get the focused pane for the active tab
			const focusedPaneId = store.focusedPaneIds[activeTabId];
			if (!focusedPaneId) {
				console.warn("[mobile-handler] No focused pane");
				toast.error("No focused pane to send command to");
				return;
			}

			// Get the pane details
			const pane = store.panes[focusedPaneId];
			if (!pane) {
				console.warn("[mobile-handler] Pane not found:", focusedPaneId);
				toast.error("Focused pane not found");
				return;
			}

			// Check if the pane is a terminal
			if (pane.type !== "terminal") {
				console.warn("[mobile-handler] Focused pane is not a terminal:", pane.type);
				toast.error("Please focus a terminal pane to receive voice commands");
				return;
			}

			// Send the command to the terminal
			// For claude commands, we prefix with the Claude command trigger
			let commandText = command.transcript;
			if (command.targetType === "claude") {
				// Assuming Claude is invoked with a specific command like "claude" in terminal
				commandText = `claude "${command.transcript.replace(/"/g, '\\"')}"`;
			}

			console.log("[mobile-handler] Writing to terminal:", {
				paneId: focusedPaneId,
				commandText: commandText.substring(0, 50),
			});

			// Write the command to terminal followed by newline to execute
			writeMutationRef.current.mutate({
				paneId: focusedPaneId,
				data: commandText + "\n",
			});

			// Show toast notification
			toast.success(`Voice command sent to ${command.targetType}`, {
				description: command.transcript.substring(0, 50) + (command.transcript.length > 50 ? "..." : ""),
			});
		},
		onError: (error) => {
			console.error("[mobile-handler] Subscription error:", error);
		},
	});
}

import crypto from "node:crypto";
import { observable } from "@trpc/server/observable";
import { EventEmitter } from "node:events";
import { env } from "main/env.main";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { loadToken } from "../auth/utils/auth-functions";

/**
 * Mobile pairing and relay for the desktop app.
 *
 * Handles:
 * - QR code generation for pairing
 * - SSE connection to relay server
 * - Receiving and executing mobile commands
 */

// Event emitter for mobile commands
export const mobileEvents = new EventEmitter();

// Active session
let activeSessionId: string | null = null;

interface MobileCommand {
	id: string;
	transcript: string;
	targetType: "terminal" | "claude" | "task";
	targetId: string | null;
	createdAt: string;
}

/**
 * Generate a unique desktop instance ID
 */
function getDesktopInstanceId(): string {
	// Use a combination of machine-specific info and random bytes
	// In production, this could be stored persistently
	return `desktop-${crypto.randomBytes(8).toString("hex")}`;
}

// Polling state
let pollingInterval: NodeJS.Timeout | null = null;
const POLL_INTERVAL_MS = 2000;

/**
 * Poll for mobile commands from the server
 */
async function pollForCommands(sessionId: string): Promise<void> {
	try {
		const commandsUrl = new URL(`${env.NEXT_PUBLIC_API_URL}/api/mobile/commands`);
		commandsUrl.searchParams.set("sessionId", sessionId);

		const response = await fetch(commandsUrl.toString());

		if (!response.ok) {
			if (response.status === 401) {
				console.log("[mobile] Session expired, stopping poll");
				disconnectFromRelay();
				mobileEvents.emit("disconnected");
				return;
			}
			console.error("[mobile] Poll failed:", response.status);
			return;
		}

		const data = await response.json();
		const commands = data.commands as MobileCommand[];

		// Process each command
		for (const command of commands) {
			console.log("[mobile] Received command:", {
				id: command.id,
				targetType: command.targetType,
				transcript: command.transcript.substring(0, 50),
			});
			mobileEvents.emit("command", command);

			// Mark command as executed (we'll handle actual execution in renderer)
			await markCommandExecuted(command.id);
		}
	} catch (err) {
		console.error("[mobile] Poll error:", err);
	}
}

/**
 * Mark a command as executed on the server
 */
async function markCommandExecuted(commandId: string): Promise<void> {
	try {
		const url = `${env.NEXT_PUBLIC_API_URL}/api/mobile/commands`;
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ commandId, status: "executed" }),
		});
	} catch (err) {
		console.error("[mobile] Failed to mark command as executed:", err);
	}
}

/**
 * Start polling for mobile commands
 */
function startPolling(sessionId: string): void {
	// Stop any existing polling
	stopPolling();

	activeSessionId = sessionId;
	console.log("[mobile] Starting command polling for session:", sessionId);
	mobileEvents.emit("connected");

	// Poll immediately, then at interval
	pollForCommands(sessionId);
	pollingInterval = setInterval(() => {
		pollForCommands(sessionId);
	}, POLL_INTERVAL_MS);
}

/**
 * Stop polling for commands
 */
function stopPolling(): void {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
	}
	activeSessionId = null;
}

/**
 * Disconnect from the relay server (stop polling)
 */
function disconnectFromRelay(): void {
	stopPolling();
	mobileEvents.emit("disconnected");
}

export const createMobileRouter = () => {
	return router({
		/**
		 * Generate a QR code for pairing with mobile
		 */
		generatePairingQR: publicProcedure
			.input(
				z.object({
					workspaceId: z.string().optional(),
					workspaceName: z.string().optional(),
					projectPath: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const { token } = await loadToken();
				if (!token) {
					return { success: false, error: "Not authenticated" };
				}

				try {
					// Call the cloud API to create a pairing session
					const response = await fetch(
						`${env.NEXT_PUBLIC_API_URL}/api/trpc/mobile.createPairingSession`,
						{
							method: "POST",
							headers: {
								Authorization: `Bearer ${token}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								json: {
									desktopInstanceId: getDesktopInstanceId(),
									activeWorkspaceId: input.workspaceId,
									activeWorkspaceName: input.workspaceName,
									activeProjectPath: input.projectPath,
								},
							}),
						},
					);

					if (!response.ok) {
						const error = await response.text();
						console.error("[mobile] Failed to create pairing session:", error);
						return { success: false, error: "Failed to create pairing session" };
					}

					const data = await response.json();
					const { sessionId, pairingToken, expiresAt } = data.result.data.json;

					// Generate QR code data URL
					// Format: superset://pair?token=XXX
					const qrData =
						env.NODE_ENV === "development"
							? `superset-dev://pair?token=${pairingToken}`
							: `superset://pair?token=${pairingToken}`;

					// Start polling for commands on this session
					startPolling(sessionId);

					return {
						success: true,
						qrData,
						pairingToken,
						sessionId,
						expiresAt,
					};
				} catch (err) {
					console.error("[mobile] Error generating QR:", err);
					return {
						success: false,
						error: err instanceof Error ? err.message : "Unknown error",
					};
				}
			}),

		/**
		 * Start listening for mobile commands on a pairing session
		 */
		startRelayConnection: publicProcedure
			.input(z.object({ sessionId: z.string() }))
			.mutation(({ input }) => {
				// Start polling for commands
				startPolling(input.sessionId);
				return { success: true };
			}),

		/**
		 * Stop the relay connection
		 */
		stopRelayConnection: publicProcedure.mutation(() => {
			disconnectFromRelay();
			return { success: true };
		}),

		/**
		 * Get current relay connection status
		 */
		getRelayStatus: publicProcedure.query(() => {
			return {
				connected: pollingInterval !== null,
				sessionId: activeSessionId,
			};
		}),

		/**
		 * Subscribe to mobile commands
		 */
		onMobileCommand: publicProcedure.subscription(() => {
			return observable<MobileCommand>((emit) => {
				const handler = (command: MobileCommand) => {
					emit.next(command);
				};

				mobileEvents.on("command", handler);

				return () => {
					mobileEvents.off("command", handler);
				};
			});
		}),

		/**
		 * Subscribe to connection status changes
		 */
		onConnectionChange: publicProcedure.subscription(() => {
			return observable<{ connected: boolean }>((emit) => {
				const connectedHandler = () => {
					emit.next({ connected: true });
				};
				const disconnectedHandler = () => {
					emit.next({ connected: false });
				};

				mobileEvents.on("connected", connectedHandler);
				mobileEvents.on("disconnected", disconnectedHandler);

				// Emit initial state
				emit.next({ connected: pollingInterval !== null });

				return () => {
					mobileEvents.off("connected", connectedHandler);
					mobileEvents.off("disconnected", disconnectedHandler);
				};
			});
		}),

		/**
		 * Acknowledge a command was executed
		 */
		acknowledgeCommand: publicProcedure
			.input(
				z.object({
					commandId: z.string(),
					success: z.boolean(),
					error: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const status = input.success ? "executed" : "failed";
				const url = `${env.NEXT_PUBLIC_API_URL}/api/mobile/commands`;
				await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						commandId: input.commandId,
						status,
						error: input.error,
					}),
				});
				return { success: true };
			}),
	});
};

export type MobileRouter = ReturnType<typeof createMobileRouter>;

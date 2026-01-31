import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal as XTerm } from "@xterm/xterm";
import { useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useTabsStore } from "renderer/stores/tabs/store";
import type { TerminalStreamEvent } from "../types";
import { useFileLinkClick } from "./useFileLinkClick";
import { useTerminalColdRestore } from "./useTerminalColdRestore";
import { useTerminalConnection } from "./useTerminalConnection";
import { useTerminalCwd } from "./useTerminalCwd";
import { useTerminalLifecycle } from "./useTerminalLifecycle";
import { useTerminalModes } from "./useTerminalModes";
import { useTerminalRestore } from "./useTerminalRestore";
import { useTerminalStream } from "./useTerminalStream";

export interface UseTerminalOptions {
	paneId: string;
	tabId: string;
	workspaceId: string;
	terminalRef: React.RefObject<HTMLDivElement | null>;
	terminalTheme: import("@xterm/xterm").ITheme | null;
	isFocused: boolean;
}

export interface UseTerminalReturn {
	xtermInstance: XTerm | null;
	searchAddonRef: React.RefObject<SearchAddon | null>;
	exitStatus: "killed" | "exited" | null;
	connectionError: string | null;
	isRestoredMode: boolean;
	restartTerminal: () => void;
	handleRetryConnection: () => void;
	handleStartShell: () => void;
	writeRef: React.RefObject<(params: { paneId: string; data: string }) => void>;
}

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
	const { paneId, tabId, workspaceId, terminalRef, terminalTheme, isFocused } =
		options;

	// Get pane data from store
	const pane = useTabsStore((s) => s.panes[paneId]);
	const paneInitialCommands = pane?.initialCommands;
	const paneInitialCwd = pane?.initialCwd;
	const clearPaneInitialData = useTabsStore((s) => s.clearPaneInitialData);

	// Terminal connection state and mutations
	const {
		connectionError,
		setConnectionError,
		workspaceCwd,
		refs: {
			createOrAttach: createOrAttachRef,
			write: writeRef,
			resize: resizeRef,
			detach: detachRef,
			clearScrollback: clearScrollbackRef,
		},
	} = useTerminalConnection({ workspaceId });

	// Terminal CWD management
	const { updateCwdFromData } = useTerminalCwd({
		paneId,
		initialCwd: paneInitialCwd,
		workspaceCwd,
	});

	// Terminal modes tracking
	const {
		isAlternateScreenRef,
		isBracketedPasteRef,
		modeScanBufferRef,
		updateModesFromData,
		resetModes,
	} = useTerminalModes();

	// File link click handler
	const { handleFileLinkClick } = useFileLinkClick({
		workspaceId,
		workspaceCwd,
	});

	// Shared refs for stream handling
	const xtermRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
	const isExitedRef = useRef(false);
	const wasKilledByUserRef = useRef(false);
	const pendingEventsRef = useRef<TerminalStreamEvent[]>([]);
	const isFocusedRef = useRef(isFocused);
	isFocusedRef.current = isFocused;

	// Handler refs for event callbacks
	const handleTerminalExitRef = useRef<
		(exitCode: number, xterm: XTerm) => void
	>(() => {});
	const handleStreamErrorRef = useRef<
		(
			event: Extract<TerminalStreamEvent, { type: "error" }>,
			xterm: XTerm,
		) => void
	>(() => {});
	const setExitStatusRef = useRef<(status: "killed" | "exited" | null) => void>(
		() => {},
	);

	// Terminal restore logic
	const {
		isStreamReadyRef,
		didFirstRenderRef,
		pendingInitialStateRef,
		maybeApplyInitialState,
		flushPendingEvents,
	} = useTerminalRestore({
		paneId,
		xtermRef,
		fitAddonRef,
		pendingEventsRef,
		isAlternateScreenRef,
		isBracketedPasteRef,
		modeScanBufferRef,
		updateCwdFromData,
		updateModesFromData,
		onExitEvent: (exitCode, xterm) =>
			handleTerminalExitRef.current(exitCode, xterm),
		onErrorEvent: (event, xterm) => handleStreamErrorRef.current(event, xterm),
		onDisconnectEvent: (reason) =>
			setConnectionError(reason || "Connection to terminal daemon lost"),
	});

	// Cold restore handling
	const {
		isRestoredMode,
		setIsRestoredMode,
		setRestoredCwd,
		handleRetryConnection,
		handleStartShell,
	} = useTerminalColdRestore({
		paneId,
		tabId,
		workspaceId,
		xtermRef,
		fitAddonRef,
		isStreamReadyRef,
		isExitedRef,
		wasKilledByUserRef,
		isFocusedRef,
		didFirstRenderRef,
		pendingInitialStateRef,
		pendingEventsRef,
		createOrAttachRef,
		setConnectionError,
		setExitStatus: (status) => setExitStatusRef.current(status),
		maybeApplyInitialState,
		flushPendingEvents,
		resetModes,
	});

	// Stream handling
	const { handleTerminalExit, handleStreamError, handleStreamData } =
		useTerminalStream({
			paneId,
			xtermRef,
			isStreamReadyRef,
			isExitedRef,
			wasKilledByUserRef,
			pendingEventsRef,
			setExitStatus: (status) => setExitStatusRef.current(status),
			setConnectionError,
			updateModesFromData,
			updateCwdFromData,
		});

	// Populate handler refs
	handleTerminalExitRef.current = handleTerminalExit;
	handleStreamErrorRef.current = handleStreamError;

	// Stream subscription
	electronTrpc.terminal.stream.useSubscription(paneId, {
		onData: handleStreamData,
		enabled: true,
	});

	// Main terminal lifecycle
	const { xtermInstance, searchAddonRef, exitStatus, restartTerminal } =
		useTerminalLifecycle({
			paneId,
			tabId,
			workspaceId,
			terminalRef,
			terminalTheme,
			isFocused,
			workspaceCwd,
			paneInitialCommands,
			paneInitialCwd,
			clearPaneInitialData,
			handleFileLinkClick,
			createOrAttachRef,
			writeRef,
			resizeRef,
			detachRef,
			clearScrollbackRef,
			setConnectionError,
			connectionError,
			isStreamReadyRef,
			didFirstRenderRef,
			pendingInitialStateRef,
			maybeApplyInitialState,
			flushPendingEvents,
			isAlternateScreenRef,
			isBracketedPasteRef,
			resetModes,
			isRestoredMode,
			setIsRestoredMode,
			setRestoredCwd,
			handleRetryConnection,
			handleStartShell,
		});

	// Wire up exit status setter
	setExitStatusRef.current = () => {};

	return {
		xtermInstance,
		searchAddonRef,
		exitStatus,
		connectionError,
		isRestoredMode,
		restartTerminal,
		handleRetryConnection,
		handleStartShell,
		writeRef,
	};
}

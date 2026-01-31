import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useAppHotkey } from "renderer/stores/hotkeys";
import { useTabsStore } from "renderer/stores/tabs/store";
import { useTerminalTheme } from "renderer/stores/theme";
import {
	ConnectionErrorOverlay,
	RestoredModeOverlay,
	SessionKilledOverlay,
} from "./components";
import { getDefaultTerminalBg } from "./helpers";
import {
	useFileLinkClick,
	useTerminalColdRestore,
	useTerminalConnection,
	useTerminalCwd,
	useTerminalLifecycle,
	useTerminalModes,
	useTerminalRestore,
	useTerminalStream,
} from "./hooks";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TerminalSearch } from "./TerminalSearch";
import type { TerminalProps, TerminalStreamEvent } from "./types";
import { scrollToBottom, shellEscapePaths } from "./utils";

export const Terminal = ({ paneId, tabId, workspaceId }: TerminalProps) => {
	const pane = useTabsStore((s) => s.panes[paneId]);
	const paneInitialCommands = pane?.initialCommands;
	const paneInitialCwd = pane?.initialCwd;
	const clearPaneInitialData = useTabsStore((s) => s.clearPaneInitialData);
	const terminalRef = useRef<HTMLDivElement>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const focusedPaneId = useTabsStore((s) => s.focusedPaneIds[tabId]);
	const terminalTheme = useTerminalTheme();
	const isFocused = focusedPaneId === paneId;

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

	// Refs for stream event handlers
	const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
	const isExitedRef = useRef(false);
	const wasKilledByUserRef = useRef(false);
	const pendingEventsRef = useRef<TerminalStreamEvent[]>([]);

	const handleTerminalExitRef = useRef<
		(exitCode: number, xterm: import("@xterm/xterm").Terminal) => void
	>(() => {});
	const handleStreamErrorRef = useRef<
		(
			event: Extract<TerminalStreamEvent, { type: "error" }>,
			xterm: import("@xterm/xterm").Terminal,
		) => void
	>(() => {});

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
		fitAddonRef: useRef(null),
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
		fitAddonRef: useRef(null),
		isStreamReadyRef,
		isExitedRef,
		wasKilledByUserRef,
		isFocusedRef: useRef(isFocused),
		didFirstRenderRef,
		pendingInitialStateRef,
		pendingEventsRef,
		createOrAttachRef,
		setConnectionError,
		setExitStatus: () => {},
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
			setExitStatus: () => {},
			setConnectionError,
			updateModesFromData,
			updateCwdFromData,
		});

	// Populate handler refs for flushPendingEvents to use
	handleTerminalExitRef.current = handleTerminalExit;
	handleStreamErrorRef.current = handleStreamError;

	// Stream subscription
	electronTrpc.terminal.stream.useSubscription(paneId, {
		onData: handleStreamData,
		enabled: true,
	});

	// Main terminal lifecycle hook
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

	// Close search when unfocused
	useEffect(() => {
		if (!isFocused) {
			setIsSearchOpen(false);
		}
	}, [isFocused]);

	// Hotkeys
	useAppHotkey(
		"FIND_IN_TERMINAL",
		() => setIsSearchOpen((prev) => !prev),
		{ enabled: isFocused, preventDefault: true },
		[isFocused],
	);

	useAppHotkey(
		"SCROLL_TO_BOTTOM",
		() => {
			if (xtermInstance) {
				scrollToBottom(xtermInstance);
			}
		},
		{ enabled: isFocused, preventDefault: true },
		[isFocused, xtermInstance],
	);

	const terminalBg = terminalTheme?.background ?? getDefaultTerminalBg();

	const handleDragOver = (event: React.DragEvent) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	};

	const handleDrop = (event: React.DragEvent) => {
		event.preventDefault();
		const files = Array.from(event.dataTransfer.files);
		if (files.length === 0) return;
		const paths = files.map((file) => window.webUtils.getPathForFile(file));
		const text = shellEscapePaths(paths);
		writeRef.current({ paneId, data: text });
	};

	return (
		<div
			role="application"
			className="relative h-full w-full overflow-hidden"
			style={{ backgroundColor: terminalBg }}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			<TerminalSearch
				searchAddon={searchAddonRef.current}
				isOpen={isSearchOpen}
				onClose={() => setIsSearchOpen(false)}
			/>
			<ScrollToBottomButton terminal={xtermInstance} />
			{exitStatus === "killed" && !connectionError && !isRestoredMode && (
				<SessionKilledOverlay onRestart={restartTerminal} />
			)}
			{connectionError && (
				<ConnectionErrorOverlay onRetry={handleRetryConnection} />
			)}
			{isRestoredMode && (
				<RestoredModeOverlay onStartShell={handleStartShell} />
			)}
			<div ref={terminalRef} className="h-full w-full" />
		</div>
	);
};

import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { IDisposable, Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	clearTerminalKilledByUser,
	isTerminalKilledByUser,
} from "renderer/lib/terminal-kill-tracking";
import { useTabsStore } from "renderer/stores/tabs/store";
import { useTerminalCallbacksStore } from "renderer/stores/tabs/terminal-callbacks";
import { scheduleTerminalAttach } from "../attach-scheduler";
import { sanitizeForTitle } from "../commandBuffer";
import { DEBUG_TERMINAL, FIRST_RENDER_RESTORE_FALLBACK_MS } from "../config";
import {
	createKeyPressHandler,
	createTerminalInputHandler,
	createTerminalInstance,
	setupClickToMoveCursor,
	setupFocusListener,
	setupKeyboardHandler,
	setupPasteHandler,
	setupResizeHandlers,
	setupVisibilityChangeHandler,
	type TerminalRendererRef,
} from "../helpers";
import { coldRestoreState, pendingDetaches } from "../state";
import type { TerminalStreamEvent } from "../types";
import { scrollToBottom } from "../utils";

export interface UseTerminalLifecycleOptions {
	paneId: string;
	tabId: string;
	workspaceId: string;
	terminalRef: React.RefObject<HTMLDivElement | null>;
	terminalTheme: import("@xterm/xterm").ITheme | null;
	isFocused: boolean;
	workspaceCwd: string | null;
	paneInitialCommands: string[] | undefined;
	paneInitialCwd: string | undefined;
	clearPaneInitialData: (paneId: string) => void;
	handleFileLinkClick: (path: string, line?: number, column?: number) => void;
	// Connection refs
	createOrAttachRef: React.RefObject<
		(
			params: {
				paneId: string;
				tabId: string;
				workspaceId: string;
				cols: number;
				rows: number;
				initialCommands?: string[];
				cwd?: string;
				allowKilled?: boolean;
			},
			callbacks: {
				onSuccess: (result: {
					isColdRestore?: boolean;
					previousCwd?: string;
					scrollback?: string;
					snapshot?: { snapshotAnsi?: string };
				}) => void;
				onError: (error: { message?: string }) => void;
				onSettled?: () => void;
			},
		) => void
	>;
	writeRef: React.RefObject<(params: { paneId: string; data: string }) => void>;
	resizeRef: React.RefObject<
		(params: { paneId: string; cols: number; rows: number }) => void
	>;
	detachRef: React.RefObject<(params: { paneId: string }) => void>;
	clearScrollbackRef: React.RefObject<(params: { paneId: string }) => void>;
	setConnectionError: (error: string | null) => void;
	connectionError: string | null;
	// Restore refs
	isStreamReadyRef: React.RefObject<boolean>;
	didFirstRenderRef: React.RefObject<boolean>;
	pendingInitialStateRef: React.RefObject<unknown>;
	maybeApplyInitialState: () => void;
	flushPendingEvents: () => void;
	// Mode refs
	isAlternateScreenRef: React.RefObject<boolean>;
	isBracketedPasteRef: React.RefObject<boolean>;
	resetModes: () => void;
	// Cold restore
	isRestoredMode: boolean;
	setIsRestoredMode: (value: boolean) => void;
	setRestoredCwd: (cwd: string | null) => void;
	handleRetryConnection: () => void;
	handleStartShell: () => void;
}

export interface UseTerminalLifecycleReturn {
	xtermInstance: XTerm | null;
	searchAddonRef: React.RefObject<SearchAddon | null>;
	exitStatus: "killed" | "exited" | null;
	restartTerminal: () => void;
}

export function useTerminalLifecycle(
	options: UseTerminalLifecycleOptions,
): UseTerminalLifecycleReturn {
	const {
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
	} = options;

	// Internal refs
	const xtermRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const rendererRef = useRef<TerminalRendererRef | null>(null);
	const isExitedRef = useRef(false);
	const wasKilledByUserRef = useRef(false);
	const _pendingEventsRef = useRef<TerminalStreamEvent[]>([]);
	const commandBufferRef = useRef("");
	const restartTerminalRef = useRef<() => void>(() => {});

	// State
	const [exitStatus, setExitStatus] = useState<"killed" | "exited" | null>(
		null,
	);
	const [xtermInstance, setXtermInstance] = useState<XTerm | null>(null);

	// Stable refs for values that change
	const isFocusedRef = useRef(isFocused);
	isFocusedRef.current = isFocused;

	const initialThemeRef = useRef(terminalTheme);

	const workspaceCwdRef = useRef(workspaceCwd);
	workspaceCwdRef.current = workspaceCwd;

	const paneInitialCommandsRef = useRef(paneInitialCommands);
	const paneInitialCwdRef = useRef(paneInitialCwd);
	const clearPaneInitialDataRef = useRef(clearPaneInitialData);
	paneInitialCommandsRef.current = paneInitialCommands;
	paneInitialCwdRef.current = paneInitialCwd;
	clearPaneInitialDataRef.current = clearPaneInitialData;

	const handleFileLinkClickRef = useRef(handleFileLinkClick);
	handleFileLinkClickRef.current = handleFileLinkClick;

	const isRestoredModeRef = useRef(isRestoredMode);
	isRestoredModeRef.current = isRestoredMode;

	const connectionErrorRef = useRef(connectionError);
	connectionErrorRef.current = connectionError;

	// Tab title handling
	const setTabAutoTitle = useTabsStore((s) => s.setTabAutoTitle);
	const setFocusedPane = useTabsStore((s) => s.setFocusedPane);

	const setTabAutoTitleRef = useRef(setTabAutoTitle);
	setTabAutoTitleRef.current = setTabAutoTitle;

	const debouncedSetTabAutoTitleRef = useRef(
		(() => {
			let timeout: ReturnType<typeof setTimeout> | null = null;
			const fn = (tabId: string, title: string) => {
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(() => {
					setTabAutoTitleRef.current(tabId, title);
				}, 100);
			};
			fn.cancel = () => {
				if (timeout) clearTimeout(timeout);
			};
			return fn;
		})(),
	);

	// Callback registration refs
	const registerClearCallbackRef = useRef(
		useTerminalCallbacksStore.getState().registerClearCallback,
	);
	const unregisterClearCallbackRef = useRef(
		useTerminalCallbacksStore.getState().unregisterClearCallback,
	);
	const registerScrollToBottomCallbackRef = useRef(
		useTerminalCallbacksStore.getState().registerScrollToBottomCallback,
	);
	const unregisterScrollToBottomCallbackRef = useRef(
		useTerminalCallbacksStore.getState().unregisterScrollToBottomCallback,
	);

	// Focus handler ref
	const handleTerminalFocusRef = useRef(() => {});
	handleTerminalFocusRef.current = () => {
		setFocusedPane(tabId, paneId);
	};

	// Main lifecycle effect
	useEffect(() => {
		const container = terminalRef.current;
		if (!container) return;

		if (DEBUG_TERMINAL) {
			console.log(`[Terminal] Mount: ${paneId}`);
		}

		// Cancel pending detach from previous unmount
		const pendingDetach = pendingDetaches.get(paneId);
		if (pendingDetach) {
			clearTimeout(pendingDetach);
			pendingDetaches.delete(paneId);
		}

		let isUnmounted = false;

		const {
			xterm,
			fitAddon,
			renderer,
			cleanup: cleanupQuerySuppression,
		} = createTerminalInstance(container, {
			cwd: workspaceCwdRef.current ?? undefined,
			initialTheme: initialThemeRef.current ?? undefined,
			onFileLinkClick: (path, line, column) =>
				handleFileLinkClickRef.current(path, line, column),
		});

		const scheduleScrollToBottom = () => {
			requestAnimationFrame(() => {
				if (isUnmounted || xtermRef.current !== xterm) return;
				scrollToBottom(xterm);
			});
		};

		// Initialize refs
		xtermRef.current = xterm;
		fitAddonRef.current = fitAddon;
		rendererRef.current = renderer;
		isExitedRef.current = false;
		setXtermInstance(xterm);
		isStreamReadyRef.current = false;
		didFirstRenderRef.current = false;
		pendingInitialStateRef.current = null;

		if (isFocusedRef.current) {
			xterm.focus();
		}

		// Load search addon asynchronously
		import("@xterm/addon-search").then(({ SearchAddon }) => {
			if (isUnmounted) return;
			const searchAddon = new SearchAddon();
			xterm.loadAddon(searchAddon);
			searchAddonRef.current = searchAddon;
		});

		// First render handling
		let renderDisposable: IDisposable | null = null;
		let firstRenderFallback: ReturnType<typeof setTimeout> | null = null;

		renderDisposable = xterm.onRender(() => {
			if (firstRenderFallback) {
				clearTimeout(firstRenderFallback);
				firstRenderFallback = null;
			}
			renderDisposable?.dispose();
			renderDisposable = null;
			didFirstRenderRef.current = true;
			maybeApplyInitialState();
		});

		firstRenderFallback = setTimeout(() => {
			if (isUnmounted || didFirstRenderRef.current) return;
			didFirstRenderRef.current = true;
			maybeApplyInitialState();
		}, FIRST_RENDER_RESTORE_FALLBACK_MS);

		// Restart terminal function
		const restartTerminal = () => {
			isExitedRef.current = false;
			isStreamReadyRef.current = false;
			wasKilledByUserRef.current = false;
			setExitStatus(null);
			clearTerminalKilledByUser(paneId);
			resetModes();
			xterm.clear();
			createOrAttachRef.current(
				{
					paneId,
					tabId,
					workspaceId,
					cols: xterm.cols,
					rows: xterm.rows,
					allowKilled: true,
				},
				{
					onSuccess: (result) => {
						pendingInitialStateRef.current = result;
						maybeApplyInitialState();
					},
					onError: (error) => {
						console.error("[Terminal] Failed to restart:", error);
						setConnectionError(error.message || "Failed to restart terminal");
						isStreamReadyRef.current = true;
						flushPendingEvents();
					},
				},
			);
		};
		restartTerminalRef.current = restartTerminal;

		// Input handlers
		const handleTerminalInput = createTerminalInputHandler({
			isRestoredModeRef,
			connectionErrorRef,
			isExitedRef,
			isFocusedRef,
			wasKilledByUserRef,
			paneId,
			writeRef,
			onRestart: restartTerminal,
		});

		const handleKeyPress = createKeyPressHandler({
			paneId,
			tabId,
			isRestoredModeRef,
			connectionErrorRef,
			isAlternateScreenRef,
			commandBufferRef,
			debouncedSetTabAutoTitle: (tid, title) =>
				debouncedSetTabAutoTitleRef.current(tid, title),
			sanitizeForTitle,
			getPane: () => useTabsStore.getState().panes[paneId],
			setPaneStatus: (pid, status) =>
				useTabsStore.getState().setPaneStatus(pid, status),
		});

		// Initial attach
		const initialCommands = paneInitialCommandsRef.current;
		const initialCwd = paneInitialCwdRef.current;

		const cancelInitialAttach = scheduleTerminalAttach({
			paneId,
			priority: isFocusedRef.current ? 0 : 1,
			run: (done) => {
				if (isTerminalKilledByUser(paneId)) {
					wasKilledByUserRef.current = true;
					isExitedRef.current = true;
					isStreamReadyRef.current = false;
					setExitStatus("killed");
					done();
					return;
				}
				if (DEBUG_TERMINAL) {
					console.log(`[Terminal] createOrAttach start: ${paneId}`);
				}
				createOrAttachRef.current(
					{
						paneId,
						tabId,
						workspaceId,
						cols: xterm.cols,
						rows: xterm.rows,
						initialCommands,
						cwd: initialCwd,
					},
					{
						onSuccess: (result) => {
							setConnectionError(null);
							if (initialCommands || initialCwd) {
								clearPaneInitialDataRef.current(paneId);
							}

							const storedColdRestore = coldRestoreState.get(paneId);
							if (storedColdRestore?.isRestored) {
								setIsRestoredMode(true);
								setRestoredCwd(storedColdRestore.cwd);
								if (storedColdRestore.scrollback && xterm) {
									xterm.write(
										storedColdRestore.scrollback,
										scheduleScrollToBottom,
									);
								}
								didFirstRenderRef.current = true;
								return;
							}

							if (result.isColdRestore) {
								const scrollback =
									result.snapshot?.snapshotAnsi ?? result.scrollback;
								coldRestoreState.set(paneId, {
									isRestored: true,
									cwd: result.previousCwd || null,
									scrollback,
								});
								setIsRestoredMode(true);
								setRestoredCwd(result.previousCwd || null);
								if (scrollback && xterm) {
									xterm.write(scrollback, scheduleScrollToBottom);
								}
								didFirstRenderRef.current = true;
								return;
							}

							pendingInitialStateRef.current = result;
							maybeApplyInitialState();
						},
						onError: (error) => {
							if (error.message?.includes("TERMINAL_SESSION_KILLED")) {
								wasKilledByUserRef.current = true;
								isExitedRef.current = true;
								isStreamReadyRef.current = false;
								setExitStatus("killed");
								setConnectionError(null);
								return;
							}
							console.error("[Terminal] Failed to create/attach:", error);
							setConnectionError(
								error.message || "Failed to connect to terminal",
							);
							isStreamReadyRef.current = true;
							flushPendingEvents();
						},
						onSettled: () => done(),
					},
				);
			},
		});

		// Event disposables
		const inputDisposable = xterm.onData(handleTerminalInput);
		const keyDisposable = xterm.onKey(handleKeyPress);
		const titleDisposable = xterm.onTitleChange((title) => {
			if (title) {
				debouncedSetTabAutoTitleRef.current(tabId, title);
			}
		});

		// Utility handlers
		const handleClear = () => {
			xterm.clear();
			clearScrollbackRef.current({ paneId });
		};

		const handleScrollToBottom = () => scrollToBottom(xterm);

		const handleWrite = (data: string) => {
			if (isExitedRef.current) return;
			writeRef.current({ paneId, data });
		};

		// Setup handlers
		const cleanupKeyboard = setupKeyboardHandler(xterm, {
			onShiftEnter: () => handleWrite("\x1b\r"),
			onClear: handleClear,
			onWrite: handleWrite,
		});
		const cleanupClickToMove = setupClickToMoveCursor(xterm, {
			onWrite: handleWrite,
		});
		registerClearCallbackRef.current(paneId, handleClear);
		registerScrollToBottomCallbackRef.current(paneId, handleScrollToBottom);

		const cleanupFocus = setupFocusListener(xterm, () =>
			handleTerminalFocusRef.current(),
		);
		const cleanupResize = setupResizeHandlers(
			container,
			xterm,
			fitAddon,
			(cols, rows) => resizeRef.current({ paneId, cols, rows }),
		);
		const cleanupPaste = setupPasteHandler(xterm, {
			onPaste: (text) => {
				commandBufferRef.current += text;
			},
			onWrite: handleWrite,
			isBracketedPasteEnabled: () => isBracketedPasteRef.current,
		});

		const isUnmountedRef = { current: isUnmounted };
		const cleanupVisibility = setupVisibilityChangeHandler({
			xterm,
			fitAddon,
			paneId,
			resizeRef,
			isUnmountedRef,
			xtermRef,
		});

		// Cleanup
		return () => {
			if (DEBUG_TERMINAL) {
				console.log(`[Terminal] Unmount: ${paneId}`);
			}
			cancelInitialAttach();
			isUnmounted = true;
			isUnmountedRef.current = true;
			if (firstRenderFallback) clearTimeout(firstRenderFallback);
			cleanupVisibility();
			inputDisposable.dispose();
			keyDisposable.dispose();
			titleDisposable.dispose();
			cleanupKeyboard();
			cleanupClickToMove();
			cleanupFocus?.();
			cleanupResize();
			cleanupPaste();
			cleanupQuerySuppression();
			unregisterClearCallbackRef.current(paneId);
			unregisterScrollToBottomCallbackRef.current(paneId);
			debouncedSetTabAutoTitleRef.current?.cancel?.();

			const detachTimeout = setTimeout(() => {
				detachRef.current({ paneId });
				pendingDetaches.delete(paneId);
				coldRestoreState.delete(paneId);
			}, 50);
			pendingDetaches.set(paneId, detachTimeout);

			isStreamReadyRef.current = false;
			didFirstRenderRef.current = false;
			pendingInitialStateRef.current = null;
			resetModes();
			renderDisposable?.dispose();

			setTimeout(() => xterm.dispose(), 0);

			xtermRef.current = null;
			searchAddonRef.current = null;
			rendererRef.current = null;
			setXtermInstance(null);
		};
	}, [
		paneId,
		tabId,
		workspaceId,
		terminalRef,
		maybeApplyInitialState,
		flushPendingEvents,
		setConnectionError,
		resetModes,
		setIsRestoredMode,
		setRestoredCwd,
		isStreamReadyRef,
		didFirstRenderRef,
		pendingInitialStateRef,
		createOrAttachRef,
		writeRef,
		resizeRef,
		detachRef,
		clearScrollbackRef,
		isAlternateScreenRef,
		isBracketedPasteRef,
	]);

	// Theme sync effect
	useEffect(() => {
		const xterm = xtermRef.current;
		if (!xterm || !terminalTheme) return;
		xterm.options.theme = terminalTheme;
	}, [terminalTheme]);

	// Focus sync effect
	useEffect(() => {
		const xterm = xtermRef.current;
		if (!xterm) return;
		if (isFocused) {
			xterm.focus();
		}
	}, [isFocused]);

	const restartTerminal = useCallback(() => {
		restartTerminalRef.current();
	}, []);

	return {
		xtermInstance,
		searchAddonRef,
		exitStatus,
		restartTerminal,
	};
}

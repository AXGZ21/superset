import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useAppHotkey } from "renderer/stores/hotkeys";
import { useTabsStore } from "renderer/stores/tabs/store";
import { useTerminalTheme } from "renderer/stores/theme";
import {
	ConnectionErrorOverlay,
	RestoredModeOverlay,
	SessionKilledOverlay,
} from "./components";
import { getDefaultTerminalBg } from "./helpers";
import { useTerminal } from "./hooks";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TerminalSearch } from "./TerminalSearch";
import type { TerminalProps } from "./types";
import { scrollToBottom, shellEscapePaths } from "./utils";

export const Terminal = ({ paneId, tabId, workspaceId }: TerminalProps) => {
	const terminalRef = useRef<HTMLDivElement>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const focusedPaneId = useTabsStore((s) => s.focusedPaneIds[tabId]);
	const terminalTheme = useTerminalTheme();
	const isFocused = focusedPaneId === paneId;

	const {
		xtermInstance,
		searchAddonRef,
		exitStatus,
		connectionError,
		isRestoredMode,
		restartTerminal,
		handleRetryConnection,
		handleStartShell,
		writeRef,
	} = useTerminal({
		paneId,
		tabId,
		workspaceId,
		terminalRef,
		terminalTheme,
		isFocused,
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

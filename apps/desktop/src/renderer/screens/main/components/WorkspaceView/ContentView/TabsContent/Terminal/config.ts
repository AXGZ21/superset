import type { ITerminalOptions } from "@xterm/xterm";

// Use user's theme
export const TERMINAL_THEME: ITerminalOptions["theme"] = undefined;

// Fallback timeout for first render (in case xterm doesn't emit onRender)
export const FIRST_RENDER_RESTORE_FALLBACK_MS = 250;

// Debug logging for terminal lifecycle (enable via localStorage)
// Run in DevTools console: localStorage.setItem('SUPERSET_TERMINAL_DEBUG', '1')
export const DEBUG_TERMINAL =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("SUPERSET_TERMINAL_DEBUG") === "1";

// Base terminal options (fontFamily is set dynamically via the font store)
export const TERMINAL_OPTIONS: ITerminalOptions = {
	cursorBlink: true,
	fontSize: 14,
	theme: TERMINAL_THEME,
	allowProposedApi: true,
	scrollback: 10000,
	macOptionIsMeta: true,
	cursorStyle: "block",
	cursorInactiveStyle: "outline",
	fastScrollModifier: "alt",
	fastScrollSensitivity: 5,
	screenReaderMode: false,
};

export const RESIZE_DEBOUNCE_MS = 150;

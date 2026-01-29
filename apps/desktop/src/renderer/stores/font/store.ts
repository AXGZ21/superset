import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
	DEFAULT_EDITOR_FONT_FAMILY,
	DEFAULT_FONT_SETTINGS,
	DEFAULT_TERMINAL_FONT_FAMILY,
} from "../../../shared/constants";
import { trpcFontStorage } from "../../lib/trpc-storage";

interface FontSettings {
	editorFont: string | null;
	terminalFont: string | null;
	terminalFontSize: number;
}

interface FontState extends FontSettings {
	setEditorFont: (font: string | null) => void;
	setTerminalFont: (font: string | null) => void;
	setTerminalFontSize: (size: number) => void;
	getTerminalFontFamily: () => string;
	getEditorFontFamily: () => string;
}

export const useFontStore = create<FontState>()(
	devtools(
		persist(
			(set, get) => ({
				editorFont: DEFAULT_FONT_SETTINGS.editorFont,
				terminalFont: DEFAULT_FONT_SETTINGS.terminalFont,
				terminalFontSize: DEFAULT_FONT_SETTINGS.terminalFontSize,

				setEditorFont: (font: string | null) => {
					set({ editorFont: font });
				},

				setTerminalFont: (font: string | null) => {
					set({ terminalFont: font });
				},

				setTerminalFontSize: (size: number) => {
					set({ terminalFontSize: size });
				},

				getTerminalFontFamily: () => {
					const { terminalFont } = get();
					if (terminalFont) {
						// User's custom font first, then fallback to defaults
						return `"${terminalFont}", ${DEFAULT_TERMINAL_FONT_FAMILY}`;
					}
					return DEFAULT_TERMINAL_FONT_FAMILY;
				},

				getEditorFontFamily: () => {
					const { editorFont } = get();
					if (editorFont) {
						// User's custom font first, then fallback to defaults
						return `"${editorFont}", ${DEFAULT_EDITOR_FONT_FAMILY}`;
					}
					return DEFAULT_EDITOR_FONT_FAMILY;
				},
			}),
			{
				name: "font-storage",
				storage: trpcFontStorage,
				partialize: (state) => ({
					editorFont: state.editorFont,
					terminalFont: state.terminalFont,
					terminalFontSize: state.terminalFontSize,
				}),
			},
		),
		{ name: "FontStore" },
	),
);

// Helper to compute font family string
const computeFontFamily = (
	customFont: string | null,
	defaultFamily: string,
): string => {
	if (customFont) {
		return `"${customFont}", ${defaultFamily}`;
	}
	return defaultFamily;
};

// Convenience hooks
export const useEditorFont = () => useFontStore((state) => state.editorFont);
export const useTerminalFont = () =>
	useFontStore((state) => state.terminalFont);
export const useTerminalFontSize = () =>
	useFontStore((state) => state.terminalFontSize);
export const useSetEditorFont = () =>
	useFontStore((state) => state.setEditorFont);
export const useSetTerminalFont = () =>
	useFontStore((state) => state.setTerminalFont);
export const useSetTerminalFontSize = () =>
	useFontStore((state) => state.setTerminalFontSize);

// Reactive font family hooks - compute in selector so Zustand tracks dependencies
export const useTerminalFontFamily = () =>
	useFontStore((state) =>
		computeFontFamily(state.terminalFont, DEFAULT_TERMINAL_FONT_FAMILY),
	);
export const useEditorFontFamily = () =>
	useFontStore((state) =>
		computeFontFamily(state.editorFont, DEFAULT_EDITOR_FONT_FAMILY),
	);

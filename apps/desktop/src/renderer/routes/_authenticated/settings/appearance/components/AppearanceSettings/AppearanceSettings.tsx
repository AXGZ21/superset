import { Button } from "@superset/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Slider } from "@superset/ui/slider";
import {
	type MarkdownStyle,
	SYSTEM_THEME_ID,
	useEditorFont,
	useMarkdownStyle,
	useSetEditorFont,
	useSetMarkdownStyle,
	useSetTerminalFont,
	useSetTerminalFontSize,
	useSetTheme,
	useTerminalFont,
	useTerminalFontSize,
	useThemeId,
	useThemeStore,
} from "renderer/stores";
import {
	DEFAULT_EDITOR_FONT_FAMILY,
	DEFAULT_FONT_SETTINGS,
	DEFAULT_TERMINAL_FONT_FAMILY,
} from "shared/constants";
import { builtInThemes } from "shared/themes";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../utils/settings-search";
import { SystemThemeCard } from "./components/SystemThemeCard";
import { ThemeCard } from "./components/ThemeCard";

interface AppearanceSettingsProps {
	visibleItems?: SettingItemId[] | null;
}

export function AppearanceSettings({ visibleItems }: AppearanceSettingsProps) {
	const showTheme = isItemVisible(
		SETTING_ITEM_ID.APPEARANCE_THEME,
		visibleItems,
	);
	const showMarkdown = isItemVisible(
		SETTING_ITEM_ID.APPEARANCE_MARKDOWN,
		visibleItems,
	);
	const showCustomThemes = isItemVisible(
		SETTING_ITEM_ID.APPEARANCE_CUSTOM_THEMES,
		visibleItems,
	);
	const showFonts = isItemVisible(
		SETTING_ITEM_ID.APPEARANCE_FONTS,
		visibleItems,
	);

	const activeThemeId = useThemeId();
	const setTheme = useSetTheme();
	const customThemes = useThemeStore((state) => state.customThemes);
	const markdownStyle = useMarkdownStyle();
	const setMarkdownStyle = useSetMarkdownStyle();

	// Font settings
	const editorFont = useEditorFont();
	const terminalFont = useTerminalFont();
	const terminalFontSize = useTerminalFontSize();
	const setEditorFont = useSetEditorFont();
	const setTerminalFont = useSetTerminalFont();
	const setTerminalFontSize = useSetTerminalFontSize();

	// Compute font families directly for reactivity
	const editorFontFamily = editorFont
		? `"${editorFont}", ${DEFAULT_EDITOR_FONT_FAMILY}`
		: DEFAULT_EDITOR_FONT_FAMILY;
	const terminalFontFamily = terminalFont
		? `"${terminalFont}", ${DEFAULT_TERMINAL_FONT_FAMILY}`
		: DEFAULT_TERMINAL_FONT_FAMILY;

	const allThemes = [...builtInThemes, ...customThemes];

	return (
		<div className="p-6 max-w-4xl w-full">
			<div className="mb-8">
				<h2 className="text-xl font-semibold">Appearance</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Customize how Superset looks on your device
				</p>
			</div>

			<div className="space-y-8">
				{/* Theme Section */}
				{showTheme && (
					<div>
						<h3 className="text-sm font-medium mb-4">Theme</h3>
						<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
							<SystemThemeCard
								isSelected={activeThemeId === SYSTEM_THEME_ID}
								onSelect={() => setTheme(SYSTEM_THEME_ID)}
							/>
							{allThemes.map((theme) => (
								<ThemeCard
									key={theme.id}
									theme={theme}
									isSelected={activeThemeId === theme.id}
									onSelect={() => setTheme(theme.id)}
								/>
							))}
						</div>
					</div>
				)}

				{showMarkdown && (
					<div className={showTheme ? "pt-6 border-t" : ""}>
						<h3 className="text-sm font-medium mb-2">Markdown Style</h3>
						<p className="text-sm text-muted-foreground mb-4">
							Rendering style for markdown files when viewing rendered content
						</p>
						<Select
							value={markdownStyle}
							onValueChange={(value) =>
								setMarkdownStyle(value as MarkdownStyle)
							}
						>
							<SelectTrigger className="w-[200px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="default">Default</SelectItem>
								<SelectItem value="tufte">Tufte</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground mt-2">
							Tufte style uses elegant serif typography inspired by Edward
							Tufte's books
						</p>
					</div>
				)}

				{showFonts && (
					<div className={showTheme || showMarkdown ? "pt-6 border-t" : ""}>
						<h3 className="text-sm font-medium mb-4">Fonts</h3>

						{/* Editor Font */}
						<div className="mb-6">
							<span className="text-sm font-medium">Editor Font</span>
							<p className="text-sm text-muted-foreground mb-2">
								Font used for code and diffs
							</p>
							<div className="flex items-center gap-2">
								<Select
									value={editorFont ?? "default"}
									onValueChange={(value) =>
										setEditorFont(value === "default" ? null : value)
									}
								>
									<SelectTrigger className="w-[200px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent side="top">
										<SelectItem value="default">Default</SelectItem>
										<SelectItem value="Berkeley Mono">Berkeley Mono</SelectItem>
										<SelectItem value="JetBrains Mono">
											JetBrains Mono
										</SelectItem>
									</SelectContent>
								</Select>
								{editorFont && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setEditorFont(null)}
									>
										Reset
									</Button>
								)}
							</div>
							{/* Editor Font Preview */}
							<div
								className="mt-3 p-4 rounded-md bg-muted/50 border overflow-x-auto"
								style={{ fontFamily: editorFontFamily }}
							>
								<pre className="text-sm">
									<code>
										{`// Preview
const greeting = 'Hello, World!';
function sum(a, b) { return a + b; }`}
									</code>
								</pre>
							</div>
						</div>

						{/* Terminal Font */}
						<div className="mb-6">
							<span className="text-sm font-medium">Terminal Font</span>
							<p className="text-sm text-muted-foreground mb-2">
								Font used for terminal
							</p>
							<div className="flex items-center gap-2">
								<Select
									value={terminalFont ?? "default"}
									onValueChange={(value) =>
										setTerminalFont(value === "default" ? null : value)
									}
								>
									<SelectTrigger className="w-[200px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent side="top">
										<SelectItem value="default">Default</SelectItem>
										<SelectItem value="Berkeley Mono">Berkeley Mono</SelectItem>
										<SelectItem value="JetBrains Mono">
											JetBrains Mono
										</SelectItem>
									</SelectContent>
								</Select>
								{terminalFont && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setTerminalFont(null)}
									>
										Reset
									</Button>
								)}
							</div>
						</div>

						{/* Terminal Font Size */}
						<div className="mb-6">
							<div className="flex items-center justify-between mb-2 max-w-md">
								<span className="text-sm font-medium">Terminal Font Size</span>
								<div className="flex items-center gap-2">
									<span className="text-sm text-muted-foreground">
										{terminalFontSize}px
									</span>
									{terminalFontSize !==
										DEFAULT_FONT_SETTINGS.terminalFontSize && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												setTerminalFontSize(
													DEFAULT_FONT_SETTINGS.terminalFontSize,
												)
											}
										>
											Reset
										</Button>
									)}
								</div>
							</div>
							<Slider
								value={[terminalFontSize]}
								onValueChange={([value]) => setTerminalFontSize(value)}
								min={8}
								max={24}
								step={1}
								className="max-w-md"
							/>
						</div>

						{/* Terminal Preview */}
						<div
							className="p-4 rounded-md bg-black text-green-400 overflow-x-auto"
							style={{
								fontFamily: terminalFontFamily,
								fontSize: `${terminalFontSize}px`,
							}}
						>
							<div>~/project main &#177;3 ?2</div>
							<div>
								<span className="text-white">&#x276F;</span> npm test{" "}
								<span className="text-green-400">&#x2713;</span>
							</div>
							<div>
								<span className="text-muted-foreground">&#x2514;&#x2500;</span>{" "}
								<span className="text-green-400">&#x25B6;</span> All tests
								passed!
							</div>
						</div>
					</div>
				)}

				{showCustomThemes && (
					<div
						className={
							showTheme || showMarkdown || showFonts ? "pt-6 border-t" : ""
						}
					>
						<h3 className="text-sm font-medium mb-2">Custom Themes</h3>
						<p className="text-sm text-muted-foreground">
							Custom theme import coming soon. You'll be able to import JSON
							theme files to create your own themes.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

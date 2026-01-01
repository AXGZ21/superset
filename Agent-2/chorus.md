# Chorus Deep Dive (UI/UX‑Focused)

## TL;DR
Chorus is a native Mac AI chat app optimized for **multi‑model workflows**, **local‑first persistence**, and **tool‑augmented chat**. The UX is dense but carefully tuned: strong keyboard ergonomics, quick‑chat/ambient flows, rich message rendering (Mermaid, LaTeX, SVG, web previews), explicit tool permissioning, and chat “versioning” via branching/reply threads. It’s not a terminal orchestrator like Superset, but it offers concrete UI/UX patterns worth borrowing.

## UI/UX deep dive (from code)

### 1) The main chat surface (`MultiChat.tsx`)
**What’s good / interesting:**
- **Dual mode UX**: a full “main window” and a **Quick Chat window** that behaves like a floating ambient chat. The Quick Chat variant has its own header controls, shortcuts, and tighter padding/rounding to feel lightweight.
- **Keyboard‑first controls**: top‑bar actions are keyed (e.g., Find `⌘F`, Share `⌘⇧S`, Summarize, navigation `⌘[`/`⌘]`). Quick Chat also supports `⌘O` (open in main), `⌘I` (vision mode), `Esc` (hide).
- **Vision mode affordance**: Quick Chat header includes a “vision mode” toggle with a **live eye icon** (`MouseTrackingEye`) and tooltip explaining screen‑sharing state.
- **Action density without clutter**: header actions only render as icon buttons when there are multiple message sets (and not in Quick Chat), keeping small chats clean.
- **Split‑pane replies**: uses a `ResizablePanelGroup` to show a **reply drawer** (threaded chat) as a right panel on desktop, and a full overlay on mobile breakpoints.
- **Scroll UX**: shows a “Scroll to bottom” button when user is >400px from bottom; uses spacer logic to keep last messages visible above a growing input.
- **Context‑limit recovery**: context overflow triggers a **summarize‑and‑continue** flow that can create a new chat and attach a summary before continuing.

### 2) Sidebar + navigation (`AppSidebar.tsx`)
**What’s good / interesting:**
- **Temporal grouping**: default chats grouped by Today / Yesterday / Last Week / Older.
- **Projects as first‑class containers** with collapsible sections; **project and chat costs** surfaced inline when enabled.
- **Drag‑and‑drop** for moving chats into projects (with “drop to create project” empty state).
- **Ambient chats** live in a bottom “drawer” with its own collapsible UI and a fast settings entry.
- **Branch awareness**: branched chats show a split icon and tooltip “Branched from …”.
- **Inline rename/delete** affordances appear on hover; delete dialog is keyboard‑navigable and auto‑focuses confirm.
- **Gradient overlays** on hover to visually emphasize actionable areas without hard borders.

### 3) Input & attachments (`ChatInput.tsx`)
**What’s good / interesting:**
- **Auto‑expanding input** with draft auto‑sync (persists draft per chat).
- **Attachment pipelines**: drag‑drop, file select, paste, URL attach, screenshot capture—all feed into a **draft attachment** state before submission.
- **“Cautious Enter”** option for users who want confirmation before submit.
- **Inline tools + model controls** (ToolsBox and model pickers) are available right above the input.
- **Context‑aware suggestions**: `ChatSuggestions` uses recent chats to generate quick “next prompts,” then one‑click inserts into the input.

### 4) Model selection UX (`ManageModelsBox.tsx` + `QuickChatModelSelector.tsx`)
**What’s good / interesting:**
- **Command‑palette model picker** with search, provider grouping, cost display, “NEW” badges, and per‑provider refresh (Ollama, LM Studio, OpenRouter).
- **API‑key gating**: if a provider has no key, model rows show “Add API Key” instead of enabling selection.
- **Local model section** is explicit and refreshable.
- **Multi‑model compare**: selected models appear as draggable “pills” at the top; order can be rearranged via DnD; gradient overlay indicates more content.
- **Quick Chat selector** is a compact popover with allowed models only (optimized for ambient flows).

### 5) Tools & permissioning (`ToolsBox.tsx`, `ToolPermissionDialog.tsx`)
**What’s good / interesting:**
- **ToolsBox as command palette**: searchable list of toolsets grouped into Built‑in / Custom; status indicators (stopped/starting/running); “Set up” button when required params are missing.
- **Tool status chips**: compact icons show which toolsets are active; tool logs accessible from the list.
- **Permission dialog**: blocking UI with tool name, model identity, full args preview, **Remember my preference** checkbox; `Enter` to allow, `Esc` to deny.

### 6) Message rendering & rich content (`MessageMarkdown.tsx`, `CodeBlock.tsx`)
**What’s good / interesting:**
- **Mermaid, SVG, LaTeX, Think blocks**, and web previews render inline.
- **Safe markdown**: HTML is escaped outside code blocks to avoid injection.
- **Runnable shell snippets**: bash code blocks can be executed inline with a play button; output is shown below with a sticky header.
- **Copy UX**: quick copy button on code blocks with inline success state.

### 7) Threading & branching (`RepliesDrawer.tsx`, `ReplyChat.tsx`)
**What’s good / interesting:**
- **Reply threads are visually separated** and explicitly marked “Replies are not added to context.”
- The replied‑to message is pinned at the top for context.
- Reply panel is **resizable on desktop** and a full overlay on small screens.

### 8) Utilities that improve polish
- **Find‑in‑page** (`FindInPage.tsx`): custom highlight + navigation with `⌘F`, `⌘G`, `⌘⇧G`, and live result counts.
- **Summary dialog** (`SummaryDialog.tsx`): high‑contrast, print‑like summary with copy and refresh actions.
- **Cost visibility** (`MessageCostDisplay.tsx`): per‑message token/cost display, hidden during streaming.

## Style system strategies (what they do well)

### 1) Semantic token system via CSS variables
- Tailwind colors map to **semantic CSS variables** (`--background`, `--foreground`, `--sidebar-*`, `--muted-*`, etc.) in `tailwind.config.cjs`.
- Components use semantic classes (e.g., `bg-background`, `text-foreground`) rather than raw color values.

### 2) Central palette → theme mapping
- `src/ui/themes/index.ts` defines a **single HSL palette** and maps it into a `Theme` object with `light` + `dark` variants.
- This keeps the palette stable while allowing multiple theme skins in the future.

### 3) Runtime theme provider
- `src/ui/themes/theme-provider.tsx` writes CSS vars to `:root` at runtime and **syncs theme to the quick‑chat window** via Tauri IPC.
- This makes multi‑window theming consistent without duplicating styles.

### 4) Typography + markdown styling
- Tailwind Typography is customized in `tailwind.config.cjs` for headings, tables, links, and code blocks to keep markdown legible and consistent.

### 5) Font system w/ user‑selectable fonts
- Fonts are loaded in `App.css` and exposed through `--font-sans` / `--font-mono` CSS variables.
- Theme provider updates the font vars based on user settings (Geist, Monaspace, JetBrains Mono, etc.).

### 6) Utility‑level polish
- Global CSS utilities for **no‑scrollbar**, **invisible scrollbars**, and **inset shadows**.
- `kbd` styling for keyboard hints is standardized across the app.

**Why it matters for Superset:** this gives them a clean separation between **theme tokens**, **component styling**, and **user‑customizable typography**, all while keeping Tailwind utility ergonomics.

### Adoption checklist for Superset (style system)
1) Define **semantic CSS variables** in `:root` for all core UI roles (background, foreground, sidebar, muted, accent, border).
2) Map Tailwind colors to those variables in `tailwind.config.*` so components use semantic classes.
3) Create a **theme registry** (light/dark palettes) that only sets CSS vars—no component‑level overrides.
4) Implement a **theme provider** that updates vars at runtime and syncs with any secondary windows/panels.
5) Add **font variables** (`--font-sans`, `--font-mono`) and store user selections in settings.
6) Centralize markdown typography overrides in Tailwind Typography config.
7) Add utility classes for scrollbars and keyboard hints to keep polish consistent.

## Non‑UI architecture highlights (brief)
- Tauri + React + TS, local SQLite (`chats.db`), TanStack Query.
- Provider abstraction with local providers (Ollama/LM Studio).
- Toolsets + MCP integration with persistent permissioning.

## What’s worth stealing for Superset (UI/UX)
1) **Ambient/Quick Chat mode**: a compact floating window with its own shortcuts and tighter layout.
2) **Resizably split threads**: right‑panel reply threads with “not in context” labeling.
3) **Command‑palette pickers** for models and tools (grouped, searchable, with provider status).
4) **Inline tool permission dialog** with stored decisions.
5) **Rich rendering pipeline** (Mermaid, LaTeX, SVG, web previews) for agent responses.
6) **Inline runnable shell snippets** with output pane for quick testing.
7) **Find‑in‑page** and **context‑limit recovery** UX for long runs.
8) **Branching cues** (split icon + tooltip in sidebar) for navigation clarity.
9) **Style system**: semantic CSS vars + runtime theme provider + user‑selectable fonts.

## Weaknesses / limitations (vs Superset)
- Primarily chat‑centric; no multi‑agent terminal orchestration.
- Mac‑first posture; remote access not a core UX.
- Group chat/conductor features are still evolving.

## Suggested follow‑ups for Superset
1) Prototype **Quick Chat/ambient** window for “lightweight tasking.”
2) Add **tool permission UI** and persistent tool decisions.
3) Add **reply threads / branch view** inside agent logs.
4) Add **rich rendering + runnable code blocks** in agent outputs.
5) Implement **find‑in‑page** and **context‑limit recovery** UX for long runs.
6) Consider adopting **semantic token theming** + **font variables** for future theming flexibility.

# OpenCode Deep Dive (Technical + Superset Comparison)

## TL;DR
OpenCode is an open‑source, provider‑agnostic **AI coding agent platform** with a **client/server architecture**, a rich **TUI client**, and a modular internal core (sessions, tools, permissions, LSP, MCP, plugins). It’s closer to a “coding agent OS” than a desktop app. Key differentiators vs Superset: (1) strong provider abstraction via Vercel AI SDK, (2) local server with REST/SSE/WebSocket API, (3) LSP + MCP integration as first‑class tools, (4) plugin & config system rooted in `.opencode` directories, (5) internal snapshot/diff/revert system.

## Architecture overview

### 1) Client/server split
- **Server**: `packages/opencode/src/server/server.ts` (Hono + OpenAPI, SSE, WebSocket). Provides a local API for sessions, tools, PTY terminals, models, MCP, etc.
- **Clients**:
  - **TUI**: `packages/opencode/src/cli/cmd/tui` (Solid + opentui) connects to the server via SDK and sync contexts.
  - **CLI “run” mode**: `cli/cmd/run.ts` subscribes to event stream and prints tool events/results.
  - **Web/desktop clients** live in other packages (`packages/app`, `packages/desktop`, `packages/web`).
- **Remote discovery**: MDNS publish option (`server/mdns.ts`) for LAN discovery.

**Why this matters**: the core logic runs once and all clients attach, so adding a new UI (web/mobile) doesn’t require re‑implementing agent logic.

### 2) Instance context & per‑project state
- **Instance** (`project/instance.ts`): per‑directory context used across storage, sessions, tools, etc.
- **Project identification** (`project/project.ts`): maps a directory to a Git root ID, stored in `.git/opencode`.
- **Global bus** + **per‑instance bus** for eventing.

### 3) Storage model
- **Local JSON storage** under `Global.Path.data/storage/**`.
- `storage.ts` provides read/write/update with locks and **migration hooks**.
- Sessions, messages, parts, etc., are stored per project in file‑structured JSON (not DB).

**Tradeoff**: simpler persistence, no DB dependency; but less query‑power than SQL.

### 4) Snapshot + diff + revert system
- `snapshot/index.ts` creates a **shadow git store** per project to track file states.
- Used for:
  - message “step” snapshots
  - diffs for UI
  - revert of specific patches
- Works even without touching the real git repo state.

**This is a powerful idea** for Superset: agent‑level revert independent of worktree state.

### 5) Sessions & message model
- **MessageV2** structure (`session/message-v2.ts`) has typed parts:
  - text, reasoning, tool calls, snapshots, patches, files, subtask markers, retries, etc.
- **SessionProcessor** (`session/processor.ts`) handles streaming, tool execution, permission checks, doom‑loop detection, and error handling.
- **Compaction** (`session/compaction.ts`) auto‑summarizes and prunes tool outputs; protects recent tool calls and avoids context overflow.

### 6) Agents, modes, permissions
- **Agent definitions** (`agent/agent.ts`): build/plan/explore/general + configurable via `.opencode/agent/*.md`.
- **Plan mode** has a strict tool allowlist (read‑only by default).
- **Permission system** (`permission/index.ts`): pattern‑based allow/deny/ask, with “always allow” caching and plugin hooks.
- **Doom loop detection**: repeated identical tool calls can trigger permission gates or forced stops.

### 7) Tool system + plugins
- **Tool registry** (`tool/registry.ts`) includes built‑ins (bash, read, edit, glob, grep, web fetch/search, todo, etc.) plus plugins.
- Plugins can define tools via `@opencode-ai/plugin` and are loaded from config directories or packages.
- Tools can be dynamically enabled/disabled based on agent permission state.

### 8) MCP integration
- `mcp/index.ts` converts MCP server tools into AI SDK tools.
- Supports SSE, HTTP, stdio transports and OAuth flows; watches tool list changes and broadcasts events.

### 9) LSP integration
- `lsp/index.ts` manages LSP servers, supports dynamic config and optional experimental servers.
- `tool/lsp.ts` exposes LSP operations (definition, references, symbols, hover, etc.) as a tool callable by the model.

### 10) ACP (Agent Client Protocol)
- `acp/README.md` describes a **clean ACP implementation** so OpenCode can act as an agent server for external clients (e.g., Zed).
- This is a significant interoperability move.

### 11) PTY subsystem
- `pty/index.ts` runs shell sessions via `bun-pty` and exposes them via WebSockets.
- Enables browser/TUI clients to attach to real shells.

### 12) Config system (very strong)
- `config/config.ts` loads config from:
  - `opencode.jsonc` / `opencode.json`
  - `.opencode/` directories (searching upward)
  - remote `.well-known/opencode`
- Supports **markdown‑based definitions** for:
  - **agents** (`agent/*.md`)
  - **commands** (`command/*.md`)
  - **modes** (`mode/*.md`)
- Supports plugins, custom tools, custom commands; auto‑installs dependencies for `.opencode` directories.

## What OpenCode does better than Superset (today)
1) **Client/server architecture**: multiple clients (TUI/web/desktop) attach to one core.
2) **Provider abstraction**: Vercel AI SDK + dynamic provider loaders (OpenAI, Anthropic, Bedrock, Azure, OpenRouter, etc.).
3) **First‑class tool ecosystem**: built‑in tools + plugins + MCP integration.
4) **LSP‑powered code intelligence** available to the agent.
5) **Snapshot/diff/revert system** independent of git state.
6) **Config system** based on `.opencode` directories + markdown‑defined agents/commands.
7) **ACP support** for interoperability with other editors/clients.
8) **Automated compaction + tool pruning** to protect context budgets.

## Gaps vs Superset
- No built‑in **worktree orchestration** UX (Superset’s core strength).
- Lacks desktop‑first workspace overview like Superset’s multi‑terminal UI.
- Storage is file‑based; less suited to analytics or multi‑user data.

## What Superset should take from OpenCode

### High‑impact adoptions
1) **Client/server core** for Superset
   - Use a local API server that the Electron app + web client connect to.
   - Unlock remote access without duplicating logic.

2) **Provider abstraction + pricing metadata**
   - Normalize model configs with providerID/modelID, cost info, and prompt limits.
   - Superset can then do cost tracking consistently across providers.

3) **Tool registry + plugin system**
   - Move tools into a registry with dynamic enable/disable per agent.
   - Allow plugins to add tools without changing core app.

4) **LSP as a tool**
   - Implement LSP clients per language and expose “definition/references/hover” tools.
   - Dramatically improves agent context quality for large codebases.

5) **Snapshot/diff/revert**
   - Add an internal snapshot store for agent edits so users can revert single steps even if git history is messy.

6) **Config‑as‑markdown** for agents/commands
   - `.superset/agent/*.md` and `.superset/command/*.md` with YAML frontmatter to define prompts, permissions, tool allowlists.

### Medium‑term adoptions
7) **MCP integration**
   - If Superset wants extensibility, adopt MCP client support (SSE/HTTP/stdio).

8) **ACP support**
   - Allow Superset’s agent to be embedded into other tools (Zed, custom clients).

9) **Compaction & pruning**
   - Add automated session summarization and tool‑output pruning to control context size.

## Suggested Superset integration path (concrete)
1) **Phase 1 – Core server + provider layer**
   - Local server with REST + SSE event stream
   - Provider registry (model list, cost info, token limits)

2) **Phase 2 – Tool registry + permissions + MCP**
   - Central tool registry
   - Permission ask/allow/deny system per tool (pattern‑based)
   - MCP client + tool conversion

3) **Phase 3 – LSP + snapshots**
   - LSP manager per project
   - Snapshot/diff/revert pipeline

4) **Phase 4 – ACP + plugins**
   - Agent Client Protocol server
   - `.superset/` plugin directory with auto‑install

## Direct comparisons to Superset (today)

| Dimension | OpenCode | Superset |
| --- | --- | --- |
| Core architecture | Client/server (Hono + SSE + WS) | Electron desktop app (local‑first) |
| Storage | JSON file store + migrations | Postgres (Neon) + Drizzle |
| Agent config | `.opencode/` + markdown prompts | Superset config JSON/presets |
| Tooling | Registry + plugins + MCP | Terminals + worktrees (no MCP yet) |
| LSP | Built‑in, exposed as tool | Not present |
| Snapshots | Shadow git snapshots for revert | Not present |
| Worktrees | Not central | Core feature |
| Remote access | Built‑in via server | Not yet |

## Why it matters strategically
OpenCode’s architecture is designed to be **extensible and multi‑client**. Superset’s strength is **workspace orchestration**. The strongest path forward is to **combine both**: keep Superset’s worktree/terminal UX, but move its orchestration logic into a shared server core (OpenCode‑style), then attach desktop + web/mobile clients on top.


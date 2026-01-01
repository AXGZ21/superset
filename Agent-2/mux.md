# mux Deep Dive

## TL;DR
mux is a desktop app for parallel agentic development with strong workspace isolation (local/worktree/SSH) and rich UX around reviews, costs, and model management. It is one of the most mature competitors in terms of UI depth and operational polish.

## Product surface (what it does)
- Parallel agent workspaces with local/worktree/SSH runtimes.
- Multi-model support (cloud + local via Ollama/OpenRouter).
- Integrated diff/review tools and git divergence UI.
- Rich markdown rendering (Mermaid/LaTeX).
- Context management features (compaction, mode prompts).
- VS Code extension for jumping into workspaces.
- Cost/token tracking and session status indicators.

## Architecture & stack
- Desktop app: Electron + React.
- Monorepo with Bun/Vite tooling.
- Persistent data: `~/.mux/config.json`, worktrees under `~/.mux/src/<project>/<branch>`, chat logs in `~/.mux/sessions/<workspace>/chat.jsonl`.
- IPC-based frontend/backend split.

## Notable implementation ideas
- **Workspace runtime options**: local, worktree, SSH.
- **Git divergence visualization** to track conflicts early.
- **Opportunistic compaction** to manage context size.
- **Cost/usage tracking** at the workspace level.
- **Project secrets** to separate human/agent credentials.

## Comparison to Superset
- Overlap: desktop app, worktree isolation, multi-agent UX.
- Gaps vs Superset:
  - mux has deeper UX for cost tracking and review workflows.
  - Superset has broader platform scope (API/admin/web), but mux is more focused and polished for desktop.

## Takeaways for Superset
- **Cost/token tracking** for each agent/session.
- **Git divergence UI** to surface merge risk early.
- **Multiple runtime modes** (local/worktree/SSH) to expand deployment options.
- **Context management UX** (compaction, mode prompts).
- **VS Code integration** for quick workspace jumps.

## Risks / tradeoffs
- Rich UX adds surface area and maintenance cost.
- SSH runtime expands security and onboarding complexity.

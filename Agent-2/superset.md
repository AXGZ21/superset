# Superset Deep Dive (Baseline)

## TL;DR
Superset is a multi-agent terminal and workspace orchestrator with a desktop app and a broader platform (web/admin/api/docs). It emphasizes local-first workflows, git worktree isolation, and agent monitoring/coordination, with a modern monorepo stack (Bun, Turbo, Next.js 16, Electron, Tailwind).

## Product surface (what it does)
- Run 10+ parallel CLI coding agents in isolated workspaces.
- Worktree-based task isolation with automated setup via `.superset/config.json`.
- Workspace presets and organized terminal systems.
- Diff review and inline editing of agent changes.
- Notifications when agents finish or need attention.
- Desktop app (Electron) with companion web/admin/docs apps.

## Architecture & stack
- Monorepo (Bun + Turborepo) with apps and packages:
  - Apps: web, marketing, admin, api, desktop, docs.
  - Packages: ui (shadcn + Tailwind v4), db (Drizzle), constants, scripts, tsconfig.
- Desktop app: Electron (main/renderer/preload split, IPC type safety).
- Web stack: Next.js 16 (with `proxy.ts` for middleware).
- Data: Drizzle ORM + Neon Postgres.
- Tooling: Biome for lint/format, tRPC, Tailwind v4.

## Notable implementation ideas
- **Worktree-first orchestration** for safe parallel development.
- **Desktop-first UX** with terminal and diff review in one place.
- **Monorepo platform** enables web, admin, API, and desktop in one codebase.

## Current gaps vs competitors
- Limited remote/mobile access compared to Catnip/Happy/VibeTunnel.
- Less explicit task/kanban workflows vs Vibe Kanban/Auto-Claude.
- Lacks deep QA automation and memory layers compared to Auto-Claude.
- No built-in cost/token tracking or LSP integration like mux/OpenCode.

## Opportunities
- Add remote client layer and session relay.
- Add lightweight task orchestration and QA loops.
- Improve context intelligence with LSP and memory features.

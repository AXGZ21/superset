# Vibe Kanban Deep Dive

## TL;DR
Vibe Kanban is a web-based orchestration layer that organizes multiple AI coding agents around tasks in a kanban workflow. It combines a Rust backend with a React frontend and offers remote access/SSH integration plus centralized MCP configuration.

## Product surface (what it does)
- Kanban view for task tracking and agent orchestration.
- Run multiple agents in parallel or sequence.
- Switch between different agent providers.
- Centralized MCP configuration management.
- Remote project access via SSH.
- Quick review and dev-server control.

## Architecture & stack
- Backend: Rust (workspace crates: server/API, db, services, executors, utils).
- Database: SQLx with local seed DB for dev.
- Frontend: React + TypeScript (Vite, Tailwind), pnpm.
- Shared types: Rust structs exported to TS via ts-rs.
- CLI: `npx vibe-kanban` for installation and local run.

## Notable implementation ideas
- **Task-centric kanban orchestration** for multi-agent workflows.
- **Shared type generation** from Rust to TS to keep API and UI aligned.
- **Remote SSH integration** directly from UI.

## Comparison to Superset
- Overlap: multi-agent orchestration, UI for status and review.
- Gaps vs Superset:
  - Vibe Kanban is task/kanban-first; Superset is terminal/workspace-first.
  - Superset has deeper desktop terminal integration.
  - Vibe Kanban has more explicit task management surface.

## Takeaways for Superset
- **Kanban/task layer** to organize multiple agents and track progress.
- **Agent sequencing** and explicit workflow states.
- **Type sharing** between backend and frontend (if we expand APIs).
- **Remote SSH integration** for running on remote hosts.

## Risks / tradeoffs
- Task boards can become overhead for power users.
- Remote SSH adds security complexity.

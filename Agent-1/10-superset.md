# Superset - Our Project Analysis

## Overview

**Superset** is an intelligent terminal application designed specifically for running 10+ parallel coding agents (like Claude Code, Codex, Cursor Composer, etc.) simultaneously on a single machine. It acts as a central orchestration platform for managing multiple concurrent development tasks.

**Repository**: Current monorepo (apps/desktop, apps/web, etc.)
**Version**: Active development
**License**: Apache 2.0

### Core Problem Solved
- Dramatically accelerate development by enabling parallel agent execution
- Manage complexity through git worktrees and organized workspaces
- Visual diff inspection and coordination tools
- A superset of existing developer tools

---

## Features

### Desktop Application (Electron)
- **Workspace Management**: Git worktree-based workspaces for parallel development
- **Terminal System**:
  - Multi-pane interface with organized tabs
  - PTY-based session management with xterm
  - Terminal history preservation and recovery
  - Color customization and theming
  - Multi-line link detection

### Agent Orchestration
- Run 10+ coding agents in parallel
- Configurable agent setup through `.superset/config.json`
- Environment variable automation per workspace
- Shell wrapper system for agent integration
- Agent hook notifications

### Diff Inspection
- Built-in diff viewer with Monaco editor
- Markdown rendering
- File explorer integration
- Quick context switching

### Project Management
- Multi-project workspace navigation
- Workspace reordering and organization
- Branch management per workspace
- Project creation/deletion

### External Integrations
- **Electric SQL Sync**: Offline-first real-time sync
- **PostHog Analytics**: Event tracking and feature flags
- **Sentry**: Performance and error monitoring
- **Linear Integration**: Bidirectional task sync
- **GitHub Integration**: Repository management

### UX/UI Features
- Dark/light theme support
- Tufte-style markdown rendering
- Auto-update mechanism
- Settings with behavior controls
- Ringtone notifications

---

## Architecture

### Monorepo Structure (Bun + Turborepo)

```
apps/
├── desktop/        # Electron application (primary)
├── web/            # Marketing website (Next.js)
├── api/            # API backend (Next.js port 3001)
├── admin/          # Admin dashboard (port 3003)
├── cli/            # CLI tool (Bun/React Ink)
├── marketing/      # Marketing site components
└── docs/           # Documentation

packages/
├── db/             # Cloud database (Drizzle + Neon PostgreSQL)
├── local-db/       # Local SQLite (Electric SQL)
├── ui/             # Shared components (shadcn/ui + TailwindCSS v4)
├── trpc/           # Shared tRPC routers
├── queries/        # Database query utilities
├── shared/         # Shared types and constants
└── typescript/     # Shared TypeScript config
```

### Desktop App Architecture

**Process Model:**
- **Main Process** (`src/main/`): Node.js, file system, terminals, git, auth
- **Renderer Process** (`src/renderer/`): React UI, browser environment
- **Preload Scripts** (`src/preload/`): Context bridge
- **Shared Code** (`src/shared/`): Type definitions, IPC channels

**Key Modules:**
1. **Terminal Management**: TerminalManager, Session, scrollback, port mapping
2. **Workspace Management**: Git worktree creation/deletion, branch management
3. **Authentication**: PKCE OAuth, token encryption, deep links
4. **Agent Setup**: Shell wrappers, hook notifications, environment injection
5. **IPC Communication**: Type-safe tRPC via trpc-electron

---

## Tech Stack

### Frontend/Desktop
- **React** 19.2.3, **Electron** 39.1.2
- **Electron Vite** 4.0.0
- **TailwindCSS** v4, **shadcn/ui**
- **React Router DOM** 7.8.2
- **React Query** 5.90.10
- **Zustand** 5.0.8
- **Monaco Editor** 0.55.1
- **xterm** 5.5.0

### Backend
- **Next.js** 16.0.10
- **tRPC** 11.7.1
- **trpc-electron** 0.1.2
- **Clerk** 6.36.2 (auth)
- **Drizzle ORM** 0.45.1
- **Express** 5.1.0

### Database
- **Neon PostgreSQL** (cloud)
- **SQLite** via better-sqlite3 (local)
- **Electric SQL** (offline-first sync)
- **Drizzle Kit** 0.31.8

### Developer Tools
- **Bun** 1.3.0, **Turborepo** 2.5.8
- **Biome** 2.3.8
- **TypeScript** 5.9.3
- **Vite** 7.1.3
- **Electron Builder** 26.0.12

### Analytics & Monitoring
- **PostHog** 1.310.1
- **Sentry**

### Terminal & System
- **node-pty** 1.1.0-beta30
- **simple-git** 3.30.0
- **execa** 9.6.0

---

## Current Strengths

1. **Innovative Architecture** - Parallel agent execution on shared codebases
2. **Type Safety** - tRPC end-to-end, type-safe IPC
3. **Offline-First Design** - Electric SQL for reliability
4. **Modular Monorepo** - Clear separation of concerns
5. **Developer Experience** - Keyboard shortcuts, theming
6. **Integration Capabilities** - Linear, PostHog, Sentry
7. **Desktop App Maturity** - Sophisticated terminal management
8. **Production Readiness** - Auth, error tracking, analytics

---

## Current Gaps (vs Competition)

Based on competitor analysis, Superset could benefit from:

### From Auto-Claude
- Multi-agent pipeline (planner → coder → QA → fixer)
- Cross-session memory system
- Self-validating QA loop

### From Claude Squad
- Pause/Resume mechanism with state preservation
- AutoYes/daemon mode for autonomous execution
- Real-time diff view alongside terminal

### From OpenCode
- Provider abstraction (multiple AI providers)
- Skill system for customization
- Plan vs Build mode separation

### From Catnip
- Claude Hooks integration for activity tracking
- Containerized execution sandbox
- Auto-port detection for services

### From Happy
- Mobile companion app
- E2E encryption
- Push notifications

### From Vibe Kanban
- Multi-agent executor system (10+ agents)
- Approval workflow with gates
- Kanban board visualization

### From Chorus
- Multi-model comparison
- MCP-first tool integration
- Local-first with SQLite

### From Mux
- Parallel workspace execution with divergence tracking
- Opportunistic context compaction
- Auto-resumption from failures

### From VibeTunnel
- Git Follow Mode (terminal follows IDE)
- Remote access via Tailscale
- Multiplexer integration (tmux/Zellij)

---

## Development Workflow

The project enforces high code quality:
- Minimal diffs, targeted edits only
- Strict TypeScript, avoid `any`
- Pattern consistency
- Co-located tests
- Biome for linting/formatting
- Zustand state management
- Lazy loading, data batching

### AGENTS.md Warnings
- Never import Node.js in renderer
- Use observables for tRPC subscriptions (not async generators)
- Use proxy.ts instead of middleware.ts in Next.js 16

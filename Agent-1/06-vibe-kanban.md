# Vibe Kanban - Comprehensive Analysis

## Overview

**Vibe Kanban** is a sophisticated orchestration platform designed to enable human engineers to work effectively with AI coding agents (Claude Code, Cursor, Gemini, Copilot, etc.). It provides centralized orchestration, approval workflows, and task management for teams using AI agents.

**Repository**: alternatives/vibe-kanban
**Version**: 0.0.143
**Language**: Rust + React/TypeScript
**License**: Open Source

### Core Problem Solved
- Switch between different coding agents seamlessly
- Orchestrate multiple agents in parallel or sequential workflows
- Review and approve agent work before deployment
- Centralize agent configuration including MCP servers

---

## Features

### Agent Management
Support for 10 different coding agents with pluggable executor system:
- Claude Code, GitHub Copilot, Google Gemini CLI
- OpenAI Codex, Cursor, AMP (Amazon)
- QwenCode, OpenCode, Droid, ACP

### Kanban Board
- Visual task management with drag-and-drop
- Task cards with execution status
- Customizable columns and workflows
- Tag-based organization

### Task Execution & Orchestration
- Single-agent task execution
- Sequential task chaining (task A → task B)
- Parallel execution orchestration
- Follow-up prompts within sessions
- Graceful interrupt handling

### Approval Workflows
- Manual approval gates for agent code
- Approval queue management
- Git diff visualization for code review

### Session Management
- Session forking for branching workflows
- Session-scoped routes for follow-ups
- Workspace/worktree-based project isolation

### Developer Features
- Git diff view with syntax highlighting
- Full execution logs viewer
- Agent stdout/stderr capture
- MCP server configuration per agent
- ANSI color stripping and log processing

---

## Architecture

### High-Level Structure (Rust + React)

```
Backend (Rust):
  ├── crates/server - Axum web server with REST API
  ├── crates/db - SQLx ORM (SQLite + Postgres)
  ├── crates/executors - Pluggable agent executor system
  ├── crates/services - Business logic
  ├── crates/deployment - Deployment orchestration
  ├── crates/remote - Hosted API implementation
  └── crates/review - Code review/approval logic

Frontend (React/TypeScript):
  ├── frontend/ - Main SPA
  │   ├── src/pages - Projects, Tasks, Settings
  │   ├── src/components - Task cards, diff views, kanban
  │   ├── src/hooks - 70+ custom hooks
  │   └── src/stores - Zustand state management
```

### Key Architectural Patterns
1. **Type Safety Bridge** - ts-rs auto-generates TypeScript from Rust
2. **Executor Abstraction** - `StandardCodingAgentExecutor` trait
3. **Session-Based Execution** - Sessions can be forked for branching
4. **Git Worktree Management** - Automatic cleanup of orphaned worktrees
5. **Event-Driven Architecture** - Real-time streaming to frontend

---

## Tech Stack

### Backend (Rust)
- **Axum** 0.8.4 (web framework)
- **Tokio** 1.0 (async runtime)
- **SQLx** 0.8.6 (database)
- **ts-rs** (TypeScript generation)
- **rmcp** 0.5.0 (MCP implementation)
- **Sentry** 0.41.0 (monitoring)

### Frontend (React/TypeScript)
- **React** 18.2.0, **TypeScript** 5.9.2
- **Vite** 6.3.5, **TailwindCSS** 3.4.0
- **Zustand** 4.5.4, **TanStack React Query** 5.85.5
- **shadcn/ui**, **Radix UI**
- **@git-diff-view** (diff visualization)
- **dnd-kit** (drag & drop)

---

## Strengths

1. **Unified Agent Ecosystem** - Single interface for 10+ agents
2. **Production-Ready Architecture** - Type-safe Rust with compile-time SQL
3. **Developer Experience** - Auto-generated TypeScript, hot reload
4. **Flexible Execution Model** - Sequential, parallel, forking workflows
5. **Extensible Plugin System** - MCP server integration per agent
6. **Rich UI/UX** - Modern shadcn/ui with kanban visualization
7. **Deployment Flexibility** - Local and remote deployments
8. **Comprehensive Feature Set** - Git integration, code review, approval gates

---

## Weaknesses

1. **Database Coupling** - Strong SQLx query/code coupling
2. **Agent Maintenance Burden** - 10 executor implementations to maintain
3. **Frontend Complexity** - 70+ custom hooks suggest tight coupling
4. **Lack of Horizontal Scaling** - SQLite is single-user only
5. **Limited Task Dependency Management** - No DAG-based workflows
6. **Session Management Complexity** - Session lifecycle unclear
7. **MCP Configuration Verbosity** - Each agent needs different format
8. **Limited Testing Evidence** - No comprehensive test coverage visible

---

## Unique Ideas Worth Noting

1. **Agent Abstraction Layer** - `StandardCodingAgentExecutor` trait
2. **Type-Safe Rust-to-TypeScript Pipeline** - ts-rs eliminates type mismatch bugs
3. **Session-Based Agent Interaction** - Multi-turn conversations with follow-ups
4. **Git Worktree Isolation** - Each project gets its own worktree
5. **MCP Server-First Design** - MCP servers as primary extension mechanism
6. **Real-Time Diff Streaming** - Stream diffs as generated
7. **Approval Gates with Session Context** - Informed human review
8. **Analytics-Aware Architecture** - Sentry + PostHog baked in

---

## What Superset Could Take From This

### High Priority
1. **Multi-Agent Executor System** - Support 10+ different coding agents
2. **Approval Workflow** - Manual gates before agent code is merged
3. **Kanban Board Visualization** - Visual task management
4. **ts-rs Pattern** - Auto-generate TypeScript from Rust/backend types

### Medium Priority
5. **Session Forking** - Branch workflows for exploration
6. **MCP Configuration Per Agent** - Agent-specific tool access
7. **Sequential/Parallel Task Execution** - Workflow orchestration
8. **Git Diff Visualization** - Code review in the UI

### Worth Exploring
9. **SQLx Pattern** - Compile-time verified SQL queries
10. **Executor Trait Pattern** - Pluggable agent implementations
11. **Follow-up Prompts** - Continue conversations within sessions

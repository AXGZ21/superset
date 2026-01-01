# Auto-Claude Deep Dive

## TL;DR
Auto-Claude is an autonomous multi-agent coding framework with a full spec-to-merge pipeline, heavy QA loops, and a memory layer. It ships as a cross-platform Electron desktop app with a Python backend and emphasizes safety through worktree isolation and dynamic command allowlists. The most differentiating pieces vs Superset are the structured spec pipeline, memory system, and QA automation.

## Product surface (what it does)
- Autonomous task execution: plan, implement, QA validate, and fix in loops.
- Parallel execution with multiple agent terminals.
- Worktree isolation per spec/feature.
- Memory layer for cross-session context (Graphiti).
- Integrations: GitHub/GitLab, Linear; changelog generation; roadmap/ideation tools.
- Desktop UI with kanban, agent terminals, and insights/ideation views.

## Architecture & stack
- Desktop app: Electron + React/TS (electron-vite), xterm-based terminals, Radix UI components.
- Backend: Python 3.12+ orchestrator and agents (planner, coder, QA reviewer, QA fixer).
- Core pipeline:
  - Spec creation (multi-phase based on complexity).
  - Implementation loop (planner -> coder -> QA review -> QA fix).
- Memory system: Graphiti integration for graph memory + semantic search, multi-provider model support.
- Security/guardrails:
  - Dynamic command allowlisting based on detected project stack.
  - Worktree isolation per spec under `.worktrees/{spec-name}`.
- Testing: QA agents can run E2E via Electron MCP (Chrome DevTools Protocol).

## Notable implementation ideas
- **Spec-first flow** with complexity-aware phase selection.
- **QA as a first-class agent loop**, not an afterthought.
- **Per-spec worktree architecture** keeps branches and changes isolated.
- **Project stack detection** to generate safe command allowlists.
- **Memory layer** (graph + semantic search) as long-term agent recall.

## Comparison to Superset
- Overlap: multi-agent workflows, worktree isolation, desktop app.
- Gaps vs Superset:
  - Superset is more terminal-orchestration focused; Auto-Claude adds a spec/QA pipeline and memory system.
  - Auto-Claude has deeper automated QA and self-fixing loops.
  - Superset has broader monorepo (web/admin/api/docs) and a broader platform scope.

## Takeaways for Superset
- **Spec pipeline**: Introduce a structured spec/plan stage with complexity gating.
- **QA loops**: Build a reusable QA+fix loop to reduce manual review burden.
- **Memory layer**: Explore a lightweight memory/insights store for cross-session recall.
- **Command allowlist**: Dynamic tooling permissions based on detected stack could reduce user risk.
- **Per-spec artifacts**: Standardize per-task artifacts (spec, requirements, plan, QA report).

## Risks / tradeoffs
- Heavy automation can increase compute cost and latency.
- Memory layers add storage + privacy concerns.
- QA automation can become brittle without strong heuristics and environment control.

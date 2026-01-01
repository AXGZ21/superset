# Claude Squad Deep Dive

## TL;DR
Claude Squad is a Go-based TUI for running multiple AI coding agents (Claude Code, Codex, Gemini, Aider, etc.) in parallel. It uses tmux sessions and git worktrees to isolate tasks and presents a lightweight terminal-first workflow. It is simpler than Superset but very fast and low overhead.

## Product surface (what it does)
- TUI dashboard to manage multiple agent sessions in one terminal.
- One session per task, each in its own git worktree/branch.
- Background execution and auto-accept ("yolo") mode.
- Diff preview and basic Git actions (commit/push/checkout).

## Architecture & stack
- Language: Go 1.23+.
- TUI: Bubbletea + Lipgloss + Bubbles (Charmbracelet stack).
- CLI: Cobra.
- Git: go-git and worktree management.
- Session orchestration: tmux sessions + PTY integration.

## Notable implementation ideas
- **tmux-backed orchestration** keeps sessions independent and durable.
- **Minimal UI** reduces complexity while still enabling multi-agent use.
- **Pluggable agents** (Codex, Claude, Gemini, Aider) via a single program flag.

## Comparison to Superset
- Overlap: worktree isolation, multi-agent orchestration.
- Gaps vs Superset:
  - Claude Squad is TUI-only; Superset has a richer desktop app.
  - Less workflow automation (no QA, no planning pipeline).
  - Fewer integrations (no DB, no web services).

## Takeaways for Superset
- **Lightweight TUI mode** could be a fast fallback for power users/SSH.
- **tmux-style multiplexing** might be useful for resilience and CLI-first flows.
- **Simple agent switching** via program flags could inspire a slimmer "agent launcher".

## Risks / tradeoffs
- TUI-only limits broad adoption for non-CLI users.
- tmux dependency adds setup friction on some platforms.

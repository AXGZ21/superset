# Claude Squad - Comprehensive Analysis

## Overview

**Claude Squad** is a sophisticated terminal-based multi-agent orchestration platform that enables users to manage multiple concurrent AI assistant instances (Claude Code, Aider, Codex, Gemini, etc.) in isolated, independent workspaces. It acts as a multiplexer and workspace manager, allowing developers to work on multiple tasks simultaneously.

**Repository**: alternatives/claude-squad
**Language**: Go 1.23.0
**License**: Open Source

### Core Problem Solved
- Sequential task bottleneck with AI assistants
- Context switching overhead
- No background processing capability
- Code conflict management between agents

---

## Features

### Core Features
- **Multi-Instance Management**: Create and manage up to 10 concurrent AI agent instances
- **Isolated Workspaces**: Each instance gets its own git worktree
- **Live Terminal Preview**: Real-time tmux pane capture
- **Dual-Pane Diff View**: Simultaneously view terminal output and git diff
- **Background Task Execution**: Instances work autonomously
- **AutoYes Mode**: Auto-accept prompts for fully autonomous execution
- **Daemon Mode**: Background process continues running when CLI is closed
- **Session Pause/Resume**: Commits changes, removes worktree, preserves branch

### Supported Programs
- Claude Code (default)
- Aider (with custom model selection)
- Codex (OpenAI)
- Gemini (Google)
- Any command-line AI assistant

### Keyboard Shortcuts
- `n` / `N`: Create new instance
- `Tab`: Switch between preview and diff tabs
- `Enter/o`: Attach to instance
- `s`: Commit and push changes
- `c`: Checkout (pause session)
- `r`: Resume paused session
- `D`: Delete instance

---

## Architecture

### Layered Architecture

```
┌─────────────────────────────────────────┐
│         Terminal UI Layer               │
│  (Bubble Tea + Lipgloss styling)        │
└─────────────────────────────────────────┘
                    ▲
┌─────────────────────────────────────────┐
│      Application Logic Layer            │
│  (app/app.go - State Machine)           │
└─────────────────────────────────────────┘
                    ▲
┌─────────────────────────────────────────┐
│     Session Management Layer            │
│  (session/ - Instance Management)       │
└─────────────────────────────────────────┘
         ▲              ▲
    ┌────────┐   ┌─────────────┐
    │  TMux  │   │ Git Worktree│
    │ Layer  │   │   Layer     │
    └────────┘   └─────────────┘
```

### Key Components

1. **Main (main.go)**: CLI entry point with Cobra command framework
2. **App Layer (app/app.go)**: 7,000+ lines implementing state machine
3. **Session Layer (session/)**: Instance lifecycle management
4. **Git Integration (session/git/)**: Worktree abstraction and operations
5. **Tmux Integration (session/tmux/)**: Comprehensive session management (16,500 lines)
6. **UI Layer (ui/)**: Bubble Tea components for TUI
7. **Config Layer (config/)**: Application settings
8. **Daemon Layer (daemon/)**: Background process for AutoYes mode

---

## Tech Stack

- **Go 1.23.0** (~7,000 lines)
- **Bubble Tea** (TUI framework)
- **Bubbles** (pre-built components)
- **Lipgloss** (styling)
- **go-git v5** (pure Go git)
- **Cobra** (CLI framework)
- **creack/pty** (PTY management)
- **Goreleaser** (multi-platform builds)

---

## Strengths

1. **Elegant Isolation Pattern** - Git worktrees provide true isolation without deep clones
2. **Sophisticated State Management** - Pause/Resume preserves both code and terminal state
3. **Real-Time Monitoring** - Status detection using tmux pane content analysis
4. **Flexible Agent Support** - Works with any CLI-based AI assistant
5. **AutoYes Automation** - Daemon mode enables hands-off background processing
6. **Responsive UI** - Bubble Tea + Lipgloss provides smooth TUI
7. **Cross-Platform** - Supports macOS, Linux, Windows
8. **Minimal Dependencies** - Lean dependency tree
9. **Persistent State** - Instances survive CLI restarts
10. **Git-Native** - Leverages git's native capabilities

---

## Weaknesses

1. **Tmux Dependency** - Hard dependency on tmux
2. **10-Instance Limit** - Arbitrary hardcoded limit
3. **Limited Error Recovery** - If tmux/git fail mid-process
4. **No Multi-Repo Support** - Each instance tied to single repository
5. **Polling-Based Status** - 500ms intervals could miss rapid changes
6. **No Log Persistence** - Terminal output doesn't persist for paused instances
7. **AutoYes Experimental** - Reliability not guaranteed
8. **Web UI Minimal** - Appears incomplete

---

## Unique Ideas Worth Noting

1. **Worktree-Based Isolation** - Uses git worktrees as primary isolation mechanism
2. **Status Detection via Content Inspection** - Analyzes tmux pane content for prompts
3. **Pause Without State Loss** - Commits changes, preserves tmux session, removes worktree
4. **PTY-Based Process Control** - Real-time session attachment
5. **Metadata Polling Architecture** - Decoupled from main UI loop
6. **Clipboard as State Transfer** - Pause mode copies branch name to clipboard
7. **Dual-Pane Live Preview** - Terminal output + git diff simultaneously
8. **Config-Driven Agent Selection** - Default program configurable

---

## What Superset Could Take From This

### High Priority
1. **Pause/Resume Mechanism** - The elegant state preservation is very useful
2. **AutoYes/Daemon Mode** - Enable fully autonomous background execution
3. **Status Detection via Content Inspection** - Know when agents are waiting for input
4. **Real-Time Diff View** - Show code changes alongside terminal

### Medium Priority
5. **Session Storage Architecture** - JSON-based persistence pattern
6. **PTY-Based Attachment** - Direct terminal interaction capability
7. **Metadata Polling** - Background status checking for all instances

### Worth Exploring
8. **Clipboard Integration** - Branch name copy for workflow continuity
9. **Config-Driven Agent Selection** - Easy swapping between AI backends
10. **State Machine UI Pattern** - Clean state transitions for complex UIs

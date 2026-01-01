# Catnip - Comprehensive Analysis

## Overview

**Catnip** is an open-source, containerized development environment built by Weights & Biases that enables running Claude Code (and other AI agents) persistently in isolated, manageable workspaces. It's designed for keeping long-lived AI coding sessions organized and accessible from anywhere.

**Repository**: alternatives/catnip
**Built by**: Weights & Biases
**License**: Apache 2.0

### Core Problem Solved
- Claude Code works best when sandboxed with full tooling access
- Managing multiple concurrent agent sessions is complex
- Users want mobile/remote access to development work
- AI agents need stable, long-running environments

---

## Features

### Workspace & Worktree Management
- **Git Worktree Automation**: Automatically manages git worktrees
- **Custom Namespace**: Uses `refs/catnip/` for isolation
- **Multi-Agent Parallelization**: Multiple AI agents on different worktrees
- **Branch Synchronization**: Auto-syncs commits to central bare repository
- **Live Repository Support**: Mounts local repos with automatic sync

### Terminal & Shell Access
- **WebSocket-based PTY**: Full terminal via xterm.js
- **SSH Support**: Direct container access for IDE integration
- **Title Tracking**: Extracts terminal titles for workflow state
- **Multiple Terminal Sessions**: Independent sessions via web UI

### Claude Code Integration
- **Activity Monitoring**: Tracks session state (Active/Running/Inactive)
- **Claude Hooks**: Event-based tracking (UserPromptSubmit, PostToolUse, Stop)
- **Session Persistence**: Reads Claude's session files
- **Hook-based Events**: HTTP endpoints for activity reporting

### Port Management & Service Preview
- **Auto-Port Detection**: Discovers running services
- **Dynamic Port Allocation**: Finds free ports automatically
- **Web Proxy**: Access services via `http://localhost:6369/$PORT`

### Mobile & Remote Access
- **Native iOS App**: TestFlight beta available
- **Web UI**: React SPA accessible from any device
- **GitHub Codespaces Integration**: One-click devcontainer setup
- **Remote Development**: Full IDE integration via SSH

---

## Architecture

### Frontend (React/TypeScript SPA)
- **Framework**: Vite + React 19 + TanStack Router
- **Styling**: Tailwind CSS v4 + ShadCN UI
- **State Management**: Zustand
- **Terminal UI**: xterm.js + react-xtermjs
- **Real-time**: WebSocket connections

### Backend (Go)
Single unified binary serving:
- HTTP REST API (Fiber framework)
- WebSocket servers
- Terminal UI (Bubble Tea)
- Git operations (go-git + shell)

**Key Services:**
| Service | Purpose |
|---------|---------|
| `GitService` | Repository and worktree lifecycle |
| `ClaudeService` | Claude Code session monitoring |
| `SessionService` | PTY session management |
| `CommitSyncService` | Background worktree sync |
| `ClaudeMonitorService` | Activity tracking and hooks |
| `PortMonitorService` | Service port detection |
| `ProxyService` | Reverse proxy for services |

### Container Image
- **Base**: Ubuntu 24.04
- **Pre-installed**: Node.js, Python, Rust, Go, Git, Docker CLI, SSH

---

## Tech Stack

### Frontend
- React 19.2, TypeScript ~5.8
- Vite 7.2, TailwindCSS 4.1
- ShadCN UI + Radix UI
- TanStack Router 1.139
- xterm.js 5.5, Zustand 5.0

### Backend
- Go 1.25
- Fiber v2 (HTTP framework)
- go-git v5
- Charmbracelet libraries (TUI)
- fsnotify, creack/pty

### Deployment
- Docker containerization
- Cloudflare Workers (edge)
- GitHub Codespaces support

---

## Strengths

1. **Comprehensive AI Agent Support** - Purpose-built for Claude Code
2. **Zero Setup for Codespaces** - One feature to install
3. **Full Terminal Access** - Works with existing editors via SSH
4. **Git & Version Control Integration** - Seamless worktree management
5. **Isolated Sandbox** - Containerized, safe for `--dangerously-skip-permissions`
6. **Port Management** - Auto-detects services, smart allocation
7. **Open Source & Extensible** - Clear architecture, documented extension points
8. **Unified CLI + Server Binary** - Single `catnip` binary does everything

---

## Weaknesses

1. **Complex State Management** - Worktree sync requires careful handling
2. **AI Agent Coverage** - Optimized for Claude Code, others less mature
3. **Performance Considerations** - PTY-over-WebSocket has latency
4. **Mobile Experience** - iOS app still beta, no Android
5. **Documentation Gaps** - Some advanced features underdocumented
6. **Linux/Container Focused** - macOS requires Docker Desktop

---

## Unique Ideas Worth Noting

1. **Claude Hooks System** - Claude fires events directly instead of PTY parsing
2. **Worktree per Agent Session** - True parallelization with isolation
3. **Live Repo Mounting** - Container mounts host repo with auto sync
4. **Proxy-Based Service Access** - Auto-detect and forward ports
5. **Terminal Title Extraction** - Non-invasive activity tracking
6. **GitHub Codespaces Deep Integration** - Seamless mobile → codespace
7. **Unified CLI + Server Binary** - Single binary for TUI, API, CLI
8. **Built-in Git Server** - HTTP git protocol from container

---

## What Superset Could Take From This

### High Priority
1. **Claude Hooks Integration** - Get activity updates directly from Claude Code
2. **Containerized Execution** - Safe sandbox for agents with full permissions
3. **Auto-Port Detection** - Discover and forward services automatically
4. **Live Repo Mounting** - Sync between container and host

### Medium Priority
5. **WebSocket PTY Architecture** - Remote terminal access pattern
6. **Activity Monitoring Service** - Track agent state precisely
7. **GitHub Codespaces Integration** - One-click cloud development

### Worth Exploring
8. **Mobile App Pattern** - iOS/web companion app architecture
9. **HTTP Git Server** - Allow cloning from running environment
10. **Refs Namespace Isolation** - Custom git refs for organization

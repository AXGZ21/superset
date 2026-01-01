# mux - Comprehensive Analysis

## Overview

**mux** is a desktop application for **parallel agentic development** — a multiplexer for running multiple AI agents simultaneously across different workspaces. It enables developers to run multiple AI coding agents in parallel on the same project, each with isolated workspaces.

**Repository**: alternatives/mux
**Language**: TypeScript/Electron
**License**: Open Source

### Core Problem Solved
- Running agents sequentially wastes time; mux enables parallel execution
- A/B testing different AI approaches to the same problem
- Long-running operations (GPT-5-Pro reasoning) in background
- Integrated code review and tangent exploration in single UI

---

## Features

### Core Workspace Management
- **Multiple runtime types**: Local, Worktree (git-based), SSH (remote)
- **Multi-model support**: Anthropic, OpenAI, Google, xAI, DeepSeek, OpenRouter, Bedrock, Ollama
- **Git divergence tracking**: Central UI showing parallel workspace divergence
- **Opportunistic compaction**: Intelligent context window management

### UI/UX Features
- **Plan/Exec mode toggle**: Planning vs execution modes
- **Command palette**: Cmd+Shift+P workspace management
- **Rich markdown**: Mermaid diagrams, LaTeX, syntax highlighting
- **Vim text input support**
- **Project secrets**: Split Human/Agent identities
- **VS Code Extension**: Jump from VS Code to mux workspaces

### Advanced Agent Capabilities
- **Thinking levels**: off/low/medium/high/xhigh
- **Multi-step planning**: `/compact`, `/propose_plan`
- **Tool execution**: 50+ integrated tools
- **Background process management**
- **Terminal integration**: Built-in PTY support
- **MCP support**: Connect to external tools
- **Cost tracking**: Real-time token/cost monitoring
- **Auto-recovery**: Resumes interrupted streams

---

## Architecture

### Monolithic Structure

```
src/
├── browser/          # React UI (Renderer)
│   ├── components/   # 100+ React components
│   ├── contexts/     # Workspace, Theme, Settings
│   ├── hooks/        # Custom React hooks
│   ├── stores/       # WorkspaceStore (Zustand)
│   └── utils/        # Message transforms, keybinds
├── desktop/          # Electron main process
│   ├── main.ts       # Window management
│   └── terminalWindowManager.ts
├── node/             # Backend services
│   ├── orpc/router.ts
│   ├── services/     # 100+ service classes
│   │   ├── aiService.ts (75KB)
│   │   ├── streamManager.ts (72KB)
│   │   ├── taskService.ts (80KB)
│   │   └── workspaceService.ts (85KB)
│   ├── runtime/      # Local, Worktree, SSH
│   └── config.ts
├── common/           # Shared types (Zod-validated)
└── cli/              # run, server, api commands
```

### Key Services
1. **aiService.ts**: AI SDK integration, streaming, tool execution
2. **streamManager.ts**: Stream lifecycle, buffering, error recovery
3. **taskService.ts**: Task execution, parallelization
4. **workspaceService.ts**: Workspace CRUD
5. **agentSession.ts**: Conversation state

---

## Tech Stack

### Frontend
- **React** 18.2 with React Compiler
- **TailwindCSS** v4 + **Radix UI**
- **Motion** (animations)
- **React Router DOM** v7

### Backend/Desktop
- **Electron** 38
- **Node.js** APIs
- **TypeScript** 5.1.3 (strict)

### AI/LLM
- **Vercel AI SDK** v5
- Provider SDKs: Anthropic, OpenAI, Google, xAI, DeepSeek, OpenRouter, Bedrock, Ollama
- `ai-tokenizer` for token counting

### Development
- **Bun** + **Turbo**
- **Vite** 7 + **Electron builder**
- **Jest** 30 + **Playwright**
- **Storybook** 10

### Core Libraries
- **@orpc/server**, **@orpc/client** (RPC)
- **Zod** (validation)
- **markdown-it**, **mermaid**, **shiki**
- **ghostty-web** (terminal)
- **node-pty** (PTY management)

### Persistence
- JSONL files for chat history
- JSON config for settings
- Git worktrees for workspace isolation

---

## Strengths

1. **Parallel Execution** - Core differentiator: multiple agents simultaneously
2. **Comprehensive Tool Suite** - 50+ pre-built tools
3. **Multi-Runtime Support** - Local, worktree, SSH execution
4. **Strong Type Safety** - Zod validation, no `any` allowed
5. **Streaming & Resumption** - Auto-recovery from failures
6. **Git Integration** - First-class worktrees with divergence visualization
7. **Multi-Model Support** - 8+ AI providers
8. **UI Responsiveness** - React Compiler for auto-memoization
9. **Cost Tracking** - Real-time token/cost monitoring
10. **Excellent Testing** - Integration tests with real APIs
11. **Self-Healing** - Corrupted history doesn't brick workspaces

---

## Weaknesses

1. **Performance** - Heavyweight Electron app, 4+ second startup
2. **Mobile Support** - Secondary mobile app, desktop primary
3. **Beta Status** - Breaking changes expected
4. **Context Compaction** - Manual `/compact` workflow
5. **Terminal Emulation** - ghostty-web may have feature gaps
6. **SSH Security** - No key agent integration visible
7. **Single Project Focus** - Each workspace tied to one repo
8. **Learning Curve** - Many features require education
9. **Windows Support** - Primarily macOS/Linux

---

## Unique Ideas Worth Noting

1. **Workspace Multiplexing** - Integrated sidebar showing all workspace states
2. **Opportunistic Compaction** - Compacts during idle, not when full
3. **Plan/Exec Mode Toggle** - Inspired by Claude Code with workspace awareness
4. **Mode Prompts** - Instruction files per mode for customization
5. **Agent Definitions** - YAML-based with custom tools and thinking levels
6. **MCP Workspace Overrides** - Per-workspace tool access control
7. **Auto-Resumption** - Automatic stream recovery after failures
8. **File Change Injection** - Detects external edits, injects diffs
9. **Message Compaction Transactions** - Atomic before/after snapshots
10. **Thinking Policy Enforcement** - Respects model capabilities

---

## What Superset Could Take From This

### High Priority
1. **Parallel Workspace Execution** - Multiple agents simultaneously
2. **Git Divergence Tracking** - Visualize how workspaces diverge
3. **Opportunistic Compaction** - Intelligent context management
4. **Auto-Resumption** - Recover from crashes/network issues

### Medium Priority
5. **Plan/Exec Mode Toggle** - Separate planning from execution
6. **Multi-Runtime Support** - Local, worktree, SSH options
7. **ORPC Pattern** - Type-safe RPC with Zod validation
8. **Workspace Store Pattern** - Zustand-based state management

### Worth Exploring
9. **File Change Injection** - Detect external edits, inject diffs
10. **Agent Definitions (YAML)** - Declarative agent configuration
11. **Thinking Policy Enforcement** - Respect model capabilities
12. **React Compiler** - Auto-memoization for performance

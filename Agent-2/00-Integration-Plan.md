# Superset Competitive Synthesis + Integration Plan

## Executive summary
The competitive landscape splits into four clusters:
1) **Workspace orchestration UIs** (mux, Vibe Kanban, Auto-Claude) – strong UX around multi-agent coordination, review, and task management.
2) **Terminal multiplexers** (claude-squad) – lightweight, fast, TUI-first.
3) **Remote access + mobility** (Catnip, Happy, VibeTunnel) – remote terminals, mobile control, or containerized workspaces.
4) **Agent platforms** (OpenCode, Chorus) – provider-agnostic, multi-client architecture, or multi-model chat.

Superset already leads in desktop-first multi-agent workspace management. The biggest opportunities are **remote/mobile access**, **workflow/QA automation**, **context intelligence (LSP/memory)**, and **cost/usage visibility**.

## Feature comparison (high level)
Legend: Y = native feature, P = partial/indirect, - = not a focus

| Feature | Superset | Auto-Claude | Claude Squad | OpenCode | Catnip | Happy | Vibe Kanban | Chorus | mux | VibeTunnel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multi-agent orchestration | Y | Y | Y | P | Y | - | Y | - | Y | - |
| Worktree isolation | Y | Y | Y | P | Y | - | P | - | Y | - |
| Task/kanban workflows | P | Y | - | - | - | - | Y | - | P | - |
| QA automation loop | - | Y | - | - | - | - | - | - | - | - |
| Memory/knowledge layer | - | Y | - | - | - | - | - | - | - | - |
| LSP integration | - | - | - | Y | - | - | - | - | - | - |
| Cost/token tracking | - | - | - | - | - | - | - | - | Y | - |
| Remote/mobile access | P | - | - | P | Y | Y | P | - | P | Y |
| Containerized runtime | - | - | - | - | Y | - | - | - | - | - |
| Client/server architecture | - | - | - | Y | P | P | - | - | - | P |
| Multi-model chat | - | - | - | P | - | - | - | Y | - | - |

## Strengths and weaknesses by project

### Auto-Claude
- Strengths: spec-first pipeline, QA/fix loops, memory layer, safe command allowlists.
- Weaknesses: heavy automation cost, complexity, higher compute requirements.

### Claude Squad
- Strengths: lightweight, fast, TUI-first, tmux durability.
- Weaknesses: minimal UI, fewer automation features, limited integrations.

### OpenCode
- Strengths: provider-agnostic, LSP integration, client/server architecture, ecosystem focus.
- Weaknesses: more infra complexity; workspace orchestration less central.

### Catnip
- Strengths: containerized isolation, remote/mobile access, port proxying, Git server.
- Weaknesses: container overhead, remote access security requirements.

### Happy
- Strengths: E2E encrypted remote control, device handoff, push notifications.
- Weaknesses: not a workspace manager; depends on external CLI/server.

### Vibe Kanban
- Strengths: task-first workflow, agent sequencing, shared types from Rust.
- Weaknesses: kanban overhead; less terminal-centric.

### Chorus
- Strengths: multi-model chat UX, local-first storage, MCP integration.
- Weaknesses: chat-first (not agent/workspace focused).

### mux
- Strengths: polished UX, cost tracking, git divergence UI, multi-runtime support.
- Weaknesses: heavier surface area to maintain; SSH runtime complexity.

### VibeTunnel
- Strengths: effortless remote terminal access, session recording.
- Weaknesses: not an agent orchestrator; security surface.

## What Superset should integrate (prioritized)

### P0: Quick wins (1-2 months)
1) **Cost/token tracking per workspace** (mux)
   - Add session-level token and cost counters with provider adapters.
2) **Git divergence UI** (mux)
   - Visualize ahead/behind/dirty across worktrees; highlight conflict risk.
3) **Push notifications + status webhooks** (Happy)
   - Notify on agent completion, approvals needed, or errors.

### P1: Near-term (3-6 months)
4) **Remote access (browser client)** (VibeTunnel, Catnip)
   - A thin web client for terminal sessions + read-only review.
5) **Task/kanban layer** (Vibe Kanban, Auto-Claude)
   - Optional task board on top of worktrees; keep it lightweight.
6) **Provider abstraction layer** (OpenCode)
   - Normalize multi-provider models and pricing; unlock vendor flexibility.

### P2: Longer-term (6-12 months)
7) **QA automation loop** (Auto-Claude)
   - Plug-in QA reviewer/fixer agents with acceptance criteria.
8) **Memory/insights layer** (Auto-Claude)
   - Lightweight semantic index of changes, decisions, and TODOs.
9) **LSP integration** (OpenCode)
   - Improve context understanding and diagnostics inside terminals.
10) **Containerized runtime option** (Catnip)
   - Optional safe execution mode for risky tasks or remote workers.

## Architectural recommendations for Superset

### 1) Introduce a core "workspace service" with optional remote clients
- Rationale: OpenCode and VibeTunnel show the value of client/server splits.
- Approach: keep local-first defaults; add a lightweight local server process with a web client that can be enabled when needed.

### 2) Add a structured task model (without heavy overhead)
- Rationale: Auto-Claude and Vibe Kanban show the value of explicit task states.
- Approach: keep task metadata optional, auto-derive from worktree context.

### 3) Build a provider abstraction + cost ledger
- Rationale: mux and OpenCode show benefits of provider flexibility and cost insight.
- Approach: standardize on a provider interface and a per-session usage ledger.

### 4) Improve safety/automation with QA loops + command allowlists
- Rationale: Auto-Claude uses dynamic allowlists and QA loops to reduce mistakes.
- Approach: start with "safe mode" presets and optional QA agents.

### 5) Remote access roadmap
- Phase 1: read-only web UI for status/diffs.
- Phase 2: interactive terminals + approval prompts (with notification system).
- Phase 3: mobile client with E2E encryption (Happy-style).

## Suggested roadmap snapshot

### Q1
- Cost tracking UI
- Git divergence indicators
- Push notifications

### Q2
- Remote read-only web client
- Task board (optional, light)
- Provider abstraction layer

### Q3
- QA automation loop
- LSP-backed context helpers

### Q4
- Memory layer + container runtime option
- Mobile control client

## Open questions for product strategy
- Do we want Superset to remain local-first or become remote-first over time?
- How much agent automation (QA/memory) do we want vs. human-in-the-loop?
- Should we ship a minimal web client quickly or wait for a robust remote access model?


# Catnip Deep Dive

## TL;DR
Catnip is a container-first orchestration layer for running Claude Code (and similar agents) remotely with a web/mobile UI. It wraps worktree management, port proxying, SSH, and Git in a containerized workspace model. Its big differentiator is safe, portable environments plus mobile access.

## Product surface (what it does)
- Containerized, isolated dev environment (Docker or Apple Container SDK).
- Worktree management for parallel agents.
- Web UI and native mobile UI (TestFlight).
- Remote access via SSH or web terminals.
- Built-in port detection and proxying for previewing services.
- Git server inside container; auto-commit to refs; branch sync.
- Codespaces/devcontainer integration.

## Architecture & stack
- Backend: Go for container orchestration and Git operations.
- Frontend: React + TypeScript, Vite SPA embedded into Go binary.
- Runtime: Docker/Apple Container; `catnip run` starts a universal container.
- Ports: automatic port discovery, proxying via UI.
- Git: workspace refs `refs/catnip/$NAME` + friendly branch sync.

## Notable implementation ideas
- **Container-first isolation** allows safe "dangerous" agent permissions.
- **Auto port forwarding/proxy** for instant preview of agent-built services.
- **Mobile-first access** to long-running agent sessions.
- **Embedded web UI** in a single Go binary for easy distribution.

## Comparison to Superset
- Overlap: multi-agent worktrees, terminal access, orchestration.
- Gaps vs Superset:
  - Catnip is container-first and remote-first; Superset is local-first.
  - Catnip has robust remote/mobile access and port proxying.
  - Superset has richer local desktop UX and deeper integrations with local tooling.

## Takeaways for Superset
- **Containerized workspace option** for safe execution and reproducibility.
- **Port discovery + proxy UI** as a first-class feature.
- **Remote/mobile access** to active workspaces.
- **Git server + auto-branch sync** to simplify review and collaboration.

## Risks / tradeoffs
- Containers add complexity (resource usage, networking, Docker deps).
- Remote access increases security requirements.

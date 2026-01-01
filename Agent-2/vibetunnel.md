# VibeTunnel Deep Dive

## TL;DR
VibeTunnel turns any browser into a terminal by proxying terminal sessions through a Node.js server with a web UI. It focuses on remote access, session recording, and minimal setup. It is complementary to Superset rather than a direct replacement.

## Product surface (what it does)
- Browser-based terminal access from any device.
- macOS menu bar app to run the server; npm package for Linux/headless.
- Session activity indicators and session recording (asciinema).
- Git follow mode to keep terminal in sync with branch changes.
- Remote access options (Tailscale, ngrok, etc.).
- Authentication modes for secure access.

## Architecture & stack
- macOS app: native Swift menu bar app (manages server lifecycle).
- Server: Node.js/TypeScript executable with embedded modules.
- Web frontend: Lit components + ghostty-web terminal.
- Command-line wrapper: `vt` forwards shell sessions through the server.

## Notable implementation ideas
- **Zero-config remote terminal** through a browser.
- **Session recording** for review or playback.
- **Git follow mode** to track branch context.
- **Mac app + npm package split** to cover desktop and headless.

## Comparison to Superset
- Overlap: remote access to terminals.
- Gaps vs Superset:
  - VibeTunnel is a terminal proxy, not a multi-agent orchestrator.
  - Superset manages worktrees and agents; VibeTunnel focuses on access.

## Takeaways for Superset
- **Browser-based terminal access** for remote monitoring.
- **Session recording** for audit/review/debugging.
- **Git follow mode** to align sessions with current branch.

## Risks / tradeoffs
- Exposing terminals over the network increases security concerns.
- Recording sessions requires careful privacy controls.

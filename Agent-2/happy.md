# Happy Coder Deep Dive

## TL;DR
Happy is a mobile/web client that lets users control Claude Code or Codex remotely with end-to-end encryption and device handoff. It is not a workspace orchestrator itself; it is a secure remote control layer.

## Product surface (what it does)
- Mobile and web client for Claude Code/Codex.
- End-to-end encrypted session relay.
- Push notifications for approvals/errors.
- Device handoff (keyboard activity switches control back).
- Wrapper CLI (`happy`) to replace `claude` or `codex`.

## Architecture & stack
- Mobile/web app: React Native + Expo, TypeScript.
- Real-time sync: Socket.io.
- Encryption: tweetnacl end-to-end.
- Auth: QR-code based pairing.
- Project structure includes `sources/app` (screens), `sources/sync` (sync engine), `sources/auth` (auth).
- Separate repos for `happy-cli` and `happy-server` (encrypted relay backend).

## Notable implementation ideas
- **E2E encrypted relay** so server never sees plaintext code or prompts.
- **Push notifications** tied to agent permission prompts.
- **Seamless handoff** between mobile and desktop control.

## Comparison to Superset
- Overlap: remote access to agent sessions.
- Gaps vs Superset:
  - Happy does not manage worktrees or multiple agents itself.
  - Superset has a desktop orchestration layer; Happy is a secure remote UI.

## Takeaways for Superset
- **Encrypted remote control** to access sessions securely from mobile.
- **Push notifications** for approvals/errors/agent completion.
- **Device handoff** UX for switching between desktop and mobile.

## Risks / tradeoffs
- E2E encryption complicates debugging and server-side features.
- Requires mobile app distribution and maintenance.

# Escape Sequences Deep Dive (OSC / ANSI / CSI)

Scope
- Review how each tool handles terminal escape sequences (OSC/CSI/ANSI), whether they filter them, and how they prevent stray control sequences from polluting terminal input or UI output.
- Compare against Superset and extract best practices.

---

## Superset
Relevant files
- `apps/desktop/src/main/lib/terminal-escape-filter.ts`
- `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/suppressQueryResponses.ts`
- `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/parseCwd.ts`
- `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/commandBuffer.ts`

Findings
- Filters clear-scrollback only: detects ED3 (`ESC[3J`) and strips everything before the last ED3 when persisting history. No RIS (`ESC c`) filtering by design. (`terminal-escape-filter.ts`)
- Suppresses response-only CSI sequences at the xterm parser layer to avoid query responses showing up as text: CPR (`CSI ... R`), focus in/out (`CSI I`/`CSI O`), mode report (`CSI $y`). (`suppressQueryResponses.ts`)
- Parses OSC 7 (`ESC]7;file://...`) to track CWD in the renderer. (`parseCwd.ts`)
- Strips ANSI from the command buffer when deriving tab titles. (`commandBuffer.ts`)
- No stateful buffering of partial escape sequences across IPC chunks (relies on xterm.js streaming). No alternate-screen filtering for history replay.

Notes
- Superset already treats some escape sequences as metadata (OSC 7), and intentionally suppresses specific query responses. It does not currently filter OSC title sequences or buffer incomplete OSC/CSI sequences for parsing.

---

## Auto-Claude
Relevant files
- `alternatives/Auto-Claude/apps/frontend/src/renderer/components/terminal/useXterm.ts`
- `alternatives/Auto-Claude/apps/frontend/src/main/terminal/pty-daemon.ts`
- `alternatives/Auto-Claude/apps/frontend/src/main/terminal/output-parser.ts`

Findings
- xterm.js receives raw PTY output; no explicit OSC/CSI filtering in the renderer. (`useXterm.ts`)
- PTY daemon forwards raw output to clients and stores a ring buffer with no escape filtering. (`pty-daemon.ts`)
- OutputParser uses regexes to detect Claude session IDs, rate limits, tokens, but does not strip ANSI/OSC first. (`output-parser.ts`)

Notes
- No protection against split OSC sequences or OSC title leakage. Escape sequences are largely passed through unchanged.

---

## Claude-squad
Relevant files
- `alternatives/claude-squad/session/tmux/tmux.go`

Findings
- On tmux attach, it intentionally discards the first stdin bytes for ~50ms to avoid terminal control sequences (e.g., `ESC[?62c...`, `OSC 10;rgb...`) being fed into tmux as input. (`tmux.go`)
- Uses `tmux capture-pane -e` to preserve ANSI escape sequences in captured output. (`tmux.go`)

Notes
- The “nuke initial stdin bytes” approach is a pragmatic filter for attach-time control sequences, but it is heuristic and time-based rather than parsing-based.

---

## Opencode
Relevant files
- `alternatives/opencode/packages/opencode/src/cli/cmd/tui/util/terminal.ts`
- `alternatives/opencode/packages/opencode/src/cli/cmd/tui/app.tsx`
- `alternatives/opencode/packages/opencode/src/cli/cmd/tui/ui/dialog.tsx`
- `alternatives/opencode/packages/app/src/components/terminal.tsx`
- `alternatives/opencode/packages/app/src/addons/serialize.ts`

Findings
- TUI queries terminal colors using OSC 10/11/4 and parses responses; notes tmux may filter OSC 4 responses. (`tui/util/terminal.ts`)
- Uses OSC 52 for clipboard writes; wraps with tmux passthrough when `TMUX` is set. (`tui/app.tsx`, `tui/ui/dialog.tsx`)
- Web terminal (ghostty-web) passes raw PTY data to the terminal; no explicit filtering. (`packages/app/src/components/terminal.tsx`)
- SerializeAddon avoids emitting ECH (`ESC[nX`) sequences in serialized output to reduce re-render artifacts. (`addons/serialize.ts` and tests)

Notes
- Opencode treats OSC as a feature (color queries, clipboard), but does not filter OSC title or other sequences from output.

---

## Catnip
Relevant files
- `alternatives/catnip/container/internal/handlers/pty.go`

Findings
- Extracts OSC 0 title (`ESC]0;...BEL`) from PTY output and sanitizes it (length + allowed chars). (`pty.go`, `extractTitleFromEscapeSequence`, `sanitizeTitle`)
- Strips ANSI/OSC sequences via regex when detecting Claude readiness (“bypass permissions on”), ensuring patterns match even with colored output. (`pty.go`)
- Detects alternate screen buffer enter/exit (`CSI ?1049h`/`CSI ?1049l`) and avoids replaying TUI content on reconnect by replaying only the pre-alt-screen buffer; sends Ctrl+L to refresh. (`pty.go`)
- For Claude sessions, sends raw data without further processing; for non-Claude sessions, processes output (port detection, buffering). (`pty.go`)

Notes
- Catnip’s alt-screen filtering is a strong approach to avoid corrupted history replays with full-screen TUIs.

---

## Happy
Findings
- No embedded terminal emulator or PTY handling in this repo; references to “terminal” are UI copy and sync metadata.

Notes
- Not applicable for OSC/ANSI handling.

---

## Vibe-kanban
Relevant files
- `alternatives/vibe-kanban/frontend/src/components/common/RawLogText.tsx`

Findings
- No interactive terminal emulator. ANSI is rendered for logs using `fancy-ansi` (ANSI -> HTML). (`RawLogText.tsx`)

Notes
- Escape handling is limited to ANSI rendering in log views; no OSC handling.

---

## Chorus
Relevant files
- `alternatives/chorus/src/core/chorus/toolsets/terminal.ts`

Findings
- No embedded terminal emulator. “Terminal” toolset proxies command execution via an MCP sidecar (`mcp-desktopcommander`). (`toolsets/terminal.ts`)

Notes
- No OSC/CSI handling in the UI; terminal is a tool abstraction rather than a PTY stream.

---

## Mux
Relevant files
- `alternatives/mux/src/node/services/ptyService.ts`
- `alternatives/mux/src/browser/components/TerminalView.tsx`

Findings
- Buffers incomplete escape sequences at the PTY layer before streaming to clients: holds back trailing `ESC`, `ESC[`, or partial `CSI` (`ESC[` + params) until the next chunk arrives. (`ptyService.ts`)
- Applies the same buffering for SSH PTY sessions. (`ptyService.ts`)
- Browser terminal (ghostty-web) is a straight pass-through for output; no filtering. (`TerminalView.tsx`)

Notes
- This buffering reduces “split CSI” issues and is a lightweight way to keep escape sequences intact in streaming output.

---

## Vibetunnel
Relevant files
- `alternatives/vibetunnel/web/src/server/utils/ansi-title-filter.ts`
- `alternatives/vibetunnel/web/src/server/pty/pty-manager.ts`
- `alternatives/vibetunnel/web/src/server/pty/asciinema-writer.ts`
- `alternatives/vibetunnel/web/src/server/utils/prompt-patterns.ts`
- `alternatives/vibetunnel/native/vt-fwd/src/title_filter.zig`
- `alternatives/vibetunnel/native/vt-fwd/src/main.zig`

Findings
- Stateful OSC title filter removes OSC 0/1/2 sequences from output while preserving all other content; handles split sequences and both BEL/ESC-\ terminators. (`ansi-title-filter.ts`)
- PTY manager applies the title filter on output when title mode is enabled and explicitly avoids writing title escape sequences into PTY input. (`pty-manager.ts`)
- Native Zig forwarder also filters OSC title sequences before output, with a state machine for split sequences. (`title_filter.zig`, `main.zig`)
- Asciinema writer parses output at byte level, preserves full escape sequences (CSI + OSC), and buffers incomplete sequences; also handles UTF-8 boundaries safely. (`asciinema-writer.ts`)
- Prompt detection strips ANSI before regex checks to avoid false negatives. (`prompt-patterns.ts`)

Notes
- Vibetunnel is the most thorough in OSC/ANSI handling: robust filtering for titles, stateful buffering for split sequences, and explicit handling of OSC terminators.

---

## Comparison snapshot (escape-sequence handling)

| Tool | Terminal stream? | OSC title handling | Query-response suppression | Incomplete ESC buffering | Alt-screen filtering | OSC 7 CWD parsing |
|------|------------------|-------------------|----------------------------|--------------------------|---------------------|------------------|
| Superset | Yes (xterm + node-pty) | No explicit filter | Yes (CSI R/I/O/$y) | No | No | Yes (OSC 7) |
| Auto-Claude | Yes (xterm + node-pty) | No | No | No | No | No |
| Claude-squad | tmux attach | Heuristic stdin nuke | No | No | No | No |
| Opencode | Yes (ghostty-web + PTY) | No | No | No | No | No |
| Catnip | Yes (xterm + server PTY) | Extract + sanitize | No | No | Yes | No |
| Happy | No | NA | NA | NA | NA | NA |
| Vibe-kanban | No (ANSI log rendering only) | NA | NA | NA | NA | NA |
| Chorus | No (toolset only) | NA | NA | NA | NA | NA |
| Mux | Yes (ghostty-web + PTY) | No | No | Yes (ESC/CSI) | No | No |
| Vibetunnel | Yes (pty + web/native) | Yes (OSC 0/1/2 filter) | No | Yes (CSI/OSC + UTF-8) | No | No |

---

## Best approaches observed

1) Stateful OSC title filtering (Vibetunnel, Catnip)
- Filter OSC 0/1/2 from the display/output stream to prevent title text from leaking into user-visible logs or being treated as input.
- Use a stateful filter that survives chunk boundaries (Vibetunnel’s TitleSequenceFilter and Zig TitleFilter).

2) Buffer incomplete escape sequences at the PTY layer (Mux, Vibetunnel)
- Holding back trailing `ESC`, `ESC[`, or partial CSI until the next chunk prevents broken control sequences in downstream renderers and avoids mis-parsing in any regex-based detectors.

3) Alternate screen detection for history replay (Catnip)
- Detect `CSI ?1049h/l` to avoid replaying TUI alt-screen content when reconnecting. Replaying only pre-alt-screen buffer avoids visual corruption.

4) Suppress response-only control sequences in the renderer (Superset)
- Suppressing query responses (`CSI R/I/O/$y`) keeps terminal output clean and avoids user confusion.

5) Treat OSC as metadata, not display text (Opencode, Superset)
- Use OSC 7 for cwd and OSC 52 for clipboard; wrap OSC 52 for tmux. Ensure these are not rendered to users.

---

## Superset comparison and gaps

Strengths already in Superset
- CSI response suppression at the xterm parser layer.
- OSC 7 parsing for cwd updates.
- ED3 clear-scrollback detection for history persistence.

Gaps relative to best-in-class approaches
- No stateful OSC title filtering: OSC 0/1/2 sequences may be passed through to history/logs if emitted by shells or tools.
- No buffering of partial escape sequences before parsing OSC 7 or other regex-based detectors; split OSC sequences can be missed.
- No alternate-screen handling for history replay; TUI output can pollute saved scrollback when reattaching.

---

## Recommended improvements for Superset

1) Add a lightweight, stateful OSC title filter (modeled after Vibetunnel)
- Filter OSC 0/1/2 sequences at the renderer or main-process stream boundary.
- Keep titles as metadata only (xterm already emits `onTitleChange`), and avoid persisting title sequences into history.

2) Buffer incomplete ESC/CSI/OSC sequences at the stream boundary
- Implement a small buffer in the main process (similar to Mux PTYService or Vibetunnel AsciinemaWriter) to prevent split sequences from reaching parsers.
- This will improve OSC 7 parsing reliability and reduce edge cases in regex detectors.

3) Detect alternate-screen entry/exit for history replay
- Track `CSI ?1049h/l` and skip replaying alt-screen buffer on reattach, or replay only pre-alt-screen output (Catnip pattern).
- Optionally send Ctrl+L after replay to refresh TUIs.

4) Keep regex-based output detectors ANSI-safe
- For any output parsing (ports, prompts, etc.), strip ANSI/OSC before matching (Vibetunnel approach).

5) Optional: OSC 52 clipboard support
- If Superset needs remote clipboard integration or terminal-initiated copy, adopt OSC 52 with tmux wrapping (Opencode pattern).

---

## Quick takeaways
- Superset already has smart suppression of response-only CSI sequences and OSC 7 cwd parsing.
- The highest-leverage additions are: (1) stateful title filtering, (2) buffering incomplete ESC/CSI/OSC across chunks, and (3) alternate-screen-aware history replay.

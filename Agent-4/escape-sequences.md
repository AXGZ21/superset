# Terminal Escape Sequence Handling: Alternatives vs Superset

## Executive Summary

This analysis examines how various GitHub projects handle OSC (Operating System Command) terminal escape sequences, comparing their approaches with Superset's implementation. The focus is on preventing escape sequences from entering terminal input and ensuring proper handling of terminal output.

## Background: What Are OSC Escape Sequences?

OSC (Operating System Command) sequences are terminal control codes that start with `ESC ]` (`\x1b]`) and end with either `BEL` (`\x07`) or `ST` (`ESC \` or `\x1b\\`). Common OSC codes include:

| Code | Purpose |
|------|---------|
| OSC 0 | Set icon name and window title |
| OSC 1 | Set icon name |
| OSC 2 | Set window title |
| OSC 4 | Query/set palette color |
| OSC 7 | Set current working directory (URL) |
| OSC 10 | Query/set foreground color |
| OSC 11 | Query/set background color |

The problem: When a terminal sends query requests (OSC 10, 11, etc.), the response can appear as "garbage" in the terminal input if not properly handled.

---

## Project Comparison Matrix

| Project | Has OSC Filtering | Approach | Scope | Library Used |
|---------|-------------------|----------|-------|--------------|
| **Superset** | ✅ Yes | Parser hooks + regex | Selective (queries only) | xterm.js hooks |
| **VibeTunnel** | ✅ Yes | Stateful filter | Selective (OSC 0-2) | Custom |
| **Catnip** | ✅ Yes | Regex + extraction | Complete strip + extract | Custom |
| **Vibe-Kanban** | ✅ Yes | Complete strip | All ANSI | strip-ansi-escapes |
| **Claude-Squad** | ✅ Yes | Time-based input filter | Initial stdin only | Custom |
| **OpenCode** | ⚠️ Uses | Detection only | N/A | Custom |
| **Mux** | ❌ No | N/A | N/A | N/A |
| **Auto-Claude** | ❌ No | N/A (shell escaping) | N/A | N/A |
| **Chorus** | ❌ No | N/A | N/A | N/A |
| **Happy** | ❌ No (mobile app) | N/A | N/A | N/A |

---

## Detailed Approach Analysis

### 1. Superset (Reference Implementation)

**Approach:** xterm.js parser hooks to suppress query responses

**Files:**
- `apps/desktop/src/main/lib/terminal-escape-filter.ts`
- `apps/desktop/src/renderer/.../suppressQueryResponses.ts`

**Implementation:**
```typescript
// Suppress CSI responses (Device Attributes, Cursor Position)
parser.registerCsiHandler({ final: "c" }, () => true);  // DA1/DA2
parser.registerCsiHandler({ final: "R" }, () => true);  // CPR

// Suppress OSC color query responses
parser.registerOscHandler(10, () => true);  // Foreground
parser.registerOscHandler(11, () => true);  // Background
// ... OSC 12-19
```

**Key Characteristics:**
- Uses xterm.js's parser infrastructure (not regex)
- Selective suppression of query responses only
- Preserves all other escape sequences for proper rendering
- Clear scrollback detection for ED3 sequences

**Pros:**
- Clean integration with terminal emulator
- Efficient (hooks vs string scanning)
- Preserves terminal functionality

**Cons:**
- Requires xterm.js (browser/Electron only)
- More complex setup

---

### 2. VibeTunnel (Best Alternative)

**Approach:** Stateful filter class for title sequences

**Files:**
- TypeScript: `web/src/server/utils/ansi-title-filter.ts`
- Zig: `native/vt-fwd/src/title_filter.zig`

**Implementation:**
```typescript
// Compiled regex for performance
private static readonly COMPLETE_TITLE_REGEX = /\x1b\][0-2];[^\x07\x1b]*(?:\x07|\x1b\\)/g;

filter(chunk: string): string {
    this.buffer += chunk;
    const filtered = this.buffer.replace(TitleSequenceFilter.COMPLETE_TITLE_REGEX, '');
    // Handle partial sequences...
    return filtered;
}
```

**Key Characteristics:**
- Dual implementation (TypeScript + Zig)
- Handles split sequences across chunks (streaming-safe)
- Filters OSC 0, 1, 2 only (titles)
- Preserves all other escape sequences

**Pros:**
- Comprehensive test suite
- Streaming-compatible
- Well-documented
- Multi-language support

**Cons:**
- Regex-based (slightly less efficient than parser)
- Only handles title sequences

---

### 3. Catnip

**Approach:** Complete stripping for pattern matching + title extraction

**Files:**
- Go: `container/internal/services/claude_onboarding.go`
- Go: `container/internal/handlers/pty.go`
- JS: `container/setup/pty-title-interceptor.js`

**Implementation:**
```go
// Complete ANSI stripping
ansiRegex := regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[><]|\x1b\][^\x1b]*\x1b\\`)
return ansiRegex.ReplaceAllString(s, "")

// Title extraction
startSeq := []byte("\x1b]0;")
endChar := byte('\x07')
```

**Key Characteristics:**
- Dual approach: strip for matching, extract for tracking
- Title length limiting (100 chars)
- Node.js interceptor for process monitoring

**Pros:**
- Good for state detection (onboarding flow)
- Title tracking feature
- Multiple integration points

**Cons:**
- Complete strip loses formatting info
- Complex multi-layer implementation

---

### 4. Vibe-Kanban

**Approach:** Library-based complete ANSI stripping

**Implementation:**
```rust
content: strip_ansi_escapes::strip_str(&content),
```

**Key Characteristics:**
- Uses `strip-ansi-escapes` crate (Rust)
- Uses `strip-ansi` / `fancy-ansi` (TypeScript)
- Applied at log processing time

**Pros:**
- Simple, library-based approach
- Consistent across codebase
- Low maintenance

**Cons:**
- Complete strip loses all formatting
- No selective filtering

---

### 5. Claude-Squad

**Approach:** Time-based input filtering on attach

**Implementation:**
```go
// Discard first 50ms of stdin after attach
select {
case <-timeoutCh:  // 50ms passed
default:
    log.InfoLog.Printf("nuked first stdin: %s", buf[:nr])
    continue  // Discard
}
```

**Key Characteristics:**
- Simple time-based approach
- Targets attach sequence interference
- Relies on tmux for terminal handling

**Pros:**
- Very simple implementation
- No regex overhead
- Terminal-agnostic

**Cons:**
- Imprecise (time-based, not content-based)
- Only handles attach scenario
- May discard legitimate input

---

## Recommendations for Superset

### Current Superset Approach: Strong

Superset's use of xterm.js parser hooks is technically the cleanest approach for an Electron/browser-based terminal:

1. **No string scanning** - Uses the terminal parser directly
2. **Selective suppression** - Only suppresses problematic responses
3. **Preserves rendering** - All display sequences work normally
4. **Efficient** - Hooks are O(1) vs O(n) regex scans

### Potential Improvements Based on Alternatives

1. **From VibeTunnel:**
   - Consider adding streaming chunk handling for split sequences
   - Add comprehensive test coverage for edge cases
   - Document the approach more thoroughly

2. **From Catnip:**
   - Consider extracting titles for display/tracking (currently just suppressed)
   - Add title length limiting as defense-in-depth

3. **General:**
   - The ED3 (clear scrollback) detection in Superset is good
   - RIS (`ESC c`) handling decision (allow for TUI apps) is correct

---

## Best Practices Summary

### For Browser/Electron Apps (like Superset)
- Use xterm.js parser hooks for suppression
- Don't strip sequences that need to render
- Handle query responses at the parser level

### For Server-Side Processing (like Vibe-Kanban)
- Use established libraries (strip-ansi-escapes, strip-ansi)
- Complete stripping is acceptable for log storage/analysis
- Consistent approach across codebase

### For PTY Proxying (like VibeTunnel)
- Stateful filtering for streaming data
- Handle chunk boundaries carefully
- Selective filtering to preserve functionality

### For Tmux Integration (like Claude-Squad)
- Consider initial "nuke" period for query responses
- Rely on tmux for most terminal handling
- Log discarded data for debugging

---

## Conclusion

Superset's approach is one of the strongest among the alternatives:

| Aspect | Superset | Best Alternative |
|--------|----------|------------------|
| Efficiency | ⭐⭐⭐⭐⭐ | VibeTunnel ⭐⭐⭐⭐ |
| Selectivity | ⭐⭐⭐⭐⭐ | VibeTunnel ⭐⭐⭐⭐⭐ |
| Test Coverage | ⭐⭐⭐ | VibeTunnel ⭐⭐⭐⭐⭐ |
| Documentation | ⭐⭐⭐ | VibeTunnel ⭐⭐⭐⭐⭐ |
| Streaming | ⭐⭐⭐⭐ | VibeTunnel ⭐⭐⭐⭐⭐ |

**Key Takeaway:** Superset's parser-based approach is architecturally sound. The main improvements would be adding more comprehensive test coverage and documentation, following VibeTunnel's example.

---

## Appendix: Individual Project Notes

Detailed notes for each project are available in the following files:
- `notes-superset.md`
- `notes-vibetunnel.md`
- `notes-catnip.md`
- `notes-claude-squad.md`
- `notes-vibe-kanban.md`
- `notes-mux.md`
- `notes-opencode.md`
- `notes-auto-claude.md`
- `notes-chorus.md`
- `notes-happy.md`

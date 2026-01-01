# Catnip - Terminal Escape Sequence Handling

## Overview

Catnip has a multi-pronged approach to terminal escape sequences: **extraction** for title tracking and **stripping** for pattern matching.

## Key Files

1. **Go: `container/internal/handlers/pty.go`** - OSC title extraction
2. **Go: `container/internal/services/claude_onboarding.go`** - ANSI stripping
3. **JS: `container/setup/pty-title-interceptor.js`** - Node.js title interception

## Approach Details

### 1. OSC Title Extraction (Go)

Extracts terminal titles from OSC 0 sequences:

```go
func extractTitleFromEscapeSequence(data []byte) (string, bool) {
    startSeq := []byte("\x1b]0;")
    endChar := byte('\x07')

    start := bytes.Index(data, startSeq)
    if start == -1 {
        return "", false
    }
    end := bytes.IndexByte(data[start+len(startSeq):], endChar)
    if end == -1 {
        return "", false
    }

    title := data[start+len(startSeq) : start+len(startSeq)+end]
    return sanitizeTitle(string(title)), true
}
```

**Features:**
- Extracts OSC 0 (window title) sequences
- Title length limit (100 chars) for security
- Sanitization of extracted titles

### 2. ANSI Stripping (Go)

Strips all ANSI escape sequences for pattern matching:

```go
func stripANSI(s string) string {
    // Remove ANSI escape sequences (CSI sequences, OSC sequences, etc.)
    ansiRegex := regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[><]|\x1b\][^\x1b]*\x1b\\`)
    return ansiRegex.ReplaceAllString(s, "")
}
```

**Patterns removed:**
- `\x1b\[[0-9;]*[a-zA-Z]` - CSI sequences (colors, cursor)
- `\x1b\][^\x07]*\x07` - OSC sequences with BEL terminator
- `\x1b[><]` - Mode switches
- `\x1b\][^\x1b]*\x1b\\` - OSC sequences with ESC \ terminator

### 3. Node.js Title Interceptor

For Claude Code processes, intercepts stdout/stderr writes to extract titles:

```javascript
const TITLE_START_SEQ = "\x1b]0;";
const TITLE_END_CHAR = "\x07";

function extractTitleFromData(data) {
    const dataStr = data.toString();
    const startIndex = dataStr.indexOf(TITLE_START_SEQ);
    if (startIndex === -1) return null;

    const titleStart = startIndex + TITLE_START_SEQ.length;
    const endIndex = dataStr.indexOf(TITLE_END_CHAR, titleStart);
    if (endIndex === -1) return null;

    return dataStr.substring(titleStart, endIndex).trim();
}
```

**Features:**
- Monkey-patches process.stdout.write and stderr.write
- Only activates for Claude-related processes
- Logs titles to file for tracking

## OSC Handling Strategy

Catnip uses a **dual approach**:
1. **Extract** - Pull title information from OSC 0 for tracking/display
2. **Strip** - Remove all ANSI sequences when doing text pattern matching

## Notes

- Title extraction is used for task/progress tracking
- ANSI stripping is used for reliable onboarding state detection
- Multiple implementations (Go + JS) for different contexts

# VibeTunnel - Terminal Escape Sequence Handling

## Overview

VibeTunnel has the most comprehensive and sophisticated approach to terminal escape sequence handling among all alternatives. It implements filtering at multiple layers and in multiple languages.

## Key Files

1. **TypeScript: `web/src/server/utils/ansi-title-filter.ts`** - Main title sequence filter
2. **Zig: `native/vt-fwd/src/title_filter.zig`** - Native implementation of title filter
3. **Docs: `web/docs/terminal-titles.md`** - Documentation on terminal title handling

## Approach Details

### 1. TitleSequenceFilter Class (TypeScript)

A stateful filter that removes terminal title sequences (OSC 0, 1, and 2) from text streams:

**Key features:**
- Handles sequences split across multiple data chunks (streaming-safe)
- Supports both BEL (`\x07`) and ESC `\` (`\x1b\\`) terminators
- Zero-copy design with minimal performance impact
- Preserves all non-title ANSI sequences

```typescript
// Regex patterns compiled once for performance
private static readonly COMPLETE_TITLE_REGEX = /\x1b\][0-2];[^\x07\x1b]*(?:\x07|\x1b\\)/g;
private static readonly PARTIAL_TITLE_REGEX = /\x1b\][0-2];.*\x1b$|\x1b\][0-2];[^\x07]*$|\x1b(?:\](?:[0-2])?)?$/;
```

**Algorithm:**
1. Buffer incoming chunks
2. Remove all complete title sequences using regex
3. Detect partial sequences at buffer end
4. Buffer incomplete sequences for next chunk
5. Return filtered content

### 2. TitleFilter Struct (Zig - Native)

State machine implementation for high-performance filtering:

**States:**
- `normal` - Default state, output characters
- `esc` - ESC character received
- `osc_type` - After `ESC]`, checking for 0/1/2
- `osc_after_type` - After type digit, waiting for semicolon
- `osc_body` - Inside title content, discarding
- `osc_escape` - ESC received inside title (for `ESC \` terminator)

```zig
// Only filter OSC 0, 1, 2 (title sequences)
if (byte == '0' or byte == '1' or byte == '2') {
    self.pending[self.pending_len] = byte;
    self.pending_len += 1;
    self.state = .osc_after_type;
}
```

### 3. How It Handles OSC Sequences

**Filtered sequences (OSC 0, 1, 2):**
- `ESC ] 0 ; title BEL` - Set icon name and window title
- `ESC ] 1 ; title BEL` - Set icon name
- `ESC ] 2 ; title BEL` - Set window title

**NOT filtered (passed through):**
- `ESC ] 3 ; ... BEL` and higher - Other OSC sequences preserved
- `ESC [ ...` - CSI sequences (colors, cursor, etc.) preserved

## Security Considerations

- Limits title length to prevent abuse
- Sanitizes title content
- Focused filtering on title sequences only

## Testing

Extensive test suite covering:
- All OSC types (0, 1, 2)
- Both terminators (BEL and ESC \)
- Split sequences across chunks
- Edge cases (empty titles, Unicode, special chars)

## Notes

- Dual implementation (TypeScript + Zig) for different performance needs
- Very well-documented with JSDoc and code comments
- Production-tested approach with comprehensive test coverage

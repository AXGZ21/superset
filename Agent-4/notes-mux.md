# Mux - Terminal Escape Sequence Handling

## Overview

Mux appears to have minimal specific terminal escape sequence filtering. The project focuses on tool input sanitization rather than terminal output filtering.

## Key Files

1. **TypeScript: `src/browser/utils/messages/sanitizeToolInput.ts`** - Tool input sanitization

## Approach Details

### Tool Input Sanitization

Mux sanitizes tool inputs to ensure they are valid objects for API calls:

```typescript
export function sanitizeToolInputs(messages: MuxMessage[]): MuxMessage[] {
  return messages.map((msg) => {
    // Only process assistant messages with tool parts
    if (msg.role !== "assistant") {
      return msg;
    }

    // Check if any parts need sanitization
    const needsSanitization = msg.parts.some(
      (part) =>
        part.type === "dynamic-tool" &&
        (typeof part.input !== "object" || part.input === null || Array.isArray(part.input))
    );

    if (!needsSanitization) {
      return msg;
    }

    // Create new message with sanitized parts - replace with empty object
    // ...
  });
}
```

### Self-Healing Philosophy

From Mux's CLAUDE.md:
> Prefer self-healing behavior: if corrupted or invalid data exists in persisted state, the system should sanitize or filter it at load/request time rather than failing permanently.

## OSC Handling Strategy

**Not specifically implemented** - Mux does not appear to have dedicated OSC/ANSI escape sequence filtering. The project may rely on:
1. xterm.js terminal emulator to handle sequences properly
2. React Compiler for UI optimization
3. Defensive filtering at data boundaries

## Notes

- Focus on JSON/tool data sanitization rather than terminal escape sequences
- Emphasizes crash resilience and self-healing
- May defer terminal escape handling to underlying terminal components
- Different architectural approach (Electron desktop app)

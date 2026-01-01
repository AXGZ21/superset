# Auto-Claude - Terminal Escape Sequence Handling

## Overview

Auto-Claude focuses on **shell command safety** rather than terminal escape sequence filtering. The project does not appear to have specific terminal escape sequence filtering for OSC sequences.

## Key Files

1. **`apps/frontend/src/shared/utils/shell-escape.ts`** - Shell argument escaping

## Approach Details

### Shell Escape Utilities

Auto-Claude implements shell argument escaping to prevent command injection, which is a related but different security concern:

```typescript
export function escapeShellArg(arg: string): string {
  // Replace single quotes with: end quote, escaped quote, start quote
  const escaped = arg.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}
```

**Features:**
- Uses single quotes for POSIX shell escaping
- Handles single quote escaping correctly
- Windows cmd.exe escaping support
- Path safety validation

### Path Safety Validation

```typescript
const suspiciousPatterns = [
  /\$\(/, // Command substitution $(...)
  /`/,   // Backtick command substitution
  /\|/,  // Pipe
  /;/,   // Command separator
  /&&/,  // AND operator
  /\|\|/, // OR operator
  />/,   // Output redirection
  /</,   // Input redirection
  /\n/,  // Newlines
  /\r/,  // Carriage returns
];
```

## OSC Sequence Handling

**Not implemented** - Auto-Claude does not appear to filter OSC escape sequences from terminal output. The project focuses on shell command safety rather than terminal output sanitization.

## Notes

- Different security focus (input injection vs output escape sequences)
- May rely on underlying terminal emulator to handle escape sequences
- Good example of defense-in-depth for shell command security

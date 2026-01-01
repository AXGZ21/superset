# OpenCode - Terminal Escape Sequence Handling

## Overview

OpenCode uses OSC sequences for terminal color detection but does not appear to have filtering for OSC sequences entering terminal input.

## Key Files

1. **TypeScript: `packages/opencode/src/cli/cmd/tui/util/terminal.ts`** - Terminal color detection

## Approach Details

### Terminal Color Detection

OpenCode queries terminal colors using OSC escape sequences:

```typescript
export async function colors(): Promise<{
  background: RGBA | null
  foreground: RGBA | null
  colors: RGBA[]
}> {
  if (!process.stdin.isTTY) return { background: null, foreground: null, colors: [] }

  return new Promise((resolve) => {
    // ... setup handlers ...

    // Query background (OSC 11)
    process.stdout.write("\x1b]11;?\x07")
    // Query foreground (OSC 10)
    process.stdout.write("\x1b]10;?\x07")
    // Query palette colors 0-15 (OSC 4)
    for (let i = 0; i < 16; i++) {
      process.stdout.write(`\x1b]4;${i};?\x07`)
    }

    // ... timeout handling ...
  })
}
```

### Response Parsing

Parses OSC responses to extract color values:

```typescript
const handler = (data: Buffer) => {
  const str = data.toString()

  // Match OSC 11 (background color)
  const bgMatch = str.match(/\x1b]11;([^\x07\x1b]+)/)
  if (bgMatch) {
    background = parseColor(bgMatch[1])
  }

  // Match OSC 10 (foreground color)
  const fgMatch = str.match(/\x1b]10;([^\x07\x1b]+)/)
  if (fgMatch) {
    foreground = parseColor(fgMatch[1])
  }

  // Match OSC 4 (palette colors)
  const paletteMatches = str.matchAll(/\x1b]4;(\d+);([^\x07\x1b]+)/g)
  // ...
}
```

## OSC Handling Strategy

OpenCode uses OSC sequences for **detection** rather than filtering:
- Sends OSC 10, 11, 4 queries to detect terminal colors
- Parses responses to determine theme (dark/light)
- Note in code: "OSC 4 (palette) queries may not work through tmux as responses are filtered"

## Notes

- Uses OSC sequences as a feature, not a security concern
- Awareness that tmux filters some OSC responses
- No filtering of incoming OSC sequences found
- TUI-based application using opentui framework

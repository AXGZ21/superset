# Superset - Terminal Escape Sequence Handling

## Overview

Superset uses a multi-layered approach to handle terminal escape sequences:

## Key Files

1. **`terminal-escape-filter.ts`** - Clear scrollback sequence detection
2. **`suppressQueryResponses.ts`** - Query response suppression using xterm.js parser hooks
3. **`parseCwd.ts`** - OSC 7 sequence parsing for directory tracking

## Approach Details

### 1. Clear Scrollback Detection (ED3)

- Detects ESC[3J (ED3 - Erase Display 3, clear scrollback)
- Does NOT filter ESC c (RIS) because TUI apps use it for screen repaints
- Used to know when to clear scrollback history

```typescript
const CLEAR_SCROLLBACK_PATTERN = new RegExp(`${ESC}\\[3J`);
```

### 2. Query Response Suppression

Uses xterm.js parser hooks to intercept and suppress terminal query responses:

**CSI handlers:**
- `final: "c"` - Device Attributes (DA1/DA2) responses
- `final: "R"` - Cursor Position Report (CPR)
- `intermediates: "$", final: "y"` - Mode Reports (DECRPM)

**OSC handlers:**
- OSC 10-19 - Color query responses (foreground, background, cursor colors)

```typescript
parser.registerCsiHandler({ final: "c" }, () => true);  // Suppress
parser.registerOscHandler(10, () => true);  // Suppress
```

### 3. OSC 7 Parsing

Parses OSC 7 sequences to extract current working directory:
- Format: `ESC]7;file://hostname/path BEL`
- Used for directory tracking, not filtering

### 4. Binary Name Sanitization

Separate from escape sequences, uses shell-quote library to validate binary names:
- Checks for dangerous shell metacharacters: `` `'"$!#~{}[]()<>|&;*?\s\\ ``
- Validates against shell injection

## Security Model

Superset does NOT strip escape sequences from terminal output - instead:
1. Uses xterm.js parser hooks to suppress query responses at the display layer
2. Lets xterm.js handle rendering escape sequences properly
3. Focuses on preventing escape sequences from affecting the terminal input/history inappropriately

## Notes

- Relies heavily on xterm.js's built-in parser infrastructure
- The approach is more about proper handling than filtering/stripping
- Clear scrollback detection is separate from OSC sequence handling

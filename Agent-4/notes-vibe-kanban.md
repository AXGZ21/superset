# Vibe-Kanban - Terminal Escape Sequence Handling

## Overview

Vibe-Kanban uses the `strip-ansi-escapes` Rust crate to strip all ANSI escape sequences from log output. This is a straightforward, library-based approach.

## Key Files

1. **Rust: `crates/executors/src/logs/stderr_processor.rs`** - Stderr stripping
2. **Rust: `crates/executors/src/executors/droid/normalize_logs.rs`** - Log normalization
3. **Rust: `crates/executors/src/executors/cursor.rs`** - Cursor executor
4. **Rust: `crates/executors/src/executors/copilot.rs`** - Copilot executor
5. **TypeScript: `frontend/src/hooks/useDevserverUrl.ts`** - Frontend stripping

## Approach Details

### 1. Stderr Log Processing (Rust)

Uses `strip-ansi-escapes` crate for complete ANSI stripping:

```rust
let mut processor = PlainTextLogProcessor::builder()
    .normalized_entry_producer(Box::new(|content: String| NormalizedEntry {
        timestamp: None,
        entry_type: NormalizedEntryType::ErrorMessage {
            error_type: NormalizedEntryError::Other,
        },
        content: strip_ansi_escapes::strip_str(&content),  // <-- Strip here
        metadata: None,
    }))
    .time_gap(Duration::from_secs(2))
    .index_provider(entry_index_provider)
    .build();
```

### 2. Executor Log Normalization

Multiple executors strip ANSI when processing output:

```rust
// In droid/normalize_logs.rs
content: strip_ansi_escapes::strip_str(trimmed).to_string(),

// Line transformation
*line = strip_ansi_escapes::strip_str(&line);
```

### 3. Server Main (Rust)

Also strips ANSI from server output:

```rust
use strip_ansi_escapes::strip;

// ...
String::from_utf8(strip(s.as_bytes())).expect("UTF-8 after stripping ANSI");
```

### 4. Frontend (TypeScript)

Uses `fancy-ansi` library for frontend stripping:

```typescript
import { stripAnsi } from 'fancy-ansi';

// ...
const cleaned = stripAnsi(line);
```

## OSC Handling Strategy

Vibe-Kanban uses **complete stripping** - all ANSI sequences are removed, including:
- CSI sequences (colors, cursor movement)
- OSC sequences (titles, hyperlinks)
- All other escape sequences

## Dependencies

- **Rust:** `strip-ansi-escapes = "0.2.1"`
- **TypeScript:** `fancy-ansi` (via npm)
- **Frontend also uses:** `strip-ansi` npm packages

## Notes

- Consistent approach across Rust backend and TypeScript frontend
- Uses established libraries rather than custom implementations
- Complete stripping (no selective filtering)
- Trade-off: loses all ANSI formatting in logs

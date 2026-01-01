# Claude-Squad - Terminal Escape Sequence Handling

## Overview

Claude-Squad uses tmux for session management and has a unique approach: **"nuking"** initial control sequences during attach.

## Key Files

1. **Go: `session/tmux/tmux.go`** - Tmux session management

## Approach Details

### Control Sequence Nuking on Attach

When attaching to a tmux session, claude-squad discards initial stdin bytes to prevent terminal control sequences from interfering:

```go
go func() {
    // Close the channel after 50ms
    timeoutCh := make(chan struct{})
    go func() {
        time.Sleep(50 * time.Millisecond)
        close(timeoutCh)
    }()

    // Read input from stdin and check for Ctrl+q
    buf := make([]byte, 32)
    for {
        nr, err := os.Stdin.Read(buf)
        if err != nil {
            if err == io.EOF {
                break
            }
            continue
        }

        // Nuke the first bytes of stdin, up to 64, to prevent tmux from reading it.
        // When we attach, there tends to be terminal control sequences like ?[?62c0;95;0c or
        // ]10;rgb:f8f8f8. The control sequences depend on the terminal (warp vs iterm).
        select {
        case <-timeoutCh:
        default:
            log.InfoLog.Printf("nuked first stdin: %s", buf[:nr])
            continue
        }
        // ... forward other input to tmux
    }
}()
```

### Approach Explanation

1. **50ms timeout** - First 50ms of stdin after attach is discarded
2. **Logs discarded data** - For debugging
3. **Terminal-agnostic** - Works with different terminals (Warp, iTerm, etc.)
4. **DA1/DA2 response handling** - Catches device attributes responses like `?[?62c0;95;0c`
5. **Color query responses** - Catches OSC 10/11 responses like `]10;rgb:f8f8f8`

### Tmux Pane Capture

Uses tmux's capture-pane with `-e` flag to preserve ANSI color codes:

```go
func (t *TmuxSession) CapturePaneContent() (string, error) {
    // Add -e flag to preserve escape sequences (ANSI color codes)
    cmd := exec.Command("tmux", "capture-pane", "-p", "-e", "-J", "-t", t.sanitizedName)
    output, err := t.cmdExec.Output(cmd)
    // ...
}
```

## OSC Handling Strategy

Claude-Squad doesn't filter OSC sequences from output. Instead:
1. **Input filtering** - Discards initial control sequences on stdin during attach
2. **Preserve output** - Keeps ANSI sequences in captured pane content for display

## Notes

- Simple but effective time-based approach
- Focuses on the specific problem (attach sequence interference)
- Relies on tmux handling most terminal emulation
- Different philosophy: time-based filtering vs pattern-based filtering

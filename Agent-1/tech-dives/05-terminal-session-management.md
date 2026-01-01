# Technical Deep Dive: Terminal & Session Management

## Sources: Superset, Mux, VibeTunnel, Claude Squad, Catnip

## Executive Summary

This deep dive analyzes terminal management implementations across all competitors to identify best practices and improvement opportunities for Superset. Key innovations include **ghostty-web WASM terminals**, **activity-based rendering**, **session recording**, and **multiplexer integration**.

---

## Architecture Comparison

### Terminal Rendering Approaches

| Project | Library | Renderer | Key Innovation |
|---------|---------|----------|----------------|
| Superset | xterm.js | Canvas/WebGL | OSC-7 cwd tracking |
| Mux | ghostty-web | WebAssembly | Auto-memoization via React Compiler |
| VibeTunnel | ghostty-web | WebAssembly | Binary protocol, activity-based rendering |
| Claude Squad | Native PTY | tmux | Pause/resume, state serialization |
| Catnip | xterm.js | Canvas | Claude hooks integration, WebSocket streaming |
| Auto-Claude | xterm.js | Canvas | Multi-pane grid, task association |

---

## Superset's Current Terminal Architecture

### Strengths

```typescript
// Terminal.tsx - Current strengths

// 1. OSC-7 CWD Tracking
const handleData = useCallback((data: string) => {
  // Parse OSC-7 escape sequence for directory changes
  const match = data.match(/\x1b\]7;file:\/\/[^\/]*([^\x07]+)\x07/);
  if (match) {
    const newCwd = decodeURIComponent(match[1]);
    onCwdChange?.(newCwd);
  }
}, []);

// 2. tRPC Observable Streaming
useEffect(() => {
  if (!sessionId) return;

  const subscription = api.terminal.output.subscribe(
    { sessionId },
    {
      onData: (data) => {
        terminalRef.current?.write(data);
      },
    }
  );

  return () => subscription.unsubscribe();
}, [sessionId]);

// 3. Search Integration
<SearchAddon
  terminal={terminalRef.current}
  searchVisible={searchVisible}
  onClose={() => setSearchVisible(false)}
/>
```

### Weaknesses Identified

1. **No Progress Indicators**: Long commands show no feedback
2. **Fixed Font Size**: 13px not customizable
3. **No Terminal Recording**: Can't replay sessions
4. **Single Terminal Type**: No distinction between agent/user terminals
5. **Limited Theme Options**: Only dark/light, no custom themes

---

## Ghostty-Web WASM Terminal (Mux, VibeTunnel)

### Why WASM Terminal?

Ghostty-web compiles the Rust-based Ghostty terminal to WebAssembly, providing:
- **Native-like Performance**: GPU-accelerated rendering
- **Accurate Emulation**: Full VT100/VT220/xterm compatibility
- **Small Bundle**: ~300KB gzipped
- **Cross-Platform Consistency**: Same rendering everywhere

### Integration Pattern

```typescript
// Ghostty-web integration from VibeTunnel

import { Terminal as GhosttyTerminal } from 'ghostty-web';

class TerminalManager {
  private terminals: Map<string, GhosttyTerminal> = new Map();

  async createTerminal(sessionId: string, container: HTMLElement): Promise<void> {
    const terminal = new GhosttyTerminal({
      // Font configuration
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      lineHeight: 1.2,

      // Performance options
      gpuAcceleration: 'auto',
      webgl2: true,
      scrollback: 10000,

      // Theme
      theme: {
        background: '#0B0B0F',
        foreground: '#E8E6E3',
        cursor: '#D6D876',
        selection: 'rgba(214, 216, 118, 0.3)',
        // ANSI colors
        black: '#1A1B26',
        red: '#F7768E',
        green: '#9ECE6A',
        // ... rest of palette
      },
    });

    await terminal.attach(container);
    this.terminals.set(sessionId, terminal);
  }

  write(sessionId: string, data: Uint8Array): void {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.resize(cols, rows);
    }
  }
}
```

### Performance Optimization: Activity-Based Rendering

```typescript
// From VibeTunnel - Only render when there's activity

class ActivityAwareTerminal {
  private lastActivity: number = 0;
  private renderScheduled: boolean = false;
  private pendingData: Uint8Array[] = [];

  write(data: Uint8Array): void {
    this.pendingData.push(data);
    this.lastActivity = Date.now();

    if (!this.renderScheduled) {
      this.scheduleRender();
    }
  }

  private scheduleRender(): void {
    this.renderScheduled = true;

    // Batch writes for 16ms (60fps)
    requestAnimationFrame(() => {
      if (this.pendingData.length > 0) {
        const merged = this.mergeBuffers(this.pendingData);
        this.terminal.write(merged);
        this.pendingData = [];
      }
      this.renderScheduled = false;

      // Continue rendering if still active
      if (Date.now() - this.lastActivity < 100) {
        this.scheduleRender();
      }
    });
  }

  private mergeBuffers(buffers: Uint8Array[]): Uint8Array {
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    return result;
  }
}
```

---

## Session Recording & Playback

### Asciinema Format (VibeTunnel)

```typescript
// Session recording in asciinema v2 format

interface AsciinemaHeader {
  version: 2;
  width: number;
  height: number;
  timestamp: number;
  env?: Record<string, string>;
  title?: string;
}

interface AsciinemaEvent {
  time: number;      // Seconds since start
  type: 'o' | 'i';   // Output or input
  data: string;      // Content
}

class SessionRecorder {
  private startTime: number = 0;
  private events: AsciinemaEvent[] = [];
  private header: AsciinemaHeader;

  constructor(width: number, height: number) {
    this.header = {
      version: 2,
      width,
      height,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  start(): void {
    this.startTime = performance.now();
    this.events = [];
  }

  recordOutput(data: string): void {
    const time = (performance.now() - this.startTime) / 1000;
    this.events.push({ time, type: 'o', data });
  }

  recordInput(data: string): void {
    const time = (performance.now() - this.startTime) / 1000;
    this.events.push({ time, type: 'i', data });
  }

  export(): string {
    const lines = [
      JSON.stringify(this.header),
      ...this.events.map(e => JSON.stringify([e.time, e.type, e.data])),
    ];
    return lines.join('\n');
  }
}

// Playback with timing
class SessionPlayer {
  private events: AsciinemaEvent[] = [];
  private currentIndex: number = 0;
  private playbackSpeed: number = 1;

  async play(terminal: Terminal, recording: string): Promise<void> {
    const lines = recording.split('\n');
    const header = JSON.parse(lines[0]) as AsciinemaHeader;
    this.events = lines.slice(1).map(line => {
      const [time, type, data] = JSON.parse(line);
      return { time, type, data };
    });

    terminal.resize(header.width, header.height);

    let lastTime = 0;
    for (const event of this.events) {
      const delay = (event.time - lastTime) * 1000 / this.playbackSpeed;
      await sleep(delay);

      if (event.type === 'o') {
        terminal.write(event.data);
      }

      lastTime = event.time;
    }
  }

  setSpeed(speed: number): void {
    this.playbackSpeed = speed;
  }
}
```

---

## Claude Hooks Integration (Catnip)

### Extracting Activity from Claude Code

```typescript
// Catnip uses Claude Code's hook system for precise activity tracking

interface ClaudeHookEvent {
  type: 'tool_start' | 'tool_end' | 'message' | 'thinking' | 'error';
  tool?: string;
  content?: string;
  timestamp: number;
}

class ClaudeHooksListener {
  private hookPath: string;
  private watcher: FSWatcher | null = null;
  private callbacks: Map<string, (event: ClaudeHookEvent) => void> = new Map();

  constructor(sessionDir: string) {
    this.hookPath = path.join(sessionDir, '.claude', 'hooks');
  }

  async start(): Promise<void> {
    // Ensure hooks directory exists
    await fs.mkdir(this.hookPath, { recursive: true });

    // Watch for hook events
    this.watcher = fs.watch(this.hookPath, (eventType, filename) => {
      if (eventType === 'change' && filename) {
        this.processHookFile(path.join(this.hookPath, filename));
      }
    });
  }

  private async processHookFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const event = JSON.parse(content) as ClaudeHookEvent;

      for (const callback of this.callbacks.values()) {
        callback(event);
      }
    } catch (error) {
      // Ignore parse errors (file may be partially written)
    }
  }

  on(id: string, callback: (event: ClaudeHookEvent) => void): void {
    this.callbacks.set(id, callback);
  }

  off(id: string): void {
    this.callbacks.delete(id);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}

// Usage in UI
function useClaudeActivity(sessionId: string) {
  const [activity, setActivity] = useState<ClaudeActivity>({
    status: 'idle',
    currentTool: null,
    lastUpdate: Date.now(),
  });

  useEffect(() => {
    const listener = new ClaudeHooksListener(getSessionDir(sessionId));

    listener.on('activity', (event) => {
      switch (event.type) {
        case 'tool_start':
          setActivity({
            status: 'executing',
            currentTool: event.tool,
            lastUpdate: event.timestamp,
          });
          break;
        case 'tool_end':
          setActivity(prev => ({
            ...prev,
            status: 'idle',
            currentTool: null,
            lastUpdate: event.timestamp,
          }));
          break;
        case 'thinking':
          setActivity({
            status: 'thinking',
            currentTool: null,
            lastUpdate: event.timestamp,
          });
          break;
      }
    });

    listener.start();
    return () => listener.stop();
  }, [sessionId]);

  return activity;
}
```

---

## Multiplexer Integration (Claude Squad, VibeTunnel)

### tmux Integration Pattern

```go
// Claude Squad's tmux session management

type TmuxManager struct {
    socketPath string
    sessions   map[string]*TmuxSession
}

type TmuxSession struct {
    Name       string
    WindowID   int
    PaneID     int
    WorkingDir string
    Command    string
}

func (m *TmuxManager) CreateSession(name string, workingDir string) (*TmuxSession, error) {
    // Create new tmux session
    cmd := exec.Command("tmux", "new-session",
        "-d",                    // Detached
        "-s", name,              // Session name
        "-c", workingDir,        // Working directory
        "-x", "120",             // Width
        "-y", "30",              // Height
    )

    if err := cmd.Run(); err != nil {
        return nil, fmt.Errorf("failed to create tmux session: %w", err)
    }

    session := &TmuxSession{
        Name:       name,
        WindowID:   0,
        PaneID:     0,
        WorkingDir: workingDir,
    }

    m.sessions[name] = session
    return session, nil
}

func (m *TmuxManager) SendKeys(sessionName string, keys string) error {
    cmd := exec.Command("tmux", "send-keys",
        "-t", sessionName,
        keys,
        "Enter",
    )
    return cmd.Run()
}

func (m *TmuxManager) CapturePane(sessionName string) (string, error) {
    cmd := exec.Command("tmux", "capture-pane",
        "-t", sessionName,
        "-p",           // Print to stdout
        "-S", "-1000",  // Start from 1000 lines back
    )

    output, err := cmd.Output()
    if err != nil {
        return "", fmt.Errorf("failed to capture pane: %w", err)
    }

    return string(output), nil
}

func (m *TmuxManager) AttachSession(sessionName string) error {
    // Attach to existing session (used for resume)
    cmd := exec.Command("tmux", "attach-session", "-t", sessionName)
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    return cmd.Run()
}

func (m *TmuxManager) DetachSession(sessionName string) error {
    // Detach client but keep session running
    cmd := exec.Command("tmux", "detach-client", "-s", sessionName)
    return cmd.Run()
}
```

### Benefits of Multiplexer Integration

1. **Native Session Persistence**: Sessions survive app restarts
2. **Easy Pause/Resume**: Detach/attach is built-in
3. **Resource Efficient**: Shared terminal processes
4. **Scriptable**: Easy to automate via CLI
5. **Fallback Option**: Users can interact directly if needed

---

## Superset Integration Recommendations

### 1. Upgrade to Ghostty-Web

```typescript
// Migration path from xterm.js to ghostty-web

// Phase 1: Add ghostty-web alongside xterm.js
import { Terminal as GhosttyTerminal } from 'ghostty-web';
import { Terminal as XtermTerminal } from 'xterm';

type TerminalBackend = 'xterm' | 'ghostty';

function createTerminal(
  backend: TerminalBackend,
  container: HTMLElement,
  options: TerminalOptions
): Terminal {
  if (backend === 'ghostty') {
    return new GhosttyTerminalAdapter(container, options);
  }
  return new XtermTerminalAdapter(container, options);
}

// Phase 2: Feature flag for testing
const useGhostty = featureFlags.get('terminal.useGhostty');

// Phase 3: Gradual rollout
// - Enable for new workspaces first
// - Then migrate existing workspaces
// - Keep xterm.js as fallback
```

### 2. Add Session Recording

```typescript
// Add recording to terminal sessions

interface TerminalSession {
  id: string;
  workspaceId: string;
  recording?: SessionRecording;
}

interface SessionRecording {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  events: RecordingEvent[];
  metadata: {
    title?: string;
    description?: string;
    tags: string[];
  };
}

// UI for session recording
function TerminalHeader({ sessionId }: { sessionId: string }) {
  const { isRecording, startRecording, stopRecording, recordings } =
    useSessionRecording(sessionId);

  return (
    <div className="flex items-center gap-2">
      {isRecording ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={stopRecording}
        >
          <Square className="h-4 w-4 mr-1" />
          Stop Recording
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={startRecording}
        >
          <Circle className="h-4 w-4 mr-1 text-red-500" />
          Record
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <History className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {recordings.map(rec => (
            <DropdownMenuItem
              key={rec.id}
              onClick={() => playRecording(rec.id)}
            >
              {rec.metadata.title || formatDate(rec.startedAt)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

### 3. Add Claude Activity Indicator

```typescript
// Activity indicator component

function ClaudeActivityIndicator({ sessionId }: { sessionId: string }) {
  const activity = useClaudeActivity(sessionId);

  return (
    <div className="flex items-center gap-2">
      <StatusDot
        color={getActivityColor(activity.status)}
        pulsing={activity.status === 'executing' || activity.status === 'thinking'}
      />
      <span className="text-sm">
        {activity.status === 'executing' && `Running ${activity.currentTool}`}
        {activity.status === 'thinking' && 'Thinking...'}
        {activity.status === 'waiting' && 'Waiting for input'}
        {activity.status === 'idle' && 'Ready'}
      </span>
    </div>
  );
}

function getActivityColor(status: ClaudeStatus): string {
  switch (status) {
    case 'executing': return '#007AFF';   // Blue
    case 'thinking': return '#FF9500';    // Orange
    case 'waiting': return '#34C759';     // Green
    case 'idle': return '#8E8E93';        // Gray
    case 'error': return '#FF3B30';       // Red
  }
}
```

### 4. Add Terminal Customization

```typescript
// Terminal settings

interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: 'dark' | 'light' | 'custom';
  customColors?: TerminalColors;
  scrollback: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
}

function TerminalSettingsPanel() {
  const { settings, updateSettings } = useTerminalSettings();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Font Family</Label>
        <Select
          value={settings.fontFamily}
          onValueChange={(fontFamily) => updateSettings({ fontFamily })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="JetBrains Mono">JetBrains Mono</SelectItem>
            <SelectItem value="Fira Code">Fira Code</SelectItem>
            <SelectItem value="SF Mono">SF Mono</SelectItem>
            <SelectItem value="Monaco">Monaco</SelectItem>
            <SelectItem value="Menlo">Menlo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Font Size: {settings.fontSize}px</Label>
        <Slider
          value={[settings.fontSize]}
          onValueChange={([fontSize]) => updateSettings({ fontSize })}
          min={10}
          max={24}
          step={1}
        />
      </div>

      <div className="space-y-2">
        <Label>Scrollback Lines</Label>
        <Select
          value={String(settings.scrollback)}
          onValueChange={(v) => updateSettings({ scrollback: Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1000">1,000</SelectItem>
            <SelectItem value="5000">5,000</SelectItem>
            <SelectItem value="10000">10,000</SelectItem>
            <SelectItem value="50000">50,000</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label>Cursor Blink</Label>
        <Switch
          checked={settings.cursorBlink}
          onCheckedChange={(cursorBlink) => updateSettings({ cursorBlink })}
        />
      </div>
    </div>
  );
}
```

---

## Performance Benchmarks

### xterm.js vs ghostty-web

| Metric | xterm.js | ghostty-web |
|--------|----------|-------------|
| Bundle Size | ~500KB | ~300KB |
| Initial Render | ~50ms | ~30ms |
| 10k Lines Render | ~200ms | ~80ms |
| Memory (10k scrollback) | ~15MB | ~8MB |
| GPU Acceleration | Optional | Always |

### Recommendation

**Migrate to ghostty-web** for:
- Better performance with large outputs
- Smaller bundle size
- Native-like terminal experience
- Active development by Ghostty team

**Keep xterm.js** as fallback for:
- WebGL-incompatible environments
- Legacy browser support
- Specific addon requirements

---

## Benefits Summary

| Feature | Current State | After Integration |
|---------|---------------|-------------------|
| Terminal Rendering | xterm.js canvas | ghostty-web WASM |
| Session Recording | None | Asciinema format |
| Activity Tracking | PTY parsing | Claude hooks |
| Customization | Limited | Full theming |
| Performance | Good | Excellent |
| Pause/Resume | Basic | tmux-backed |

## Estimated Implementation Effort

| Component | Effort | Priority |
|-----------|--------|----------|
| Ghostty-web Integration | 3 weeks | Medium |
| Session Recording | 2 weeks | Low |
| Claude Hooks Listener | 1 week | High |
| Activity Indicator | 1 week | High |
| Terminal Settings | 1 week | Medium |
| tmux Integration | 3 weeks | Low |
| **Total** | **11 weeks** | - |

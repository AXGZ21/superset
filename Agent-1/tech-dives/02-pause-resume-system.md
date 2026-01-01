# Technical Deep Dive: Pause/Resume System

## Sources: Claude Squad, Mux

## Executive Summary

Claude Squad implements an elegant **pause/resume mechanism** that allows long-running agent sessions to be suspended and resumed later without losing state. This is critical for resource management, context switching, and handling interruptions during autonomous agent execution.

---

## Architecture Overview

### State Preservation Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PAUSE/RESUME SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   RUNNING STATE                    PAUSED STATE                              │
│   ┌─────────────────┐             ┌─────────────────┐                       │
│   │ Active Terminal │  ──PAUSE──▶ │ Serialized PTY  │                       │
│   │ Claude Code Proc│             │ Session State   │                       │
│   │ Git Worktree    │             │ Conversation    │                       │
│   │ Conversation    │             │ Git Stash       │                       │
│   └─────────────────┘             └─────────────────┘                       │
│                                          │                                   │
│                                          │ RESUME                           │
│                                          ▼                                   │
│                                   ┌─────────────────┐                       │
│                                   │ Restored Session│                       │
│                                   │ + Context Replay│                       │
│                                   └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Claude Squad Implementation

### Session State Structure

```go
// From claude-squad/session/instance.go

type Instance struct {
    // Identity
    ID          string
    Title       string
    CreatedAt   time.Time

    // Git state
    GitWorktree string      // Path to worktree
    GitBranch   string      // Current branch
    GitStashRef string      // Stash reference (when paused)

    // Terminal state
    TmuxSession string      // tmux session name
    PtyState    *PtyState   // Serialized PTY content

    // Conversation state
    Conversation []Message  // Full conversation history
    LastPrompt   string     // Last user prompt

    // Status
    Status      InstanceStatus  // running | paused | completed | failed
    PausedAt    *time.Time
    ResumedAt   *time.Time
}

type PtyState struct {
    ScrollbackBuffer []byte  // Terminal history
    CursorPosition   Position
    TerminalSize     Size
    Environment      map[string]string
}
```

### Pause Operation Flow

```go
// Pause flow in Claude Squad

func (i *Instance) Pause() error {
    // 1. Send interrupt signal to Claude Code
    if err := i.interruptAgent(); err != nil {
        return fmt.Errorf("failed to interrupt agent: %w", err)
    }

    // 2. Wait for agent to reach safe state
    if err := i.waitForSafeState(30 * time.Second); err != nil {
        log.Warn("Agent did not reach safe state, forcing pause")
    }

    // 3. Capture terminal state
    ptyState, err := i.capturePtyState()
    if err != nil {
        return fmt.Errorf("failed to capture PTY state: %w", err)
    }
    i.PtyState = ptyState

    // 4. Git operations
    if i.hasUncommittedChanges() {
        // Stash changes with descriptive message
        stashRef, err := i.gitStash(fmt.Sprintf("superset-pause-%s", i.ID))
        if err != nil {
            return fmt.Errorf("failed to stash changes: %w", err)
        }
        i.GitStashRef = stashRef
    }

    // 5. Commit conversation state to disk
    if err := i.saveConversation(); err != nil {
        return fmt.Errorf("failed to save conversation: %w", err)
    }

    // 6. Detach tmux session (keeps process but disconnects UI)
    if err := i.detachTmuxSession(); err != nil {
        return fmt.Errorf("failed to detach tmux: %w", err)
    }

    // 7. Update status
    i.Status = InstanceStatusPaused
    i.PausedAt = timePtr(time.Now())

    // 8. Optionally remove worktree (if memory constrained)
    if config.RemoveWorktreeOnPause {
        if err := i.removeWorktree(); err != nil {
            log.Warn("Failed to remove worktree: %v", err)
        }
    }

    return nil
}
```

### Resume Operation Flow

```go
func (i *Instance) Resume() error {
    // 1. Verify session exists
    if i.Status != InstanceStatusPaused {
        return fmt.Errorf("instance not paused, status: %s", i.Status)
    }

    // 2. Recreate worktree if removed
    if !i.worktreeExists() {
        if err := i.createWorktree(); err != nil {
            return fmt.Errorf("failed to recreate worktree: %w", err)
        }
    }

    // 3. Restore git stash
    if i.GitStashRef != "" {
        if err := i.gitStashPop(i.GitStashRef); err != nil {
            return fmt.Errorf("failed to restore stash: %w", err)
        }
        i.GitStashRef = ""
    }

    // 4. Recreate tmux session
    if err := i.createTmuxSession(); err != nil {
        return fmt.Errorf("failed to create tmux session: %w", err)
    }

    // 5. Restore terminal state
    if i.PtyState != nil {
        if err := i.restorePtyState(i.PtyState); err != nil {
            log.Warn("Failed to restore PTY state: %v", err)
        }
    }

    // 6. Replay conversation context
    if err := i.replayConversationContext(); err != nil {
        return fmt.Errorf("failed to replay context: %w", err)
    }

    // 7. Restart Claude Code with context
    if err := i.startClaudeCode(); err != nil {
        return fmt.Errorf("failed to start Claude Code: %w", err)
    }

    // 8. Send resume prompt
    resumePrompt := fmt.Sprintf(`
        Continue from where we left off.
        Last action: %s
        Current state: %s
    `, i.getLastAction(), i.getCurrentState())

    if err := i.sendPrompt(resumePrompt); err != nil {
        return fmt.Errorf("failed to send resume prompt: %w", err)
    }

    // 9. Update status
    i.Status = InstanceStatusRunning
    i.ResumedAt = timePtr(time.Now())

    return nil
}
```

---

## Safe State Detection

### Activity Detection via PTY Inspection

Claude Squad detects when the agent is "safe to pause" by inspecting terminal output:

```go
// Detect if agent is waiting for user input
func (i *Instance) isWaitingForInput() bool {
    lastLines := i.getLastNLines(5)

    // Check for Claude Code prompt patterns
    patterns := []string{
        "> ",           // Input prompt
        "? ",           // Question prompt
        "[Y/n]",        // Confirmation prompt
        "Press any key", // Continue prompt
    }

    for _, pattern := range patterns {
        if strings.Contains(lastLines, pattern) {
            return true
        }
    }

    return false
}

// Detect if agent is actively executing
func (i *Instance) isExecuting() bool {
    // Check for active process output
    outputRate := i.getOutputRateLastNSeconds(5)
    return outputRate > 0.5 // More than 0.5 chars/sec
}

// Wait for safe state with timeout
func (i *Instance) waitForSafeState(timeout time.Duration) error {
    deadline := time.Now().Add(timeout)

    for time.Now().Before(deadline) {
        if i.isWaitingForInput() {
            return nil
        }

        if !i.isExecuting() {
            // No output for 5 seconds, likely safe
            return nil
        }

        time.Sleep(500 * time.Millisecond)
    }

    return fmt.Errorf("timeout waiting for safe state")
}
```

---

## Mux's Session Compaction Pattern

Mux adds **opportunistic compaction** to the pause/resume model:

```typescript
// From Mux's session management

interface CompactedSession {
  id: string;
  summary: string;          // AI-generated summary
  keyDecisions: string[];   // Important decisions made
  currentState: string;     // What was being worked on
  pendingTasks: string[];   // What remains to do

  // Compressed conversation
  recentMessages: Message[];  // Last 20 messages
  compactedHistory: string;   // Summarized older messages
}

async function compactSession(session: Session): Promise<CompactedSession> {
  // Get full conversation
  const messages = session.conversation;

  if (messages.length < 50) {
    // No compaction needed
    return {
      ...session,
      recentMessages: messages,
      compactedHistory: '',
    };
  }

  // Split into recent and older
  const recentMessages = messages.slice(-20);
  const olderMessages = messages.slice(0, -20);

  // Generate summary of older messages
  const summaryPrompt = `
    Summarize the following conversation history, capturing:
    1. Key decisions made
    2. Problems encountered and solutions
    3. Current state of the work
    4. Any pending tasks or next steps

    Conversation:
    ${olderMessages.map(formatMessage).join('\n')}
  `;

  const summary = await generateSummary(summaryPrompt);

  return {
    id: session.id,
    summary: summary.overview,
    keyDecisions: summary.decisions,
    currentState: summary.state,
    pendingTasks: summary.pending,
    recentMessages,
    compactedHistory: summary.fullText,
  };
}
```

### Opportunistic Compaction Trigger

```typescript
// Compact during idle periods
class SessionManager {
  private compactionInterval: NodeJS.Timer | null = null;

  startOpportunisticCompaction() {
    this.compactionInterval = setInterval(async () => {
      const sessions = await this.getPausedSessions();

      for (const session of sessions) {
        // Only compact if not recently accessed
        const idleTime = Date.now() - session.lastAccessedAt;
        const needsCompaction = session.conversation.length > 100;

        if (idleTime > 30 * 60 * 1000 && needsCompaction) {
          await this.compactSession(session.id);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }
}
```

---

## Superset Integration Strategy

### Step 1: Add Pause/Resume State to Workspace

```typescript
// Extend workspace types
interface WorkspaceState {
  // ... existing fields

  // Pause/Resume
  pauseState: PauseState | null;
  canPause: boolean;
  canResume: boolean;
}

interface PauseState {
  pausedAt: Date;
  reason: 'user' | 'resource' | 'error';

  // Preserved state
  terminalBuffer: string;        // Serialized xterm content
  cursorPosition: { x: number; y: number };
  gitStashRef: string | null;

  // Conversation context
  conversationSummary: string;
  lastAction: string;
  pendingTasks: string[];

  // Compaction
  isCompacted: boolean;
  compactedAt: Date | null;
}
```

### Step 2: Implement Pause Handler in Main Process

```typescript
// apps/desktop/src/main/lib/workspace/pause-manager.ts

export class PauseManager {
  constructor(
    private terminalManager: TerminalManager,
    private worktreeManager: WorktreeManager,
    private conversationStore: ConversationStore
  ) {}

  async pause(workspaceId: string, reason: PauseReason): Promise<PauseResult> {
    const workspace = await this.getWorkspace(workspaceId);

    // 1. Check if safe to pause
    const safeState = await this.waitForSafeState(workspaceId, 30000);
    if (!safeState.safe) {
      return {
        success: false,
        error: 'Agent not in safe state',
        suggestion: safeState.suggestion
      };
    }

    // 2. Capture terminal state
    const terminalState = await this.terminalManager.captureState(
      workspace.terminalSessionId
    );

    // 3. Stash git changes
    let gitStashRef: string | null = null;
    if (await this.hasUncommittedChanges(workspace.worktreePath)) {
      gitStashRef = await this.stashChanges(
        workspace.worktreePath,
        `superset-pause-${workspaceId}`
      );
    }

    // 4. Save conversation state
    const conversationState = await this.conversationStore.capture(workspaceId);

    // 5. Stop terminal process
    await this.terminalManager.stop(workspace.terminalSessionId);

    // 6. Create pause state
    const pauseState: PauseState = {
      pausedAt: new Date(),
      reason,
      terminalBuffer: terminalState.buffer,
      cursorPosition: terminalState.cursor,
      gitStashRef,
      conversationSummary: conversationState.summary,
      lastAction: conversationState.lastAction,
      pendingTasks: conversationState.pendingTasks,
      isCompacted: false,
      compactedAt: null,
    };

    // 7. Update workspace
    await this.updateWorkspace(workspaceId, {
      status: 'paused',
      pauseState,
    });

    return { success: true, pauseState };
  }

  async resume(workspaceId: string): Promise<ResumeResult> {
    const workspace = await this.getWorkspace(workspaceId);

    if (!workspace.pauseState) {
      return { success: false, error: 'Workspace not paused' };
    }

    const { pauseState } = workspace;

    // 1. Restore git stash if exists
    if (pauseState.gitStashRef) {
      await this.restoreStash(workspace.worktreePath, pauseState.gitStashRef);
    }

    // 2. Create new terminal session
    const terminalSession = await this.terminalManager.create(
      workspace.worktreePath
    );

    // 3. Restore terminal buffer
    if (pauseState.terminalBuffer) {
      await this.terminalManager.writeBuffer(
        terminalSession.id,
        pauseState.terminalBuffer
      );
    }

    // 4. Start Claude Code with context
    const resumePrompt = this.buildResumePrompt(pauseState);
    await this.terminalManager.startClaudeCode(terminalSession.id, {
      initialPrompt: resumePrompt,
      cwd: workspace.worktreePath,
    });

    // 5. Update workspace
    await this.updateWorkspace(workspaceId, {
      status: 'running',
      pauseState: null,
      terminalSessionId: terminalSession.id,
    });

    return { success: true };
  }

  private buildResumePrompt(pauseState: PauseState): string {
    return `
You are resuming a previously paused session.

## Session Context
${pauseState.conversationSummary}

## Last Action
${pauseState.lastAction}

## Pending Tasks
${pauseState.pendingTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

## Instructions
Continue from where we left off. Review the current state and proceed with the next pending task.
    `.trim();
  }
}
```

### Step 3: Add UI Components

```typescript
// Pause button in workspace header
export function WorkspaceActions({ workspaceId }: { workspaceId: string }) {
  const { status, canPause, canResume, pauseState } = useWorkspaceState(workspaceId);
  const { pause, resume } = useWorkspaceActions(workspaceId);
  const [isPausing, setIsPausing] = useState(false);

  const handlePause = async () => {
    setIsPausing(true);
    const result = await pause('user');
    setIsPausing(false);

    if (!result.success) {
      toast.error(`Failed to pause: ${result.error}`);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {status === 'running' && canPause && (
        <Button
          onClick={handlePause}
          variant="outline"
          disabled={isPausing}
        >
          {isPausing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Pausing...
            </>
          ) : (
            <>
              <Pause className="mr-2 h-4 w-4" />
              Pause
            </>
          )}
        </Button>
      )}

      {status === 'paused' && canResume && (
        <Button onClick={resume} variant="default">
          <Play className="mr-2 h-4 w-4" />
          Resume
        </Button>
      )}
    </div>
  );
}

// Paused workspace indicator
export function PausedWorkspaceCard({ workspace }: { workspace: Workspace }) {
  const { pauseState } = workspace;

  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Pause className="h-4 w-4 text-amber-500" />
          <CardTitle>{workspace.name}</CardTitle>
          <Badge variant="outline" className="ml-auto">
            Paused {formatRelative(pauseState.pausedAt)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div>
            <span className="text-sm text-muted-foreground">Last Action:</span>
            <p className="text-sm">{pauseState.lastAction}</p>
          </div>
          {pauseState.pendingTasks.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Pending:</span>
              <ul className="list-disc list-inside text-sm">
                {pauseState.pendingTasks.slice(0, 3).map((task, i) => (
                  <li key={i}>{task}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

### Step 4: Add Keyboard Shortcuts

```typescript
// Add to keyboard shortcuts
const shortcuts = {
  'mod+shift+p': {
    action: 'pause-workspace',
    handler: () => pauseCurrentWorkspace(),
    description: 'Pause current workspace',
  },
  'mod+shift+r': {
    action: 'resume-workspace',
    handler: () => resumeCurrentWorkspace(),
    description: 'Resume current workspace',
  },
};
```

---

## Session Persistence Format

### JSONL Storage (from Mux pattern)

```typescript
// Store conversation as append-only JSONL
// File: ~/.superset/sessions/{workspaceId}/conversation.jsonl

interface ConversationEntry {
  timestamp: string;
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
}

class ConversationStore {
  private filePath: string;

  async append(entry: ConversationEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.filePath, line);
  }

  async read(): Promise<ConversationEntry[]> {
    const content = await fs.readFile(this.filePath, 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          // Self-healing: skip corrupted lines
          return null;
        }
      })
      .filter(Boolean);
  }

  async compact(): Promise<void> {
    const entries = await this.read();

    // Keep last 50 entries, summarize older ones
    if (entries.length <= 50) return;

    const recent = entries.slice(-50);
    const older = entries.slice(0, -50);

    const summary = await this.summarize(older);

    // Write compacted file
    const compactedEntries = [
      { type: 'system', content: `[Compacted History]\n${summary}` },
      ...recent,
    ];

    await fs.writeFile(
      this.filePath,
      compactedEntries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
  }
}
```

---

## AutoYes/Daemon Mode

### Automatic Prompt Acceptance

```typescript
// Auto-accept prompts for fully autonomous execution
interface DaemonModeConfig {
  enabled: boolean;
  autoAcceptPatterns: string[];
  autoRejectPatterns: string[];
  timeout: number;
}

class DaemonMode {
  constructor(private config: DaemonModeConfig) {}

  async handlePrompt(prompt: string): Promise<'accept' | 'reject' | 'manual'> {
    // Check rejection patterns first (safety)
    for (const pattern of this.config.autoRejectPatterns) {
      if (new RegExp(pattern).test(prompt)) {
        return 'reject';
      }
    }

    // Check acceptance patterns
    for (const pattern of this.config.autoAcceptPatterns) {
      if (new RegExp(pattern).test(prompt)) {
        return 'accept';
      }
    }

    // Default: require manual intervention
    return 'manual';
  }
}

// Default patterns
const defaultDaemonConfig: DaemonModeConfig = {
  enabled: false,
  autoAcceptPatterns: [
    'Do you want to proceed\\?',
    'Continue\\?',
    '\\[Y/n\\]',
    'Press Enter to continue',
  ],
  autoRejectPatterns: [
    'delete|remove|rm -rf',  // Dangerous operations
    'force push',
    'drop database',
  ],
  timeout: 30000,
};
```

---

## Benefits for Superset

1. **Resource Management**: Free up system resources when not actively working
2. **Context Switching**: Switch between projects without losing progress
3. **Long-Running Tasks**: Start a task, pause, and resume later
4. **Error Recovery**: Pause/resume can help recover from stuck states
5. **Session Persistence**: Never lose work, even after restarts

## Estimated Implementation Effort

| Component | Effort | Priority |
|-----------|--------|----------|
| PauseManager | 2 weeks | High |
| ResumeManager | 1 week | High |
| ConversationStore (JSONL) | 1 week | High |
| Terminal State Capture | 1 week | Medium |
| UI Components | 1 week | Medium |
| Daemon Mode | 2 weeks | Low |
| Session Compaction | 2 weeks | Low |
| **Total** | **10 weeks** | - |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| State corruption on crash | JSONL append-only format with self-healing |
| Git stash conflicts | Unique stash names, conflict detection on resume |
| Context loss on long pauses | Opportunistic compaction preserves key info |
| Resume prompt confusion | Clear context injection with last action summary |

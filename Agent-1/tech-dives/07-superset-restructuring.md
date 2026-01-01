# Superset Restructuring Recommendations

## Based on Competitive Analysis of 9 AI Coding Agent Tools

## Executive Summary

After analyzing Auto-Claude, Claude Squad, OpenCode, Catnip, Happy, Vibe Kanban, Chorus, Mux, and VibeTunnel, this document provides actionable restructuring recommendations for Superset to strengthen its competitive position and address identified gaps.

---

## Current State Assessment

### Strengths to Preserve

1. **Parallel Agent Execution** - Core differentiator, no competitor matches 10+ agents
2. **Git Worktree Architecture** - Industry-standard isolation approach
3. **Type-Safe IPC** - tRPC via trpc-electron is excellent
4. **Electric SQL Sync** - Unique offline-first capability
5. **Modern Stack** - React 19, TailwindCSS v4, Bun, Turborepo
6. **Monorepo Organization** - Clear separation of apps/packages

### Critical Gaps

1. **No Autonomous Mode** - No AutoYes, no daemon mode, no QA loops
2. **No Pause/Resume** - Can't suspend and restore agent sessions
3. **Vendor Lock-In** - Limited to specific agent CLIs
4. **No Memory System** - No cross-session context retention
5. **Limited Visibility** - No command palette, status hidden in hovers
6. **Basic Terminal** - No recording, no activity indicators

---

## Recommended Roadmap

### Phase 1: Quick Wins (1-2 months)

**Goal**: Improve daily UX without major architectural changes

#### 1.1 Command Palette (Cmd+K)

**Priority**: Critical
**Effort**: 2 weeks

```typescript
// Implement spotlight-style search
interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  category: 'workspace' | 'file' | 'action' | 'setting';
}

// Categories:
// - Workspaces: Switch to, create, delete
// - Files: Recent files, search files
// - Actions: Run agent, commit, push, pull
// - Settings: Toggle theme, open settings
```

**Reference**: Mux, VS Code, Raycast

#### 1.2 Workspace Status Badges

**Priority**: High
**Effort**: 1 week

Show git status directly in workspace tabs:
- Dirty indicator (yellow dot)
- Ahead/behind counts
- Branch name always visible
- Agent status (running/idle/waiting)

**Reference**: Auto-Claude, GitHub Desktop

#### 1.3 Claude Hooks Integration

**Priority**: High
**Effort**: 1 week

Listen to Claude Code's hook events for precise activity tracking:
- Tool execution start/end
- Thinking state
- Waiting for input
- Error states

**Reference**: Catnip

#### 1.4 Cost Tracking Display

**Priority**: Medium
**Effort**: 1 week

Add token/cost counter to workspace header:
- Per-session costs
- Breakdown by model
- Running total in footer

**Reference**: Chorus, Mux, OpenCode

---

### Phase 2: Autonomy Features (2-4 months)

**Goal**: Enable truly hands-off agent operation

#### 2.1 Pause/Resume System

**Priority**: Critical
**Effort**: 4 weeks

Implement session state preservation:
- Serialize terminal state (scrollback + cursor)
- Git stash uncommitted changes
- Save conversation context
- Resume with context injection

**Reference**: Claude Squad

```typescript
interface PauseState {
  pausedAt: Date;
  terminalBuffer: string;
  gitStashRef: string | null;
  conversationSummary: string;
  lastAction: string;
  pendingTasks: string[];
}
```

#### 2.2 AutoYes/Daemon Mode

**Priority**: High
**Effort**: 3 weeks

Enable automatic prompt acceptance:
- Pattern-based auto-accept
- Pattern-based auto-reject (dangerous operations)
- Timeout fallback
- Activity logging

**Reference**: Claude Squad

#### 2.3 QA Loop Integration

**Priority**: Medium
**Effort**: 4 weeks

Add optional QA validation after agent execution:
- Run reviewer agent on changes
- Categorize issues by severity
- Auto-fix critical/major issues
- Report results in UI

**Reference**: Auto-Claude

---

### Phase 3: Provider Abstraction (3-5 months)

**Goal**: Remove vendor lock-in, support multiple AI providers

#### 3.1 Provider Interface

**Priority**: High
**Effort**: 4 weeks

Create unified provider abstraction:
- Anthropic (Claude Code, Claude API)
- OpenAI (Codex, GPT-4)
- Google (Gemini)
- Local (Ollama)

**Reference**: OpenCode (18+ providers), Chorus (8+ providers)

#### 3.2 Model Selector UI

**Priority**: Medium
**Effort**: 2 weeks

Add model picker to workspace:
- Provider tabs
- Model cards with costs
- Per-workspace model selection

#### 3.3 Multi-Model Comparison

**Priority**: Low
**Effort**: 3 weeks

Enable A/B testing responses:
- Send prompt to multiple models
- Side-by-side comparison view
- Select best response

**Reference**: Chorus

---

### Phase 4: Memory System (4-6 months)

**Goal**: Enable agents to learn across sessions

#### 4.1 Knowledge Graph Storage

**Priority**: High
**Effort**: 6 weeks

Implement SQLite-based graph storage:
- Entity extraction from sessions
- Relation mapping
- Vector embeddings for search

**Reference**: Auto-Claude (Graphiti)

#### 4.2 Context Retrieval

**Priority**: High
**Effort**: 4 weeks

Add semantic search for relevant context:
- Query-based retrieval
- Graph traversal expansion
- Relevance ranking

#### 4.3 Session Injection

**Priority**: Medium
**Effort**: 2 weeks

Inject relevant context into new sessions:
- Format context for system prompt
- Add memory UI for inspection
- Allow manual context editing

---

### Phase 5: Multi-Agent Pipeline (6-9 months)

**Goal**: Enable sophisticated autonomous workflows

#### 5.1 Pipeline Orchestrator

**Priority**: Medium
**Effort**: 8 weeks

Implement Planner → Coder → QA → Fixer pipeline:
- Phase state management
- Inter-agent communication
- Progress visualization

**Reference**: Auto-Claude

#### 5.2 Pipeline UI

**Priority**: Medium
**Effort**: 4 weeks

Add pipeline visualization:
- Phase progress indicator
- Subtask dots
- Spec viewer
- QA results panel

#### 5.3 Pipeline Configuration

**Priority**: Low
**Effort**: 2 weeks

Allow customization of pipeline:
- Skip/include phases
- Model selection per phase
- Custom prompts per phase

---

## Architecture Changes

### Recommended Directory Structure

```
apps/desktop/src/
├── main/
│   ├── lib/
│   │   ├── workspace/           # Workspace management
│   │   │   ├── manager.ts
│   │   │   ├── pause-manager.ts     # NEW: Pause/resume
│   │   │   └── session-recorder.ts  # NEW: Recording
│   │   ├── providers/           # NEW: AI providers
│   │   │   ├── registry.ts
│   │   │   ├── anthropic.ts
│   │   │   ├── openai.ts
│   │   │   └── ...
│   │   ├── memory/              # NEW: Memory system
│   │   │   ├── store.ts
│   │   │   ├── analyzer.ts
│   │   │   └── retriever.ts
│   │   ├── pipeline/            # NEW: Multi-agent pipeline
│   │   │   ├── orchestrator.ts
│   │   │   ├── planner.ts
│   │   │   ├── coder.ts
│   │   │   └── qa-reviewer.ts
│   │   └── terminal/
│   │       ├── manager.ts
│   │       └── hooks-listener.ts    # NEW: Claude hooks
│   └── ipc/
├── renderer/
│   ├── components/
│   │   ├── CommandPalette/      # NEW
│   │   ├── CostTracker/         # NEW
│   │   ├── ActivityIndicator/   # NEW
│   │   ├── PipelineView/        # NEW
│   │   └── MemoryView/          # NEW
│   └── stores/
│       ├── providers-store.ts   # NEW
│       ├── memory-store.ts      # NEW
│       └── pipeline-store.ts    # NEW
└── shared/
    └── types/
        ├── providers.ts         # NEW
        ├── memory.ts            # NEW
        └── pipeline.ts          # NEW
```

### State Management Evolution

**Current**: Simple Zustand stores

**Recommended**: Layered store architecture

```typescript
// Layer 1: Domain stores (pure data)
const workspaceStore = create<WorkspaceState>(...);
const providerStore = create<ProviderState>(...);
const memoryStore = create<MemoryState>(...);

// Layer 2: MapStore for instances (per-workspace)
const workspaceStores = new Map<string, WorkspaceStore>();

// Layer 3: Derived selectors (computed values)
const useWorkspaceStatus = (id: string) => {
  const workspace = useWorkspaceStore(id);
  const provider = useProviderStore();
  const memory = useMemoryStore();

  return useMemo(() => ({
    ...workspace,
    providerName: provider.getProviderName(workspace.providerId),
    memoryContext: memory.getContext(workspace.projectPath),
  }), [workspace, provider, memory]);
};
```

---

## UI/UX Improvements

### Information Architecture

**Current**:
```
TopBar
├── Workspace Tabs (hidden status)
└── Settings

WorkspaceView
├── Sidebar (Changes, Git Tree, Tasks)
└── Content (Terminal, Diff Viewer)
```

**Recommended**:
```
TopBar
├── Command Palette Trigger
├── Workspace Tabs (visible status badges)
├── Cost Tracker
└── Settings

WorkspaceView
├── Activity Bar (left edge, icon-only)
│   ├── Terminal
│   ├── Changes
│   ├── Memory
│   ├── Pipeline
│   └── Settings
├── Sidebar (collapsible)
│   └── Context-specific content
└── Content
    ├── Tabs (Terminal, Diff, etc.)
    └── Bottom Panel (Problems, Output, Memory)
```

### Keyboard Navigation

**Additions**:
| Shortcut | Action |
|----------|--------|
| Cmd+K | Open command palette |
| Cmd+Shift+P | Pause current workspace |
| Cmd+Shift+R | Resume workspace |
| Cmd+Shift+E | Toggle explorer |
| Cmd+Shift+G | Toggle git changes |
| Cmd+Shift+M | Toggle memory panel |
| Cmd+J | Toggle bottom panel |

### Accessibility Improvements

1. **Focus management**: Trap focus in modals, restore on close
2. **Screen reader support**: Add aria-live regions for status changes
3. **Color contrast**: Audit all text/background combinations
4. **Keyboard navigation**: Ensure all actions have keyboard equivalents

---

## Technical Debt to Address

### High Priority

1. **Terminal.tsx (453 lines)** - Extract hooks and sub-components
2. **tabs/store.ts (450+ lines)** - Split into TabHistory, TabLayout, PaneManager
3. **Deep component nesting** - Flatten where possible (max 4 levels)
4. **No error boundaries** - Add to all screen-level components

### Medium Priority

1. **No Storybook** - Add component documentation
2. **Inconsistent modal patterns** - Standardize on Dialog component
3. **Missing loading states** - Add skeleton loaders
4. **Limited animation** - Add consistent Motion patterns

### Low Priority

1. **No component tests** - Add unit tests for UI components
2. **No E2E tests** - Add Playwright tests for critical flows
3. **Bundle size optimization** - Lazy load heavy components

---

## Resource Estimates

### Team Composition (Recommended)

- **1 Senior Frontend Engineer** - Architecture, complex features
- **1 Mid Frontend Engineer** - UI components, polish
- **1 Backend/Systems Engineer** - Provider integration, memory system
- **0.5 Designer** - UX improvements, design system

### Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Quick Wins | 2 months | None |
| Phase 2: Autonomy | 3 months | Phase 1 |
| Phase 3: Providers | 3 months | Phase 1 |
| Phase 4: Memory | 4 months | Phase 2 |
| Phase 5: Pipeline | 4 months | Phases 2-4 |

**Total**: 12-16 months for full implementation

### Cost Estimates (Rough)

| Item | Monthly | Annual |
|------|---------|--------|
| Engineering (2.5 FTE) | $50-80K | $600K-1M |
| Design (0.5 FTE) | $10-15K | $120-180K |
| Infrastructure | $2-5K | $24-60K |
| AI API costs (dev) | $1-3K | $12-36K |
| **Total** | **$63-103K** | **$756K-1.3M** |

---

## Success Metrics

### Phase 1
- Command palette usage > 50% of users
- Workspace status visibility complaints reduced 80%
- Cost tracking active for 70% of sessions

### Phase 2
- Pause/resume used by 30% of users
- AutoYes mode enabled for 20% of workspaces
- Session duration increased 2x (users can leave and return)

### Phase 3
- 3+ providers configured by 40% of users
- Model switching used in 20% of sessions
- Vendor lock-in complaints eliminated

### Phase 4
- Memory system enabled for 50% of projects
- Context retrieval improves agent accuracy by 15%
- User-reported "agent doesn't understand my project" reduced 60%

### Phase 5
- Pipeline mode used for 30% of complex tasks
- QA loop catches 80% of obvious issues
- Autonomous completion rate increased 40%

---

## Conclusion

Superset has a strong foundation with its parallel execution model and modern architecture. The recommended restructuring focuses on:

1. **Immediate UX improvements** (command palette, status visibility)
2. **Autonomy features** (pause/resume, AutoYes, QA loops)
3. **Provider flexibility** (multi-provider support)
4. **Long-term intelligence** (memory system, pipelines)

By executing this roadmap, Superset can evolve from a **parallel agent runner** to a **comprehensive AI development platform** that:
- Removes vendor lock-in
- Enables truly autonomous operation
- Learns and improves over time
- Provides best-in-class visibility and control

The key differentiator—**10+ parallel agents**—should be enhanced, not replaced. All new features should complement the parallel execution model, making it even more powerful and accessible.

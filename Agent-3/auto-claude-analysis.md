# Auto-Claude Technical Deep Dive & Integration Analysis

## Executive Summary

Auto-Claude is a sophisticated autonomous AI coding agent system with a Python backend + Electron frontend architecture. It uses a phase-based execution pipeline, Graphiti memory integration, and git worktree isolation. This analysis identifies key architectural patterns and integration opportunities for Superset.

---

## Auto-Claude Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Frontend (TypeScript)                │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ Agent Manager │  │ Phase Parser  │  │ IPC Communication │   │
│  │ (Singleton)   │  │ (Zod Schema)  │  │ (Type-Safe)       │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Subprocess + stdout/stderr streaming)
┌─────────────────────────────────────────────────────────────────┐
│                    Python Backend (Agent System)                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ Spec Runner   │  │ Agent Runner  │  │ Memory Manager    │   │
│  │ (Orchestrator)│  │ (Claude SDK)  │  │ (Graphiti/File)   │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ Planner Agent │  │ Coder Agent   │  │ QA Agents         │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Frontend Agent Manager (`apps/frontend/src/main/agent/`)

**Files:**
- `agent-manager.ts` - Singleton process manager
- `agent-process.ts` - Subprocess wrapper for Python agents
- `agent-state.ts` - Type-safe state machine with Zod validation
- `phase-event-schema.ts` - Strongly-typed phase event parsing

**Key Pattern - Singleton Process Manager:**
```typescript
// Auto-Claude uses a singleton pattern for managing agent processes
class AgentManager {
  private static instance: AgentManager;
  private currentProcess: AgentProcess | null = null;
  private eventEmitter = new EventEmitter();

  private constructor() {}

  static getInstance(): AgentManager {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }
}
```

**Phase Event Streaming:**
Auto-Claude parses structured JSON events from stdout:
```typescript
// Phase event schema with Zod
const PhaseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phase_start'), phase: z.string(), ... }),
  z.object({ type: z.literal('phase_complete'), phase: z.string(), success: z.boolean() }),
  z.object({ type: z.literal('agent_message'), content: z.string() }),
  // ... more event types
]);
```

#### 2. Backend Agent System (`apps/backend/`)

**Core Files:**
- `core/client.py` - Claude SDK integration with retry logic
- `agents/planner.py` - Task planning and decomposition
- `agents/coder.py` - Code generation agent
- `agents/memory_manager.py` - Dual-layer memory (Graphiti + file-based)
- `runners/spec_runner.py` - Main orchestrator
- `spec/pipeline/orchestrator.py` - Phase execution pipeline

**Claude SDK Integration:**
```python
# Auto-Claude wraps claude-agent-sdk with retry logic and error handling
from claude_agent_sdk import Agent, create_sdk_mcp_server

class CoderAgent:
    def __init__(self, spec_dir, project_dir, model, thinking_level):
        self.agent = Agent(
            model=model,
            thinking_budget=get_thinking_budget(thinking_level),
            tools=create_all_tools(spec_dir, project_dir),
        )
```

---

## Phase-Based Execution Model

### Complexity Tiers

Auto-Claude dynamically selects phases based on task complexity:

| Complexity | Phases | Files Typically Affected |
|------------|--------|-------------------------|
| **SIMPLE** | 3 | 1-2 files |
| **STANDARD** | 6 | 3-10 files |
| **COMPLEX** | 8 | 10+ files/integrations |

### Phase Pipeline

```
SIMPLE:     Discovery → Quick Spec → Validate
STANDARD:   Discovery → Requirements → Context → Spec → Plan → Validate
COMPLEX:    Discovery → Requirements → Research → Context → Spec →
            Self-Critique → Plan → Validate
```

### Phase Execution Flow

```python
# From spec/pipeline/orchestrator.py
class SpecOrchestrator:
    async def run(self, interactive=True, auto_approve=False):
        # Phase 1: Discovery
        result = await run_phase("discovery", phase_executor.phase_discovery)
        await self._store_phase_summary("discovery")  # Compaction

        # Phase 2: Requirements
        result = await run_phase("requirements",
            lambda: phase_executor.phase_requirements(interactive))

        # Phase 3: AI Complexity Assessment
        self.assessment = await complexity.run_ai_complexity_assessment(...)

        # Dynamic phases based on complexity
        for phase_name in self.assessment.phases_to_run():
            result = await run_phase(phase_name, all_phases[phase_name])
            await self._store_phase_summary(phase_name)
```

### Conversation Compaction

Auto-Claude summarizes completed phases to manage context:
```python
async def _store_phase_summary(self, phase_name: str):
    phase_output = gather_phase_outputs(self.spec_dir, phase_name)
    summary = await summarize_phase_output(
        phase_name, phase_output,
        model="claude-sonnet-4-5-20250929",
        target_words=500
    )
    self._phase_summaries[phase_name] = summary
```

---

## Memory Management

### Dual-Layer Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Memory Manager                     │
│  ┌───────────────────────┐ ┌─────────────────────┐ │
│  │ PRIMARY: Graphiti     │ │ FALLBACK: File-based│ │
│  │ - Semantic search     │ │ - Zero dependencies │ │
│  │ - Cross-session ctx   │ │ - JSON files        │ │
│  │ - Knowledge graph     │ │ - Always available  │ │
│  └───────────────────────┘ └─────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Graphiti Integration

```python
# From agents/memory_manager.py
async def get_graphiti_context(spec_dir, project_dir, subtask):
    memory = GraphitiMemory(spec_dir, project_dir)

    # Search knowledge graph
    context_items = await memory.get_relevant_context(query, num_results=5)
    session_history = await memory.get_session_history(limit=3)

    return format_context(context_items, session_history)
```

### Session Insights Structure

```python
insights = {
    "subtasks_completed": [...],
    "discoveries": {
        "files_understood": {},
        "patterns_found": [],
        "gotchas_encountered": [],
    },
    "what_worked": [...],
    "what_failed": [...],
    "recommendations_for_next_session": [],
}
```

---

## Tool Registry System

Auto-Claude creates custom MCP tools per-session:

```python
# From agents/tools_pkg/registry.py
def create_all_tools(spec_dir: Path, project_dir: Path) -> list:
    all_tools = []
    all_tools.extend(create_subtask_tools(spec_dir, project_dir))
    all_tools.extend(create_progress_tools(spec_dir, project_dir))
    all_tools.extend(create_memory_tools(spec_dir, project_dir))
    all_tools.extend(create_qa_tools(spec_dir, project_dir))
    return all_tools

def create_auto_claude_mcp_server(spec_dir, project_dir):
    tools = create_all_tools(spec_dir, project_dir)
    return create_sdk_mcp_server(name="auto-claude", version="1.0.0", tools=tools)
```

---

## Comparison with Superset Desktop

### Architecture Comparison

| Aspect | Auto-Claude | Superset |
|--------|-------------|----------|
| **Frontend** | Electron (TypeScript) | Electron (TypeScript) |
| **Backend** | Python (subprocess) | Node.js (same process) |
| **IPC** | stdout/stderr streaming | tRPC (type-safe) |
| **Agent System** | Custom Python agents | Claude Code CLI wrapper |
| **Memory** | Graphiti + file-based | None (relies on Claude Code) |
| **Worktrees** | Git worktree isolation | Git worktree isolation |
| **State** | Zod + EventEmitter | Zustand + tRPC subscriptions |

### Superset's Current Architecture

```typescript
// Terminal management - similar to Auto-Claude's agent management
export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();

  async createOrAttach(params: CreateSessionParams): Promise<SessionResult> {
    // Deduplication, session recovery, scrollback management
  }
}

// Workspace/worktree management via tRPC
const createWorkspacesRouter = () => router({
  create: publicProcedure
    .input(z.object({ projectId: z.string(), ... }))
    .mutation(async ({ input }) => {
      await createWorktree(project.mainRepoPath, branch, worktreePath, startPoint);
      // DB operations, analytics tracking
    }),
});
```

---

## Integration Recommendations

### High-Value Features to Adopt

#### 1. Phase-Based Task Execution (Priority: HIGH)

**Why:** Auto-Claude's complexity-aware phase system produces better results for complex tasks.

**Integration Approach:**
```typescript
// Create a TaskOrchestrator that wraps Claude Code
interface TaskPhase {
  name: string;
  prompt: string;
  tools: string[];
}

const COMPLEXITY_TIERS = {
  simple: ['execute'],
  standard: ['plan', 'execute', 'validate'],
  complex: ['discover', 'plan', 'research', 'execute', 'review', 'validate'],
};

class TaskOrchestrator {
  async assessComplexity(task: string): Promise<ComplexityTier> {
    // Use Claude to assess task complexity
  }

  async executeWithPhases(task: string, tier: ComplexityTier) {
    for (const phase of COMPLEXITY_TIERS[tier]) {
      await this.executePhase(phase, task);
      await this.storePhaseContext(phase);
    }
  }
}
```

#### 2. Memory/Context Management (Priority: HIGH)

**Why:** Cross-session context improves agent performance significantly.

**Integration Approach:**
```typescript
// Add to Superset's local-db package
interface SessionInsight {
  workspaceId: string;
  taskId: string;
  filesUnderstood: Record<string, string>;
  patternsFound: string[];
  gotchasEncountered: string[];
  recommendations: string[];
  timestamp: number;
}

// Create a ContextManager service
class ContextManager {
  async getRelevantContext(workspaceId: string, task: string): Promise<string> {
    const insights = await db.query.sessionInsights.findMany({
      where: eq(sessionInsights.workspaceId, workspaceId),
      orderBy: desc(sessionInsights.timestamp),
      limit: 5,
    });
    return this.formatContext(insights);
  }

  async saveSessionInsights(insight: SessionInsight) {
    await db.insert(sessionInsights).values(insight);
  }
}
```

#### 3. Phase Event Streaming (Priority: MEDIUM)

**Why:** Real-time progress updates improve UX for long-running tasks.

**Integration Approach:**
```typescript
// Extend tRPC with phase event subscriptions
export const createTaskRouter = () => router({
  executeTask: publicProcedure
    .input(z.object({ workspaceId: z.string(), task: z.string() }))
    .subscription(() => {
      return observable<PhaseEvent>((emit) => {
        const orchestrator = new TaskOrchestrator();
        orchestrator.on('phase', (event) => emit.next(event));
        orchestrator.execute(input.task);
        return () => orchestrator.abort();
      });
    }),
});
```

#### 4. Conversation Compaction (Priority: MEDIUM)

**Why:** Allows handling larger tasks without hitting context limits.

**Integration Approach:**
```typescript
interface PhaseContext {
  phase: string;
  summary: string;  // Compact representation
  keyFiles: string[];
  decisions: string[];
}

class ConversationCompactor {
  async summarizePhase(phaseOutput: string): Promise<string> {
    // Use Haiku for efficient summarization
    const summary = await claude.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Summarize this phase output in 200 words: ${phaseOutput}`
      }]
    });
    return summary.content[0].text;
  }
}
```

### Lower Priority Features

#### 5. Custom Tool Registry (Priority: LOW)

Auto-Claude creates per-task MCP tools. Superset already has Claude Code's built-in tools, but could extend with project-specific tools:

```typescript
// Example: Project-aware tools
const projectTools = {
  runTests: async (pattern: string) => {
    const config = await loadProjectConfig(workspace.path);
    return spawn(config.testCommand, [pattern]);
  },
  lint: async () => {
    const config = await loadProjectConfig(workspace.path);
    return spawn(config.lintCommand);
  },
};
```

#### 6. AI Complexity Assessment (Priority: LOW)

Could be useful but adds latency. Consider using heuristics first:

```typescript
function assessComplexityHeuristic(task: string, context: ProjectContext): ComplexityTier {
  const taskLength = task.length;
  const mentionsMultipleFiles = /files?|components?|modules?/gi.test(task);
  const mentionsIntegration = /api|database|auth|integration/gi.test(task);

  if (taskLength < 100 && !mentionsMultipleFiles) return 'simple';
  if (mentionsIntegration) return 'complex';
  return 'standard';
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Recommended First)

1. **Session Insights Table**
   - Add `session_insights` table to local-db
   - Create CRUD operations

2. **Context Manager Service**
   - Retrieve relevant past insights
   - Format for Claude Code injection

3. **Post-Task Hook**
   - Extract and save insights after task completion

### Phase 2: Phase System

1. **Task Orchestrator**
   - Wrap Claude Code execution
   - Implement phase transitions

2. **Phase Event Streaming**
   - tRPC subscription for progress
   - UI progress indicator

3. **Conversation Compaction**
   - Summarize between phases
   - Inject summaries into context

### Phase 3: Advanced Features

1. **AI Complexity Assessment**
   - Use Claude to assess tasks
   - Cache assessments

2. **Custom Project Tools**
   - Config-driven tool injection
   - Project-specific commands

---

## Key Takeaways

1. **Auto-Claude's strength is structured execution** - The phase-based pipeline with complexity tiers produces consistent results for various task sizes.

2. **Memory is crucial for multi-session work** - Graphiti integration shows significant value for projects worked on over multiple sessions.

3. **Superset already has strong foundations** - Git worktree isolation, terminal management, and tRPC are well-implemented. Build on these.

4. **Start with context management** - Adding session insights storage and retrieval would provide immediate value with minimal architectural changes.

5. **Phase system can be layered on** - Don't need full Auto-Claude architecture. A simpler phase wrapper around Claude Code would capture 80% of the benefit.

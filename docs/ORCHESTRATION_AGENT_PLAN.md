# Orchestration Agent Architecture Plan

A top-level orchestration agent that coordinates multiple sub-agents, integrates with external services (Linear, GitHub), and provides a unified chat interface for task management and code assistance.

---

## Executive Summary

Build an orchestration layer powered by Claude Opus 4.5 that:
- Runs as a sidebar chat panel in the desktop app
- Coordinates multiple concurrent agent tasks
- Pulls context from running terminal agents (Claude Code, OpenCode, Codex)
- Integrates with Linear for task management
- Uses Vercel AI SDK for streaming and tool calling

---

## Phase 1: Foundation (Chat Panel + Basic AI)

**Goal**: Enable the chat sidebar and connect it to Claude Opus 4.5 via Vercel AI SDK.

### Milestone 1.1: Re-enable Chat Panel UI

**Files to modify**:
- `apps/desktop/src/renderer/stores/index.ts` - Export chat panel store
- `apps/desktop/src/shared/hotkeys.ts` - Add `TOGGLE_CHAT_PANEL` hotkey
- `apps/desktop/src/renderer/screens/main/components/TopBar/index.tsx` - Add toggle button
- `apps/desktop/src/renderer/screens/main/index.tsx` - Add hotkey handler
- `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/index.tsx` - Integrate resizable chat panel

**Implementation**:
```typescript
// hotkeys.ts addition
TOGGLE_CHAT_PANEL: defineHotkey({
  keys: "meta+l",
  label: "Toggle Chat Panel",
  category: "Layout",
}),
```

**Existing resources**:
- `apps/desktop/docs/CHAT_PANEL_FEATURE.md` - Step-by-step re-enable guide
- `apps/desktop/src/renderer/stores/chat-panel-state.ts` - Ready-to-use Zustand store
- `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/ChatPanel/` - Existing panel component

### Milestone 1.2: Build Chat Interface

**New components** (co-located under `TabsContent/ChatPanel/`):
```
ChatPanel/
├── ChatPanel.tsx              # Main container
├── index.ts                   # Barrel export
├── components/
│   ├── ChatMessages/          # Message list using @superset/ui/ai-elements
│   │   ├── ChatMessages.tsx
│   │   └── index.ts
│   ├── ChatInput/             # Input using PromptInput components
│   │   ├── ChatInput.tsx
│   │   └── index.ts
│   └── AgentStatus/           # Shows orchestrator + sub-agent status
│       ├── AgentStatus.tsx
│       └── index.ts
├── hooks/
│   └── useChat/
│       ├── useChat.ts         # Local chat state management
│       └── index.ts
└── stores/
    └── chatStore/
        ├── chatStore.ts       # Conversation history, pending messages
        └── index.ts
```

**Use existing AI elements**:
```typescript
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  Message,
  MessageContent,
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@superset/ui/ai-elements";
```

### Milestone 1.3: Connect to Claude Opus 4.5

**New tRPC router**: `apps/desktop/src/lib/trpc/routers/orchestrator/`

```typescript
// orchestrator/index.ts
import { router, publicProcedure } from "../../trpc";
import { observable } from "@trpc/server/observable";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const createOrchestratorRouter = () => {
  return router({
    // Send message and stream response
    chat: publicProcedure
      .input(z.object({
        messages: z.array(messageSchema),
        workspaceId: z.string(),
        context: z.object({
          taskId: z.string().optional(),
          files: z.array(z.string()).optional(),
        }).optional(),
      }))
      .subscription(({ input }) => {
        return observable<{ type: "delta" | "done"; content?: string }>((emit) => {
          const runStream = async () => {
            const { textStream } = await streamText({
              model: anthropic("claude-opus-4-5-20251101"),
              messages: input.messages,
              system: buildSystemPrompt(input.context),
            });

            for await (const delta of textStream) {
              emit.next({ type: "delta", content: delta });
            }
            emit.next({ type: "done" });
          };

          runStream().catch((err) => {
            console.error("[orchestrator/chat] Stream error:", err);
            emit.error(err);
          });

          return () => {
            // Cleanup if needed
          };
        });
      }),

    // Get conversation history
    getHistory: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(async ({ input }) => {
        // Return stored conversation for workspace
        return [];
      }),
  });
};
```

**Environment setup**:
- Add `ANTHROPIC_API_KEY` to `.env`
- Install `@ai-sdk/anthropic` if not present

---

## Phase 2: Agent Orchestration

**Goal**: Enable the orchestrator to spawn, monitor, and coordinate sub-agents.

### Milestone 2.1: Agent Registry

Track all running agents across terminals/panes.

**New store**: `apps/desktop/src/renderer/stores/agentRegistry/`

```typescript
// agentRegistry.ts
interface AgentInstance {
  id: string;
  paneId: string;
  type: "claude" | "opencode" | "codex" | "custom";
  status: "idle" | "working" | "permission" | "review";
  currentTask?: string;
  startedAt: Date;
  context: {
    workspaceId: string;
    cwd: string;
    task?: TaskReference;
  };
}

interface AgentRegistryState {
  agents: Map<string, AgentInstance>;

  // Actions
  registerAgent: (agent: AgentInstance) => void;
  updateAgentStatus: (id: string, status: AgentInstance["status"]) => void;
  setAgentTask: (id: string, task: string) => void;
  unregisterAgent: (id: string) => void;

  // Queries
  getAgentsByWorkspace: (workspaceId: string) => AgentInstance[];
  getActiveAgents: () => AgentInstance[];
}
```

**Integration with existing hooks**:
Extend `apps/desktop/src/renderer/stores/tabs/useAgentHookListener.ts` to populate the registry:

```typescript
// In useAgentHookListener
if (event.type === NOTIFICATION_EVENTS.AGENT_LIFECYCLE) {
  const { eventType, paneId, agentType } = event.data;

  if (eventType === "Start") {
    agentRegistry.registerAgent({
      id: generateId(),
      paneId,
      type: agentType,
      status: "working",
      startedAt: new Date(),
      context: { workspaceId, cwd },
    });
  }
  // ... handle other events
}
```

### Milestone 2.2: Context Aggregation

Pull context from running agents to inform orchestrator decisions.

**New service**: `apps/desktop/src/main/lib/context-aggregator/`

```typescript
// context-aggregator/index.ts
interface AggregatedContext {
  workspace: {
    id: string;
    path: string;
    branch: string;
    recentFiles: string[];
  };
  agents: {
    id: string;
    type: string;
    recentOutput: string;  // Last N lines
    currentTask: string;
  }[];
  tasks: {
    active: TaskSummary[];
    recent: TaskSummary[];
  };
  git: {
    status: string;
    recentCommits: string[];
    changedFiles: string[];
  };
}

export class ContextAggregator {
  async aggregate(workspaceId: string): Promise<AggregatedContext> {
    const [workspace, agents, tasks, git] = await Promise.all([
      this.getWorkspaceContext(workspaceId),
      this.getAgentContext(workspaceId),
      this.getTaskContext(workspaceId),
      this.getGitContext(workspaceId),
    ]);

    return { workspace, agents, tasks, git };
  }

  private async getAgentContext(workspaceId: string) {
    // Read recent terminal output from active agent panes
    const agents = agentRegistry.getAgentsByWorkspace(workspaceId);
    return Promise.all(agents.map(async (agent) => ({
      id: agent.id,
      type: agent.type,
      recentOutput: await terminalManager.getRecentOutput(agent.paneId, 50),
      currentTask: agent.currentTask || "Unknown",
    })));
  }
}
```

### Milestone 2.3: Sub-Agent Spawning

Allow orchestrator to spawn new agent instances.

**tRPC procedures**:
```typescript
// orchestrator/agents.ts
spawnAgent: publicProcedure
  .input(z.object({
    workspaceId: z.string(),
    agentType: z.enum(["claude", "opencode", "codex"]),
    task: z.string(),
    splitDirection: z.enum(["vertical", "horizontal"]).optional(),
  }))
  .mutation(async ({ input }) => {
    const { tabId } = await createNewPane({
      workspaceId: input.workspaceId,
      type: "terminal",
      initialCommands: [
        buildAgentCommand(input.agentType, input.task),
      ],
    });

    return { tabId, paneId };
  }),

// Build command based on agent type
function buildAgentCommand(type: string, task: string): string {
  const escapedTask = task.replace(/"/g, '\\"');
  switch (type) {
    case "claude":
      return `claude "${escapedTask}"`;
    case "opencode":
      return `opencode "${escapedTask}"`;
    case "codex":
      return `codex "${escapedTask}"`;
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}
```

### Milestone 2.4: Inter-Agent Communication

Enable orchestrator to read from and write to sub-agents.

**Terminal integration**:
```typescript
// Add to terminal router
sendToTerminal: publicProcedure
  .input(z.object({
    paneId: z.string(),
    text: z.string(),
  }))
  .mutation(async ({ input }) => {
    await terminalManager.write(input.paneId, input.text);
    return { success: true };
  }),

getTerminalOutput: publicProcedure
  .input(z.object({
    paneId: z.string(),
    lines: z.number().default(100),
  }))
  .query(async ({ input }) => {
    return terminalManager.getRecentOutput(input.paneId, input.lines);
  }),
```

---

## Phase 3: Tool Calling & Actions

**Goal**: Give the orchestrator tools to interact with the system.

### Milestone 3.1: Define Orchestrator Tools

**Tools schema** (Vercel AI SDK format):

```typescript
// orchestrator/tools.ts
import { tool } from "ai";
import { z } from "zod";

export const orchestratorTools = {
  // Task management
  createTask: tool({
    description: "Create a new task in the current workspace",
    parameters: z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      labels: z.array(z.string()).optional(),
    }),
    execute: async ({ title, description, priority, labels }) => {
      const task = await apiClient.task.create.mutate({
        title,
        description,
        priority,
        labels,
        organizationId: getCurrentOrgId(),
      });
      return { taskId: task.id, slug: task.slug };
    },
  }),

  // Agent spawning
  spawnAgent: tool({
    description: "Spawn a sub-agent to work on a specific task",
    parameters: z.object({
      agentType: z.enum(["claude", "opencode", "codex"]),
      task: z.string().describe("The task or prompt for the agent"),
      background: z.boolean().default(false),
    }),
    execute: async ({ agentType, task, background }) => {
      const result = await trpc.orchestrator.spawnAgent.mutate({
        workspaceId: getCurrentWorkspaceId(),
        agentType,
        task,
      });
      return { paneId: result.paneId, spawned: true };
    },
  }),

  // File operations
  readFile: tool({
    description: "Read contents of a file in the workspace",
    parameters: z.object({
      path: z.string(),
      lines: z.number().optional(),
    }),
    execute: async ({ path, lines }) => {
      const content = await fs.readFile(path, "utf-8");
      if (lines) {
        return content.split("\n").slice(0, lines).join("\n");
      }
      return content;
    },
  }),

  // Git operations
  gitStatus: tool({
    description: "Get git status of the current workspace",
    parameters: z.object({}),
    execute: async () => {
      const result = await exec("git status --porcelain");
      return result.stdout;
    },
  }),

  // Linear integration
  syncFromLinear: tool({
    description: "Pull latest tasks from Linear",
    parameters: z.object({
      teamId: z.string().optional(),
    }),
    execute: async ({ teamId }) => {
      const tasks = await apiClient.integration.linear.sync.mutate({ teamId });
      return { synced: tasks.length, tasks };
    },
  }),

  pushToLinear: tool({
    description: "Create or update a task in Linear",
    parameters: z.object({
      taskId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
    }),
    execute: async (params) => {
      const result = await apiClient.integration.linear.push.mutate(params);
      return result;
    },
  }),

  // Context gathering
  getWorkspaceContext: tool({
    description: "Get comprehensive context about the current workspace",
    parameters: z.object({
      include: z.array(z.enum(["git", "tasks", "agents", "files"])).optional(),
    }),
    execute: async ({ include }) => {
      const context = await contextAggregator.aggregate(getCurrentWorkspaceId());
      // Filter based on include array
      return context;
    },
  }),

  // Agent communication
  askAgent: tool({
    description: "Send a message to a running sub-agent and wait for response",
    parameters: z.object({
      agentId: z.string(),
      message: z.string(),
    }),
    execute: async ({ agentId, message }) => {
      const agent = agentRegistry.get(agentId);
      if (!agent) throw new Error("Agent not found");

      await terminalManager.write(agent.paneId, message + "\n");
      // Wait for response (with timeout)
      const response = await waitForAgentResponse(agent.paneId, 30000);
      return { response };
    },
  }),
};
```

### Milestone 3.2: Tool Execution Pipeline

**Stream with tools**:
```typescript
// Enhanced chat subscription
chat: publicProcedure
  .input(chatInputSchema)
  .subscription(({ input }) => {
    return observable<ChatEvent>((emit) => {
      const runStream = async () => {
        const context = await contextAggregator.aggregate(input.workspaceId);

        const { textStream, toolCalls } = await streamText({
          model: anthropic("claude-opus-4-5-20251101"),
          messages: input.messages,
          system: buildSystemPrompt(context),
          tools: orchestratorTools,
          maxSteps: 10,  // Allow multi-step tool use
          onStepFinish: ({ toolCalls, toolResults }) => {
            // Emit tool execution events for UI
            for (const call of toolCalls) {
              emit.next({
                type: "tool_call",
                tool: call.toolName,
                args: call.args,
              });
            }
            for (const result of toolResults) {
              emit.next({
                type: "tool_result",
                tool: result.toolName,
                result: result.result,
              });
            }
          },
        });

        for await (const delta of textStream) {
          emit.next({ type: "delta", content: delta });
        }
        emit.next({ type: "done" });
      };

      runStream().catch((err) => emit.error(err));
      return () => {};
    });
  }),
```

### Milestone 3.3: Tool UI Components

Display tool calls in chat using existing components.

```typescript
// ChatMessages.tsx
import { Tool, ToolContent, ToolHeader } from "@superset/ui/ai-elements";

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  return (
    <Tool>
      <ToolHeader>
        <ToolIcon name={toolCall.toolName} />
        <span>{toolCall.toolName}</span>
      </ToolHeader>
      <ToolContent>
        {toolCall.status === "pending" && <Loader />}
        {toolCall.status === "complete" && (
          <ToolResult result={toolCall.result} />
        )}
        {toolCall.status === "error" && (
          <ToolError error={toolCall.error} />
        )}
      </ToolContent>
    </Tool>
  );
}
```

---

## Phase 4: Linear Integration

**Goal**: Deep integration with Linear for task management.

### Milestone 4.1: Bidirectional Task Sync

**Enhance existing Linear router** (`packages/trpc/src/router/integration/linear/`):

```typescript
// Add to linear.ts
syncTasks: protectedProcedure
  .input(z.object({
    organizationId: z.uuid(),
    direction: z.enum(["pull", "push", "both"]).default("both"),
    filter: z.object({
      teamId: z.string().optional(),
      assigneeId: z.string().optional(),
      status: z.array(z.string()).optional(),
    }).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const client = await getLinearClient(input.organizationId);
    if (!client) throw new TRPCError({ code: "NOT_FOUND" });

    if (input.direction === "pull" || input.direction === "both") {
      await pullFromLinear(client, input.organizationId, input.filter);
    }

    if (input.direction === "push" || input.direction === "both") {
      await pushToLinear(client, input.organizationId);
    }

    return { success: true };
  }),

// Get tasks assigned to current user
getMyTasks: protectedProcedure
  .input(z.object({ organizationId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const client = await getLinearClient(input.organizationId);
    if (!client) return [];

    const me = await client.viewer;
    const issues = await me.assignedIssues({
      filter: { state: { type: { nin: ["completed", "canceled"] } } },
    });

    return issues.nodes.map(issue => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      state: issue.state,
      url: issue.url,
    }));
  }),
```

### Milestone 4.2: Task Context in Orchestrator

Feed Linear task context into orchestrator prompts:

```typescript
// System prompt builder
function buildSystemPrompt(context: AggregatedContext): string {
  const sections = [
    `# Current Workspace
Path: ${context.workspace.path}
Branch: ${context.workspace.branch}`,
  ];

  if (context.tasks.active.length > 0) {
    sections.push(`
# Active Tasks
${context.tasks.active.map(t => `- [${t.identifier}] ${t.title} (${t.status})`).join("\n")}
`);
  }

  if (context.agents.length > 0) {
    sections.push(`
# Running Agents
${context.agents.map(a => `- ${a.type} (${a.id}): ${a.currentTask}`).join("\n")}
`);
  }

  sections.push(`
# Available Tools
You can use tools to:
- Create and manage tasks (createTask, updateTask)
- Spawn sub-agents to work on code (spawnAgent)
- Read files and git status (readFile, gitStatus)
- Sync with Linear (syncFromLinear, pushToLinear)
- Query running agents (askAgent, getAgentStatus)

When the user asks you to work on something, prefer spawning specialized agents rather than doing everything yourself.
`);

  return sections.join("\n\n");
}
```

### Milestone 4.3: Task Assignment Flow

Workflow for assigning Linear tasks to agents:

```typescript
// orchestrator/workflows/taskAssignment.ts
export async function assignTaskToAgent({
  taskId,
  agentType,
  workspaceId,
}: {
  taskId: string;
  agentType: "claude" | "opencode" | "codex";
  workspaceId: string;
}) {
  // 1. Fetch task details
  const task = await apiClient.task.get.query({ id: taskId });

  // 2. Build agent prompt from task
  const prompt = buildAgentPromptFromTask(task);

  // 3. Create git branch for task
  const branchName = `${task.identifier.toLowerCase()}-${slugify(task.title)}`;
  await createBranch(workspaceId, branchName);

  // 4. Spawn agent
  const { paneId } = await spawnAgent({
    workspaceId,
    agentType,
    task: prompt,
  });

  // 5. Track assignment
  await apiClient.task.update.mutate({
    id: taskId,
    branch: branchName,
    status: "in_progress",
  });

  return { paneId, branchName };
}

function buildAgentPromptFromTask(task: Task): string {
  return `
# Task: ${task.title}
Identifier: ${task.identifier}

## Description
${task.description || "No description provided."}

## Requirements
- Work on the branch that has been created for this task
- Commit your changes with clear commit messages referencing ${task.identifier}
- When done, let me know so I can create a PR

## Context
${task.labels?.map(l => `- ${l}`).join("\n") || "No labels"}
Priority: ${task.priority || "none"}
`.trim();
}
```

---

## Phase 5: Advanced Orchestration

**Goal**: Sophisticated multi-agent coordination and planning.

### Milestone 5.1: Task Decomposition

Auto-decompose complex tasks into sub-tasks:

```typescript
// orchestrator/planning.ts
const planningTools = {
  createPlan: tool({
    description: "Create a structured plan for a complex task",
    parameters: z.object({
      objective: z.string(),
      constraints: z.array(z.string()).optional(),
    }),
    execute: async ({ objective, constraints }) => {
      // Use Claude to generate a plan
      const { text } = await generateText({
        model: anthropic("claude-opus-4-5-20251101"),
        prompt: `Create a step-by-step plan for: ${objective}

Constraints: ${constraints?.join(", ") || "None"}

Output as JSON array of steps with:
- id: unique step identifier
- title: short step title
- description: detailed description
- dependencies: array of step ids this depends on
- agentType: recommended agent (claude, opencode, codex, or human)
- estimatedComplexity: low, medium, high`,
      });

      return JSON.parse(text);
    },
  }),

  executePlan: tool({
    description: "Execute a plan by spawning agents for each step",
    parameters: z.object({
      planId: z.string(),
      parallel: z.boolean().default(false),
    }),
    execute: async ({ planId, parallel }) => {
      const plan = await getPlan(planId);

      if (parallel) {
        // Execute independent steps in parallel
        const independent = plan.steps.filter(s => s.dependencies.length === 0);
        await Promise.all(independent.map(step => executeStep(step)));
      } else {
        // Execute sequentially
        for (const step of topologicalSort(plan.steps)) {
          await executeStep(step);
        }
      }

      return { completed: true };
    },
  }),
};
```

### Milestone 5.2: Agent Supervisor Pattern

Monitor and coordinate running agents:

```typescript
// orchestrator/supervisor.ts
export class AgentSupervisor {
  private watchers = new Map<string, AgentWatcher>();

  async supervise(agentId: string, options: SupervisionOptions) {
    const watcher = new AgentWatcher(agentId, {
      onStuck: async () => {
        // Agent hasn't produced output in N seconds
        await this.nudgeAgent(agentId, "Are you stuck? What's your current status?");
      },
      onError: async (error) => {
        // Agent encountered an error
        await this.handleAgentError(agentId, error);
      },
      onPermissionRequest: async () => {
        // Agent needs permission - notify orchestrator
        this.emit("permission_required", { agentId });
      },
      onComplete: async (result) => {
        // Agent finished - collect results
        await this.collectResults(agentId, result);
      },
    });

    this.watchers.set(agentId, watcher);
    watcher.start();
  }

  async collectResults(agentId: string, result: AgentResult) {
    // Parse agent output for:
    // - Files created/modified
    // - Tests run
    // - Errors encountered
    // - Next steps suggested

    const parsed = await parseAgentOutput(result.output);

    // Update task status
    if (parsed.taskCompleted) {
      await apiClient.task.update.mutate({
        id: parsed.taskId,
        status: "review",
      });
    }

    // Store results for orchestrator context
    await storeAgentResult(agentId, parsed);
  }
}
```

### Milestone 5.3: Conversation Memory

Persist and retrieve conversation context:

```typescript
// stores/conversationStore.ts
interface ConversationStore {
  conversations: Map<string, Conversation>;

  // Per-workspace conversations
  getConversation: (workspaceId: string) => Conversation;
  addMessage: (workspaceId: string, message: Message) => void;

  // Cross-conversation memory
  addFact: (fact: Fact) => void;
  searchFacts: (query: string) => Fact[];

  // Persistence
  save: () => Promise<void>;
  load: () => Promise<void>;
}

interface Conversation {
  id: string;
  workspaceId: string;
  messages: Message[];
  summary?: string;  // AI-generated summary for long conversations
  facts: Fact[];     // Extracted facts/decisions
  createdAt: Date;
  updatedAt: Date;
}

interface Fact {
  id: string;
  content: string;
  source: "user" | "agent" | "inferred";
  confidence: number;
  relatedTasks: string[];
  createdAt: Date;
}
```

**Conversation summarization** (for long contexts):

```typescript
async function summarizeConversation(messages: Message[]): Promise<string> {
  if (messages.length < 20) return "";  // No need to summarize yet

  const { text } = await generateText({
    model: anthropic("claude-3-5-haiku-20241022"),  // Fast model for summaries
    prompt: `Summarize this conversation, preserving:
- Key decisions made
- Tasks assigned
- Important context
- Current status

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join("\n\n")}`,
  });

  return text;
}
```

---

## Phase 6: Polish & UX

**Goal**: Production-ready user experience.

### Milestone 6.1: Chat UI Enhancements

**Rich message rendering**:
- Markdown with syntax highlighting
- Collapsible tool call details
- Task cards with quick actions
- Agent status indicators

**Quick actions panel**:
```typescript
// QuickActions.tsx
const quickActions = [
  { label: "Pull Linear tasks", action: () => syncFromLinear() },
  { label: "Git status", action: () => showGitStatus() },
  { label: "Spawn Claude agent", action: () => spawnAgent("claude") },
  { label: "View running agents", action: () => showAgentPanel() },
];
```

### Milestone 6.2: Agent Status Panel

Visual overview of all running agents:

```typescript
// AgentStatusPanel.tsx
function AgentStatusPanel() {
  const agents = useAgentRegistry((s) => s.getActiveAgents());

  return (
    <div className="agent-status-panel">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent}>
          <AgentHeader>
            <AgentIcon type={agent.type} />
            <AgentName>{agent.type}</AgentName>
            <AgentStatus status={agent.status} />
          </AgentHeader>
          <AgentTask>{agent.currentTask}</AgentTask>
          <AgentActions>
            <Button onClick={() => focusAgent(agent.paneId)}>Focus</Button>
            <Button onClick={() => askAgent(agent.id)}>Ask</Button>
            <Button variant="destructive" onClick={() => stopAgent(agent.id)}>
              Stop
            </Button>
          </AgentActions>
        </AgentCard>
      ))}
    </div>
  );
}
```

### Milestone 6.3: Keyboard Shortcuts

```typescript
// hotkeys.ts additions
CHAT_FOCUS_INPUT: defineHotkey({
  keys: "meta+shift+l",
  label: "Focus Chat Input",
  category: "Chat",
}),
CHAT_SPAWN_AGENT: defineHotkey({
  keys: "meta+shift+a",
  label: "Quick Spawn Agent",
  category: "Chat",
}),
CHAT_SYNC_LINEAR: defineHotkey({
  keys: "meta+shift+s",
  label: "Sync Linear Tasks",
  category: "Chat",
}),
```

### Milestone 6.4: Error Handling & Recovery

```typescript
// Graceful error handling in chat
const handleChatError = (error: Error) => {
  if (error.message.includes("rate_limit")) {
    showToast({
      title: "Rate limited",
      description: "Please wait a moment before sending another message.",
      variant: "warning",
    });
  } else if (error.message.includes("context_length")) {
    // Summarize and retry
    await summarizeAndRetry();
  } else {
    showToast({
      title: "Chat error",
      description: error.message,
      variant: "destructive",
    });
  }
};
```

---

## Technical Architecture Summary

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Desktop App                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Chat Panel │  │  Terminal   │  │  Terminal   │  Terminal │  │
│  │  (React)    │  │  (Claude)   │  │  (OpenCode) │  (Codex)  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┴─────┬─────┘  │
│         │                │                │            │         │
│         ▼                ▼                ▼            ▼         │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    tRPC (Electron IPC)                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │ │
│  │  │ Orchestrator │  │   Terminal   │  │  Notifications   │  │ │
│  │  │    Router    │  │    Router    │  │     Router       │  │ │
│  │  └──────┬───────┘  └──────────────┘  └──────────────────┘  │ │
│  └─────────┼───────────────────────────────────────────────────┘ │
│            │                                                     │
│            ▼                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Context         │  │ Agent           │  │ Conversation    │  │
│  │ Aggregator      │  │ Registry        │  │ Store           │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
└───────────┼────────────────────┼────────────────────┼────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌───────────────────────────────────────────────────────────────────┐
│                         External Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  Anthropic   │  │    Linear    │  │  Superset API (Backend)  │ │
│  │  Claude API  │  │     API      │  │  (Tasks, Users, etc.)    │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

### Key Files Reference

| Component | Location |
|-----------|----------|
| Chat Panel Store | `apps/desktop/src/renderer/stores/chat-panel-state.ts` |
| AI UI Components | `packages/ui/src/components/ai-elements/` |
| Agent Hooks | `apps/desktop/src/main/lib/agent-setup/` |
| Terminal Router | `apps/desktop/src/lib/trpc/routers/terminal/` |
| Linear Integration | `packages/trpc/src/router/integration/linear/` |
| Task Schema | `packages/db/src/schema/schema.ts` |
| Hotkeys | `apps/desktop/src/shared/hotkeys.ts` |

### Dependencies to Add

```json
{
  "dependencies": {
    "@ai-sdk/anthropic": "^1.0.0",
    "ai": "^5.0.0"
  }
}
```

### Environment Variables

```env
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Implementation Order

1. **Phase 1** (Foundation): 3-5 days
   - Enable chat panel UI
   - Basic Claude integration
   - Streaming responses

2. **Phase 2** (Agent Orchestration): 5-7 days
   - Agent registry
   - Context aggregation
   - Sub-agent spawning

3. **Phase 3** (Tool Calling): 5-7 days
   - Define tools
   - Execution pipeline
   - Tool UI

4. **Phase 4** (Linear Integration): 3-5 days
   - Bidirectional sync
   - Task context
   - Assignment flow

5. **Phase 5** (Advanced): 7-10 days
   - Task decomposition
   - Agent supervisor
   - Conversation memory

6. **Phase 6** (Polish): 3-5 days
   - UI enhancements
   - Keyboard shortcuts
   - Error handling

---

## Open Questions

1. **Persistence**: Should conversation history persist to the backend API or stay local?
2. **Multi-user**: Should agents be shareable across team members?
3. **Cost control**: How to handle API costs for heavy usage?
4. **Model selection**: Allow users to choose between Opus/Sonnet/Haiku?
5. **Security**: How to handle sensitive data in agent context?

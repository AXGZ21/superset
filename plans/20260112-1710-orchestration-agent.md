# Orchestration Agent for Task Management

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from AGENTS.md and the ExecPlan template.

## Purpose / Big Picture

Build a top-level orchestration agent that enables users to manage complex multi-agent workflows through a chat interface. After this change, users can:

1. Open a sidebar chat panel on the right side of the web app
2. Describe complex tasks in natural language (e.g., "Pull my Linear tickets and create a plan for the sprint")
3. Watch the orchestrator spawn specialized sub-agents to accomplish the task
4. See real-time progress as agents work in parallel
5. Review and approve actions before agents execute them

The orchestrator acts as a "manager" agent that coordinates specialized "worker" agents, pulling context from Linear, codebase knowledge, and other integrations to accomplish user goals.

## Assumptions

1. The existing Linear integration (`apps/web/src/app/(dashboard)/integrations/linear/`) provides OAuth connectivity that can be leveraged for pulling tasks
2. The Vercel AI SDK v6 `ToolLoopAgent` class is the primary abstraction for building agents
3. Claude Opus 4.5 (`anthropic/claude-opus-4-5-20250514`) is available via Vercel AI Gateway or direct Anthropic provider
4. The chat sidebar will be a persistent component across dashboard routes

## Open Questions

1. **State Persistence**: Should agent conversation history persist across sessions? (See Decision Log placeholder #1)
2. **Sub-agent Communication**: Should sub-agents communicate through a message bus, or return results directly to the orchestrator? (See Decision Log placeholder #2)
3. **Approval Workflow**: Should all agent actions require approval, or only "dangerous" actions like creating/modifying Linear tickets? (See Decision Log placeholder #3)
4. **Context Window Management**: How do we handle context limits when orchestrating multiple sub-agents with large context? (See Decision Log placeholder #4)

## Progress

- [ ] Milestone 1: Chat Sidebar UI Foundation
- [ ] Milestone 2: Basic Orchestrator Agent with Claude Opus 4.5
- [ ] Milestone 3: Linear Integration Tools
- [ ] Milestone 4: Sub-agent Spawning and Coordination
- [ ] Milestone 5: Task List View and Progress Tracking
- [ ] Milestone 6: Approval Workflows

## Surprises & Discoveries

(To be updated during implementation)

## Decision Log

- **Placeholder #1 (State Persistence)**: Pending
- **Placeholder #2 (Sub-agent Communication)**: Pending
- **Placeholder #3 (Approval Workflow)**: Pending
- **Placeholder #4 (Context Management)**: Pending

## Outcomes & Retrospective

(To be updated at completion)

---

## Context and Orientation

### Affected Apps and Packages

- **apps/web**: Primary location for the chat sidebar UI and agent configuration
- **apps/api**: May host agent API routes if needed for server-side orchestration
- **packages/db**: Will store conversation history and agent state
- **packages/ui**: Shared UI components for chat interface

### Key Existing Files

- `apps/web/src/app/(dashboard)/layout.tsx` - Dashboard layout where sidebar will be added
- `apps/web/src/app/(dashboard)/integrations/linear/` - Existing Linear OAuth integration
- `apps/web/src/trpc/` - tRPC setup for API communication
- `docs/llms.txt` - Vercel AI SDK v6 documentation reference

### Technology Choices

**Vercel AI SDK v6** - The AI SDK provides:
- `ToolLoopAgent` class for creating agents that use tools in a loop
- `useChat` hook for streaming chat UI
- `streamText` / `generateText` for API routes
- `tool()` function for defining agent capabilities
- `stopWhen: stepCountIs(N)` for multi-step agentic behavior

**Claude Opus 4.5** - Used via either:
- Vercel AI Gateway: `anthropic/claude-opus-4-5-20250514`
- Direct Anthropic provider: `@ai-sdk/anthropic`

**Chat Architecture** - The chat uses:
- `useChat` hook on the client with `DefaultChatTransport`
- API route handler that calls the orchestrator agent
- Streaming responses via `toUIMessageStreamResponse()`

---

## Plan of Work

### Milestone 1: Chat Sidebar UI Foundation

This milestone creates the right-sidebar chat panel UI without AI functionality. At completion, users see a collapsible chat sidebar on dashboard pages that accepts text input and displays placeholder messages.

**Scope:**
1. Create `ChatSidebar` component at `apps/web/src/app/(dashboard)/components/ChatSidebar/`
2. Add sidebar state management (open/closed) to dashboard layout
3. Implement basic chat message list and input components
4. Style with TailwindCSS v4 following existing patterns

**Files to create:**
```
apps/web/src/app/(dashboard)/components/ChatSidebar/
├── ChatSidebar.tsx        # Main sidebar container with open/close logic
├── ChatMessageList.tsx    # Scrollable message container
├── ChatMessage.tsx        # Individual message bubble
├── ChatInput.tsx          # Text input with send button
└── index.ts               # Barrel export
```

**Layout modification:**
Edit `apps/web/src/app/(dashboard)/layout.tsx` to include the sidebar:
```tsx
// Add sidebar state and ChatSidebar component
// Sidebar should be on the right, collapsible, ~400px wide when open
```

**Acceptance:**
```
bun dev
# Navigate to localhost:3000/dashboard
# See chat toggle button in header/footer
# Click toggle - sidebar slides in from right
# Type message and click send - message appears in list (no AI response yet)
```

---

### Milestone 2: Basic Orchestrator Agent with Claude Opus 4.5

This milestone connects the chat UI to a Claude Opus 4.5 agent. At completion, users can have a basic conversation with the AI through the sidebar.

**Scope:**
1. Install AI SDK dependencies: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/react`
2. Create orchestrator agent definition
3. Create API route for chat endpoint
4. Connect frontend to API with `useChat` hook

**Dependencies to install:**
```bash
cd apps/web
bun add ai @ai-sdk/anthropic @ai-sdk/react zod
```

**Files to create:**

`apps/web/src/lib/agents/orchestrator/orchestrator.ts` - Agent definition:
```typescript
import { ToolLoopAgent, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

export const orchestratorAgent = new ToolLoopAgent({
  model: anthropic('claude-opus-4-5-20250514'),
  instructions: `You are an orchestration agent for Superset, a developer productivity platform.
Your role is to help users manage their tasks, coordinate work, and accomplish complex goals.
You have access to tools that let you:
- Query and manage Linear tickets
- Spawn specialized sub-agents for specific tasks
- Search and analyze codebases

Always explain what you're doing and ask for confirmation before taking actions that modify data.`,
  tools: {
    // Tools will be added in subsequent milestones
  },
});
```

`apps/web/src/app/api/chat/route.ts` - API route:
```typescript
import { convertToModelMessages, streamText, UIMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

export const maxDuration = 60; // Allow longer for agentic tasks

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: anthropic('claude-opus-4-5-20250514'),
    system: `You are an orchestration agent for Superset...`,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
```

**Update ChatSidebar to use useChat:**
```typescript
'use client';
import { useChat } from '@ai-sdk/react';

export function ChatSidebar() {
  const { messages, sendMessage, input, setInput, isLoading } = useChat({
    api: '/api/chat',
  });
  // ... render messages and input
}
```

**Environment variables needed:**
```env
ANTHROPIC_API_KEY=your-key-here
# OR for Vercel AI Gateway:
AI_GATEWAY_API_KEY=your-gateway-key
```

**Acceptance:**
```
bun dev
# Open sidebar, type "Hello, what can you help me with?"
# See streaming response from Claude Opus 4.5
# Response explains agent capabilities
```

---

### Milestone 3: Linear Integration Tools

This milestone adds tools for the orchestrator to interact with Linear. At completion, the agent can list, search, and display Linear issues.

**Scope:**
1. Create Linear API client using existing OAuth tokens
2. Define Linear tools for the orchestrator
3. Add tool result rendering in chat UI

**Files to create:**

`apps/web/src/lib/agents/tools/linear.ts` - Linear tools:
```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const linearTools = {
  listMyIssues: tool({
    description: 'List Linear issues assigned to the current user',
    inputSchema: z.object({
      status: z.enum(['backlog', 'todo', 'in_progress', 'done']).optional(),
      limit: z.number().min(1).max(50).default(10),
    }),
    execute: async ({ status, limit }) => {
      // Use existing Linear OAuth token from session
      // Call Linear GraphQL API
      // Return formatted issue list
    },
  }),

  searchIssues: tool({
    description: 'Search Linear issues by text query',
    inputSchema: z.object({
      query: z.string().describe('Search query for issue title or description'),
      teamId: z.string().optional(),
    }),
    execute: async ({ query, teamId }) => {
      // Search Linear issues
    },
  }),

  getIssueDetails: tool({
    description: 'Get detailed information about a specific Linear issue',
    inputSchema: z.object({
      issueId: z.string().describe('The Linear issue ID (e.g., SUP-123)'),
    }),
    execute: async ({ issueId }) => {
      // Fetch full issue details
    },
  }),

  createIssue: tool({
    description: 'Create a new Linear issue. Always confirm with user before creating.',
    inputSchema: z.object({
      title: z.string(),
      description: z.string().optional(),
      teamId: z.string(),
      priority: z.number().min(0).max(4).optional(),
    }),
    execute: async (params) => {
      // Create issue in Linear
    },
  }),
};
```

**Update orchestrator with tools:**
```typescript
import { linearTools } from '../tools/linear';

export const orchestratorAgent = new ToolLoopAgent({
  model: anthropic('claude-opus-4-5-20250514'),
  instructions: `...`,
  tools: {
    ...linearTools,
  },
  stopWhen: stepCountIs(20), // Allow multi-step tool usage
});
```

**Add tool result rendering in ChatMessage:**
```typescript
// Handle tool-call and tool-result message parts
{message.parts.map(part => {
  switch (part.type) {
    case 'text':
      return <p>{part.text}</p>;
    case 'tool-call':
      return <ToolCallCard tool={part.toolName} args={part.args} />;
    case 'tool-result':
      return <ToolResultCard tool={part.toolName} result={part.result} />;
  }
})}
```

**Acceptance:**
```
bun dev
# Ensure Linear is connected in integrations
# Open chat, ask "What Linear tickets are assigned to me?"
# Agent calls listMyIssues tool
# Results displayed in chat with formatted cards
```

---

### Milestone 4: Sub-agent Spawning and Coordination

This milestone enables the orchestrator to spawn specialized sub-agents for complex tasks. At completion, the orchestrator can delegate work to specialized agents that run in parallel.

**Scope:**
1. Define sub-agent types (CodeAnalyzer, PlanningAgent, ResearchAgent)
2. Create sub-agent spawning tool
3. Implement context sharing between agents
4. Add parallel execution support

**Files to create:**

`apps/web/src/lib/agents/sub-agents/code-analyzer.ts`:
```typescript
import { ToolLoopAgent, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

export const codeAnalyzerAgent = new ToolLoopAgent({
  model: anthropic('claude-sonnet-4-20250514'), // Faster model for sub-tasks
  instructions: `You are a code analysis agent. Your job is to:
- Analyze codebases for patterns and issues
- Summarize code structure and dependencies
- Identify areas that need refactoring

Report your findings concisely.`,
  tools: {
    searchCode: tool({ /* ... */ }),
    readFile: tool({ /* ... */ }),
    analyzeComplexity: tool({ /* ... */ }),
  },
});
```

`apps/web/src/lib/agents/sub-agents/planning-agent.ts`:
```typescript
export const planningAgent = new ToolLoopAgent({
  model: anthropic('claude-sonnet-4-20250514'),
  instructions: `You are a planning agent. Your job is to:
- Break down complex tasks into actionable steps
- Estimate effort and dependencies
- Create structured plans with clear milestones

Output plans in a structured format.`,
  tools: {
    createPlan: tool({ /* ... */ }),
    estimateEffort: tool({ /* ... */ }),
  },
});
```

`apps/web/src/lib/agents/tools/spawn-agent.ts`:
```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const spawnAgentTool = tool({
  description: 'Spawn a specialized sub-agent to handle a specific task',
  inputSchema: z.object({
    agentType: z.enum(['code-analyzer', 'planning', 'research']),
    task: z.string().describe('The specific task for the sub-agent'),
    context: z.string().optional().describe('Additional context to pass'),
  }),
  execute: async ({ agentType, task, context }) => {
    // Spawn the appropriate sub-agent
    // Run it with the given task
    // Return results to orchestrator
    const agent = getAgent(agentType);
    const result = await agent.generate({
      prompt: `${context ? `Context: ${context}\n\n` : ''}Task: ${task}`,
    });
    return {
      agentType,
      task,
      result: result.text,
      steps: result.steps.length,
    };
  },
});
```

**Parallel execution pattern:**
```typescript
// In orchestrator, spawn multiple agents in parallel
const parallelAgentTool = tool({
  description: 'Run multiple sub-agents in parallel',
  inputSchema: z.object({
    tasks: z.array(z.object({
      agentType: z.enum(['code-analyzer', 'planning', 'research']),
      task: z.string(),
    })),
  }),
  execute: async ({ tasks }) => {
    const results = await Promise.all(
      tasks.map(({ agentType, task }) =>
        getAgent(agentType).generate({ prompt: task })
      )
    );
    return results.map((r, i) => ({
      task: tasks[i].task,
      result: r.text,
    }));
  },
});
```

**Acceptance:**
```
bun dev
# Ask "Analyze my codebase and create a plan for improving test coverage"
# Orchestrator spawns code-analyzer to analyze codebase
# Orchestrator spawns planning-agent to create improvement plan
# Both results are synthesized into final response
```

---

### Milestone 5: Task List View and Progress Tracking

This milestone adds a visual task list that shows agent progress. At completion, users see real-time updates as agents work through tasks.

**Scope:**
1. Create TaskListView component showing active agent tasks
2. Implement progress streaming for long-running operations
3. Add expandable task details

**Files to create:**

`apps/web/src/app/(dashboard)/components/ChatSidebar/TaskListView/`:
```
TaskListView/
├── TaskListView.tsx     # Main task list container
├── TaskItem.tsx         # Individual task with status/progress
├── TaskProgress.tsx     # Progress indicator
└── index.ts
```

**TaskListView component:**
```typescript
interface Task {
  id: string;
  agentType: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  result?: string;
  startedAt: Date;
  completedAt?: Date;
}

export function TaskListView({ tasks }: { tasks: Task[] }) {
  return (
    <div className="space-y-2">
      {tasks.map(task => (
        <TaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}
```

**Real-time progress via streaming:**
```typescript
// Use AI SDK's streaming with custom events
const result = streamText({
  model,
  messages,
  onStepStart: (step) => {
    // Emit task started event
  },
  onStepFinish: (step) => {
    // Emit task completed event
  },
});
```

**Acceptance:**
```
bun dev
# Ask "Review my Linear backlog and prioritize the top 5 items"
# See TaskListView appear with:
#   - "Fetching Linear issues" (running)
#   - "Analyzing priorities" (pending)
# Watch tasks transition from pending -> running -> completed
# Final results show prioritized list
```

---

### Milestone 6: Approval Workflows

This milestone adds user approval for sensitive actions. At completion, the agent pauses before executing actions that modify external systems.

**Scope:**
1. Define approval-required actions
2. Create ApprovalRequest component
3. Implement approval/rejection flow
4. Resume agent execution after approval

**Approval-required actions:**
- Creating Linear issues
- Modifying Linear issues (status, assignee, etc.)
- Executing code/scripts
- Making external API calls

**Files to create:**

`apps/web/src/lib/agents/tools/with-approval.ts`:
```typescript
import { tool } from 'ai';

export function withApproval<T>(
  baseTool: ReturnType<typeof tool>,
  approvalMessage: (args: T) => string
) {
  return tool({
    ...baseTool,
    execute: async (args, { abortSignal }) => {
      // Return approval request instead of executing
      return {
        type: 'approval-required',
        action: baseTool.description,
        details: approvalMessage(args as T),
        args,
      };
    },
  });
}

// Usage:
const createIssueWithApproval = withApproval(
  linearTools.createIssue,
  (args) => `Create Linear issue: "${args.title}" in team ${args.teamId}`
);
```

`apps/web/src/app/(dashboard)/components/ChatSidebar/ApprovalRequest/`:
```typescript
export function ApprovalRequest({
  action,
  details,
  onApprove,
  onReject
}: {
  action: string;
  details: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="border rounded-lg p-4 bg-amber-50 dark:bg-amber-950">
      <h4 className="font-semibold">Approval Required</h4>
      <p className="text-sm text-muted-foreground">{action}</p>
      <p className="mt-2">{details}</p>
      <div className="flex gap-2 mt-4">
        <Button onClick={onApprove}>Approve</Button>
        <Button variant="outline" onClick={onReject}>Reject</Button>
      </div>
    </div>
  );
}
```

**API route handling approvals:**
```typescript
export async function POST(req: Request) {
  const { messages, approvalResponse } = await req.json();

  if (approvalResponse) {
    // Resume execution with approval result
    return resumeWithApproval(approvalResponse);
  }

  // Normal flow...
}
```

**Acceptance:**
```
bun dev
# Ask "Create a Linear ticket for fixing the login bug"
# Agent prepares createIssue tool call
# ApprovalRequest appears: "Create Linear issue: 'Fix login bug'"
# Click Approve - issue is created
# Or click Reject - agent acknowledges and asks for changes
```

---

## Concrete Steps

### Phase 1 Setup Commands

```bash
cd /Users/avipeltz/.superset/worktrees/superset/orchestration-chat

# Install AI SDK dependencies in web app
cd apps/web
bun add ai @ai-sdk/anthropic @ai-sdk/react zod

# Return to root
cd ../..

# Run typecheck to verify no type errors
bun run typecheck

# Expected: No errors
```

### Phase 2 Development Commands

```bash
# Start development server
bun dev

# Run lint check
bun run lint

# Run type check
bun run typecheck

# Run tests
bun test
```

## Validation and Acceptance

### Final Acceptance Criteria

1. **Chat Sidebar**: Opens/closes smoothly, persists state across navigation
2. **Basic Chat**: Can converse with Claude Opus 4.5 via streaming
3. **Linear Tools**: Can list, search, and view Linear issues
4. **Sub-agents**: Can spawn code-analyzer and planning agents
5. **Task Progress**: Shows real-time progress of agent operations
6. **Approvals**: Blocks and requests approval for data-modifying actions

### Validation Commands

```bash
# Full validation suite
bun run typecheck   # No type errors
bun run lint        # No lint errors
bun test            # All tests pass

# Manual testing
bun dev
# Navigate to localhost:3000
# Open chat sidebar
# Test each milestone's acceptance criteria
```

## Idempotence and Recovery

All changes are additive and can be safely re-run:
- Component files can be overwritten without data loss
- Database migrations (if needed) will be idempotent
- API routes are stateless and can be redeployed

To rollback:
- Git revert the relevant commits
- Remove added packages from package.json and re-run `bun install`

## Artifacts and Notes

### Key Vercel AI SDK v6 Patterns

**Agent Definition:**
```typescript
import { ToolLoopAgent, tool, stepCountIs } from 'ai';

const agent = new ToolLoopAgent({
  model: anthropic('claude-opus-4-5-20250514'),
  instructions: 'System prompt...',
  tools: { /* tools */ },
  stopWhen: stepCountIs(20),
});
```

**API Route with Streaming:**
```typescript
import { streamText, convertToModelMessages, UIMessage } from 'ai';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model: anthropic('claude-opus-4-5-20250514'),
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
```

**Client Chat Hook:**
```typescript
import { useChat } from '@ai-sdk/react';

const { messages, sendMessage, isLoading } = useChat({
  api: '/api/chat',
});
```

**Tool Definition:**
```typescript
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: 'What this tool does',
  inputSchema: z.object({
    param: z.string().describe('Parameter description'),
  }),
  execute: async ({ param }) => {
    // Tool logic
    return { result: 'data' };
  },
});
```

## Interfaces and Dependencies

### Required Environment Variables

```env
# Anthropic (direct)
ANTHROPIC_API_KEY=sk-ant-...

# OR Vercel AI Gateway
AI_GATEWAY_API_KEY=...
```

### Package Dependencies

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/react": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

### Type Definitions

```typescript
// Message types from AI SDK
import type { UIMessage, Message, ModelMessage } from 'ai';

// Agent result type
import type { ToolLoopAgent, InferAgentUIMessage } from 'ai';

// Tool types
import type { ToolSet, Tool } from 'ai';
```

---

## Revision History

- **2026-01-12**: Initial plan created with 6 milestones covering full orchestration agent implementation

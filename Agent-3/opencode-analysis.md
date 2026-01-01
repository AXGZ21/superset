# OpenCode Technical Deep Dive & Integration Analysis

## Executive Summary

OpenCode is an open-source, provider-agnostic AI coding agent with a sophisticated multi-LLM provider system, built-in LSP support, and a client/server architecture. Built by the SST team (creators of terminal.shop), it focuses heavily on TUI excellence while supporting desktop and web interfaces. This analysis identifies key patterns and integration opportunities for Superset.

---

## OpenCode Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ TUI (Terminal)│  │ Desktop App   │  │ Web Console       │   │
│  │ (Bun + Ink)   │  │ (Tauri)       │  │ (SolidJS)         │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (HTTP/WebSocket)
┌─────────────────────────────────────────────────────────────────┐
│                      OpenCode Server                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ Session Mgmt  │  │ Agent System  │  │ Provider System   │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ Tool Registry │  │ Event Bus     │  │ LSP Integration   │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ MCP Servers   │  │ Config System │  │ Storage Layer     │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
packages/
├── opencode/      # Core CLI + server (Bun/TypeScript)
├── desktop/       # Tauri desktop app
├── console/       # Web console (SolidJS)
├── ui/            # Shared UI components
├── sdk/           # JavaScript SDK
├── plugin/        # Plugin system
├── docs/          # Documentation
├── slack/         # Slack integration
├── enterprise/    # Enterprise features
└── web/           # Marketing site
```

### Technology Stack

| Component | Technology |
|-----------|------------|
| **Runtime** | Bun |
| **Build** | Turborepo |
| **Core** | TypeScript + Zod |
| **Desktop** | Tauri (not Electron!) |
| **Web** | SolidJS + TailwindCSS v4 |
| **AI SDK** | Vercel AI SDK |
| **State** | Event Bus (pub/sub) |

---

## Core Systems Deep Dive

### 1. Multi-Provider System

OpenCode's provider system is its crown jewel - supporting 20+ AI providers out of the box.

**Bundled Providers:**
```typescript
const BUNDLED_PROVIDERS = {
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/google-vertex": createVertex,
  "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
  "@openrouter/ai-sdk-provider": createOpenRouter,
  "@ai-sdk/xai": createXai,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/deepinfra": createDeepInfra,
  "@ai-sdk/cerebras": createCerebras,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/gateway": createGateway,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/openai-compatible": createOpenAICompatible,
  // + GitHub Copilot, SAP AI Core, Cloudflare AI Gateway
};
```

**Custom Loaders for Complex Providers:**
```typescript
const CUSTOM_LOADERS = {
  async "amazon-bedrock"(input) {
    // Auto-detect AWS credentials
    const awsProfile = Env.get("AWS_PROFILE");
    const awsAccessKeyId = Env.get("AWS_ACCESS_KEY_ID");
    if (!awsProfile && !awsAccessKeyId) return { autoload: false };

    const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers");
    return {
      autoload: true,
      options: {
        region: Env.get("AWS_REGION") ?? "us-east-1",
        credentialProvider: fromNodeProviderChain(),
      },
      // Region-aware model prefixing
      async getModel(sdk, modelID, options) {
        const region = options?.region;
        if (modelID.includes("claude")) {
          modelID = `${region.split("-")[0]}.${modelID}`;
        }
        return sdk.languageModel(modelID);
      },
    };
  },

  async opencode(input) {
    // Free tier detection - filter paid models if no API key
    const hasKey = await detectAPIKey(input);
    if (!hasKey) {
      for (const [key, value] of Object.entries(input.models)) {
        if (value.cost.input > 0) delete input.models[key];
      }
    }
    return { autoload: true, options: hasKey ? {} : { apiKey: "public" } };
  },
};
```

**Provider Selection Flow:**
```
┌──────────────────────────────────────────────────────────────────┐
│                    Provider Discovery Pipeline                    │
│                                                                  │
│  1. Load from models.dev database (model metadata)               │
│  2. Check environment variables for API keys                     │
│  3. Load from Auth.all() (stored credentials)                    │
│  4. Run CUSTOM_LOADERS for complex providers                     │
│  5. Apply config overrides from opencode.jsonc                   │
│  6. Filter by enabled_providers / disabled_providers             │
│  7. Cache SDK instances by hash of options                       │
└──────────────────────────────────────────────────────────────────┘
```

### 2. Agent System

OpenCode has a flexible agent system with permission controls.

**Built-in Agents:**
```typescript
const agents = {
  // Primary agents (user-facing)
  build: {
    name: "build",
    mode: "primary",
    permission: { edit: "allow", bash: { "*": "allow" } },
    tools: defaultTools,
  },
  plan: {
    name: "plan",
    mode: "primary",
    permission: {
      edit: "deny",
      bash: {
        "git diff*": "allow",
        "git log*": "allow",
        "grep*": "allow",
        "ls*": "allow",
        "rg*": "allow",
        "*": "ask",  // Ask for other commands
      },
    },
  },

  // Subagents (internal use)
  general: {
    name: "general",
    mode: "subagent",
    description: "For researching complex questions and multi-step tasks",
    tools: { todoread: false, todowrite: false },
  },
  explore: {
    name: "explore",
    mode: "subagent",
    description: "Fast codebase exploration",
    tools: { edit: false, write: false },
    prompt: PROMPT_EXPLORE,
  },

  // Utility agents (hidden)
  compaction: { mode: "primary", hidden: true, tools: { "*": false } },
  title: { mode: "primary", hidden: true },
  summary: { mode: "primary", hidden: true },
};
```

**Permission Patterns:**
```typescript
// Glob-style bash command matching
const planPermission = {
  bash: {
    "git diff*": "allow",       // Allow git diff commands
    "find * -delete*": "ask",   // Ask before destructive finds
    "find *": "allow",          // Allow other finds
    "*": "ask",                  // Ask for everything else
  },
};

// Permission types
type Permission = "ask" | "allow" | "deny";
```

### 3. Tool Registry

OpenCode has a comprehensive built-in tool set plus plugin support.

**Core Tools:**
```typescript
const tools = [
  InvalidTool,      // Error handling
  BashTool,         // Shell execution
  ReadTool,         // File reading
  GlobTool,         // Pattern matching
  GrepTool,         // Content search
  EditTool,         // File editing
  WriteTool,        // File creation
  TaskTool,         // Subagent spawning
  WebFetchTool,     // URL fetching
  TodoWriteTool,    // Todo management
  TodoReadTool,     // Todo reading
  WebSearchTool,    // Web search (Exa)
  CodeSearchTool,   // Code search (Exa)
  SkillTool,        // Skills system
  LspTool,          // LSP integration (experimental)
  BatchTool,        // Batch operations (experimental)
];
```

**Plugin System:**
```typescript
// Load custom tools from .opencode/tool/*.ts
const glob = new Bun.Glob("tool/*.{js,ts}");
for await (const match of glob.scan({ cwd: configDir })) {
  const mod = await import(match);
  for (const [id, def] of Object.entries(mod)) {
    custom.push(fromPlugin(id, def));
  }
}

// Tool definition format (from @opencode-ai/plugin)
interface ToolDefinition {
  description: string;
  args: Record<string, z.ZodType>;
  execute: (args: any, ctx: ToolContext) => Promise<string>;
}
```

### 4. Session Management

Sessions track conversations with messages and parts (streaming chunks).

**Session Structure:**
```typescript
const Info = z.object({
  id: Identifier.schema("session"),
  projectID: z.string(),
  directory: z.string(),
  parentID: Identifier.schema("session").optional(),  // Child sessions
  title: z.string(),
  version: z.string(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    compacting: z.number().optional(),
    archived: z.number().optional(),
  }),
  summary: z.object({
    additions: z.number(),
    deletions: z.number(),
    files: z.number(),
    diffs: Snapshot.FileDiff.array().optional(),
  }).optional(),
  share: z.object({ url: z.string() }).optional(),
  revert: z.object({
    messageID: z.string(),
    partID: z.string().optional(),
    snapshot: z.string().optional(),
  }).optional(),
});
```

**Session Events:**
```typescript
export const Event = {
  Created: BusEvent.define("session.created", z.object({ info: Info })),
  Updated: BusEvent.define("session.updated", z.object({ info: Info })),
  Deleted: BusEvent.define("session.deleted", z.object({ info: Info })),
  Diff: BusEvent.define("session.diff", z.object({ sessionID, diff })),
  Error: BusEvent.define("session.error", z.object({ sessionID, error })),
};
```

### 5. Event Bus

OpenCode uses a pub/sub event bus for decoupling components.

**Bus Implementation:**
```typescript
export namespace Bus {
  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const payload = { type: def.type, properties };

    // Local subscribers
    for (const key of [def.type, "*"]) {
      const match = state().subscriptions.get(key);
      for (const sub of match ?? []) {
        pending.push(sub(payload));
      }
    }

    // Cross-instance via GlobalBus
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    });
  }

  export function subscribe<Definition>(def: Definition, callback: (event) => void) {
    return raw(def.type, callback);
  }

  export function subscribeAll(callback: (event: any) => void) {
    return raw("*", callback);
  }
}
```

### 6. Configuration System

OpenCode has an extremely flexible configuration system with multiple sources.

**Config Loading Order:**
```
1. Global config (~/.config/opencode/opencode.jsonc)
2. OPENCODE_CONFIG env var override
3. Project config (./opencode.jsonc - found via findUp)
4. OPENCODE_CONFIG_CONTENT env var
5. .well-known/opencode from authenticated URLs
6. .opencode/ directories (commands, agents, plugins, tools)
7. OPENCODE_PERMISSION env var
```

**Config Schema (Comprehensive):**
```typescript
const Info = z.object({
  // Display
  theme: z.string().optional(),
  keybinds: Keybinds.optional(),
  tui: TUI.optional(),

  // Models
  model: z.string().optional(),           // e.g., "anthropic/claude-sonnet-4"
  small_model: z.string().optional(),     // For title generation
  default_agent: z.string().optional(),
  disabled_providers: z.array(z.string()).optional(),
  enabled_providers: z.array(z.string()).optional(),

  // Agents & Commands
  agent: z.record(Agent).optional(),
  command: z.record(Command).optional(),

  // Providers
  provider: z.record(Provider).optional(),
  mcp: z.record(Mcp).optional(),

  // Tools
  tools: z.record(z.boolean()).optional(),
  lsp: z.union([z.literal(false), z.record(LSPConfig)]).optional(),
  formatter: z.union([z.literal(false), z.record(FormatterConfig)]).optional(),

  // Permissions
  permission: PermissionConfig.optional(),

  // Features
  share: z.enum(["manual", "auto", "disabled"]).optional(),
  autoupdate: z.union([z.boolean(), z.literal("notify")]).optional(),
  compaction: z.object({
    auto: z.boolean().optional(),
    prune: z.boolean().optional(),
  }).optional(),

  // Experimental
  experimental: z.object({
    hook: HookConfig.optional(),
    batch_tool: z.boolean().optional(),
    openTelemetry: z.boolean().optional(),
  }).optional(),
});
```

### 7. LSP Integration

OpenCode has built-in Language Server Protocol support.

**LSP Configuration:**
```typescript
lsp: z.record(z.string(), z.object({
  command: z.array(z.string()),
  extensions: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  initialization: z.record(z.any()).optional(),
}))

// Built-in servers
const LSPServer = {
  typescript: { id: "typescript", command: ["typescript-language-server", "--stdio"] },
  rust: { id: "rust", command: ["rust-analyzer"] },
  go: { id: "go", command: ["gopls"] },
  python: { id: "python", command: ["pyright-langserver", "--stdio"] },
  // ... more
};
```

---

## Comparison with Superset

### Architecture Comparison

| Aspect | OpenCode | Superset |
|--------|----------|----------|
| **Runtime** | Bun | Bun + Node |
| **Desktop** | Tauri | Electron |
| **AI Provider** | Multi-provider (20+) | Claude Code CLI |
| **State** | Event Bus (pub/sub) | Zustand + tRPC |
| **Config** | JSONC + Zod | .env + TypeScript |
| **LSP** | Built-in | None |
| **Agents** | Configurable (build/plan/custom) | Single mode |
| **Permissions** | Glob-pattern matching | Binary allow/deny |
| **MCP** | Local + Remote | Via Claude Code |

### Key Differences

**1. Provider System**
- OpenCode: Full multi-provider support with custom loaders
- Superset: Relies on Claude Code CLI (Anthropic only)

**2. Agent Modes**
- OpenCode: `build`, `plan`, custom agents with permissions
- Superset: Single mode via Claude Code

**3. Configuration**
- OpenCode: Extensive JSONC config with Zod validation
- Superset: Environment variables + TypeScript

**4. Desktop**
- OpenCode: Tauri (Rust-based, smaller bundle)
- Superset: Electron (Node.js, larger ecosystem)

---

## Integration Recommendations

### High-Value Features to Adopt

#### 1. Multi-Provider Support (Priority: HIGH)

**Why:** Provider-agnostic support future-proofs Superset as models evolve and pricing changes.

**Integration Approach:**
```typescript
// Create a provider abstraction layer
interface AIProvider {
  id: string;
  name: string;
  models: Model[];
  createLanguageModel(modelId: string): LanguageModel;
}

// Use Vercel AI SDK as foundation
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const providers: Record<string, () => AIProvider> = {
  anthropic: () => ({ id: "anthropic", sdk: createAnthropic() }),
  openai: () => ({ id: "openai", sdk: createOpenAI() }),
  google: () => ({ id: "google", sdk: createGoogleGenerativeAI() }),
};

// Provider selection UI
function ProviderSelector({ current, onSelect }) {
  const available = useAvailableProviders();  // Auto-detect via env vars
  return <Select value={current} options={available} onChange={onSelect} />;
}
```

#### 2. Permission Pattern Matching (Priority: HIGH)

**Why:** Glob-style permissions give users fine-grained control without complexity.

**Integration Approach:**
```typescript
// Glob-style bash command permissions
interface PermissionConfig {
  edit: "ask" | "allow" | "deny";
  bash: Record<string, "ask" | "allow" | "deny">;  // Pattern → permission
}

function matchBashPermission(command: string, patterns: Record<string, Permission>): Permission {
  // Most specific match wins
  for (const [pattern, permission] of Object.entries(patterns)) {
    if (minimatch(command, pattern)) {
      return permission;
    }
  }
  return patterns["*"] ?? "ask";
}

// Example config
const planModePermissions = {
  bash: {
    "git diff*": "allow",
    "git log*": "allow",
    "grep*": "allow",
    "rm *": "deny",
    "*": "ask",
  },
};
```

#### 3. Agent Modes (Priority: MEDIUM)

**Why:** Different modes for different tasks (full control vs read-only exploration).

**Integration Approach:**
```typescript
interface AgentMode {
  id: string;
  name: string;
  permissions: PermissionConfig;
  tools: Record<string, boolean>;  // Tool enablement
  prompt?: string;  // Additional system prompt
}

const MODES: AgentMode[] = [
  {
    id: "build",
    name: "Build",
    permissions: { edit: "allow", bash: { "*": "allow" } },
    tools: {},  // All enabled
  },
  {
    id: "plan",
    name: "Plan",
    permissions: { edit: "deny", bash: { "git*": "allow", "*": "ask" } },
    tools: { edit: false, write: false },
  },
];

// Mode selector in UI
function ModeSelector({ currentMode, onChange }) {
  return (
    <Tabs value={currentMode} onValueChange={onChange}>
      <TabsTrigger value="build">Build</TabsTrigger>
      <TabsTrigger value="plan">Plan</TabsTrigger>
    </Tabs>
  );
}
```

#### 4. Event Bus Architecture (Priority: MEDIUM)

**Why:** Decouples components and enables cross-window communication.

**Integration Approach:**
```typescript
// Typed event definitions with Zod
import { BusEvent } from "./bus-event";

const SessionEvents = {
  Created: BusEvent.define("session.created", z.object({ info: SessionInfo })),
  Updated: BusEvent.define("session.updated", z.object({ info: SessionInfo })),
  MessageAdded: BusEvent.define("session.message", z.object({ sessionId, message })),
};

// Publisher
Bus.publish(SessionEvents.Created, { info: newSession });

// Subscriber (in React component)
useEffect(() => {
  return Bus.subscribe(SessionEvents.Updated, (event) => {
    if (event.properties.info.id === sessionId) {
      setSession(event.properties.info);
    }
  });
}, [sessionId]);
```

#### 5. Configurable Keybinds (Priority: LOW)

**Why:** Power users love customizable keybinds.

**Integration Approach:**
```typescript
const Keybinds = z.object({
  leader: z.string().default("ctrl+x"),
  session_new: z.string().default("<leader>n"),
  session_list: z.string().default("<leader>l"),
  model_list: z.string().default("<leader>m"),
  agent_cycle: z.string().default("tab"),
  input_submit: z.string().default("return"),
  input_newline: z.string().default("shift+return"),
});

// Use in components
function useKeybind(action: keyof typeof Keybinds, handler: () => void) {
  const config = useConfig();
  const binding = config.keybinds[action];
  useHotkeys(expandLeader(binding, config.keybinds.leader), handler);
}
```

#### 6. LSP Integration (Priority: LOW)

**Why:** Better code intelligence for the agent.

**Integration Approach:**
```typescript
// LSP client for enhanced code understanding
class LSPManager {
  private clients: Map<string, LanguageClient> = new Map();

  async getDefinition(file: string, position: Position): Promise<Location[]> {
    const client = await this.getClient(file);
    return client?.textDocument.definition({ textDocument: { uri: file }, position });
  }

  async getReferences(file: string, position: Position): Promise<Location[]> {
    const client = await this.getClient(file);
    return client?.textDocument.references({ textDocument: { uri: file }, position });
  }

  async getDiagnostics(file: string): Promise<Diagnostic[]> {
    const client = await this.getClient(file);
    return client?.diagnostics ?? [];
  }
}

// Use in tool context
const lspTool = {
  name: "lsp",
  description: "Get code intelligence (definitions, references, diagnostics)",
  async execute({ file, position, action }) {
    const lsp = await LSPManager.getInstance();
    switch (action) {
      case "definition": return lsp.getDefinition(file, position);
      case "references": return lsp.getReferences(file, position);
      case "diagnostics": return lsp.getDiagnostics(file);
    }
  },
};
```

### Lower Priority Features

#### 7. Models.dev Database (Priority: LOW)

OpenCode maintains a database of model metadata at models.dev:
```typescript
// Model metadata with pricing, capabilities, limits
interface ModelInfo {
  id: string;
  name: string;
  cost: { input: number; output: number; cache: { read: number; write: number } };
  limit: { context: number; output: number };
  capabilities: {
    reasoning: boolean;
    toolcall: boolean;
    image: boolean;
    // ...
  };
}
```

#### 8. Session Sharing (Priority: LOW)

OpenCode has built-in session sharing via ShareNext:
```typescript
const share = z.object({
  manual: "Share via command",
  auto: "Auto-share new sessions",
  disabled: "Disable sharing",
});
```

---

## Implementation Roadmap

### Phase 1: Foundation

1. **Provider Abstraction Layer**
   - Create provider interface using Vercel AI SDK
   - Add env-based provider detection
   - Implement provider selection UI

2. **Permission System**
   - Add glob-pattern matching for bash commands
   - Create permission configuration schema
   - Implement permission checking middleware

### Phase 2: Agent Modes

1. **Mode Definitions**
   - Create build/plan mode configs
   - Add mode-specific tool filtering
   - Implement mode switching UI

2. **Custom Agents**
   - Allow custom agent definitions
   - Per-agent permission overrides
   - Agent-specific prompts

### Phase 3: Infrastructure

1. **Event Bus**
   - Implement typed event system
   - Cross-window communication
   - Event persistence for replay

2. **Configuration**
   - JSONC config file support
   - Zod schema validation
   - Config merging from multiple sources

### Phase 4: Advanced

1. **LSP Integration**
   - Language server management
   - Code intelligence tools
   - Diagnostics in UI

2. **Keybind System**
   - Configurable keybinds
   - Leader key support
   - Keybind editor UI

---

## Key Takeaways

1. **Multi-provider is the future** - OpenCode's 20+ provider support with automatic detection is excellent. As model capabilities converge and pricing drops, being provider-agnostic is crucial.

2. **Glob-pattern permissions are elegant** - The `"git diff*": "allow"` pattern is intuitive for users and powerful for fine-grained control.

3. **Agent modes improve UX** - Having a "plan" mode that's read-only and a "build" mode with full access addresses different use cases cleanly.

4. **Event bus decouples well** - OpenCode's pub/sub system enables clean separation between components and cross-window sync.

5. **Zod schemas everywhere** - OpenCode uses Zod for everything (config, events, API). This provides excellent type safety and validation.

6. **Start with providers** - The multi-provider system is the highest-impact feature. It opens Superset to users who prefer OpenAI, Google, or local models.

7. **Tauri is lighter than Electron** - OpenCode uses Tauri for desktop, resulting in smaller bundles. Worth considering for future versions.

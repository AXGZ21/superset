# Interactive Plan Viewer for Superset Desktop

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

## Purpose / Big Picture

When an AI coding agent (OpenCode or Claude Code) submits a plan via the `submit_plan` tool or `ExitPlanMode` hook, Superset Desktop will automatically open the plan in a new pane with beautiful Tufte-styled markdown rendering. This enables users to review agent plans visually within the app rather than in the terminal, creating a foundation for future annotation, approval, and feedback features (like Plannotator).

**User-visible outcome**: When an agent finishes planning and calls `submit_plan`, a new pane automatically opens in the current tab showing the plan with the existing Tufte markdown styling. The user sees the same beautiful rendering they'd see when viewing any `.md` file.

**This is Phase 1 of a multi-phase feature** inspired by Plannotator. The dedicated `plan-viewer` pane type provides extension points for future phases: approve/reject workflow, text annotations, and structured feedback.

## Assumptions

- The existing `MarkdownRenderer` component is suitable for rendering plan content (confirmed - it has Tufte styling)
- Plans are markdown strings that can be displayed without modification

## Critical Discovery (2026-01-04)

### Initial OpenCode Research (Partially Incorrect)
Initial research of the OpenCode codebase suggested no plugin system exists. However, analysis of Plannotator's implementation reveals a different picture.

### Plannotator Analysis (Key Insights)

Plannotator (https://github.com/backnotprop/plannotator) has working integrations for both Claude Code and OpenCode:

**Claude Code Integration:**
- Uses `ExitPlanMode` permission hook
- Plan content IS exposed at `event.tool_input.plan`
- Hook reads plan from stdin as JSON event

**OpenCode Integration:**
- Registers as `@plannotator/opencode@latest` plugin
- Exposes a `submit_plan` tool
- NOT using MCP servers - uses OpenCode's native plugin system

**Architecture Pattern (Plannotator):**
```
Hook spawned → Read plan from stdin → Start ephemeral HTTP server → Open browser → Wait for decision → Return JSON to agent
```

### Superset's Simplified Approach

Since we're **already inside Electron**, we don't need the ephemeral server pattern:

```
Agent Hook → Write temp file → Notify main process → tRPC subscription → Display in pane
```

**Both agents can be supported in Phase 1:**
1. **Claude Code**: Hook `ExitPlanMode` permission request, read `tool_input.plan`
2. **OpenCode**: Register plugin with `submit_plan` tool (same pattern as Plannotator)

## Open Questions

All questions resolved - see Decision Log.

## Phased Roadmap (Plannotator-Inspired Features)

This plan implements **Phase 1**. The architecture is designed to enable future phases:

### Phase 1: View Plans (This Plan)
- Dedicated `plan-viewer` pane type with `PlanViewerState`
- Stores metadata: `content`, `originPaneId`, `planId`, `status`, `submittedAt`
- Tufte-styled markdown rendering via existing `MarkdownRenderer`
- Pane appears without stealing focus, marked with `needsAttention`

### Phase 2: Approve / Request Changes (Future)
- Add `DecisionBar` component to `PlanViewerPane` with Approve/Reject buttons
- Add `status: 'pending' | 'approved' | 'rejected'` to `PlanViewerState`
- Send decision back to agent via `originPaneId` → notification system
- Global feedback textarea for rejection comments

### Phase 3: Text Annotations (Future)
- Add `annotations: Annotation[]` to `PlanViewerState`
- Wrap `MarkdownRenderer` with `AnnotatableViewer` using `web-highlighter` library
- Add `Toolbar` component for annotation actions (delete/comment/replace)
- Export annotations as structured markdown feedback (like Plannotator)

### Phase 4: Advanced Features (Future)
- Plan history in workspace sidebar
- Obsidian export with frontmatter
- Diff view between plan revisions
- Shareable URL links via compression
- Claude Code support

### How Phase 1 Enables Future Phases

    PlanViewerState (Phase 1)           Future Extensions
    ─────────────────────────           ─────────────────
    content: string          ───────►   Same, used by all phases
    planId: string           ───────►   Track plan lifecycle, enable history
    originPaneId: string     ───────►   Send approval/feedback back to agent
    status: 'pending'        ───────►   Add 'approved' | 'rejected' in Phase 2
    submittedAt: number      ───────►   Display, sorting, cleanup
    (future) annotations[]   ───────►   Add in Phase 3 for text feedback

## Progress

- [ ] (pending) Milestone 1: Add `plan-viewer` pane type to shared types
- [ ] (pending) Milestone 2: Create PlanViewerPane component
- [ ] (pending) Milestone 3: Extend Claude Code wrapper to hook `ExitPlanMode`
- [ ] (pending) Milestone 4: Create OpenCode plugin with `submit_plan` tool
- [ ] (pending) Milestone 5: Add main process plan handler (validate, read, emit)
- [ ] (pending) Milestone 6: Handle plan event in renderer, add store action
- [ ] (pending) Validation: End-to-end test with both Claude Code and OpenCode

## Surprises & Discoveries

- **2026-01-04 (Initial): OpenCode codebase research.** Initial research of OpenCode GitHub suggested no plugin hook system and only MCP server extensibility.

- **2026-01-04 (Revised): Plannotator analysis changes everything.** Analysis of https://github.com/backnotprop/plannotator revealed:
  - **Claude Code**: `ExitPlanMode` hook DOES expose plan content at `event.tool_input.plan`
  - **OpenCode**: Has a plugin system (separate from MCP) - Plannotator uses `@plannotator/opencode@latest`
  - Both agents can be supported in Phase 1
  - Architecture simplified: no ephemeral HTTP server needed since we're already in Electron
  - Plan revised to use native hook/plugin patterns matching Plannotator's approach

## Decision Log

- **Decision #1: Plan pane appears without stealing focus**
  Rationale: User may be actively working in the terminal when the plan is submitted. Stealing focus would be disruptive. The pane appears in the layout and the user can click on it when ready to review. Use `needsAttention: true` instead of focus.
  Date: 2026-01-04 / User decision

- **Decision #2: Plans are ephemeral (not persisted across restarts)**
  Rationale: Plans are transient artifacts - you review, approve/modify, then implement. The plan content already exists in terminal scrollback. Persisting adds complexity (serialize large markdown, handle stale plans). Future features can add "Save to Obsidian" or "Export as file" if users want to keep plans.
  
  Implementation (per Oracle review):
  - Use Zustand `persist` middleware's `partialize` option
  - Filter BOTH panes (exclude `type === 'plan-viewer'`) AND layout references
  - Must remove plan-viewer pane IDs from tab layouts to avoid dangling pointers on rehydration
  - Follow existing `partialize` patterns in the codebase
  
  Date: 2026-01-04 / User + Agent + Oracle consensus

- **Decision #3: Minimal header, content-first display**
  Rationale: Plans typically have their own `# Title` heading - no need to duplicate. The MosaicWindow toolbar already shows pane name. A heavy metadata header adds visual noise. Implementation: Tab bar shows plan title (extracted from first heading or summary), toolbar shows small timestamp badge + close/lock buttons (same pattern as FileViewerPane), content area is full Tufte-rendered markdown with no extra header.
  Date: 2026-01-04 / User + Agent consensus

- **Decision #4: Temp file for content transport**
  Rationale: Avoids pushing large markdown through querystrings, JSON bodies, or tRPC payloads. File paths are tiny and robust. Plugin writes plan to temp directory, notification carries only the file path, main process reads file and emits content via tRPC subscription.
  
  Implementation details (per Oracle review):
  - Use `os.homedir()` explicitly, NOT `~` (shell expansion doesn't work in Node APIs)
  - Main process owns the temp directory path, passes to plugin via env var (e.g., `SUPERSET_PLANS_DIR`)
  - Use `fs.mkdir(dir, { recursive: true })` before writing
  - Security: Use `path.resolve()` + `realpath()` to canonicalize paths, prevent `../` traversal and symlink escapes
  - Only accept files matching pattern: `{PLANS_DIR}/{planId}.md` where planId is alphanumeric + hyphens
  - Max file size guard: reject files > 1MB to prevent renderer freeze
  - Cleanup: Best-effort, non-blocking deletion of old plan files on app start (mtime > 24h)
  
  Date: 2026-01-04 / Oracle recommendation

- **Decision #5: Dedicated plan-viewer pane (not reusing file-viewer)**
  Rationale: While file-viewer could render markdown, a dedicated pane type provides clean extension points for future Plannotator-like features (approve/reject, annotations, feedback). Retrofitting these onto file-viewer would be awkward. The extra upfront work (~2 hours) pays off in Phase 2+.
  Date: 2026-01-04 / User + Agent consensus

- **Decision #6: Use native hook/plugin patterns (matching Plannotator)** ⚠️ REVISED TWICE

  **Original:** Use `tool.execute.after` hook in OpenCode plugin

  **First Revision:** Use MCP server (based on OpenCode codebase research)

  **Final Revision (after Plannotator analysis):** Use native patterns for each agent:

  - **Claude Code**: Hook `ExitPlanMode` permission request, read plan from `event.tool_input.plan`
  - **OpenCode**: Register plugin with `submit_plan` tool (same pattern as Plannotator)

  Key insight from Plannotator: Both agents have working integration patterns that don't require MCP servers. Plannotator's `@plannotator/opencode@latest` plugin proves OpenCode has a plugin system beyond MCP.

  Benefits:
  - Proven patterns (Plannotator has working implementations)
  - Simpler than MCP server approach
  - Both agents supported in Phase 1
  - No new dependencies (`@modelcontextprotocol/sdk` not needed)

  Date: 2026-01-04 / Final revision after Plannotator analysis

- **Decision #7: Oracle review items addressed**
  The following implementation details were added per Oracle's second review:
  - Path handling: Use `os.homedir()` explicitly, never `~`; use `path.resolve()` + `realpath()` for canonicalization
  - Security: Validate paths are within allowed directory, check filename pattern, prevent traversal
  - Size guard: Reject plan files > 1MB to prevent renderer freeze
  - Persistence: Filter both panes AND layout references to avoid dangling pointers
  - Env var: Main process passes `SUPERSET_PLANS_DIR` to plugin via wrapper script
  - Cleanup: Best-effort, non-blocking deletion of old files
  Date: 2026-01-04 / Oracle review incorporated

## Outcomes & Retrospective

(To be filled at completion)

## Context and Orientation

### Existing Architecture

The Superset desktop app uses Electron with a React renderer. Key architectural pieces:

**Agent Wrappers** (`apps/desktop/src/main/lib/agent-setup/agent-wrappers.ts`):
- Wrapper scripts for Claude Code and OpenCode that inject hooks/plugins
- OpenCode plugin already hooks into `session.idle`, `session.error`, and `permission.ask` events
- Uses `SUPERSET_TAB_ID` environment variable to identify which terminal pane triggered the notification

**Notification System**:
- Main process receives notifications from agent hooks via a notify script
- Notifications are broadcast to renderer via tRPC subscriptions
- `apps/desktop/src/renderer/stores/tabs/useAgentHookListener.ts` handles `AGENT_COMPLETE` and `FOCUS_TAB` events

**Tabs/Panes Store** (`apps/desktop/src/renderer/stores/tabs/store.ts`):
- Manages tab and pane state with Zustand
- `addFileViewerPane()` opens files in panes with view mode detection
- `createFileViewerPane()` creates pane objects for file viewing
- Pane types are `terminal`, `webview`, or `file-viewer`

**MarkdownRenderer** (`apps/desktop/src/renderer/components/MarkdownRenderer/`):
- Beautiful Tufte-styled markdown rendering
- Uses `react-markdown` with `remark-gfm` and `rehype-raw`/`rehype-sanitize`
- Has `SelectionContextMenu` for text selection (useful for future annotation)
- Configurable styles via `tufteConfig` and `defaultConfig`

**FileViewerPane** (`apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/FileViewerPane.tsx`):
- Renders file content in three modes: `rendered` (markdown), `raw` (editor), `diff`
- Fetches content from disk via tRPC query `changes.readWorkingFile`
- Uses `MarkdownRenderer` for rendered mode

### File Paths

Key files to modify or reference:

    apps/desktop/src/shared/tabs-types.ts          # Add plan-viewer pane type
    apps/desktop/src/renderer/stores/tabs/types.ts # Renderer-specific types
    apps/desktop/src/renderer/stores/tabs/utils.ts # Add createPlanViewerPane helper
    apps/desktop/src/renderer/stores/tabs/store.ts # Add addPlanViewerPane action
    apps/desktop/src/main/lib/agent-setup/agent-wrappers.ts # Extend OpenCode plugin
    apps/desktop/src/shared/constants.ts           # Add PLAN_SUBMITTED event type
    apps/desktop/src/renderer/stores/tabs/useAgentHookListener.ts # Handle plan events

New files to create:

    apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/PlanViewerPane/
    ├── PlanViewerPane.tsx
    └── index.ts

## Plan of Work

### Architecture Overview

**Claude Code Flow:**
```
Claude Code                     Superset Hook                    Main Process                     Renderer
      │                              │                              │                              │
      │ 1. ExitPlanMode              │                              │                              │
      │    permission request        │                              │                              │
      ├─────────────────────────────>│                              │                              │
      │                              │ 2. Read tool_input.plan      │                              │
      │                              │ 3. Write to temp file        │                              │
      │                              │ 4. notify.sh { filePath }    │                              │
      │                              ├─────────────────────────────>│                              │
      │                              │                              │ 5. Validate & read file      │
      │                              │                              │ 6. Emit PLAN_SUBMITTED       │
      │                              │                              ├─────────────────────────────>│
      │                              │                              │    7. addPlanViewerPane()    │
      │<─────────────────────────────┤                              │       with needsAttention    │
      │ 8. Return { behavior: allow }│                              │                              │
```

**OpenCode Flow:**
```
OpenCode Agent                  Superset Plugin                  Main Process                     Renderer
      │                              │                              │                              │
      │ 1. Calls submit_plan tool    │                              │                              │
      ├─────────────────────────────>│                              │                              │
      │                              │ 2. Write to temp file        │                              │
      │                              │ 3. notify.sh { filePath }    │                              │
      │                              ├─────────────────────────────>│                              │
      │                              │                              │ 4. Validate & read file      │
      │                              │                              │ 5. Emit PLAN_SUBMITTED       │
      │                              │                              ├─────────────────────────────>│
      │                              │                              │    6. addPlanViewerPane()    │
      │<─────────────────────────────┤                              │       with needsAttention    │
      │ 7. Return success message    │                              │                              │
```

### Milestone 1: Add `plan-viewer` Pane Type

Extend the shared types to support a new pane type for plans.

**In `apps/desktop/src/shared/tabs-types.ts`**:
1. Add `"plan-viewer"` to the `PaneType` union
2. Add `PlanViewerState` interface:
    
        interface PlanViewerState {
          content: string;           // The plan markdown
          planId: string;            // Unique identifier for this plan
          originPaneId: string;      // Terminal pane that submitted (for future response)
          status: 'pending';         // Future: 'approved' | 'rejected'
          summary?: string;          // Optional brief summary
          submittedAt: number;       // Timestamp
          agentType?: 'opencode' | 'claude';
        }
    
3. Add optional `planViewer?: PlanViewerState` field to `Pane` interface

**In `apps/desktop/src/renderer/stores/tabs/utils.ts`**:
1. Add `CreatePlanViewerPaneOptions` interface
2. Add `createPlanViewerPane(tabId, options)` factory function

**In `apps/desktop/src/renderer/stores/tabs/store.ts`** (persist config):
1. Update `partialize` in the persist middleware to exclude plan-viewer pane content from persistence (per Decision #2)

### Milestone 2: Create PlanViewerPane Component

Create a new pane component for rendering plans.

**Create `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/PlanViewerPane/PlanViewerPane.tsx`**:

1. Similar structure to `FileViewerPane` but simpler (no file fetching, no diff mode)
2. Accept `pane.planViewer.content` directly (already loaded by main process)
3. Render using `MarkdownRenderer` with Tufte styling
4. Minimal toolbar: plan title (from first heading), small timestamp badge, close/lock buttons (per Decision #3)
5. No content header - let the markdown content speak for itself
6. Props include `originPaneId` for future Phase 2 response channel

**Modify `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabsContent.tsx`**:

1. Add case for `plan-viewer` pane type in `renderTile()`
2. Render `PlanViewerPane` component with appropriate props

### Milestone 3: Extend Claude Code Wrapper for `ExitPlanMode` Hook

Add plan interception to the Claude Code wrapper.

**In `apps/desktop/src/main/lib/agent-setup/agent-wrappers.ts`**:

The existing Claude Code wrapper already has hook infrastructure. Add handling for `ExitPlanMode`:

```typescript
// In the Claude Code plugin/hook handler
// When ExitPlanMode permission is requested, the event contains the plan

async function handleClaudeCodeHook(event: HookEvent) {
  // Check if this is an ExitPlanMode permission request
  if (event.type === 'PermissionRequest' && event.permission?.name === 'ExitPlanMode') {
    const plan = event.tool_input?.plan;

    if (plan) {
      // Generate safe plan ID
      const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Write plan to temp file
      const plansDir = process.env.SUPERSET_PLANS_DIR;
      await fs.mkdir(plansDir, { recursive: true });
      const planPath = path.join(plansDir, `${planId}.md`);
      await fs.writeFile(planPath, plan, 'utf-8');

      // Notify main process
      const payload = JSON.stringify({
        type: 'plan_submitted',
        planId,
        planPath,
        originPaneId: process.env.SUPERSET_TAB_ID,
        agentType: 'claude',
      });
      execSync(`bash "${process.env.SUPERSET_NOTIFY_SCRIPT}" '${payload}'`);
    }

    // Allow the permission (plan mode exit proceeds)
    return { behavior: 'allow' };
  }

  // Handle other events...
}
```

**Hook Event Structure (from Plannotator analysis):**
```typescript
interface ExitPlanModeEvent {
  type: 'PermissionRequest';
  permission: {
    name: 'ExitPlanMode';
  };
  tool_input: {
    plan: string;  // The full markdown plan content
  };
}
```

### Milestone 4: Create OpenCode Plugin with `submit_plan` Tool

Create an OpenCode plugin (similar to Plannotator's approach).

**Create `apps/desktop/src/main/lib/agent-plugins/opencode-plan/`**:

The plugin follows Plannotator's pattern - it's a simple script that:
1. Registers a `submit_plan` tool
2. Writes plan to temp file when called
3. Notifies Superset main process

**`index.ts`** (OpenCode plugin entry point):

```typescript
// OpenCode plugin for plan submission
// Registered via opencode.json as "@superset/opencode-plan"

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PLANS_DIR = process.env.SUPERSET_PLANS_DIR || path.join(process.env.HOME || '', '.superset', 'tmp', 'plans');
const NOTIFY_SCRIPT = process.env.SUPERSET_NOTIFY_SCRIPT;
const ORIGIN_PANE_ID = process.env.SUPERSET_TAB_ID || '';

// Plugin definition matching OpenCode's plugin API
export default {
  name: '@superset/opencode-plan',
  version: '1.0.0',

  tools: {
    submit_plan: {
      description: 'Submit an implementation plan for visual review in Superset. Use this when you have created a plan that the user should review before implementation.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description: 'The full markdown content of the plan',
          },
          summary: {
            type: 'string',
            description: 'A brief one-line summary of the plan',
          },
        },
        required: ['plan'],
      },

      async execute({ plan, summary }: { plan: string; summary?: string }) {
        // Generate safe plan ID
        const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        // Ensure directory exists
        await fs.mkdir(PLANS_DIR, { recursive: true });

        // Write plan to temp file
        const planPath = path.join(PLANS_DIR, `${planId}.md`);
        await fs.writeFile(planPath, plan, 'utf-8');

        // Notify Superset main process
        if (NOTIFY_SCRIPT) {
          const payload = JSON.stringify({
            type: 'plan_submitted',
            planId,
            planPath,
            summary,
            originPaneId: ORIGIN_PANE_ID,
            agentType: 'opencode',
          });
          try {
            execSync(`bash "${NOTIFY_SCRIPT}" '${payload}'`);
          } catch (err) {
            console.error('[superset-plan] Failed to notify:', err);
          }
        }

        return 'Plan submitted successfully. It is now displayed in Superset for review.';
      },
    },
  },
};
```

**Configure OpenCode** to use the plugin via `.opencode.json` or wrapper script:

```json
{
  "plugins": ["@superset/opencode-plan"]
}
```

**Update wrapper script** in `apps/desktop/src/main/lib/agent-setup/agent-wrappers.ts`:

```typescript
export function buildOpenCodeWrapperScript(
  opencodeConfigDir: string,
  plansTmpDir: string,
  notifyScript: string,
): string {
  return `#!/bin/bash
${WRAPPER_MARKER}
# Superset wrapper for OpenCode

${REAL_BINARY_RESOLVER}
REAL_BIN="$(find_real_binary "opencode")"
if [ -z "$REAL_BIN" ]; then
  echo "${getMissingBinaryMessage("opencode")}" >&2
  exit 127
fi

export OPENCODE_CONFIG_DIR="${opencodeConfigDir}"
export SUPERSET_PLANS_DIR="${plansTmpDir}"
export SUPERSET_NOTIFY_SCRIPT="${notifyScript}"
exec "$REAL_BIN" "$@"
`;
}
```

**In `apps/desktop/src/shared/constants.ts`**:

Add new notification event type:

    NOTIFICATION_EVENTS = {
      ...existing,
      PLAN_SUBMITTED: 'plan_submitted',
    }

### Milestone 5: Main Process Plan Handler

Add plan notification handling in main process.

**In `apps/desktop/src/main/lib/notifications/server.ts`** (or equivalent):

1. Add handler for `plan_submitted` notification type
2. Validate `planPath` is within allowed directory (security)
3. Read file content from disk
4. Emit via tRPC subscription with full content + metadata

**Create `apps/desktop/src/main/lib/plans/` directory**:

1. `paths.ts` - Define `PLANS_TMP_DIR`
2. `cleanup.ts` - Delete old plan files on app start (mtime > 24h)
3. `validate.ts` - Validate plan file paths are safe

### Milestone 6: Handle Plan Event in Renderer

Add plan handling to the notification subscription.

**In `apps/desktop/src/renderer/stores/tabs/store.ts`**:

Add `addPlanViewerPane(workspaceId, options)` action:
1. Similar to `addFileViewerPane` but creates a plan-viewer pane
2. Reuses unlocked plan-viewer panes or creates new one
3. Sets `needsAttention: true` instead of focus (per Decision #1)
4. Does NOT update `focusedPaneIds` - pane appears without disrupting user

**In `apps/desktop/src/renderer/stores/tabs/useAgentHookListener.ts`**:

Add handler for `PLAN_SUBMITTED` event:
1. Extract plan content and metadata from event
2. Resolve target workspace from `SUPERSET_TAB_ID`
3. Call `addPlanViewerPane()` to display the plan
4. Pane appears with attention indicator, user clicks when ready

### Milestone 7: Claude Code Hook Extension (Out of Scope)

Explicitly out of scope for Phase 1. Claude Code's `ExitPlanMode` hook may not expose plan content. Revisit when we have a reliable mechanism to capture the plan text from Claude Code.

## Concrete Steps

### Step 1: Create Plans Directory Structure

    mkdir -p apps/desktop/src/main/lib/plans

Create helper files:

**`paths.ts`**:

    import os from "node:os";
    import path from "node:path";
    import { app } from "electron";
    
    // Use app.getPath for Electron-managed user data, or fallback for dev
    const getBaseDir = () => {
      try {
        return app.getPath("userData");
      } catch {
        return path.join(os.homedir(), ".superset");
      }
    };
    
    export const PLANS_TMP_DIR = path.join(getBaseDir(), "tmp", "plans");
    
    // Valid plan ID pattern: alphanumeric + hyphens only
    export const PLAN_ID_PATTERN = /^[a-zA-Z0-9-]+$/;
    
    export const MAX_PLAN_FILE_SIZE = 1024 * 1024; // 1MB

**`validate.ts`**:

    import fs from "node:fs";
    import path from "node:path";
    import { PLANS_TMP_DIR, PLAN_ID_PATTERN, MAX_PLAN_FILE_SIZE } from "./paths";
    
    export async function validateAndReadPlanFile(filePath: string): Promise<{
      ok: true; content: string;
    } | {
      ok: false; error: string;
    }> {
      // Resolve to canonical path (prevents ../ traversal)
      const resolvedPath = path.resolve(filePath);
      const realPath = await fs.promises.realpath(resolvedPath).catch(() => null);
      
      if (!realPath) {
        return { ok: false, error: "File does not exist" };
      }

      // Must be within PLANS_TMP_DIR (use path.sep to prevent /plans-evil/ bypass)
      const normalizedDir = PLANS_TMP_DIR.endsWith(path.sep) ? PLANS_TMP_DIR : PLANS_TMP_DIR + path.sep;
      if (!realPath.startsWith(normalizedDir)) {
        return { ok: false, error: "Path outside allowed directory" };
      }
      
      // Filename must match pattern
      const filename = path.basename(realPath);
      const planId = filename.replace(/\.md$/, "");
      if (!PLAN_ID_PATTERN.test(planId)) {
        return { ok: false, error: "Invalid plan ID format" };
      }
      
      // Check file size
      const stats = await fs.promises.stat(realPath);
      if (stats.size > MAX_PLAN_FILE_SIZE) {
        return { ok: false, error: "Plan file too large" };
      }
      
      const content = await fs.promises.readFile(realPath, "utf-8");
      return { ok: true, content };
    }

**`cleanup.ts`**:

    import fs from "node:fs";
    import path from "node:path";
    import { PLANS_TMP_DIR } from "./paths";
    
    const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    
    export async function cleanupOldPlanFiles(): Promise<void> {
      try {
        const files = await fs.promises.readdir(PLANS_TMP_DIR);
        const now = Date.now();
        
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          
          const filePath = path.join(PLANS_TMP_DIR, file);
          const stats = await fs.promises.stat(filePath).catch(() => null);
          
          if (stats && now - stats.mtimeMs > MAX_AGE_MS) {
            await fs.promises.unlink(filePath).catch(() => {});
          }
        }
      } catch {
        // Best-effort, non-blocking - ignore errors
      }
    }

### Step 2: Extend Shared Types

Edit `apps/desktop/src/shared/tabs-types.ts`:

    // Add to PaneType
    export type PaneType = "terminal" | "webview" | "file-viewer" | "plan-viewer";
    
    // Add new interface
    export interface PlanViewerState {
      content: string;
      planId: string;
      originPaneId: string;       // For future Phase 2 response
      status: 'pending';          // Future: 'approved' | 'rejected'
      summary?: string;
      submittedAt: number;
      agentType?: 'opencode' | 'claude';
    }
    
    // Add to Pane interface
    export interface Pane {
      // ...existing fields
      planViewer?: PlanViewerState;
    }

Edit `apps/desktop/src/shared/constants.ts`:

    export const NOTIFICATION_EVENTS = {
      AGENT_COMPLETE: 'agent_complete',
      FOCUS_TAB: 'focus_tab',
      PLAN_SUBMITTED: 'plan_submitted',
    };

### Step 3: Add Factory Function

Edit `apps/desktop/src/renderer/stores/tabs/utils.ts`:

    export interface CreatePlanViewerPaneOptions {
      content: string;
      planId: string;
      originPaneId: string;
      summary?: string;
      agentType?: 'opencode' | 'claude';
    }
    
    export const createPlanViewerPane = (
      tabId: string,
      options: CreatePlanViewerPaneOptions,
    ): Pane => {
      const id = generateId("pane");
      
      // Extract title from first heading or use summary
      const titleMatch = options.content.match(/^#\s+(.+)$/m);
      const title = titleMatch?.[1]?.slice(0, 40) || options.summary?.slice(0, 30) || "Plan";
      
      return {
        id,
        tabId,
        type: "plan-viewer",
        name: title,
        needsAttention: true,  // Highlight that plan needs review
        planViewer: {
          content: options.content,
          planId: options.planId,
          originPaneId: options.originPaneId,
          status: 'pending',
          summary: options.summary,
          submittedAt: Date.now(),
          agentType: options.agentType,
        },
      };
    };

### Step 4: Update Store Persistence

Edit `apps/desktop/src/renderer/stores/tabs/store.ts`:

Update the persist middleware to exclude plan-viewer panes AND their layout references:

    import { removePaneFromLayout } from "./utils";
    
    // Helper to filter plan-viewer panes from layouts
    const filterPlanViewerFromLayout = (
      layout: MosaicNode<string>,
      planPaneIds: Set<string>
    ): MosaicNode<string> | null => {
      let result = layout;
      for (const paneId of planPaneIds) {
        const filtered = removePaneFromLayout(result, paneId);
        if (!filtered) return null;
        result = filtered;
      }
      return result;
    };
    
    persist(
      (set, get) => ({ ... }),
      {
        name: "tabs-storage",
        storage: trpcTabsStorage,
        partialize: (state) => {
          // Find all plan-viewer pane IDs
          const planPaneIds = new Set(
            Object.entries(state.panes)
              .filter(([_, pane]) => pane.type === 'plan-viewer')
              .map(([id]) => id)
          );
          
          // Filter panes
          const filteredPanes = Object.fromEntries(
            Object.entries(state.panes).filter(
              ([_, pane]) => pane.type !== 'plan-viewer'
            )
          );
          
          // Filter layouts to remove dangling plan-viewer references
          const filteredTabs = state.tabs.map(tab => ({
            ...tab,
            layout: filterPlanViewerFromLayout(tab.layout, planPaneIds) || tab.layout,
          }));
          
          // Filter focusedPaneIds to remove plan-viewer references
          const filteredFocusedPaneIds = Object.fromEntries(
            Object.entries(state.focusedPaneIds).filter(
              ([_, paneId]) => !planPaneIds.has(paneId)
            )
          );
          
          return {
            ...state,
            tabs: filteredTabs,
            panes: filteredPanes,
            focusedPaneIds: filteredFocusedPaneIds,
          };
        },
      },
    )

Add `addPlanViewerPane` action (similar to `addFileViewerPane` but no focus):

    addPlanViewerPane: (workspaceId, options) => {
      const state = get();
      const activeTabId = state.activeTabIds[workspaceId];
      const activeTab = state.tabs.find((t) => t.id === activeTabId);
      if (!activeTab) return "";
      
      // Look for existing unlocked plan-viewer pane to reuse
      const tabPaneIds = extractPaneIdsFromLayout(activeTab.layout);
      const planViewerPanes = tabPaneIds
        .map((id) => state.panes[id])
        .filter((p) => p?.type === "plan-viewer" && !p.planViewer?.isLocked);
      
      if (planViewerPanes.length > 0) {
        // Reuse existing pane
        const paneToReuse = planViewerPanes[0];
        set({
          panes: {
            ...state.panes,
            [paneToReuse.id]: createPlanViewerPane(activeTab.id, options),
          },
        });
        return paneToReuse.id;
      }
      
      // Create new pane (no focus change!)
      const newPane = createPlanViewerPane(activeTab.id, options);
      const newLayout = { direction: "row", first: activeTab.layout, second: newPane.id, splitPercentage: 50 };
      
      set({
        tabs: state.tabs.map((t) => t.id === activeTab.id ? { ...t, layout: newLayout } : t),
        panes: { ...state.panes, [newPane.id]: newPane },
        // NOTE: Do NOT update focusedPaneIds - don't steal focus
      });
      
      return newPane.id;
    }

### Step 5: Create PlanViewerPane Component

Create `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/PlanViewerPane/PlanViewerPane.tsx`:

    import { MosaicWindow } from "react-mosaic-component";
    import { MarkdownRenderer } from "renderer/components/MarkdownRenderer";
    import { Badge } from "@superset/ui/badge";
    import { formatDistanceToNow } from "date-fns";
    // ... imports
    
    export function PlanViewerPane({ pane, path, isActive, ... }) {
      const planViewer = pane.planViewer;
      if (!planViewer) return null;
      
      const timeAgo = formatDistanceToNow(planViewer.submittedAt, { addSuffix: true });
      
      return (
        <MosaicWindow path={path} title="" renderToolbar={() => (
          <div className="flex items-center justify-between px-2 w-full h-full">
            <span className="text-xs font-medium truncate">{pane.name}</span>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{timeAgo}</Badge>
              {/* Lock and close buttons */}
            </div>
          </div>
        )}>
          <div className="h-full overflow-auto p-4">
            <MarkdownRenderer content={planViewer.content} style="tufte" />
          </div>
        </MosaicWindow>
      );
    }

### Step 6: Wire Up Component in TabsContent

Edit `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabsContent.tsx`:

In `renderTile()`, add case for plan-viewer:

    if (pane.type === "plan-viewer") {
      return (
        <PlanViewerPane
          paneId={paneId}
          path={path}
          pane={pane}
          isActive={isActive}
          tabId={tabId}
          removePane={removePane}
          setFocusedPane={setFocusedPane}
        />
      );
    }

### Step 7: Extend Agent Hooks for Plan Submission

**Claude Code: Extend the hook handler**

In `apps/desktop/src/main/lib/agent-setup/agent-wrappers.ts`, update the Claude Code hook handler to intercept `ExitPlanMode`:

```typescript
// Add to the existing hook handling code
async function handleClaudeCodePermissionRequest(event: HookEvent): Promise<HookResponse> {
  // Check for ExitPlanMode (plan submission)
  if (event.permission?.name === 'ExitPlanMode') {
    const plan = event.tool_input?.plan;

    if (plan && typeof plan === 'string') {
      const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const plansDir = process.env.SUPERSET_PLANS_DIR;

      if (plansDir) {
        await fs.mkdir(plansDir, { recursive: true });
        const planPath = path.join(plansDir, `${planId}.md`);
        await fs.writeFile(planPath, plan, 'utf-8');

        // Notify main process
        const notifyScript = process.env.SUPERSET_NOTIFY_SCRIPT;
        if (notifyScript) {
          const payload = JSON.stringify({
            type: 'plan_submitted',
            planId,
            planPath,
            originPaneId: process.env.SUPERSET_TAB_ID,
            agentType: 'claude',
          });
          execSync(`bash "${notifyScript}" '${payload}'`);
        }
      }
    }

    // Allow ExitPlanMode to proceed
    return { behavior: 'allow' };
  }

  // Handle other permissions...
  return { behavior: 'allow' };
}
```

**OpenCode: Create the plugin**

Create `apps/desktop/src/main/lib/agent-plugins/opencode-plan/index.ts`:

```typescript
// OpenCode plugin for plan submission (follows Plannotator pattern)
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PLANS_DIR = process.env.SUPERSET_PLANS_DIR || path.join(process.env.HOME || '', '.superset', 'tmp', 'plans');
const NOTIFY_SCRIPT = process.env.SUPERSET_NOTIFY_SCRIPT;

export default {
  name: '@superset/opencode-plan',
  version: '1.0.0',

  tools: {
    submit_plan: {
      description: 'Submit an implementation plan for visual review in Superset.',
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string', description: 'The full markdown plan content' },
          summary: { type: 'string', description: 'Brief one-line summary' },
        },
        required: ['plan'],
      },

      async execute({ plan, summary }: { plan: string; summary?: string }) {
        const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        await fs.mkdir(PLANS_DIR, { recursive: true });
        const planPath = path.join(PLANS_DIR, `${planId}.md`);
        await fs.writeFile(planPath, plan, 'utf-8');

        if (NOTIFY_SCRIPT) {
          const payload = JSON.stringify({
            type: 'plan_submitted',
            planId,
            planPath,
            summary,
            originPaneId: process.env.SUPERSET_TAB_ID,
            agentType: 'opencode',
          });
          execSync(`bash "${NOTIFY_SCRIPT}" '${payload}'`);
        }

        return 'Plan submitted successfully. It is now displayed in Superset for review.';
      },
    },
  },
};
```

**Update wrapper scripts** to pass required environment variables (both agents need `SUPERSET_PLANS_DIR` and `SUPERSET_NOTIFY_SCRIPT`).

### Step 8: Handle Plan Notification in Main Process

Edit `apps/desktop/src/main/lib/notifications/server.ts` (or equivalent):

    import { validateAndReadPlanFile } from "../plans/validate";
    import { notificationsEmitter } from "./emitter";
    import { NOTIFICATION_EVENTS } from "shared/constants";
    
    // In the notification handler, add case for plan_submitted:
    
    if (data.type === "plan_submitted") {
      const { planId, planPath, summary, originPaneId, agentType } = data;
      
      // Validate and read plan file securely
      const result = await validateAndReadPlanFile(planPath);
      
      if (!result.ok) {
        console.warn(`[notifications] Invalid plan file: ${result.error}`);
        return;
      }
      
      // Emit to renderer via tRPC subscription
      notificationsEmitter.emit(NOTIFICATION_EVENTS.PLAN_SUBMITTED, {
        content: result.content,
        planId,
        summary,
        originPaneId,
        agentType,
      });
      
      return;
    }

Also call cleanup on app start in `apps/desktop/src/main/index.ts`:

    import { cleanupOldPlanFiles } from "./lib/plans/cleanup";
    
    app.whenReady().then(async () => {
      // Best-effort cleanup of old plan files
      cleanupOldPlanFiles();
      
      // ... rest of app initialization
    });

### Step 9: Handle Event in Renderer

Edit `apps/desktop/src/renderer/stores/tabs/useAgentHookListener.ts`:

Add handler for `PLAN_SUBMITTED`:

    if (event.type === NOTIFICATION_EVENTS.PLAN_SUBMITTED) {
      const { content, planId, summary, originPaneId, agentType } = event.data;
      
      state.addPlanViewerPane(workspaceId, {
        content,
        planId,
        originPaneId,
        summary,
        agentType,
      });
    }

## Validation and Acceptance

### Acceptance Criteria

1. **Plan appears automatically**: When running `opencode` in a Superset terminal and the agent calls `submit_plan`, a new pane opens showing the plan in Tufte-styled markdown.

2. **Plan renders correctly**: Code blocks, headings, lists, and other markdown elements render properly with syntax highlighting.

3. **Pane integrates with layout**: The plan pane behaves like other panes - can be split, moved, closed, locked.

4. **No regression**: Existing file-viewer and terminal panes continue to work.

### Validation Steps

1. Start dev mode:
   
        bun run dev
        cd apps/desktop && bun run dev

2. Open the desktop app and create a workspace

3. Open a terminal and run:
   
        opencode

4. Have the agent create a plan and call `submit_plan`

5. Verify:
   - A new pane appears with the plan content
   - Markdown renders with Tufte styling
   - Pane can be closed, locked, split
   - Terminal pane still functions normally

6. Run type check:
   
        bun run typecheck

7. Run lint:
   
        bun run lint

## Idempotence and Recovery

- All changes are additive (new types, new component, new action)
- No migrations required
- No database changes
- If implementation fails partway, unused types and components can be deleted

## Artifacts and Notes

### Reference: Plannotator Architecture

From the Plannotator project analysis:

- Uses ephemeral Bun server to serve plan UI
- Annotation types: DELETION, INSERTION, REPLACEMENT, COMMENT, GLOBAL_COMMENT
- Plan is parsed into blocks: heading, paragraph, code, list-item, blockquote, table
- URL sharing via deflate compression in hash
- `web-highlighter` library for text selection and annotation

This informs future phases (annotation support) but is not needed for Phase 1.

### Reference: Existing MarkdownRenderer Usage

    <MarkdownRenderer 
      content={rawFileData.content}
      style="tufte"  // or "default"
    />

The component accepts `content` string and optional `style` prop.

### Temp File Approach Rationale

Why temp files instead of passing content directly:

1. **Payload size**: Plans can be large (10KB+). Querystrings have limits (~2KB), IPC has memory overhead.
2. **Reliability**: File paths are tiny strings that always fit in any transport.
3. **Debuggability**: Can inspect plan files on disk for troubleshooting.
4. **Cleanup**: Simple mtime-based cleanup policy (delete files > 24h old).
5. **Security**: Main process validates path before reading, preventing arbitrary file access.

File location: `~/.superset/tmp/plans/{planId}.md`
- Owned by Superset (not shared `/tmp`)
- Easy to find and clean up
- Per-user isolation

### Agent Integration Reference

Both agents are integrated using their native hook/plugin patterns (matching Plannotator's approach):

**Claude Code: ExitPlanMode Hook**

When Claude Code exits plan mode, it fires a `PermissionRequest` event:

```typescript
interface ExitPlanModeEvent {
  type: 'PermissionRequest';
  permission: { name: 'ExitPlanMode' };
  tool_input: {
    plan: string;  // Full markdown plan content
  };
}
```

The hook handler reads `tool_input.plan`, writes to temp file, and notifies main process.

**OpenCode: Plugin with submit_plan Tool**

OpenCode plugin registers a `submit_plan` tool:

```typescript
{
  name: 'submit_plan',
  description: 'Submit an implementation plan for visual review in Superset.',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'Full markdown plan content' },
      summary: { type: 'string', description: 'Brief one-line summary' },
    },
    required: ['plan'],
  },
}
```

When called, the plugin writes plan to temp file and notifies main process.

**Reference: Plannotator**

This integration pattern is proven by Plannotator (https://github.com/backnotprop/plannotator) which has working implementations for both Claude Code and OpenCode.

## Interfaces and Dependencies

### New Types (in shared/tabs-types.ts)

    interface PlanViewerState {
      content: string;
      planId: string;
      originPaneId: string;
      status: 'pending';  // Future: | 'approved' | 'rejected'
      summary?: string;
      submittedAt: number;
      agentType?: 'opencode' | 'claude';
      isLocked?: boolean;  // Prevent pane reuse
    }

### New Store Actions (in tabs/store.ts)

    addPlanViewerPane: (
      workspaceId: string,
      options: {
        content: string;
        planId: string;
        originPaneId: string;
        summary?: string;
        agentType?: 'opencode' | 'claude';
      }
    ) => string;  // returns paneId

### New Component (PlanViewerPane)

    interface PlanViewerPaneProps {
      paneId: string;
      path: MosaicBranch[];
      pane: Pane;
      isActive: boolean;
      tabId: string;
      removePane: (paneId: string) => void;
      setFocusedPane: (tabId: string, paneId: string) => void;
    }

### Notification Event Shape (from plugin to main)

    // Sent by OpenCode plugin via notify.sh
    interface PlanSubmittedNotification {
      type: 'plan_submitted';
      planId: string;
      planPath: string;  // File path, not content
      summary?: string;
      originPaneId: string;
      agentType: 'opencode' | 'claude';
    }

### tRPC Event Shape (main to renderer)

    // Emitted via tRPC subscription after main reads file
    interface PlanSubmittedEvent {
      type: 'plan_submitted';
      data: {
        content: string;  // Full markdown content (read from file)
        planId: string;
        originPaneId: string;
        summary?: string;
        agentType: 'opencode' | 'claude';
      };
    }

### Event Routing

1. **Constants** (`apps/desktop/src/shared/constants.ts`):
   Add `PLAN_SUBMITTED: 'plan_submitted'` to `NOTIFICATION_EVENTS`

2. **Emitter** (`apps/desktop/src/main/lib/notifications/emitter.ts`):
   Existing `notificationsEmitter` EventEmitter - no changes needed

3. **tRPC Router** (`apps/desktop/src/lib/trpc/routers/notifications.ts`):
   Add `PLAN_SUBMITTED` case to the subscription observable

4. **Renderer Handler** (`apps/desktop/src/renderer/stores/tabs/useAgentHookListener.ts`):
   Add handler for `NOTIFICATION_EVENTS.PLAN_SUBMITTED`

### New Files

    apps/desktop/src/main/lib/plans/
    ├── paths.ts           # PLANS_TMP_DIR constant
    ├── cleanup.ts         # Delete old plan files
    └── validate.ts        # Validate plan file paths

    apps/desktop/src/main/lib/agent-plugins/opencode-plan/
    └── index.ts           # OpenCode plugin with submit_plan tool

    apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/PlanViewerPane/
    ├── PlanViewerPane.tsx
    └── index.ts

### Dependencies

**No new npm dependencies required.** Uses existing:
- `react-mosaic-component` for pane layout
- `date-fns` for timestamp formatting (already in project)
- `MarkdownRenderer` for Tufte rendering

The agent integrations use native hook/plugin patterns - no external SDKs needed.

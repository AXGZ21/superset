# UI Refactor Plan: Conductor + Warp Style

Transform Superset's interface from a tab-heavy layout to a clean, sidebar-driven workspace navigation like Conductor, with Warp's minimal chrome philosophy.

---

## Current State Analysis

### Superset Current Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [tabs: stop | auto | escap | setti | mobi | other | ui-p | ...] │  ← Crowded tab bar
├──────────┬──────────────────────────────────────┬───────────────┤
│ Sidebar  │         Main Content                 │  Right Panel  │
│ ─────────│                                      │               │
│ +Terminal│  Terminal Window                     │  Terminal     │
│ codex    │  ┌─────────────────────────────┐    │  Output       │
│ claude   │  │ Console Error               │    │               │
│ gemini   │  │ ## Error Message            │    │               │
│ cursor   │  │ ...                         │    │               │
│ ─────────│  └─────────────────────────────┘    │               │
│ PORTS    │                                      │               │
│ 54898    │                                      │               │
│ 57532    │                                      │               │
└──────────┴──────────────────────────────────────┴───────────────┘
```

**Problems:**
1. Tab bar becomes unusable with many workspaces
2. Sidebar mixes terminals, ports, and experiments
3. No repository grouping
4. No visible branch/PR info at glance
5. Visual density is high

---

### Conductor Target Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ← →  ⚡ AviPeltz/baghdad                    /baghdad  [Open ▾]   │  ← Minimal top bar
├──────────────┬─────────────────────────────────┬─────────────────┤
│  Workspaces  │  ❋ Untitled    +               │ Changes │ Files │
│  ═══════════ │                                 │ ═══════════════ │
│  superset    │  ⚡ Branched from origin/main   │ .charlie        │
│  ├─ + New    │                                 │ .claude         │
│  ├─ baghdad  │  📁 Created baghdad ▾          │ .context        │
│  │   19m ⌘1  │     and copied 1057 files      │ .cursor         │
│  ├─ session  │                                 │ .github         │
│  │   2d  ⌘2  │  ○ Optional: add setup script  │ .superset       │
│  └─ mcmaster │                                 │ apps            │
│              │  ⇄ Optional: select dirs       │ assets          │
│  category    │                                 │ docs            │
│  ├─ + New    │  ┌─────────────────────────┐   │ packages        │
│  └─ nicosia  │  │ Done! You're in an      │   │ scripts         │
│      PR #1   │  │ isolated copy.          │   │ tooling         │
│              │  └─────────────────────────┘   │                 │
│  humanlayer  │                                 │ ─────────────── │
│  ├─ + New    │                                 │ Run │ Terminal │
│              │                                 │ (base) %        │
│  mesh-editor │                                 │                 │
│  ├─ + New    │ ────────────────────────────── │                 │
│              │ Ask to make changes, @mention   │                 │
│ ─────────────│ [❋ Opus 4.5] [icons...]   [↑]  │                 │
│ + Add repo   │                                 │                 │
└──────────────┴─────────────────────────────────┴─────────────────┘
```

**Key Features:**
1. Workspaces organized by repository in sidebar
2. Inline "+ New workspace" per repo
3. Branch/PR badges visible
4. Keyboard shortcuts visible (⌘1, ⌘2, etc.)
5. Minimal top bar - just current workspace
6. Right panel for files/changes
7. Bottom-docked chat input

---

## Refactor Plan

### Phase 1: Sidebar Architecture (High Priority)

#### 1.1 New Sidebar Data Structure

```typescript
// Current: Flat list of workspaces
workspaces: Workspace[]

// Target: Grouped by repository
interface Repository {
  id: string;
  name: string;           // "superset"
  owner?: string;         // "AviPeltz" (for remote repos)
  path: string;           // "/Users/avi/Developer/superset"
  isExpanded: boolean;
  workspaces: Workspace[];
}

interface Workspace {
  id: string;
  name: string;           // "baghdad"
  branch: string;         // "baghdad" or "main"
  baseBranch: string;     // "origin/main"
  createdAt: Date;
  lastAccessedAt: Date;
  prNumber?: number;      // #1 if has PR
  prStatus?: 'open' | 'merged' | 'closed';
  keyboardShortcut?: string;  // "⌘1"
  status: 'active' | 'archived';
}

interface SidebarState {
  repositories: Repository[];
  activeWorkspaceId: string | null;
}
```

#### 1.2 Sidebar Component Structure

```
Sidebar/
├── Sidebar.tsx                    # Main container
├── index.ts
├── components/
│   ├── SidebarHeader/
│   │   ├── SidebarHeader.tsx      # "Workspaces" title + collapse
│   │   └── index.ts
│   ├── RepositoryGroup/
│   │   ├── RepositoryGroup.tsx    # Collapsible repo section
│   │   ├── RepositoryHeader.tsx   # Repo name + new workspace btn
│   │   └── index.ts
│   ├── WorkspaceItem/
│   │   ├── WorkspaceItem.tsx      # Individual workspace row
│   │   ├── WorkspaceBadge.tsx     # PR badge, branch badge
│   │   ├── WorkspaceMenu.tsx      # Right-click context menu
│   │   └── index.ts
│   ├── AddRepository/
│   │   ├── AddRepository.tsx      # "+ Add repository" button
│   │   └── index.ts
│   └── SidebarFooter/
│       ├── SidebarFooter.tsx      # Settings gear, etc.
│       └── index.ts
└── hooks/
    ├── useSidebarState.ts
    └── useWorkspaceShortcuts.ts
```

#### 1.3 Workspace Item Design

```
┌────────────────────────────────────────────┐
│ ⚡ AviPeltz/baghdad                        │  ← Active state (highlighted bg)
│    baghdad · 19m ago                   ⌘1  │
├────────────────────────────────────────────┤
│ ⚡ session-tab-refactor                    │  ← Normal state
│    madrid · 2d ago                     ⌘2  │
├────────────────────────────────────────────┤
│ 🔀 category-scraper                        │  ← Has PR
│    nicosia · PR #1 · Archive           ⌘3  │
└────────────────────────────────────────────┘
```

**Visual states:**
- Default: `bg-transparent`
- Hover: `bg-muted/50`
- Active: `bg-sidebar-accent` with left border accent
- Has PR: Show PR badge with status color

---

### Phase 2: Top Bar Simplification

#### 2.1 Current → Target

**Current:**
```
[tab1][tab2][tab3][tab4][tab5][tab6][tab7][tab8][tab9]...
```

**Target:**
```
← →  ⚡ AviPeltz/baghdad                    /baghdad  [Open ▾]
```

#### 2.2 New Top Bar Components

```typescript
// TopBar.tsx
<div className="flex items-center h-12 px-4 border-b">
  {/* Navigation */}
  <div className="flex items-center gap-1">
    <Button variant="ghost" size="iconSm" onClick={goBack}>
      <ChevronLeft className="size-4" />
    </Button>
    <Button variant="ghost" size="iconSm" onClick={goForward}>
      <ChevronRight className="size-4" />
    </Button>
  </div>

  {/* Current Workspace */}
  <div className="flex items-center gap-2 ml-4">
    <BranchIcon className="size-4 text-muted-foreground" />
    <span className="font-medium">{workspace.owner}/{workspace.name}</span>
  </div>

  {/* Spacer */}
  <div className="flex-1" />

  {/* Quick Actions */}
  <div className="flex items-center gap-2">
    <Badge variant="outline" className="font-mono text-xs">
      /{workspace.branch}
    </Badge>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Open <ChevronDown className="ml-1 size-3" />
        </Button>
      </DropdownMenuTrigger>
      {/* Open in VSCode, Cursor, Terminal, etc. */}
    </DropdownMenu>
  </div>
</div>
```

#### 2.3 Tab Bar → Tab Strip (Optional)

If multiple files/sessions need to be open within a workspace, use a secondary tab strip below the top bar (like VS Code):

```
┌─────────────────────────────────────────────────────────────┐
│ ← →  ⚡ AviPeltz/baghdad                   /baghdad [Open▾] │
├─────────────────────────────────────────────────────────────┤
│ [❋ Untitled] [Terminal 1] [Terminal 2]                  [+] │  ← Session tabs
├─────────────────────────────────────────────────────────────┤
│                      Main Content                           │
└─────────────────────────────────────────────────────────────┘
```

---

### Phase 3: Right Panel Redesign

#### 3.1 Panel Tabs

```typescript
type RightPanelTab = 'changes' | 'files' | 'terminal';

// Panel header with tabs
<div className="flex items-center border-b">
  <Tabs value={activeTab} onValueChange={setActiveTab}>
    <TabsList className="bg-transparent">
      <TabsTrigger value="changes">
        Changes
        {changesCount > 0 && (
          <Badge variant="secondary" className="ml-1">{changesCount}</Badge>
        )}
      </TabsTrigger>
      <TabsTrigger value="files">All files</TabsTrigger>
    </TabsList>
  </Tabs>
</div>
```

#### 3.2 File Tree Component

```
Changes (3)  │ All files
─────────────────────────
📁 .charlie
📁 .claude
📁 .context
📁 .cursor
📁 .github
📁 .superset
📁 apps
📁 assets
📁 docs
📁 packages
📁 scripts
📁 tooling
─────────────────────────
▼ Run  │ Terminal │ [+]
─────────────────────────
(base) (AviPeltz/baghdad) %
█
```

---

### Phase 4: Chat Input Bar (Bottom-Docked)

#### 4.1 Conductor-Style Input

```typescript
// ChatInputBar.tsx
<div className="border-t bg-background/95 backdrop-blur p-4">
  <div className="relative">
    <Textarea
      placeholder="Ask to make changes, @mention files, run /commands"
      className="min-h-[60px] pr-24 resize-none"
    />
    <div className="absolute bottom-2 left-2 flex items-center gap-1">
      <ModelSelector value={model} onChange={setModel} />
      <Button variant="ghost" size="iconSm"><Globe /></Button>
      <Button variant="ghost" size="iconSm"><Paperclip /></Button>
      <Button variant="ghost" size="iconSm"><AlertTriangle /></Button>
    </div>
    <div className="absolute bottom-2 right-2 flex items-center gap-1">
      <Button variant="ghost" size="iconSm"><Tag /></Button>
      <Button variant="ghost" size="iconSm"><FileText /></Button>
      <Button size="iconSm"><ArrowUp /></Button>
    </div>
  </div>
</div>
```

#### 4.2 Model Selector (Like Conductor)

```typescript
// ModelSelector.tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" className="gap-1">
      <Sparkles className="size-3" />
      Opus 4.5
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem>Opus 4.5</DropdownMenuItem>
    <DropdownMenuItem>Sonnet 4</DropdownMenuItem>
    <DropdownMenuItem>Haiku 3.5</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

### Phase 5: Polish Details

#### 5.1 Animations

```typescript
// Sidebar expand/collapse
const sidebarVariants = {
  expanded: { width: 260 },
  collapsed: { width: 48 },
};

// Workspace item selection
const workspaceVariants = {
  inactive: { backgroundColor: 'transparent' },
  active: { backgroundColor: 'hsl(var(--sidebar-accent))' },
};

// Right panel slide
const panelVariants = {
  open: { x: 0, opacity: 1 },
  closed: { x: 20, opacity: 0 },
};
```

#### 5.2 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘1-9` | Switch to workspace 1-9 |
| `⌘N` | New workspace in current repo |
| `⌘B` | Toggle sidebar |
| `⌘J` | Toggle right panel |
| `⌘K` | Open command palette |
| `⌘/` | Focus chat input |

#### 5.3 Context Menus

**Workspace right-click:**
```
┌──────────────────────────┐
│ Open in Editor       ⌘O  │
│ Open in Terminal     ⌘T  │
│ ─────────────────────    │
│ Rename...            ⌘R  │
│ Duplicate                │
│ ─────────────────────    │
│ Create PR                │
│ View PR #1           ↗   │
│ ─────────────────────    │
│ Archive                  │
│ Delete...            ⌫   │
└──────────────────────────┘
```

**Repository right-click:**
```
┌──────────────────────────┐
│ New Workspace        ⌘N  │
│ ─────────────────────    │
│ Open Folder              │
│ Open in GitHub       ↗   │
│ ─────────────────────    │
│ Collapse All             │
│ Remove Repository        │
└──────────────────────────┘
```

---

## Component Migration Map

| Current Component | New Component | Changes |
|-------------------|---------------|---------|
| `WorkspaceTabs` (top) | `Sidebar/RepositoryGroup` | Move to sidebar, group by repo |
| `Sidebar` (terminals) | `RightPanel/Terminal` | Move terminals to right panel |
| `PortsPanel` | `RightPanel/Ports` | Move to right panel tab |
| N/A | `TopBar` | New minimal top bar |
| N/A | `ChatInputBar` | New bottom-docked input |
| N/A | `RightPanel/FileTree` | New file browser |

---

## Implementation Order

### Week 1: Data Layer
1. [ ] Define new TypeScript interfaces
2. [ ] Create workspace grouping logic
3. [ ] Add repository detection from paths
4. [ ] Migrate workspace store to new shape

### Week 2: Sidebar
1. [ ] Build `RepositoryGroup` component
2. [ ] Build `WorkspaceItem` component
3. [ ] Add expand/collapse animations
4. [ ] Wire up keyboard shortcuts
5. [ ] Add context menus

### Week 3: Top Bar + Right Panel
1. [ ] Replace tab bar with minimal top bar
2. [ ] Build right panel with tabs
3. [ ] Move terminal to right panel
4. [ ] Add file tree component

### Week 4: Chat Input + Polish
1. [ ] Build bottom-docked chat input
2. [ ] Add model selector
3. [ ] Polish animations
4. [ ] Test all keyboard shortcuts
5. [ ] Dark mode audit

---

## Visual Comparison

### Before (Superset)
- ❌ Crowded tab bar
- ❌ Flat workspace list
- ❌ Mixed sidebar content
- ❌ No repository grouping
- ❌ No keyboard shortcuts visible

### After (Conductor/Warp Style)
- ✅ Clean top bar
- ✅ Hierarchical sidebar
- ✅ Repository grouping
- ✅ Keyboard shortcuts visible
- ✅ Bottom-docked chat
- ✅ Right panel for files/terminal
- ✅ Minimal chrome

---

## Key Design Decisions

### 1. Where do terminals go?

**Recommendation:** Right panel, as a tab alongside "Files" and "Changes"

This matches VS Code's layout and keeps the main content area focused on the chat/agent interaction.

### 2. How to handle many workspaces?

**Recommendation:** Collapsible repository groups + search/filter

- Repos collapse to show just the name
- Add a search bar at top of sidebar
- Show "Archive" section for old workspaces

### 3. How to show workspace status?

**Recommendation:** Subtle badges and icons

```
⚡ active branch      (lightning = worktree active)
🔀 has PR             (merge icon)
⏸️ paused/archived    (pause icon)
✓ PR merged           (checkmark)
```

### 4. What about the PORTS section?

**Recommendation:** Move to right panel as collapsible section at bottom

```
─────────────────────────
▼ Ports
  localhost:3000    ↗
  localhost:5432    ↗
─────────────────────────
```

---

## Files to Modify

```
apps/desktop/src/renderer/
├── components/
│   ├── Sidebar/                    # Major refactor
│   │   ├── Sidebar.tsx             # New grouped layout
│   │   ├── RepositoryGroup.tsx     # NEW
│   │   ├── WorkspaceItem.tsx       # NEW
│   │   └── AddRepository.tsx       # NEW
│   ├── TopBar/                     # Replace WorkspaceTabs
│   │   ├── TopBar.tsx              # NEW - minimal bar
│   │   └── WorkspaceNav.tsx        # NEW
│   ├── RightPanel/                 # NEW
│   │   ├── RightPanel.tsx
│   │   ├── FileTree.tsx
│   │   ├── TerminalPanel.tsx
│   │   └── PortsPanel.tsx
│   ├── ChatInput/                  # NEW or refactor
│   │   ├── ChatInputBar.tsx
│   │   └── ModelSelector.tsx
│   └── Layout/
│       └── MainLayout.tsx          # Update layout grid
├── stores/
│   └── workspace-store.ts          # Add repository grouping
└── hooks/
    └── useWorkspaceShortcuts.ts    # NEW
```

---

## Summary

The core transformation is:

1. **Sidebar**: Flat list → Hierarchical repository groups
2. **Top bar**: Tab overflow → Single workspace indicator
3. **Right panel**: New → File tree + terminal + ports
4. **Chat**: Embedded → Bottom-docked prominent input

This matches Conductor's information architecture while keeping Superset's functionality intact. The result is a cleaner, more scalable interface that handles many workspaces gracefully.

# Auto-Claude Memory & Knowledge Graph System Analysis

Deep analysis of Auto-Claude's memory, knowledge graph, and context management system with recommendations for Superset adoption.

---

## Executive Summary

Auto-Claude implements a sophisticated **dual-layer memory system** combining:
1. **Graphiti** - Graph-based semantic knowledge storage with vector search
2. **File-based fallback** - JSON files that work without any dependencies

This architecture ensures the system always functions while providing powerful semantic retrieval when available.

---

## 1. Memory Architecture

### Dual-Layer Storage Strategy

**PRIMARY: Graphiti Memory System** (when enabled)
- **Database**: LadybugDB (embedded Kuzu fork, no Docker required)
- **Location**: `~/.auto-claude/memories/`
- **Features**: Vector search, semantic similarity, cross-session context

**FALLBACK: File-Based Memory** (always available)
- **Location**: `.auto-claude/specs/{spec-name}/memory/`
- **Files**:
  - `session_insights/session_NNN.json` - Session learnings
  - `codebase_map.json` - File purposes and discoveries
  - `patterns.md` - Code patterns to follow
  - `gotchas.md` - Pitfalls to avoid

### Memory Save Flow

```python
async def save_session_memory(
    spec_dir: Path,
    project_dir: Path,
    subtask_id: str,
    session_num: int,
    success: bool,
    subtasks_completed: list[str],
    discoveries: dict | None = None,
) -> tuple[bool, str]:
    """
    Memory Strategy:
    - PRIMARY: Graphiti (when enabled) - provides semantic search
    - FALLBACK: File-based (when Graphiti is disabled) - zero dependencies
    """
    # Try Graphiti first if enabled
    if graphiti_enabled:
        try:
            memory = GraphitiMemory(spec_dir, project_dir)
            if memory.is_enabled:
                result = await memory.save_structured_insights(discoveries)
                if result:
                    return True, "graphiti"
        except Exception as e:
            logger.warning(f"Graphiti save failed: {e}")

    # FALLBACK: File-based (always works)
    save_file_based_memory(spec_dir, session_num, insights)
    return True, "file"
```

### Session Data Model

```python
session_insights = {
    "subtasks_completed": list[str],        # IDs of completed tasks
    "discoveries": {
        "files_understood": dict[str, str], # {path: purpose}
        "patterns_found": list[str],        # Pattern descriptions
        "gotchas_encountered": list[str]    # Pitfall descriptions
    },
    "what_worked": list[str],               # Successful approaches
    "what_failed": list[str],               # Failed approaches
    "recommendations_for_next_session": list[str]  # Suggestions
}
```

---

## 2. Knowledge Graph Structure

### Node Types

The Graphiti knowledge graph has three main node types:

| Node Type | Purpose | Examples |
|-----------|---------|----------|
| **Episodic** | Temporal memories | Session insights, task outcomes, QA results |
| **Entity** | Semantic concepts | Patterns, gotchas, file purposes, architecture |
| **Relationship** | Connections | "used by", "similar to", "part of" |

### Episode Types

```python
EPISODE_TYPE_SESSION_INSIGHT = "session_insight"          # Session learnings
EPISODE_TYPE_CODEBASE_DISCOVERY = "codebase_discovery"    # File purposes
EPISODE_TYPE_PATTERN = "pattern"                          # Code patterns
EPISODE_TYPE_GOTCHA = "gotcha"                           # Pitfalls to avoid
EPISODE_TYPE_TASK_OUTCOME = "task_outcome"                # Task results
EPISODE_TYPE_QA_RESULT = "qa_result"                     # QA findings
EPISODE_TYPE_HISTORICAL_CONTEXT = "historical_context"    # Past context
```

### Memory Scoping

Auto-Claude supports two scoping modes:

```python
class GroupIdMode:
    SPEC = "spec"          # Each spec gets isolated memory
    PROJECT = "project"    # All specs share project-wide context

def group_id(self) -> str:
    if self.group_id_mode == GroupIdMode.PROJECT:
        # Shared project namespace with path hash for uniqueness
        project_name = self.project_dir.name
        path_hash = hashlib.md5(str(self.project_dir).encode())[:8]
        return f"project_{project_name}_{path_hash}"
    else:
        # Isolated spec namespace
        return self.spec_dir.name
```

**Why this matters**: Superset could use similar scoping to isolate memory per workspace/worktree while optionally sharing learnings across an organization.

---

## 3. Context Management System

### Three-Phase Context Building

**Phase 1: Service Detection & Keyword Extraction**
```python
class ContextBuilder:
    def build_context(
        self,
        task: str,
        services: list[str] | None = None,        # Auto-detect if None
        keywords: list[str] | None = None,        # Extract from task if None
        include_graph_hints: bool = True,         # Include Graphiti context
    ) -> TaskContext:
        # 1. Auto-detect services from project index
        services = self.service_matcher.suggest_services(task)

        # 2. Extract keywords from task description
        keywords = self.keyword_extractor.extract_keywords(task)

        # 3. Search each service for relevant files
        for service_name in services:
            matches = self.searcher.search_service(service_path, keywords)
```

**Phase 2: File Categorization**
- **Files to Modify**: Core implementation targets
- **Files to Reference**: Examples, patterns, similar code

**Phase 3: Pattern Discovery & Graph Hints**
- Discovers code patterns from reference files
- Fetches historical hints from knowledge graph

### Context Model

```python
@dataclass
class TaskContext:
    task_description: str
    scoped_services: list[str]           # Services to search
    files_to_modify: list[FileMatch]     # Implementation targets
    files_to_reference: list[FileMatch]  # Pattern examples
    patterns_discovered: list[str]       # Code patterns
    service_contexts: dict[str, str]     # Service-specific context
    graph_hints: list[dict]              # Historical insights
```

### Context Window Management

The system prevents context overflow through:

1. **Result limiting**: `MAX_CONTEXT_RESULTS = 10`
2. **Truncation**: Content limited to ~500 chars per item
3. **Scoring**: Vector similarity filters weak matches
4. **Type filtering**: Can filter by episode type

---

## 4. Memory Types

Auto-Claude recognizes **four primary memory types**:

### Type 1: Episodic Memory (temporal, session-based)
- Session insights from completed sessions
- Task outcomes (success/failure with reasons)
- QA results and fixes applied
- **Retrieved by**: Temporal queries, session history

### Type 2: Semantic Memory (conceptual knowledge)
- Code patterns discovered and validated
- Architectural gotchas and pitfalls
- File purposes and responsibilities
- **Retrieved by**: Semantic similarity search

### Type 3: Procedural Memory (how-to knowledge)
- Successful implementation approaches
- Pattern applications in this codebase
- Tool usage patterns
- **Retrieved by**: Task-based pattern matching

### Type 4: Predictive Memory (anticipatory)
- Recommendations for next session
- Common failure modes to avoid
- Patterns that work together
- **Retrieved by**: Predictive queries on similar tasks

---

## 5. Retrieval Mechanisms

### Mode 1: Semantic Vector Search (primary)

```python
async def get_relevant_context(
    query: str,
    num_results: int = 10,
) -> list[dict]:
    """
    Vector embedding similarity search.

    Process:
    1. Embed query using configured embedder (Voyage, OpenAI, etc)
    2. Search graph for similar episode/entity embeddings
    3. Return top-k results with similarity scores
    """
    results = await self.client.graphiti.search(
        query=query,
        group_ids=[self.group_id],
        num_results=min(num_results, MAX_CONTEXT_RESULTS),
    )
```

### Mode 2: Temporal History Queries

```python
async def get_session_history(
    limit: int = 5,
    spec_only: bool = True,
) -> list[dict]:
    """Get recent session insights chronologically."""
    results = await self.client.graphiti.search(
        query="session insight completed subtasks recommendations",
        group_ids=[self.group_id],
        num_results=limit * 2,
    )
    # Filter for session insights
    sessions = [r for r in results if "session_insight" in r.content]
```

### Mode 3: Similar Task Matching

```python
async def get_similar_task_outcomes(
    task_description: str,
    limit: int = 5,
) -> list[dict]:
    """
    Find past tasks similar to current one.
    Learns from what succeeded/failed before.
    """
```

### Keyword Fallback

When embedder not configured, falls back to keyword search:

```python
query = """
    MATCH (e:Episodic)
    WHERE toLower(e.name) CONTAINS $search_query
       OR toLower(e.content) CONTAINS $search_query
    RETURN ...
    LIMIT $limit
"""
```

---

## 6. Graph Operations

### Core Operations

```python
# Session Management
async def add_session_insight(session_num: int, insights: dict) -> bool

# Discovery Management
async def add_codebase_discoveries(discoveries: dict[str, str]) -> bool

# Pattern & Gotcha Management
async def add_pattern(pattern: str) -> bool
async def add_gotcha(gotcha: str) -> bool

# Outcome Tracking
async def add_task_outcome(task_id: str, success: bool, outcome: str) -> bool

# Structured Insight Ingestion
async def save_structured_insights(insights: dict) -> bool
```

### Structured Insight Ingestion

Converts a single rich insight into multiple focused episodes:

```python
async def save_structured_insights(self, insights: dict) -> bool:
    """
    Converts single rich insight into:
    - Session insight episode
    - Individual pattern episodes
    - Individual gotcha episodes
    - Codebase discovery episodes
    - Task outcome episodes
    """
```

---

## 7. Claude Integration

### Context Retrieval (before agent sessions)

```python
async def get_graphiti_context(
    spec_dir: Path,
    project_dir: Path,
    subtask: dict,
) -> str | None:
    """
    Retrieve relevant context from Graphiti for subtask.
    Called before starting coder agent session.
    """
    memory = GraphitiMemory(spec_dir, project_dir)

    # Build search query from subtask description
    query = f"{subtask['description']} {subtask['id']}"

    # Get relevant context
    context_items = await memory.get_relevant_context(query, num_results=5)
    session_history = await memory.get_session_history(limit=3)

    # Format as Markdown for prompt injection
    formatted = "## Memory Context\n"
    for item in context_items:
        formatted += f"- **[{item['type']}]** {item['content'][:500]}\n"

    return formatted
```

### Memory Saving (after agent sessions)

```python
async def save_session_memory(...) -> tuple[bool, str]:
    """
    Save session learnings to memory after coder completes.
    Called by agent orchestrator after each session.
    """
```

### Agent Memory Tools

Agents can interact with memory directly via tools:

```python
@tool("record_discovery", "Record a codebase discovery...")
async def record_discovery(args: dict) -> dict

@tool("record_gotcha", "Record a gotcha or pitfall...")
async def record_gotcha(args: dict) -> dict

@tool("get_session_context", "Get context from previous sessions...")
async def get_session_context(args: dict) -> dict
```

### Automatic Insight Extraction

Uses Claude (Haiku for speed/cost) to extract insights after sessions:

```python
async def extract_insights(
    spec_dir: Path,
    project_dir: Path,
    session_num: int,
    commit_before: str,
    commit_after: str,
) -> dict:
    """
    Sends to Claude:
    1. Session diff (git diff between commits)
    2. Changed files list
    3. Commit messages
    4. Attempt history

    Receives structured insights:
    - Changed file purposes
    - Patterns applied
    - Gotchas encountered
    - What worked/failed
    - Recommendations for next session
    """
```

---

## 8. Complete Memory Flow

```
1. START SESSION
   ↓
2. RETRIEVE CONTEXT
   → Search Graphiti for relevant past insights
   → Format as Markdown for prompt
   ↓
3. INJECT INTO PROMPT
   {previous learnings} + {current task} → Agent
   ↓
4. AGENT EXECUTES
   - Can use record_discovery() tool
   - Can use record_gotcha() tool
   - Modifies files, runs tests
   ↓
5. EXTRACT INSIGHTS
   → Uses Claude (Haiku) to analyze diff
   → Returns: patterns, gotchas, what_worked, etc
   ↓
6. SAVE MEMORY
   → Try Graphiti first (stores with embeddings)
   → Fallback to file-based JSON
   ↓
7. NEXT SESSION
   → Retrieves what was learned
   → Cycle repeats
```

---

## 9. Configuration

### Environment Variables

```bash
# Enable Graphiti memory system
GRAPHITI_ENABLED=true

# Provider selection
GRAPHITI_LLM_PROVIDER=anthropic    # anthropic|openai|azure|ollama|google
GRAPHITI_EMBEDDER_PROVIDER=voyage  # openai|voyage|azure|ollama|google

# Database location
GRAPHITI_DB_PATH=~/.auto-claude/memories
GRAPHITI_DATABASE=auto_claude_memory

# Provider credentials
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...

# Context limits
MAX_CONTEXT_RESULTS=10

# Extraction settings
INSIGHT_EXTRACTION_ENABLED=true
INSIGHT_EXTRACTOR_MODEL=claude-3-5-haiku-latest
```

---

## 10. Failure Modes & Recovery

### Graceful Degradation

```
Graphiti fails/unavailable
    ↓
Fallback to file-based (always works)
    ↓
System continues, memory still saved
    ↓
When Graphiti recovers, can migrate file-based to graph
```

### Provider Change Detection

```
Provider change detected (e.g., OpenAI → Voyage embedder)
    ↓
State tracks this in .graphiti_state.json
    ↓
Warning logged: "Embedding provider changed"
    ↓
Run migration script or start fresh
```

---

## 11. What Superset Should Adopt

### High Priority - Adopt Now

| Feature | Why | Implementation Effort |
|---------|-----|----------------------|
| **Dual-layer memory** | Reliability - always works | Medium |
| **Session insights** | Learn from each worktree session | Low |
| **File-based fallback** | Zero dependency option | Low |
| **Automatic insight extraction** | Captures learnings without user effort | Medium |

### Medium Priority - Adopt Soon

| Feature | Why | Implementation Effort |
|---------|-----|----------------------|
| **Memory scoping** | Isolate per workspace, share across org | Medium |
| **Vector search** | Find semantically similar past work | High |
| **Agent memory tools** | Let agents record discoveries in real-time | Medium |
| **Gotcha tracking** | Avoid repeating mistakes | Low |

### Lower Priority - Consider Later

| Feature | Why | Implementation Effort |
|---------|-----|----------------------|
| **Full knowledge graph** | Overkill for initial launch | Very High |
| **Multi-provider embeddings** | Nice flexibility but complex | High |
| **Temporal queries** | Useful for debugging | Medium |

---

## 12. Recommended Superset Implementation

### Phase 1: File-Based Memory (Week 1-2)

Start simple with JSON files per workspace:

```typescript
// packages/db/src/memory/workspace-memory.ts

interface WorkspaceMemory {
  workspaceId: string;
  sessions: SessionInsight[];
  discoveries: Record<string, string>;  // file -> purpose
  patterns: string[];
  gotchas: string[];
}

interface SessionInsight {
  sessionNumber: number;
  timestamp: string;
  tasksCompleted: string[];
  whatWorked: string[];
  whatFailed: string[];
  recommendations: string[];
}

// Save after each session
async function saveSessionInsight(
  workspaceId: string,
  insight: SessionInsight
): Promise<void> {
  const memoryPath = `~/.superset/workspaces/${workspaceId}/memory.json`;
  const memory = await loadMemory(memoryPath);
  memory.sessions.push(insight);
  await writeJSON(memoryPath, memory);
}
```

### Phase 2: Automatic Extraction (Week 3-4)

Use Claude to extract insights after sessions:

```typescript
// packages/db/src/memory/insight-extractor.ts

async function extractInsights(
  workspaceId: string,
  sessionDiff: string,
  changedFiles: string[]
): Promise<SessionInsight> {
  const response = await claude.messages.create({
    model: "claude-3-5-haiku-latest",  // Fast and cheap
    messages: [{
      role: "user",
      content: `Analyze this coding session and extract insights:

## Diff
${sessionDiff}

## Changed Files
${changedFiles.join('\n')}

Return JSON with:
- patterns_found: Code patterns used
- gotchas_encountered: Pitfalls to avoid
- what_worked: Successful approaches
- what_failed: Failed approaches
- recommendations: Suggestions for next session`
    }]
  });

  return parseInsights(response);
}
```

### Phase 3: Context Injection (Week 5-6)

Inject relevant memory into agent prompts:

```typescript
// packages/db/src/memory/context-builder.ts

async function buildContext(
  workspaceId: string,
  currentTask: string
): Promise<string> {
  const memory = await loadMemory(workspaceId);

  // Get recent sessions
  const recentSessions = memory.sessions.slice(-3);

  // Find relevant patterns
  const relevantPatterns = memory.patterns
    .filter(p => isRelevant(p, currentTask));

  // Find relevant gotchas
  const relevantGotchas = memory.gotchas
    .filter(g => isRelevant(g, currentTask));

  return `## Context from Previous Sessions

### Recent Learnings
${recentSessions.map(s => formatSession(s)).join('\n')}

### Relevant Patterns
${relevantPatterns.map(p => `- ${p}`).join('\n')}

### Gotchas to Avoid
${relevantGotchas.map(g => `- ${g}`).join('\n')}`;
}
```

### Phase 4: Vector Search (Optional, Week 7+)

Add semantic search if needed:

```typescript
// packages/db/src/memory/vector-store.ts

// Use pgvector with Neon (already have Postgres)
async function searchSimilar(
  workspaceId: string,
  query: string,
  limit: number = 5
): Promise<MemoryItem[]> {
  const embedding = await embedQuery(query);

  return db.query(`
    SELECT content, type,
           1 - (embedding <=> $1) as similarity
    FROM workspace_memories
    WHERE workspace_id = $2
    ORDER BY embedding <=> $1
    LIMIT $3
  `, [embedding, workspaceId, limit]);
}
```

---

## 13. Key Differences from Auto-Claude

| Aspect | Auto-Claude | Superset Recommendation |
|--------|-------------|-------------------------|
| **Database** | LadybugDB (embedded graph) | Neon PostgreSQL + pgvector |
| **Default mode** | Graphiti with file fallback | File-based with optional vector |
| **Scoping** | Spec-based | Workspace + Organization |
| **Extraction** | Post-session with Haiku | Same, but triggered by commit |
| **Agent tools** | Multiple memory tools | Single `recordInsight` tool |
| **Complexity** | High (full graph) | Low to Medium (start simple) |

---

## 14. Summary

Auto-Claude's memory system is sophisticated but potentially over-engineered for Superset's initial needs. The key insights to adopt:

1. **Always have a fallback** - File-based memory that works without dependencies
2. **Automatic extraction** - Use Claude to capture learnings without user effort
3. **Scoped memory** - Isolate per workspace but allow org-wide sharing
4. **Context injection** - Feed relevant history into agent prompts
5. **Start simple** - File-based → Vector search → Full graph (if needed)

The most valuable pattern is the **insight extraction loop**: automatically analyzing each session's diff to capture what worked, what failed, and what to remember for next time. This creates a self-improving system without requiring user input.

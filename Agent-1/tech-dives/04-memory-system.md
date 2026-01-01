# Technical Deep Dive: Cross-Session Memory System

## Source: Auto-Claude (Graphiti Knowledge Graph)

## Executive Summary

Auto-Claude implements a sophisticated **cross-session memory system** using Graphiti-style knowledge graphs. This enables agents to retain context across sessions, learn from past interactions, and build up project-specific knowledge over time.

---

## Architecture Overview

### Memory System Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CROSS-SESSION MEMORY SYSTEM                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Session 1          Session 2          Session 3                           │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐                        │
│   │Decisions│        │Decisions│        │Decisions│                        │
│   │Context  │        │Context  │        │Context  │                        │
│   │Actions  │        │Actions  │        │Actions  │                        │
│   └────┬────┘        └────┬────┘        └────┬────┘                        │
│        │                  │                  │                              │
│        └──────────────────┼──────────────────┘                              │
│                           ▼                                                 │
│            ┌──────────────────────────────┐                                │
│            │    KNOWLEDGE GRAPH           │                                │
│            │  ┌─────────────────────────┐ │                                │
│            │  │ Entities  │ Relations   │ │                                │
│            │  ├───────────┼─────────────┤ │                                │
│            │  │ Files     │ depends_on  │ │                                │
│            │  │ Functions │ calls       │ │                                │
│            │  │ Decisions │ led_to      │ │                                │
│            │  │ Problems  │ solved_by   │ │                                │
│            │  │ Patterns  │ used_in     │ │                                │
│            │  └─────────────────────────┘ │                                │
│            └──────────────────────────────┘                                │
│                           │                                                 │
│                           ▼                                                 │
│            ┌──────────────────────────────┐                                │
│            │    CONTEXT RETRIEVAL         │                                │
│            │  • Semantic search           │                                │
│            │  • Graph traversal           │                                │
│            │  • Relevance ranking         │                                │
│            └──────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Knowledge Graph Schema

### Entity Types

```typescript
// Core entity types for coding context

interface Entity {
  id: string;
  type: EntityType;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  embedding: number[];  // Vector for semantic search
  createdAt: Date;
  updatedAt: Date;
  sourceSessionId: string;
}

type EntityType =
  | 'file'           // Source files
  | 'function'       // Functions/methods
  | 'class'          // Classes/types
  | 'module'         // Packages/modules
  | 'decision'       // Architectural decisions
  | 'problem'        // Issues encountered
  | 'solution'       // Solutions implemented
  | 'pattern'        // Code patterns used
  | 'dependency'     // External dependencies
  | 'config'         // Configuration choices
  | 'requirement'    // User requirements
  | 'test'           // Test cases
  ;

// Specific entity examples
interface FileEntity extends Entity {
  type: 'file';
  metadata: {
    path: string;
    language: string;
    lastModified: Date;
    size: number;
    imports: string[];
    exports: string[];
  };
}

interface DecisionEntity extends Entity {
  type: 'decision';
  metadata: {
    context: string;
    alternatives: string[];
    chosenOption: string;
    reasoning: string;
    impact: 'low' | 'medium' | 'high';
  };
}

interface ProblemEntity extends Entity {
  type: 'problem';
  metadata: {
    errorType: string;
    stackTrace?: string;
    relatedFiles: string[];
    frequency: number;
    lastOccurrence: Date;
  };
}
```

### Relation Types

```typescript
// Relations between entities

interface Relation {
  id: string;
  type: RelationType;
  sourceId: string;
  targetId: string;
  weight: number;       // Relevance weight (0-1)
  metadata: Record<string, unknown>;
  createdAt: Date;
}

type RelationType =
  | 'depends_on'        // A depends on B
  | 'imports'           // A imports B
  | 'calls'             // Function A calls function B
  | 'extends'           // Class A extends class B
  | 'led_to'            // Decision A led to outcome B
  | 'solved_by'         // Problem A solved by solution B
  | 'used_in'           // Pattern A used in file B
  | 'related_to'        // Generic association
  | 'conflicts_with'    // A conflicts with B
  | 'supersedes'        // A replaces B (versioning)
  ;

// Example relations
const exampleRelations: Relation[] = [
  {
    id: 'rel-1',
    type: 'solved_by',
    sourceId: 'problem-timeout-issue',
    targetId: 'solution-retry-logic',
    weight: 0.95,
    metadata: {
      sessionId: 'session-123',
      verified: true,
    },
  },
  {
    id: 'rel-2',
    type: 'led_to',
    sourceId: 'decision-use-zustand',
    targetId: 'pattern-centralized-store',
    weight: 0.8,
    metadata: {
      context: 'Chose Zustand over Redux for simplicity',
    },
  },
];
```

---

## Memory Extraction Pipeline

### Session Analysis

```typescript
// Extract knowledge from session conversation

interface SessionAnalyzer {
  extractEntities(conversation: Message[]): Promise<Entity[]>;
  extractRelations(entities: Entity[], conversation: Message[]): Promise<Relation[]>;
  summarizeSession(conversation: Message[]): Promise<SessionSummary>;
}

class SessionAnalyzerImpl implements SessionAnalyzer {
  constructor(private llm: AIProvider) {}

  async extractEntities(conversation: Message[]): Promise<Entity[]> {
    const prompt = `
      Analyze this coding session conversation and extract key entities.

      For each entity, identify:
      1. Type (file, function, decision, problem, solution, pattern, etc.)
      2. Name (identifier)
      3. Description (what it is/does)
      4. Relevant metadata

      Focus on:
      - Files that were created or modified
      - Functions and classes discussed
      - Architectural decisions made
      - Problems encountered and how they were solved
      - Patterns or approaches used

      Conversation:
      ${conversation.map(formatMessage).join('\n')}

      Output as JSON array of entities.
    `;

    const response = await this.llm.complete({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8192,
    });

    return parseEntities(response.content);
  }

  async extractRelations(
    entities: Entity[],
    conversation: Message[]
  ): Promise<Relation[]> {
    const prompt = `
      Given these entities from a coding session, identify relationships between them.

      Entities:
      ${entities.map(e => `- ${e.type}: ${e.name}`).join('\n')}

      Conversation context:
      ${conversation.slice(-20).map(formatMessage).join('\n')}

      Identify relations like:
      - depends_on: A requires B to function
      - imports: File A imports from file B
      - calls: Function A calls function B
      - led_to: Decision A resulted in outcome B
      - solved_by: Problem A was fixed by solution B
      - used_in: Pattern A was applied to file B

      Output as JSON array with: sourceId, targetId, type, weight (0-1), reasoning.
    `;

    const response = await this.llm.complete({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4096,
    });

    return parseRelations(response.content);
  }

  async summarizeSession(conversation: Message[]): Promise<SessionSummary> {
    const prompt = `
      Summarize this coding session for future context retrieval.

      Include:
      1. Main objectives (what was the user trying to accomplish)
      2. Key decisions made (and why)
      3. Problems encountered (and solutions)
      4. Files created/modified
      5. Patterns or approaches used
      6. Unfinished work or next steps

      Conversation:
      ${conversation.map(formatMessage).join('\n')}

      Output structured JSON.
    `;

    const response = await this.llm.complete({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2048,
    });

    return parseSessionSummary(response.content);
  }
}
```

### Embedding Generation

```typescript
// Generate embeddings for semantic search

class EmbeddingService {
  constructor(private embeddingProvider: EmbeddingProvider) {}

  async embedEntity(entity: Entity): Promise<number[]> {
    // Create rich text representation for embedding
    const text = this.entityToText(entity);
    return this.embeddingProvider.embed(text);
  }

  private entityToText(entity: Entity): string {
    const parts = [
      `Type: ${entity.type}`,
      `Name: ${entity.name}`,
      `Description: ${entity.description}`,
    ];

    // Add type-specific metadata
    switch (entity.type) {
      case 'decision':
        parts.push(`Context: ${entity.metadata.context}`);
        parts.push(`Reasoning: ${entity.metadata.reasoning}`);
        break;
      case 'problem':
        parts.push(`Error: ${entity.metadata.errorType}`);
        break;
      case 'file':
        parts.push(`Path: ${entity.metadata.path}`);
        parts.push(`Language: ${entity.metadata.language}`);
        break;
    }

    return parts.join('\n');
  }
}
```

---

## Context Retrieval System

### Semantic Search

```typescript
// Retrieve relevant context for new sessions

interface ContextRetriever {
  retrieve(query: string, options?: RetrievalOptions): Promise<RetrievalResult>;
}

interface RetrievalOptions {
  maxEntities: number;
  maxRelations: number;
  entityTypes?: EntityType[];
  minRelevance: number;
  includeGraphContext: boolean;
}

interface RetrievalResult {
  entities: Array<Entity & { relevance: number }>;
  relations: Relation[];
  summary: string;
}

class ContextRetrieverImpl implements ContextRetriever {
  constructor(
    private graphStore: GraphStore,
    private embeddingService: EmbeddingService
  ) {}

  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    const {
      maxEntities = 20,
      maxRelations = 30,
      entityTypes,
      minRelevance = 0.5,
      includeGraphContext = true,
    } = options;

    // 1. Embed the query
    const queryEmbedding = await this.embeddingService.embed(query);

    // 2. Semantic search for relevant entities
    let entities = await this.graphStore.searchByEmbedding(queryEmbedding, {
      limit: maxEntities * 2,  // Fetch more for filtering
      types: entityTypes,
    });

    // 3. Filter by relevance threshold
    entities = entities.filter(e => e.relevance >= minRelevance);

    // 4. If graph context enabled, expand with related entities
    if (includeGraphContext) {
      const expandedIds = new Set(entities.map(e => e.id));
      const relatedEntities = await this.expandGraph(
        entities.slice(0, 10),  // Top 10 only
        2  // Depth of 2 hops
      );

      for (const related of relatedEntities) {
        if (!expandedIds.has(related.id)) {
          entities.push({ ...related, relevance: related.relevance * 0.7 });
          expandedIds.add(related.id);
        }
      }
    }

    // 5. Get relations between found entities
    const entityIds = entities.slice(0, maxEntities).map(e => e.id);
    const relations = await this.graphStore.getRelationsBetween(entityIds);

    // 6. Generate retrieval summary
    const summary = await this.summarizeRetrieval(entities, relations, query);

    return {
      entities: entities.slice(0, maxEntities),
      relations: relations.slice(0, maxRelations),
      summary,
    };
  }

  private async expandGraph(
    seedEntities: Entity[],
    depth: number
  ): Promise<Array<Entity & { relevance: number }>> {
    const visited = new Set<string>();
    const result: Array<Entity & { relevance: number }> = [];

    let frontier = seedEntities.map(e => ({ entity: e, depth: 0 }));

    while (frontier.length > 0) {
      const current = frontier.shift()!;

      if (visited.has(current.entity.id) || current.depth >= depth) {
        continue;
      }

      visited.add(current.entity.id);

      // Get connected entities
      const relations = await this.graphStore.getRelationsFrom(current.entity.id);

      for (const rel of relations) {
        const connected = await this.graphStore.getEntity(rel.targetId);
        if (connected && !visited.has(connected.id)) {
          // Relevance decays with distance
          const relevance = rel.weight * Math.pow(0.7, current.depth + 1);
          result.push({ ...connected, relevance });
          frontier.push({ entity: connected, depth: current.depth + 1 });
        }
      }
    }

    return result;
  }

  private async summarizeRetrieval(
    entities: Entity[],
    relations: Relation[],
    query: string
  ): Promise<string> {
    // Generate human-readable summary of retrieved context
    const prompt = `
      Summarize the following retrieved context for the query: "${query}"

      Entities:
      ${entities.slice(0, 10).map(e =>
        `- [${e.type}] ${e.name}: ${e.description}`
      ).join('\n')}

      Key Relations:
      ${relations.slice(0, 10).map(r =>
        `- ${r.sourceId} ${r.type} ${r.targetId}`
      ).join('\n')}

      Provide a brief summary of what past context is relevant.
    `;

    // Use a small model for speed
    const response = await this.llm.complete({
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
    });

    return response.content;
  }
}
```

---

## Graph Storage Backend

### SQLite + Vector Extension

```typescript
// Local-first graph storage with vector search

import Database from 'better-sqlite3';

class SQLiteGraphStore implements GraphStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
    this.loadVectorExtension();
  }

  private initSchema(): void {
    this.db.exec(`
      -- Entities table
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        metadata TEXT,  -- JSON
        embedding BLOB,  -- Float32 array
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source_session_id TEXT
      );

      -- Relations table
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source_id TEXT NOT NULL REFERENCES entities(id),
        target_id TEXT NOT NULL REFERENCES entities(id),
        weight REAL DEFAULT 1.0,
        metadata TEXT,  -- JSON
        created_at INTEGER NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(source_session_id);
      CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
    `);
  }

  async addEntity(entity: Entity): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities
      (id, type, name, description, metadata, embedding, created_at, updated_at, source_session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entity.id,
      entity.type,
      entity.name,
      entity.description,
      JSON.stringify(entity.metadata),
      entity.embedding ? Buffer.from(new Float32Array(entity.embedding).buffer) : null,
      entity.createdAt.getTime(),
      entity.updatedAt.getTime(),
      entity.sourceSessionId
    );
  }

  async searchByEmbedding(
    queryEmbedding: number[],
    options: { limit: number; types?: EntityType[] }
  ): Promise<Array<Entity & { relevance: number }>> {
    // Use cosine similarity for vector search
    const entities = this.db.prepare(`
      SELECT *, embedding FROM entities
      WHERE type IN (${options.types?.map(() => '?').join(',') || 'SELECT DISTINCT type FROM entities'})
    `).all(...(options.types || [])) as any[];

    // Calculate similarities
    const results = entities
      .filter(e => e.embedding)
      .map(e => {
        const embedding = new Float32Array(e.embedding.buffer);
        const similarity = cosineSimilarity(queryEmbedding, Array.from(embedding));
        return { ...this.rowToEntity(e), relevance: similarity };
      })
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, options.limit);

    return results;
  }

  async getRelationsBetween(entityIds: string[]): Promise<Relation[]> {
    const placeholders = entityIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT * FROM relations
      WHERE source_id IN (${placeholders})
        AND target_id IN (${placeholders})
    `).all(...entityIds, ...entityIds);

    return rows.map(this.rowToRelation);
  }

  private rowToEntity(row: any): Entity {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description,
      metadata: JSON.parse(row.metadata || '{}'),
      embedding: row.embedding
        ? Array.from(new Float32Array(row.embedding.buffer))
        : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      sourceSessionId: row.source_session_id,
    };
  }
}

// Cosine similarity helper
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

---

## Superset Integration Strategy

### Step 1: Add Memory Store

```typescript
// apps/desktop/src/main/lib/memory/store.ts

export class MemoryStore {
  private graphStore: SQLiteGraphStore;
  private analyzer: SessionAnalyzer;
  private retriever: ContextRetriever;
  private embeddingService: EmbeddingService;

  constructor(dataDir: string) {
    const dbPath = path.join(dataDir, 'memory.db');
    this.graphStore = new SQLiteGraphStore(dbPath);
    this.embeddingService = new EmbeddingService(/* config */);
    this.analyzer = new SessionAnalyzerImpl(/* llm */);
    this.retriever = new ContextRetrieverImpl(this.graphStore, this.embeddingService);
  }

  // Called when a session ends
  async processSession(
    sessionId: string,
    conversation: Message[]
  ): Promise<void> {
    // 1. Extract entities
    const entities = await this.analyzer.extractEntities(conversation);

    // 2. Generate embeddings
    for (const entity of entities) {
      entity.embedding = await this.embeddingService.embedEntity(entity);
      entity.sourceSessionId = sessionId;
      await this.graphStore.addEntity(entity);
    }

    // 3. Extract relations
    const relations = await this.analyzer.extractRelations(entities, conversation);
    for (const relation of relations) {
      await this.graphStore.addRelation(relation);
    }

    // 4. Store session summary
    const summary = await this.analyzer.summarizeSession(conversation);
    await this.storeSessionSummary(sessionId, summary);
  }

  // Called when starting a new session
  async getRelevantContext(
    projectPath: string,
    currentTask: string
  ): Promise<string> {
    const result = await this.retriever.retrieve(currentTask, {
      maxEntities: 15,
      maxRelations: 20,
      minRelevance: 0.6,
      includeGraphContext: true,
    });

    return this.formatContextForPrompt(result);
  }

  private formatContextForPrompt(result: RetrievalResult): string {
    if (result.entities.length === 0) {
      return '';
    }

    return `
## Relevant Context from Previous Sessions

${result.summary}

### Key Decisions
${result.entities
  .filter(e => e.type === 'decision')
  .map(e => `- ${e.name}: ${e.description}`)
  .join('\n')}

### Known Solutions
${result.entities
  .filter(e => e.type === 'solution')
  .map(e => `- ${e.name}: ${e.description}`)
  .join('\n')}

### Related Files
${result.entities
  .filter(e => e.type === 'file')
  .map(e => `- ${e.metadata.path}`)
  .join('\n')}
    `.trim();
  }
}
```

### Step 2: Inject Memory into Sessions

```typescript
// Modify session start to include memory context

async function startSessionWithMemory(
  workspaceId: string,
  userPrompt: string
): Promise<void> {
  const workspace = await getWorkspace(workspaceId);
  const memoryStore = getMemoryStore();

  // Get relevant context from memory
  const memoryContext = await memoryStore.getRelevantContext(
    workspace.projectPath,
    userPrompt
  );

  // Build enhanced system prompt
  const systemPrompt = `
${baseSystemPrompt}

${memoryContext ? `
---
${memoryContext}
---
` : ''}

User request: ${userPrompt}
  `.trim();

  // Start Claude Code with enhanced context
  await startClaudeCode(workspace.terminalSessionId, {
    systemPrompt,
  });
}
```

### Step 3: Add Memory UI

```typescript
// Memory viewer component

function MemoryView({ workspaceId }: { workspaceId: string }) {
  const { entities, relations, isLoading } = useMemoryGraph(workspaceId);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

  if (isLoading) {
    return <Skeleton className="h-[400px]" />;
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Graph Visualization */}
      <Card>
        <CardHeader>
          <CardTitle>Knowledge Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <ForceGraph
            nodes={entities.map(e => ({
              id: e.id,
              label: e.name,
              type: e.type,
            }))}
            links={relations.map(r => ({
              source: r.sourceId,
              target: r.targetId,
              label: r.type,
            }))}
            onNodeClick={(node) => {
              setSelectedEntity(entities.find(e => e.id === node.id) || null);
            }}
          />
        </CardContent>
      </Card>

      {/* Entity Details */}
      <Card>
        <CardHeader>
          <CardTitle>
            {selectedEntity ? selectedEntity.name : 'Select an entity'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedEntity && (
            <div className="space-y-4">
              <div>
                <Label>Type</Label>
                <Badge>{selectedEntity.type}</Badge>
              </div>
              <div>
                <Label>Description</Label>
                <p className="text-sm">{selectedEntity.description}</p>
              </div>
              <div>
                <Label>Source Session</Label>
                <p className="text-sm text-muted-foreground">
                  {selectedEntity.sourceSessionId}
                </p>
              </div>
              <div>
                <Label>Metadata</Label>
                <pre className="text-xs bg-muted p-2 rounded overflow-auto">
                  {JSON.stringify(selectedEntity.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

### Step 4: Memory Settings

```typescript
// Memory configuration in settings

function MemorySettings() {
  const { settings, updateSettings } = useMemorySettings();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Memory System</h3>
        <p className="text-sm text-muted-foreground">
          Configure how Superset remembers context across sessions
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Enable Memory</Label>
            <p className="text-sm text-muted-foreground">
              Allow agents to learn from previous sessions
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => updateSettings({ enabled })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Auto-extract Knowledge</Label>
            <p className="text-sm text-muted-foreground">
              Automatically analyze completed sessions
            </p>
          </div>
          <Switch
            checked={settings.autoExtract}
            onCheckedChange={(autoExtract) => updateSettings({ autoExtract })}
          />
        </div>

        <div className="space-y-2">
          <Label>Memory Scope</Label>
          <Select
            value={settings.scope}
            onValueChange={(scope) => updateSettings({ scope })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">Per Project</SelectItem>
              <SelectItem value="workspace">Per Workspace</SelectItem>
              <SelectItem value="global">Global</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="pt-4">
          <Button variant="outline" onClick={() => clearMemory()}>
            Clear All Memory
          </Button>
        </div>
      </div>
    </div>
  );
}
```

---

## Benefits for Superset

1. **Context Retention**: Agents remember decisions, patterns, and solutions
2. **Learning Over Time**: Project knowledge accumulates across sessions
3. **Reduced Repetition**: No need to re-explain project context
4. **Pattern Recognition**: Similar problems get similar solutions
5. **Onboarding Acceleration**: New team members inherit knowledge

## Estimated Implementation Effort

| Component | Effort | Priority |
|-----------|--------|----------|
| Graph Schema Design | 1 week | High |
| SQLite Graph Store | 2 weeks | High |
| Session Analyzer | 2 weeks | High |
| Embedding Service | 1 week | High |
| Context Retriever | 2 weeks | High |
| Session Integration | 1 week | Medium |
| Memory UI | 2 weeks | Low |
| Settings & Config | 1 week | Low |
| **Total** | **12 weeks** | - |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Stale/incorrect knowledge | Add entity expiration, allow manual correction |
| Embedding drift | Re-embed periodically, track embedding model version |
| Privacy concerns | Per-project isolation, clear memory option |
| Storage growth | Automatic pruning of low-relevance entities |
| Retrieval latency | Cache frequent queries, optimize vector search |

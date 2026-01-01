# Technical Deep Dive: Multi-Agent Pipeline Architecture

## Source: Auto-Claude

## Executive Summary

Auto-Claude's multi-agent pipeline represents the most sophisticated autonomous coding architecture in our competitive analysis. It implements a **Planner → Coder → QA Reviewer → QA Fixer** pipeline that enables truly autonomous development with self-validation loops.

---

## Architecture Overview

### Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MULTI-AGENT PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────┐    ┌──────────┐    ┌─────────────┐    ┌─────────────┐       │
│   │ PLANNER  │───▶│  CODER   │───▶│ QA REVIEWER │───▶│  QA FIXER   │       │
│   └──────────┘    └──────────┘    └─────────────┘    └─────────────┘       │
│        │               │                │                   │              │
│        ▼               ▼                ▼                   ▼              │
│   Spec Document   Implemented       Review Report      Fixed Code          │
│   + Subtasks      Solution          + Issues List      + Validation        │
│                                                                             │
│                         ┌───────────────────────┐                          │
│                         │    MEMORY SYSTEM      │                          │
│                         │  (Graphiti Knowledge) │                          │
│                         └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Agent Responsibilities

| Agent | Input | Output | Claude Model |
|-------|-------|--------|--------------|
| **Planner** | User task description | Structured spec + subtasks | Claude Sonnet |
| **Coder** | Spec document | Implemented solution | Claude Code (SDK) |
| **QA Reviewer** | Codebase + spec | Review report + issues | Claude Sonnet |
| **QA Fixer** | Issues list | Fixed code | Claude Code (SDK) |

---

## Implementation Details

### 1. Planner Agent

**Purpose**: Break down user requests into actionable specifications.

**Key Implementation Pattern**:
```typescript
// Pseudo-code based on Auto-Claude architecture
interface PlannerOutput {
  spec: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    technicalApproach: string;
  };
  subtasks: Array<{
    id: string;
    title: string;
    description: string;
    estimatedComplexity: 'low' | 'medium' | 'high';
    dependencies: string[];
  }>;
}

async function runPlanner(taskDescription: string): Promise<PlannerOutput> {
  const systemPrompt = `
    You are a senior software architect. Break down the following task
    into a structured specification with clear subtasks.

    Output a JSON spec with:
    - High-level description
    - Acceptance criteria (testable)
    - Technical approach
    - Ordered subtasks with dependencies
  `;

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    system: systemPrompt,
    messages: [{ role: 'user', content: taskDescription }],
    max_tokens: 4096,
  });

  return parseSpecification(response.content);
}
```

**Superset Integration Strategy**:
- Add "Plan Mode" toggle in workspace view (like Mux's Plan/Exec mode)
- Show planning output in dedicated panel before execution starts
- Allow user review/modification of spec before proceeding

### 2. Coder Agent

**Purpose**: Execute the planned subtasks using Claude Code SDK.

**Key Implementation Pattern**:
```typescript
// Based on Auto-Claude's Claude Code SDK integration
import Anthropic from '@anthropic-ai/sdk';

interface CoderSession {
  sessionId: string;
  workingDirectory: string;
  subtaskId: string;
  status: 'running' | 'completed' | 'failed';
}

async function runCoder(spec: PlannerOutput, subtask: Subtask): Promise<CoderResult> {
  const client = new Anthropic();

  // Create focused prompt for the subtask
  const prompt = `
    ## Context
    ${spec.spec.description}

    ## Current Subtask
    ${subtask.title}: ${subtask.description}

    ## Acceptance Criteria
    ${spec.spec.acceptanceCriteria.join('\n')}

    Complete this subtask following best practices.
  `;

  // Use Claude Code's agentic loop
  const response = await client.beta.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    tools: [
      { type: 'computer_20241022', ... },
      { type: 'text_editor_20241022', ... },
      { type: 'bash_20241022', ... },
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  return processCoderResponse(response);
}
```

**Superset Integration Strategy**:
- Wrap existing Claude Code CLI in SDK-based orchestration
- Pipe subtask context into each terminal session
- Track subtask progress with visual indicators

### 3. QA Reviewer Agent

**Purpose**: Validate implemented code against the specification.

**Key Implementation Pattern**:
```typescript
interface ReviewResult {
  passed: boolean;
  issues: Array<{
    severity: 'critical' | 'major' | 'minor' | 'suggestion';
    file: string;
    line?: number;
    description: string;
    suggestedFix?: string;
  }>;
  coverage: {
    acceptanceCriteriaMet: number;
    acceptanceCriteriaTotal: number;
  };
}

async function runQAReviewer(
  spec: PlannerOutput,
  codeChanges: CodeDiff[]
): Promise<ReviewResult> {
  const systemPrompt = `
    You are a senior code reviewer. Review the following code changes
    against the specification and acceptance criteria.

    For each issue found:
    1. Categorize severity (critical/major/minor/suggestion)
    2. Specify the file and line number
    3. Describe the problem clearly
    4. Suggest a fix if possible

    Also verify each acceptance criterion is met.
  `;

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        specification: spec,
        changes: codeChanges.map(formatDiff),
      }),
    }],
    max_tokens: 8192,
  });

  return parseReviewResult(response.content);
}
```

**Superset Integration Strategy**:
- Add "QA Review" action in workspace context menu
- Display review results in dedicated panel with severity badges
- Link issues to specific files/lines in diff viewer
- Show acceptance criteria checklist with pass/fail status

### 4. QA Fixer Agent

**Purpose**: Automatically fix issues found by the reviewer.

**Key Implementation Pattern**:
```typescript
async function runQAFixer(
  issues: ReviewIssue[],
  workingDirectory: string
): Promise<FixResult> {
  // Sort issues by severity (critical first)
  const sortedIssues = issues.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
  );

  // Group by file for efficient fixing
  const issuesByFile = groupBy(sortedIssues, 'file');

  const results: FixAttempt[] = [];

  for (const [file, fileIssues] of Object.entries(issuesByFile)) {
    const fixPrompt = `
      Fix the following issues in ${file}:

      ${fileIssues.map(i => `
        - [${i.severity}] Line ${i.line}: ${i.description}
          Suggested fix: ${i.suggestedFix || 'None provided'}
      `).join('\n')}

      Apply the minimal changes needed to fix these issues.
    `;

    const response = await claudeCode.execute({
      prompt: fixPrompt,
      workingDirectory,
      tools: ['text_editor_20241022', 'bash_20241022'],
    });

    results.push({
      file,
      issues: fileIssues,
      fixed: response.success,
      changes: response.changes,
    });
  }

  return { attempts: results, allFixed: results.every(r => r.fixed) };
}
```

---

## Self-Validating QA Loop

The critical innovation is the **iterative QA loop** that runs until all issues are resolved:

```typescript
async function runPipelineWithQALoop(
  taskDescription: string,
  maxIterations: number = 3
): Promise<PipelineResult> {
  // Phase 1: Planning
  const spec = await runPlanner(taskDescription);

  // Phase 2: Coding
  for (const subtask of spec.subtasks) {
    await runCoder(spec, subtask);
  }

  // Phase 3: QA Loop
  let iteration = 0;
  let reviewResult: ReviewResult;

  do {
    iteration++;

    // Run QA Review
    const codeChanges = await getCodeChanges();
    reviewResult = await runQAReviewer(spec, codeChanges);

    if (reviewResult.passed) {
      break;
    }

    // Run QA Fixer for critical/major issues
    const fixableIssues = reviewResult.issues.filter(
      i => i.severity === 'critical' || i.severity === 'major'
    );

    if (fixableIssues.length > 0) {
      await runQAFixer(fixableIssues, workingDirectory);
    }

  } while (!reviewResult.passed && iteration < maxIterations);

  return {
    spec,
    review: reviewResult,
    iterations: iteration,
    success: reviewResult.passed,
  };
}
```

---

## UI Components for Pipeline Visualization

### Phase Progress Indicator (from Auto-Claude)

Auto-Claude implements a sophisticated `PhaseProgressIndicator` component:

```typescript
interface PhaseProgressProps {
  phase: 'planning' | 'coding' | 'qa_review' | 'qa_fix' | 'completed' | 'failed';
  subtasks: Subtask[];
  phaseLogs: string[];
  isStuck: boolean;
  isRunning: boolean;
}

function PhaseProgressIndicator({ phase, subtasks, phaseLogs, isStuck, isRunning }: PhaseProgressProps) {
  return (
    <div className="phase-progress">
      {/* Phase Steps */}
      <div className="flex items-center gap-2">
        {PHASES.map((p, i) => (
          <div key={p} className={cn(
            "phase-step",
            phase === p && "active",
            isCompleted(p, phase) && "completed",
            isStuck && phase === p && "stuck"
          )}>
            {isCompleted(p, phase) ? <CheckIcon /> : <PhaseIcon phase={p} />}
            <span>{p}</span>
          </div>
        ))}
      </div>

      {/* Subtask Indicators (up to 10 dots) */}
      <div className="subtask-dots">
        {subtasks.slice(0, 10).map((st, i) => (
          <motion.div
            key={st.id}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.03 }}
            className={cn(
              "status-dot",
              st.status === 'completed' && "bg-green-500",
              st.status === 'in_progress' && "bg-blue-500 animate-pulse",
              st.status === 'failed' && "bg-red-500",
              st.status === 'pending' && "bg-gray-400"
            )}
          />
        ))}
      </div>

      {/* Progress Bar */}
      <div className="progress-bar">
        {phase === 'coding' ? (
          <motion.div
            className="fill"
            animate={{ width: `${getProgress(subtasks)}%` }}
            transition={{ duration: 0.5 }}
          />
        ) : (
          <motion.div
            className="indeterminate"
            animate={{ x: ['-100%', '400%'] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
      </div>
    </div>
  );
}
```

---

## Integration into Superset

### Step 1: Add Pipeline Mode Toggle

```typescript
// Add to workspace store
interface WorkspaceState {
  // ... existing state
  pipelineMode: 'manual' | 'pipeline';
  pipelineState: PipelineState | null;
}

// Add UI toggle
<DropdownMenu>
  <DropdownMenuTrigger>
    <Button variant="outline">
      {pipelineMode === 'pipeline' ? 'Pipeline Mode' : 'Manual Mode'}
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => setPipelineMode('manual')}>
      Manual Mode (direct Claude Code)
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setPipelineMode('pipeline')}>
      Pipeline Mode (Plan → Code → QA)
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Step 2: Implement Pipeline Orchestrator

```typescript
// New file: apps/desktop/src/main/lib/pipeline/orchestrator.ts

export class PipelineOrchestrator {
  private spec: PlannerOutput | null = null;
  private currentPhase: PipelinePhase = 'idle';
  private qaIterations: number = 0;

  async start(taskDescription: string): Promise<void> {
    this.emit('phase-change', { phase: 'planning' });

    // Phase 1: Plan
    this.spec = await this.planner.run(taskDescription);
    this.emit('spec-ready', { spec: this.spec });

    // Phase 2: Code
    this.emit('phase-change', { phase: 'coding' });
    for (const subtask of this.spec.subtasks) {
      await this.coder.run(this.spec, subtask);
      this.emit('subtask-complete', { subtask });
    }

    // Phase 3: QA Loop
    await this.runQALoop();

    this.emit('pipeline-complete', {
      success: this.lastReview?.passed ?? false
    });
  }

  private async runQALoop(): Promise<void> {
    const maxIterations = 3;

    while (this.qaIterations < maxIterations) {
      this.emit('phase-change', { phase: 'qa_review' });
      const review = await this.qaReviewer.run(this.spec!, await this.getChanges());

      if (review.passed) {
        this.emit('qa-passed', { review });
        return;
      }

      this.emit('phase-change', { phase: 'qa_fix' });
      await this.qaFixer.run(review.issues);
      this.qaIterations++;
    }

    this.emit('qa-max-iterations', { iterations: this.qaIterations });
  }
}
```

### Step 3: Add Pipeline View Component

```typescript
// New file: apps/desktop/src/renderer/screens/main/components/PipelineView/

export function PipelineView({ workspaceId }: { workspaceId: string }) {
  const { pipelineState, startPipeline, stopPipeline } = usePipelineStore(workspaceId);

  if (!pipelineState) {
    return <PipelineStartView onStart={startPipeline} />;
  }

  return (
    <div className="pipeline-view">
      {/* Phase Progress */}
      <PhaseProgressIndicator
        phase={pipelineState.currentPhase}
        subtasks={pipelineState.spec?.subtasks ?? []}
        isRunning={pipelineState.isRunning}
      />

      {/* Spec View */}
      {pipelineState.spec && (
        <SpecificationView spec={pipelineState.spec} />
      )}

      {/* QA Results */}
      {pipelineState.qaReviews.map((review, i) => (
        <QAReviewCard key={i} review={review} iteration={i + 1} />
      ))}

      {/* Actions */}
      <div className="actions">
        <Button onClick={stopPipeline} variant="destructive">
          Stop Pipeline
        </Button>
        {pipelineState.currentPhase === 'qa_review' && (
          <Button onClick={() => skipQA()} variant="outline">
            Skip QA (Accept Current)
          </Button>
        )}
      </div>
    </div>
  );
}
```

---

## Benefits for Superset

1. **Truly Autonomous Development**: Users can start a task and walk away
2. **Quality Assurance Built-In**: Self-validation prevents obvious bugs
3. **Structured Progress Visibility**: Clear phases with progress tracking
4. **Iterative Improvement**: QA loop catches and fixes issues automatically
5. **Spec-Driven Development**: Clear documentation of what was built

## Estimated Implementation Effort

| Component | Effort | Priority |
|-----------|--------|----------|
| Planner Agent | 2 weeks | High |
| Coder Agent (wrap existing) | 1 week | High |
| QA Reviewer Agent | 2 weeks | High |
| QA Fixer Agent | 1 week | Medium |
| Pipeline Orchestrator | 2 weeks | High |
| UI Components | 2 weeks | Medium |
| **Total** | **10 weeks** | - |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| API costs multiply (4 agents per task) | Add cost estimation before pipeline start |
| QA loop may not converge | Hard cap at 3 iterations with user notification |
| Large tasks overwhelm planner | Add task complexity estimation, suggest breakdown |
| User loses control | Allow intervention at any phase, easy pipeline stop |

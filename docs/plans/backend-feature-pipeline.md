# Backend Feature Pipeline

## Problem

The "Launch" button on the feature detail page orchestrates a multi-step AI pipeline (Architecture → Task Generation → Task Coding) **from the frontend**. The React component manages the sequence via in-memory state (`isAutoLaunching`, `autoLaunchStep`) and Pusher event listeners. This is brittle:

- **If the user navigates away or closes the tab**, the architecture run completes and auto-accepts, but task generation never starts. The pipeline silently dies mid-sequence.
- **No retry on partial failure.** If architecture succeeds but tasks fail, the user must re-run the entire pipeline.
- **Race conditions.** The frontend reacts to `STAKWORK_RUN_UPDATE` (status webhook) to advance the pipeline, but the result may not be saved yet (the result webhook is a separate request). Task generation could start before architecture is actually written to the feature.
- **No visibility.** There's no record of what pipeline was requested or where it stalled. The state exists only in a React component.
- **Tasks not auto-assigned.** When `TASK_GENERATION` creates tasks, they lack `systemAssigneeType`, so the Task Coordinator cron never picks them up for coding.

## Goal

Move the sequential orchestration into the backend so that a single API call ("launch this feature") kicks off the full pipeline:

```
[User validates Requirements] → ARCHITECTURE → TASK_GENERATION → Tasks coded sequentially (via Task Coordinator)
```

**Key UX principle:** Requirements are the human checkpoint. The user writes or generates requirements, reviews them, and only then clicks "Launch". Everything after that is fully automated — no further human intervention required until tasks are coded and PRs are ready for review.

The frontend becomes a passive observer — it shows progress via Pusher but never drives the sequence.

## Design

### 1. Add pipeline fields to `StakworkRun`

Add columns to track chaining and pipeline-aware parameters:

```prisma
model StakworkRun {
  // ... existing fields ...

  // Pipeline chaining
  parentRunId    String?       @map("parent_run_id")
  parentRun      StakworkRun?  @relation("RunChain", fields: [parentRunId], references: [id])
  childRuns      StakworkRun[] @relation("RunChain")
  pipelineNext   String[]      @default([]) @map("pipeline_next") // Remaining steps as StakworkRunType[]
  pipelineParams Json?         @map("pipeline_params") // Params inherited through the pipeline
}
```

- `parentRunId` — links to the run that triggered this one (for traceability)
- `pipelineNext` — remaining steps to execute after this run completes
- `pipelineParams` — JSON object of parameters that flow through the entire pipeline (e.g., `{ autoAssignTasks: true }`)

This is a linked-list approach with inherited context. Each run knows its remaining steps and carries forward any pipeline-wide settings.

### 2. Pipeline-aware parameters

The key insight: **different pipeline entry points need different behaviors**. When a user manually creates tasks, they may want to assign them themselves. When the "Launch" button triggers the full pipeline, tasks should auto-assign to the Task Coordinator.

**Pipeline params flow:**

```typescript
interface PipelineParams {
  autoAssignTasks?: boolean;    // Assign generated tasks to TASK_COORDINATOR
  skipClarifyingQuestions?: boolean;  // Skip AI clarification prompts
}
```

The launch endpoint sets these params, and they're inherited by each subsequent run in the chain:

```typescript
// In /api/features/[featureId]/launch
const firstRun = await createStakworkRun({
  type: "ARCHITECTURE",
  workspaceId: feature.workspaceId,
  featureId: params.featureId,
  autoAccept: true,
  pipelineNext: ["TASK_GENERATION"],
  pipelineParams: {
    autoAssignTasks: true,
    skipClarifyingQuestions: true,
  },
}, user.id);
```

When the webhook creates the next run, it passes `pipelineParams` through:

```typescript
const nextRun = await createStakworkRun({
  type: pipelineNext[0],
  workspaceId: run.workspaceId,
  featureId: run.featureId,
  autoAccept: true,
  parentRunId: run.id,
  pipelineNext: pipelineNext.slice(1),
  pipelineParams: run.pipelineParams,  // Inherit params
}, run.workspace.ownerId);
```

### 3. Task creation with auto-assignment

In `applyAcceptResult` for `TASK_GENERATION`, check `pipelineParams.autoAssignTasks`:

```typescript
case StakworkRunType.TASK_GENERATION: {
  const tasksData = JSON.parse(run.result);
  const pipelineParams = run.pipelineParams as PipelineParams | null;
  const autoAssignTasks = pipelineParams?.autoAssignTasks ?? false;

  // ... existing feature/phase lookup ...

  for (const task of tasks) {
    const createdTask = await db.task.create({
      data: {
        title: task.title,
        description: task.description || null,
        priority: task.priority,
        phaseId: defaultPhase.id,
        featureId: run.featureId,
        workspaceId: featureWithPhase.workspace.id,
        status: "TODO",
        dependsOnTaskIds,
        repositoryId,
        createdById: userId,
        updatedById: userId,
        // Pipeline-aware: auto-assign to Task Coordinator if this is an automated launch
        systemAssigneeType: autoAssignTasks ? "TASK_COORDINATOR" : null,
        // PRs require manual merge — user reviews code at the end
        autoMerge: false,
      },
    });

    tempIdToRealId[task.tempId] = createdTask.id;
  }
  break;
}
```

This ensures:
- **Manual task generation** (user clicks "Generate Tasks" on a feature): No auto-assignment, user controls workflow
- **Pipeline launch** (user clicks "Launch"): Tasks auto-assigned to `TASK_COORDINATOR` → cron picks them up

### 4. Backend chaining in `processStakworkRunWebhook`

After the existing auto-accept logic in `processStakworkRunWebhook` (stakwork-run.ts ~line 721), add pipeline advancement:

```typescript
// Track whether auto-accept succeeded
let autoAcceptSucceeded = false;

if (run.autoAccept && status === WorkflowStatus.COMPLETED && run.featureId && serializedResult) {
  try {
    await db.stakworkRun.update({
      where: { id: run.id },
      data: { decision: StakworkRunDecision.ACCEPTED },
    });

    await applyAcceptResult({
      type: run.type,
      featureId: run.featureId,
      result: serializedResult,
      workspaceId: run.workspaceId,
      pipelineParams: run.pipelineParams,  // Pass params to applyAcceptResult
    }, run.workspace.ownerId);

    autoAcceptSucceeded = true;

    await pusherServer.trigger(channelName, PUSHER_EVENTS.STAKWORK_RUN_DECISION, {
      runId: run.id,
      type: run.type,
      featureId: run.featureId,
      decision: StakworkRunDecision.ACCEPTED,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error(`Auto-accept failed for run ${run.id}:`, "stakwork-run", { error: String(error) });
  }
}

// Advance pipeline ONLY if auto-accept succeeded
const pipelineNext = run.pipelineNext as string[] | null;
if (autoAcceptSucceeded && pipelineNext && pipelineNext.length > 0 && run.featureId) {
  try {
    const nextRun = await createStakworkRun({
      type: pipelineNext[0] as StakworkRunType,
      workspaceId: run.workspaceId,
      featureId: run.featureId,
      autoAccept: true,
      parentRunId: run.id,
      pipelineNext: pipelineNext.slice(1),
      pipelineParams: run.pipelineParams,
    }, run.workspace.ownerId);

    // Broadcast pipeline progress
    await pusherServer.trigger(channelName, PUSHER_EVENTS.STAKWORK_RUN_UPDATE, {
      runId: nextRun.id,
      type: nextRun.type,
      status: nextRun.status,
      featureId: nextRun.featureId,
      parentRunId: run.id,
      pipelineStep: pipelineNext.length,  // How many steps remain
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error(`Pipeline advancement failed for run ${run.id}:`, "stakwork-run", { error: String(error) });
    // The current run's result is already saved. Log the failure but don't lose work.
  }
}
```

**Key improvements over the original plan:**
1. Pipeline only advances if auto-accept actually succeeded (not just if status is COMPLETED)
2. `parentRunId` is passed directly to `createStakworkRun()` — no separate update call
3. `pipelineParams` flows through the chain

### 5. Update `createStakworkRun` signature

Extend the input type to accept pipeline fields:

```typescript
interface CreateStakworkRunInput {
  type: StakworkRunType;
  workspaceId: string;
  featureId?: string;
  autoAccept?: boolean;
  params?: Record<string, unknown>;
  // Pipeline fields
  parentRunId?: string;
  pipelineNext?: string[];
  pipelineParams?: PipelineParams;
}

export async function createStakworkRun(
  input: CreateStakworkRunInput,
  userId: string
): Promise<StakworkRun> {
  // ... existing logic ...

  const run = await db.stakworkRun.create({
    data: {
      // ... existing fields ...
      parentRunId: input.parentRunId,
      pipelineNext: input.pipelineNext ?? [],
      pipelineParams: input.pipelineParams ?? null,
    },
  });

  return run;
}
```

### 6. New API endpoint: `POST /api/features/[featureId]/launch`

A single endpoint that starts the pipeline:

```typescript
// src/app/api/features/[featureId]/launch/route.ts

export async function POST(request: NextRequest, { params }: { params: { featureId: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const feature = await db.feature.findUnique({
    where: { id: params.featureId },
    include: { workspace: true },
  });

  if (!feature) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }

  // Check workspace access
  const access = await getWorkspaceAccess(feature.workspace.slug, session.user.id);
  if (!access || !canManageFeatures(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate requirements exist — this is the human checkpoint
  if (!feature.requirements || feature.requirements.trim() === "") {
    return NextResponse.json(
      { error: "Requirements must be filled in before launching. This is the human review step." },
      { status: 400 }
    );
  }

  // Idempotency: check if a pipeline is already running
  const existingRun = await db.stakworkRun.findFirst({
    where: {
      featureId: params.featureId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      OR: [
        { pipelineNext: { isEmpty: false } },
        { parentRunId: { not: null } },
      ],
    },
  });

  if (existingRun) {
    return NextResponse.json(
      { error: "Pipeline already running", runId: existingRun.id },
      { status: 409 }
    );
  }

  // Define the pipeline
  const PIPELINE: StakworkRunType[] = ["ARCHITECTURE", "TASK_GENERATION"];

  // Create the first run
  const firstRun = await createStakworkRun({
    type: PIPELINE[0],
    workspaceId: feature.workspaceId,
    featureId: params.featureId,
    autoAccept: true,
    pipelineNext: PIPELINE.slice(1),
    pipelineParams: {
      autoAssignTasks: true,
      skipClarifyingQuestions: true,
    },
  }, session.user.id);

  // Update feature status
  await db.feature.update({
    where: { id: params.featureId },
    data: { status: "IN_PROGRESS" },
  });

  return NextResponse.json({
    success: true,
    data: {
      runId: firstRun.id,
      pipeline: PIPELINE,
      pipelineParams: { autoAssignTasks: true },
    },
  });
}
```

### 7. Stop endpoint: `POST /api/features/[featureId]/launch/stop`

Stops the active pipeline:

```typescript
export async function POST(request: NextRequest, { params }: { params: { featureId: string } }) {
  // Auth + access checks...

  // Find all in-progress/pending runs for this feature that are part of a pipeline
  const activeRuns = await db.stakworkRun.findMany({
    where: {
      featureId: params.featureId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      OR: [
        { pipelineNext: { isEmpty: false } },
        { parentRunId: { not: null } },
      ],
    },
  });

  // Stop each active run and clear pipeline state
  for (const run of activeRuns) {
    await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        status: "HALTED",
        pipelineNext: [],  // Clear remaining steps so chain doesn't resume
      },
    });

    // If the run has a Stakwork projectId, attempt to stop it externally
    if (run.projectId) {
      try {
        await stopStakworkProject(run.projectId);
      } catch (error) {
        logger.warn(`Failed to stop Stakwork project ${run.projectId}`, "pipeline", { error });
      }
    }
  }

  return NextResponse.json({ success: true, stoppedRuns: activeRuns.length });
}
```

### 8. Frontend simplification

The feature detail page changes from **orchestrator** to **observer**:

**Remove:**
- `isAutoLaunching`, `autoLaunchStep`, `currentAutoLaunchRunId` state
- `handleLaunchTasks()` callback
- The `handleStakworkRunUpdate` Pusher handler that chains architecture → tasks
- All the refs (`isAutoLaunchingRef`, `autoLaunchStepRef`, `handleLaunchTasksRef`)

**Replace with:**
- A single `POST /api/features/[featureId]/launch` call from the Launch button
- A `pipelineStatus` derived from Pusher events, used purely for display:
  ```typescript
  const [pipelineStatus, setPipelineStatus] = useState<{
    running: boolean;
    currentStep: string | null;
    stepsRemaining: number;
  }>({ running: false, currentStep: null, stepsRemaining: 0 });
  ```
- The existing `STAKWORK_RUN_DECISION` listener already refetches feature data on accept — this stays unchanged

The Pusher handler becomes read-only: it updates a progress display but never triggers API calls.

### 9. Error handling and recovery

Because the pipeline state lives in the database, recovery is straightforward:

- **Failed run:** The `processStakworkRunWebhook` handler catches failures. If a run fails, it won't have `COMPLETED` status, so `pipelineNext` won't advance. The feature page can show "Architecture failed" with a retry button.

- **Retry from failure:** The `/launch` endpoint can detect a failed pipeline and offer to resume:
  ```typescript
  const failedRun = await db.stakworkRun.findFirst({
    where: {
      featureId: params.featureId,
      status: { in: ["FAILED", "ERROR"] },
      parentRunId: { not: null },  // Part of a pipeline
    },
    orderBy: { createdAt: "desc" },
  });

  if (failedRun) {
    // Option: resume from the failed step instead of restarting
    // Or: return info about the failure so frontend can offer choices
  }
  ```

- **Stale runs:** The existing task coordinator cron can be extended to detect pipeline runs stuck in `IN_PROGRESS` for too long and mark them as `FAILED`.

- **Auto-accept failure:** If `applyAcceptResult()` throws, the pipeline won't advance (due to `autoAcceptSucceeded` check). The run shows as completed but the feature doesn't have the result. User can manually accept or retry.

### 10. Dashboard chat integration

The `create-feature` endpoint (`/api/features/create-feature`) currently starts an ARCHITECTURE run when `deepResearch: true`. However, per our UX principle, **requirements are the human checkpoint** — we shouldn't auto-launch the full pipeline from chat.

Instead, `deepResearch` should only generate requirements (or keep the current behavior of generating architecture for review). The user then:
1. Reviews the generated content on the feature page
2. Fills in / edits requirements
3. Clicks "Launch" to start the automated pipeline

**No change needed to `create-feature`** — it continues to work as before. The full pipeline is only triggered via the explicit `/launch` endpoint after human review.

However, we should extract the pipeline logic to a shared service for consistency:

```typescript
// src/services/feature-pipeline.ts

export async function launchFeaturePipeline(
  featureId: string,
  workspaceId: string,
  userId: string,
  options?: { autoAssignTasks?: boolean }
): Promise<StakworkRun> {
  const PIPELINE: StakworkRunType[] = ["ARCHITECTURE", "TASK_GENERATION"];

  return createStakworkRun({
    type: PIPELINE[0],
    workspaceId,
    featureId,
    autoAccept: true,
    pipelineNext: PIPELINE.slice(1),
    pipelineParams: {
      autoAssignTasks: options?.autoAssignTasks ?? true,
      skipClarifyingQuestions: true,
    },
  }, userId);
}
```

This service is called by:
- `POST /api/features/[featureId]/launch` — after validating requirements exist
- Future: any other entry point that needs to start the full pipeline

### 11. Task Coordinator prerequisites

For the full pipeline to work (tasks auto-coded after generation), ensure:

1. **Workspace has `ticketSweepEnabled: true`** — The launch endpoint could auto-enable this, or require it as a precondition:
   ```typescript
   if (!feature.workspace.ticketSweepEnabled) {
     return NextResponse.json(
       { error: "Task Coordinator must be enabled to launch pipeline" },
       { status: 400 }
     );
   }
   ```

2. **Workspace has available pods** — The task coordinator checks pod availability before starting tasks. No pods = tasks stay queued.

3. **Tasks have valid repository** — Generated tasks need a `repositoryId` to know where to code. The `TASK_GENERATION` result should include repo info, or tasks default to the first workspace repo.

## UX: Requirements as the Human Checkpoint

The pipeline is designed with a clear separation between **human review** and **automated execution**:

```
┌─────────────────────────────────────────────────────────────────┐
│  HUMAN PHASE                                                    │
│                                                                 │
│  1. User creates feature (title, brief)                         │
│  2. User writes requirements OR uses "deep research" to         │
│     generate them                                               │
│  3. User reviews and edits requirements until satisfied         │
│  4. User clicks "Launch"                                        │
│                                                                 │
│  ─────────────────── HANDOFF ───────────────────                │
│                                                                 │
│  AUTOMATED PHASE (no human intervention needed)                 │
│                                                                 │
│  5. Architecture generated and auto-accepted                    │
│  6. Tasks generated and auto-accepted                           │
│  7. Tasks coded sequentially (respecting dependencies)          │
│  8. PRs created for each task                                   │
│                                                                 │
│  ─────────────────── REVIEW ────────────────────                │
│                                                                 │
│  9. User reviews PRs and merges                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why requirements are the input checkpoint:**
- Requirements define *what* to build — the user must validate this before automation takes over
- Architecture and tasks are *how* to build it — AI handles this based on the validated requirements
- If requirements are wrong, everything downstream is wasted work
- This is the last chance for human course-correction before coding begins

**Why PR review is the output checkpoint:**
- Tasks are created with `autoMerge: false` — PRs require manual merge
- This is intentional: the user reviews the actual code before it lands
- Even with full automation, humans verify the output quality
- If a PR is wrong, the user can request changes or reject it

The Launch button is disabled until requirements are non-empty. The backend also validates this, returning a 400 error if someone tries to launch without requirements.

## Full Pipeline Flow

```
User fills in Requirements (manually or via deep research)
    │
    ▼
User clicks "Launch" on Feature
    │
    ▼
POST /api/features/[featureId]/launch
    │
    ├── Validates requirements exist (400 if empty)
    ├── Validates workspace has ticketSweepEnabled
    ├── Checks no pipeline already running (idempotency)
    ├── Creates ARCHITECTURE run with:
    │     pipelineNext: ["TASK_GENERATION"]
    │     pipelineParams: { autoAssignTasks: true, skipClarifyingQuestions: true }
    │     autoAccept: true
    ├── Sets feature.status = "IN_PROGRESS"
    │
    ▼
Stakwork executes ARCHITECTURE workflow
    │
    ▼
Webhook: processStakworkRunWebhook (status: COMPLETED)
    │
    ├── Auto-accept: updates feature.architecture
    ├── autoAcceptSucceeded = true
    ├── Pops "TASK_GENERATION" from pipelineNext
    ├── Creates TASK_GENERATION run with:
    │     parentRunId: <architecture run id>
    │     pipelineNext: []
    │     pipelineParams: { autoAssignTasks: true, ... }  (inherited)
    │     autoAccept: true
    │
    ▼
Stakwork executes TASK_GENERATION workflow
    │
    ▼
Webhook: processStakworkRunWebhook (status: COMPLETED)
    │
    ├── Auto-accept: creates Task records
    │     Each task gets: systemAssigneeType = "TASK_COORDINATOR"
    ├── pipelineNext is empty → pipeline complete
    │
    ▼
Task Coordinator Cron (runs every N minutes)
    │
    ├── Finds TODO tasks with systemAssigneeType = "TASK_COORDINATOR"
    ├── Checks areDependenciesSatisfied() for each task
    ├── For tasks with satisfied dependencies:
    │     Calls startTaskWorkflow() → Stakwork
    │
    ▼
Tasks coded sequentially, respecting dependency order
    │
    ├── Each task creates a PR
    ├── PR merge satisfies dependency for downstream tasks
    │
    ▼
All tasks complete → Feature status updated to COMPLETED
```

## Migration

```sql
ALTER TABLE stakwork_runs ADD COLUMN parent_run_id TEXT REFERENCES stakwork_runs(id);
ALTER TABLE stakwork_runs ADD COLUMN pipeline_next TEXT[] DEFAULT '{}';
ALTER TABLE stakwork_runs ADD COLUMN pipeline_params JSONB;
CREATE INDEX idx_stakwork_runs_parent ON stakwork_runs(parent_run_id);
CREATE INDEX idx_stakwork_runs_pipeline ON stakwork_runs(feature_id) WHERE array_length(pipeline_next, 1) > 0;
```

## Implementation Order

1. **Schema migration** — add `parentRunId`, `pipelineNext`, and `pipelineParams` to `StakworkRun`
2. **Update `createStakworkRun`** — accept pipeline fields in input, persist to database
3. **Update `applyAcceptResult`** — read `pipelineParams`, apply `autoAssignTasks` to task creation
4. **Update `processStakworkRunWebhook`** — add pipeline advancement logic with `autoAcceptSucceeded` gate
5. **Extract `launchFeaturePipeline()`** — shared service function for pipeline initiation
6. **API endpoints** — create `POST /api/features/[featureId]/launch` and `/stop`
7. **Frontend cleanup** — remove orchestration state from `page.tsx`, wire Launch button to new endpoint
8. **Dashboard chat** — update `create-feature` to use `launchFeaturePipeline()`
9. **Tests** — integration tests for:
   - Pipeline advancement on webhook
   - `pipelineParams` inheritance
   - `autoAssignTasks` → `systemAssigneeType` assignment
   - Idempotency of `/launch`
   - `/stop` clears pipeline state

## Design Decisions

### Why `pipelineParams` instead of per-run params?

Per-run `params` (the existing field) are sent to Stakwork and control AI behavior. `pipelineParams` control system behavior across the chain (e.g., how to handle results). Keeping them separate avoids confusion and allows `params` to vary per step while `pipelineParams` stays constant.

### Why check `autoAcceptSucceeded` before advancing?

If the run completes but auto-accept fails (e.g., `applyAcceptResult()` throws because the feature was deleted), advancing to task generation would be pointless — there's no architecture to generate tasks from. The pipeline should halt and surface the error.

### Why pass `parentRunId` to `createStakworkRun()` directly?

The original plan created the run, then updated `parentRunId` in a separate call. This creates a race condition: if the next run completes extremely fast, the parent link might not exist yet. Passing `parentRunId` at creation time ensures atomicity.

### Why use `String[]` for `pipelineNext` instead of a separate Pipeline table?

Simpler schema, no joins needed. The chain is self-describing: each run knows what comes next. For longer pipelines (3+ steps), the array naturally shrinks as steps complete. Tradeoff: querying "all runs in a pipeline" requires following `parentRunId` links, but this is rare.

### Why `autoMerge: false` for pipeline-generated tasks?

The pipeline has two human checkpoints:
1. **Input checkpoint:** User validates requirements before clicking Launch
2. **Output checkpoint:** User reviews PRs before merging

Setting `autoMerge: false` ensures PRs don't land automatically. Even though the coding is fully automated, a human still reviews the actual code before it enters the codebase. This balances automation with quality control.

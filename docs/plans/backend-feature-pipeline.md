# Backend Feature Pipeline

## Problem

The "Launch" button on the feature detail page orchestrates a multi-step AI pipeline (Architecture → Task Generation) **from the frontend**. The React component manages the sequence via in-memory state (`isAutoLaunching`, `autoLaunchStep`) and Pusher event listeners. This is brittle:

- **If the user navigates away or closes the tab**, the architecture run completes and auto-accepts, but task generation never starts. The pipeline silently dies mid-sequence.
- **No retry on partial failure.** If architecture succeeds but tasks fail, the user must re-run the entire pipeline.
- **Race conditions.** The frontend reacts to `STAKWORK_RUN_UPDATE` (status webhook) to advance the pipeline, but the result may not be saved yet (the result webhook is a separate request). Task generation could start before architecture is actually written to the feature.
- **No visibility.** There's no record of what pipeline was requested or where it stalled. The state exists only in a React component.

## Goal

Move the sequential orchestration into the backend so that a single API call ("launch this feature") kicks off the full pipeline. The frontend becomes a passive observer — it shows progress via Pusher but never drives the sequence.

## Design

### 1. Add pipeline fields to `StakworkRun`

Add two columns to track chaining:

```prisma
model StakworkRun {
  // ... existing fields ...

  // Pipeline chaining
  parentRunId String?       @map("parent_run_id")
  parentRun   StakworkRun?  @relation("RunChain", fields: [parentRunId], references: [id])
  childRuns   StakworkRun[] @relation("RunChain")
  nextStep    StakworkRunType? @map("next_step") // What to launch when this run completes
}
```

- `parentRunId` — links to the run that triggered this one (for traceability)
- `nextStep` — declares what run type to launch next upon successful completion

This is a simple linked-list approach. Each run knows its own next step, and points back to its parent. No separate "Pipeline" table needed — the chain is implicit in the run records.

### 2. Backend chaining in `processStakworkRunWebhook`

After the existing auto-accept logic in `processStakworkRunWebhook` (stakwork-run.ts ~line 721), add pipeline advancement:

```typescript
// After auto-accept succeeds...

// Advance pipeline: if this run has a nextStep, create the next run
if (run.autoAccept && run.nextStep && status === WorkflowStatus.COMPLETED && run.featureId) {
  try {
    const nextRun = await createStakworkRun(
      {
        type: run.nextStep,
        workspaceId: run.workspaceId,
        featureId: run.featureId,
        autoAccept: true,
        params: { skipClarifyingQuestions: true },
      },
      run.workspace.ownerId
    );

    // Link the chain
    await db.stakworkRun.update({
      where: { id: nextRun.id },
      data: { parentRunId: run.id },
    });

    // Broadcast pipeline progress
    await pusherServer.trigger(channelName, PUSHER_EVENTS.STAKWORK_RUN_UPDATE, {
      runId: nextRun.id,
      type: nextRun.type,
      status: nextRun.status,
      featureId: nextRun.featureId,
      parentRunId: run.id,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error(`Pipeline advancement failed for run ${run.id}:`, "stakwork-run", { error: String(error) });
    // The current run's result is already saved. Log the failure but don't lose work.
  }
}
```

The key insight: **the webhook handler already runs on the server when Stakwork calls back**. We just need to add one more step after auto-accept: check `nextStep`, and if set, create the next run. No frontend involvement.

### 3. New API endpoint: `POST /api/features/[featureId]/launch`

A single endpoint that starts the pipeline:

```typescript
// src/app/api/features/[featureId]/launch/route.ts

export async function POST(request: NextRequest, { params }: { params: { featureId: string } }) {
  // Auth + workspace access check
  // Validate feature exists and has requirements

  // Define the pipeline steps
  const PIPELINE: StakworkRunType[] = [
    "ARCHITECTURE",
    "TASK_GENERATION",
  ];

  // Create the first run with nextStep pointing to the second
  const firstRun = await createStakworkRun(
    {
      type: PIPELINE[0],
      workspaceId: feature.workspaceId,
      featureId: params.featureId,
      autoAccept: true,
      params: { skipClarifyingQuestions: true },
      nextStep: PIPELINE[1], // Chain to next
    },
    user.id
  );

  // Update feature status to IN_PROGRESS
  await db.feature.update({
    where: { id: params.featureId },
    data: { status: "IN_PROGRESS" },
  });

  return NextResponse.json({
    success: true,
    data: { runId: firstRun.id, pipeline: PIPELINE },
  });
}
```

For pipelines longer than 2 steps (e.g., adding REQUIREMENTS or USER_STORIES later), we build the chain at creation time. The first run gets `nextStep: PIPELINE[1]`. When `processStakworkRunWebhook` creates the second run, it sets `nextStep: PIPELINE[2]` by reading the pipeline definition. 

**Simpler approach:** pass the full remaining pipeline as a JSON array in a new `pipeline` field on the run, rather than just `nextStep`. When the webhook fires, pop the first element and pass the rest to the next run:

```prisma
model StakworkRun {
  // ...
  parentRunId    String?       @map("parent_run_id")
  parentRun      StakworkRun?  @relation("RunChain", fields: [parentRunId], references: [id])
  childRuns      StakworkRun[] @relation("RunChain")
  pipelineNext   String[]      @default([]) @map("pipeline_next") // Remaining steps as StakworkRunType[]
}
```

The launch endpoint creates the first run with `pipelineNext: ["TASK_GENERATION"]`. When architecture completes, the webhook pops `TASK_GENERATION` from the array and creates the next run with `pipelineNext: []`. This scales to any pipeline length without code changes.

### 4. Stop endpoint: `POST /api/features/[featureId]/launch/stop`

Stops the active pipeline for a feature:

```typescript
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

// Stop each active run
for (const run of activeRuns) {
  await stopStakworkRun(run.id, user.id);
}
```

This also clears `pipelineNext` on any halted run so the chain doesn't accidentally resume.

### 5. Frontend simplification

The feature detail page changes from **orchestrator** to **observer**:

**Remove:**
- `isAutoLaunching`, `autoLaunchStep`, `currentAutoLaunchRunId` state
- `handleLaunchTasks()` callback
- The `handleStakworkRunUpdate` Pusher handler that chains architecture → tasks
- All the refs (`isAutoLaunchingRef`, `autoLaunchStepRef`, `handleLaunchTasksRef`)

**Replace with:**
- A single `POST /api/features/[featureId]/launch` call from the Launch button
- A `pipelineStatus` derived from Pusher events or polling, used purely for display (progress indicator, "Architecture... done. Generating tasks..." etc.)
- The existing `STAKWORK_RUN_DECISION` listener already refetches feature data on accept — this stays unchanged

The Pusher handler becomes read-only: it updates a progress display but never triggers API calls.

### 6. Error handling and recovery

Because the pipeline state lives in the database, recovery is straightforward:

- **Failed run:** The `processStakworkRunWebhook` handler already catches failures. If a run fails, it won't have `COMPLETED` status, so `nextStep`/`pipelineNext` won't advance. The feature page can show "Architecture failed" with a retry button.
- **Retry a step:** `POST /api/features/[featureId]/launch` can check for an existing failed pipeline run and resume from the failed step instead of restarting.
- **Stale runs:** A cron job or the launch endpoint itself can detect runs stuck in `IN_PROGRESS` for too long and mark them as `FAILED`.

### 7. Dashboard chat integration

The `create-feature` endpoint (`/api/features/create-feature`) currently starts only an architecture run when `deepResearch: true`. With the new pipeline, it should call the same launch endpoint (or use the same service function) to start the full pipeline:

```typescript
if (deepResearch) {
  await launchFeaturePipeline(feature.id, feature.workspaceId, userOrResponse.id);
}
```

This ensures the dashboard chat and the feature detail page use the same pipeline logic.

## Migration

```sql
ALTER TABLE stakwork_runs ADD COLUMN parent_run_id TEXT REFERENCES stakwork_runs(id);
ALTER TABLE stakwork_runs ADD COLUMN pipeline_next TEXT[] DEFAULT '{}';
CREATE INDEX idx_stakwork_runs_parent ON stakwork_runs(parent_run_id);
```

## Implementation Order

1. **Schema migration** — add `parentRunId` and `pipelineNext` to `StakworkRun`
2. **Service layer** — add pipeline advancement logic to `processStakworkRunWebhook`, extract `launchFeaturePipeline()` helper
3. **API endpoint** — create `POST /api/features/[featureId]/launch` and `/stop`
4. **Frontend cleanup** — remove orchestration state from `page.tsx`, wire Launch button to new endpoint, keep Pusher as display-only
5. **Dashboard chat** — update `create-feature` to use `launchFeaturePipeline()`
6. **Tests** — integration tests for the webhook chaining logic

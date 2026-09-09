/**
 * mergeFeatureLiveState — pure reducer for incrementally updating a
 * Feature canvas node's live agent-activity state from Pusher events,
 * without a full projector re-fetch.
 *
 * Two event sources:
 *  1. `WORKFLOW_STATUS_UPDATE` on the feature's own channel (`feature-{id}`):
 *     - taskId === featureId  → planner event; update `plannerRunning`.
 *     - taskId !== featureId  → child-task event; upsert into `agentTasks`
 *       and recompute `agentsRunningCount`.
 *     - taskId not in seeded agentTasks set AND not === featureId →
 *       reject/ignore (don't trust arbitrary ids off the wire).
 *
 *  2. `STAKWORK_RUN_UPDATE` on the workspace channel:
 *     - filter `payload.featureId === featureId` → OR into `plannerRunning`.
 *
 * The incremental merge is an optimistic overlay — a subsequent full
 * projector refetch (CANVAS_UPDATED) is authoritative and should replace
 * locally-merged state outright via `resetFromProjection`.
 *
 * Note: `workspaceProjector`'s loose (no-milestone/no-initiative) features
 * have NO `CANVAS_UPDATED` refetch fallback — the incremental channel merge
 * is their ONLY update path. This makes the rejection logic and the seeded
 * `agentTasks` id set especially important for them.
 */

export interface AgentTaskState {
  id: string;
  workflowStatus: string | null;
}

export interface FeatureLiveState {
  /** Feature's own id — used as discriminator for planner vs child-task events. */
  featureId: string;
  /** True when the planner (feature-level workflow) is actively running. */
  plannerRunning: boolean;
  /**
   * Per-task live map. Seeded from the projector's `customData.agentTasks`
   * array; keys are task ids. Upserted by incoming child-task events.
   * Only task ids present in this map are trusted off the wire.
   */
  agentTasksById: Map<string, AgentTaskState>;
  /** Count of in-flight tasks: IN_PROGRESS, or (mode=agent AND PENDING). */
  agentsRunningCount: number;
  /**
   * Timestamp of the last event that touched plannerRunning from the
   * STAKWORK_RUN_UPDATE source, so duplicate broadcasts can be deduped.
   */
  lastStakworkRunTimestamp: number | null;
}

export interface WorkflowStatusUpdateEvent {
  taskId: string;
  workflowStatus: string;
  timestamp?: Date | string | number;
}

export interface StakworkRunUpdateEvent {
  featureId?: string | null;
  status?: string;
  type?: string;
  timestamp?: Date | string | number;
}

/** Derived from projector's customData.agentTasks array on initial seeding. */
export interface ProjectionSnapshot {
  plannerRunning: boolean;
  agentTasks: AgentTaskState[];
  agentsRunningCount: number;
}

export interface FeatureRunState {
  plannerRunning: boolean;
  agentsRunningCount: number;
  /** True when any child task FAILED / ERROR — the halt condition that forces `plannerRunning` false. */
  hasErrorTask: boolean;
}

/**
 * Canonical "is this feature running?" predicate, shared by the canvas
 * projector (`buildFeatureNode` in `projectors.ts`) and the org control panel so
 * every surface agrees on what "running" means:
 *
 *   - `plannerRunning`: true ONLY when `workflowStatus === "IN_PROGRESS"`.
 *     Deliberately excludes "PENDING" (the Prisma schema default) so a
 *     brand-new, never-started feature never false-positives as running.
 *     Forced false when any child task has FAILED/ERROR — the same halt
 *     condition `updateFeatureStatusFromTasks` recognises, so a feature
 *     sitting on a stale IN_PROGRESS read with broken tasks doesn't pulse
 *     indefinitely.
 *   - `agentsRunningCount`: TaskCard.tsx's in-flight convention —
 *     `workflowStatus === "IN_PROGRESS"`, OR `mode === "agent"` AND
 *     `workflowStatus === "PENDING"` (agent-mode tasks are active from
 *     PENDING until completion). Non-agent PENDING tasks are NOT counted.
 */
export function deriveFeatureRunState(
  workflowStatus: string | null,
  tasks: ReadonlyArray<{ workflowStatus: string | null; mode?: string | null }>,
): FeatureRunState {
  const hasErrorTask = tasks.some((t) => t.workflowStatus === "FAILED" || t.workflowStatus === "ERROR");
  const plannerRunning = !hasErrorTask && workflowStatus === "IN_PROGRESS";
  const agentsRunningCount = tasks.filter(
    (t) => t.workflowStatus === "IN_PROGRESS" || (t.mode === "agent" && t.workflowStatus === "PENDING"),
  ).length;
  return { plannerRunning, agentsRunningCount, hasErrorTask };
}

/** "Planner working", "N agent(s) running", or both joined — the one label for a running state. */
export function formatRunningLabel(running: Pick<FeatureRunState, "plannerRunning" | "agentsRunningCount">): string {
  const parts: string[] = [];
  if (running.plannerRunning) parts.push("Planner working");
  if (running.agentsRunningCount > 0) {
    parts.push(running.agentsRunningCount === 1 ? "1 agent running" : `${running.agentsRunningCount} agents running`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a single task state is "in flight" using the same
 * logic as TaskCard.tsx: IN_PROGRESS is always running; PENDING is running
 * only for agent-mode tasks (which remain active until completion).
 *
 * Because the wire representation only carries `{id, workflowStatus}` (no
 * `mode` field after seeding), we conservatively treat PENDING as NOT
 * in-flight for non-agent mode — the mode is unknown from the event alone.
 * The projector's initial seed uses the full `mode` field; incremental
 * updates from events use only workflowStatus.
 *
 * This is intentionally conservative: a task transitioning from PENDING
 * (not counted) → IN_PROGRESS (counted) will emit an event and the count
 * will immediately update. The edge case of a new agent-mode task starting
 * at PENDING is caught on the next CANVAS_UPDATED full refetch.
 */
function isTaskInFlight(workflowStatus: string | null): boolean {
  return workflowStatus === "IN_PROGRESS";
}

function recomputeCount(tasks: Map<string, AgentTaskState>): number {
  let count = 0;
  for (const t of tasks.values()) {
    if (isTaskInFlight(t.workflowStatus)) count += 1;
  }
  return count;
}

function toTimestampMs(ts: Date | string | number | undefined): number {
  if (ts === undefined) return Date.now();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  return new Date(ts).getTime();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an initial FeatureLiveState from the projector's snapshot.
 * Called once when the canvas node is first rendered.
 */
export function initFeatureLiveState(featureId: string, snapshot: ProjectionSnapshot): FeatureLiveState {
  const agentTasksById = new Map<string, AgentTaskState>(
    snapshot.agentTasks.map((t) => [t.id, { id: t.id, workflowStatus: t.workflowStatus }]),
  );
  return {
    featureId,
    plannerRunning: snapshot.plannerRunning,
    agentTasksById,
    agentsRunningCount: snapshot.agentsRunningCount,
    lastStakworkRunTimestamp: null,
  };
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

/**
 * Handle a `WORKFLOW_STATUS_UPDATE` event from the feature's Pusher channel.
 *
 * Returns a new state object (immutable update) or the same reference if
 * nothing changed (allows React to bail out of re-renders).
 */
export function mergeWorkflowStatusUpdate(state: FeatureLiveState, event: WorkflowStatusUpdateEvent): FeatureLiveState {
  const { taskId, workflowStatus } = event;

  // --- Planner branch: event targets the feature itself ---
  if (taskId === state.featureId) {
    const newPlannerRunning = workflowStatus === "IN_PROGRESS";
    if (newPlannerRunning === state.plannerRunning) return state; // no change
    return { ...state, plannerRunning: newPlannerRunning };
  }

  // --- Child-task branch: event targets a child task ---
  // Upsert by task id. Feature-channel events are server-published (the
  // webhook fan-out), never client-triggerable on a public channel, so a
  // task id absent from the initial projection is a newly-created task and
  // is registered live rather than dropped — otherwise its count never
  // updates until the next full refetch.
  const existing = state.agentTasksById.get(taskId);
  if (existing && existing.workflowStatus === workflowStatus) return state; // no change

  const newTasks = new Map(state.agentTasksById);
  newTasks.set(taskId, { id: taskId, workflowStatus });
  const newCount = recomputeCount(newTasks);

  return {
    ...state,
    agentTasksById: newTasks,
    agentsRunningCount: newCount,
  };
}

/**
 * Handle a `STAKWORK_RUN_UPDATE` event from the workspace Pusher channel.
 *
 * Only acts when `event.featureId === state.featureId` and the run status
 * indicates the planner is active. ORs into `plannerRunning` — does not
 * clear it (clearing happens via WORKFLOW_STATUS_UPDATE or a full refetch).
 *
 * Uses the event timestamp for basic dedup: if a duplicate broadcast arrives
 * with the same or older timestamp, skip it.
 */
export function mergeStakworkRunUpdate(state: FeatureLiveState, event: StakworkRunUpdateEvent): FeatureLiveState {
  // Filter: only act on events for this feature
  if (!event.featureId || event.featureId !== state.featureId) return state;

  const tsMs = toTimestampMs(event.timestamp);
  // Dedup: skip if this event is older than the last one we processed
  if (state.lastStakworkRunTimestamp !== null && tsMs <= state.lastStakworkRunTimestamp) {
    return state;
  }

  // OR in plannerRunning if the run is in progress
  const runIsActive = event.status === "IN_PROGRESS";
  const newPlannerRunning = state.plannerRunning || runIsActive;

  if (newPlannerRunning === state.plannerRunning && tsMs === state.lastStakworkRunTimestamp) {
    return state;
  }

  return {
    ...state,
    plannerRunning: newPlannerRunning,
    lastStakworkRunTimestamp: tsMs,
  };
}

/**
 * Replace locally-merged state outright from an authoritative projector
 * snapshot (called on CANVAS_UPDATED full refetch).
 *
 * This is the designated "supersede" path — the projector output is
 * authoritative and clears any optimistic overlay.
 */
export function resetFromProjection(state: FeatureLiveState, snapshot: ProjectionSnapshot): FeatureLiveState {
  const agentTasksById = new Map<string, AgentTaskState>(
    snapshot.agentTasks.map((t) => [t.id, { id: t.id, workflowStatus: t.workflowStatus }]),
  );
  return {
    ...state,
    plannerRunning: snapshot.plannerRunning,
    agentTasksById,
    agentsRunningCount: snapshot.agentsRunningCount,
    lastStakworkRunTimestamp: null,
  };
}

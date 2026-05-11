/**
 * Projectors — the extension point for turning DB state into live
 * canvas nodes.
 *
 * A projector is `(scope, orgId) → { nodes, rollups? }`. The framework
 * calls every registered projector for every read; each one is
 * responsible for returning `{ nodes: [] }` when its scope doesn't
 * apply. This keeps the merge step dead-simple (concat the results) at
 * the cost of a few extra no-op calls — a cost we're happy to pay.
 */
import { db } from "@/lib/db";
import type { CanvasEdge, CanvasLane, CanvasNode } from "system-canvas";
import type {
  Projector,
  ProjectionResult,
  ProjectorContext,
  Scope,
} from "./types";
import {
  INITIATIVE_ROW_STEP,
  INITIATIVE_ROW_X0,
  INITIATIVE_ROW_Y,
  LOOSE_FEATURE_INIT_ROW_STEP,
  LOOSE_FEATURE_INIT_ROW_X0,
  LOOSE_FEATURE_INIT_ROW_Y,
  LOOSE_FEATURE_WS_ROW_STEP,
  LOOSE_FEATURE_WS_ROW_X0,
  LOOSE_FEATURE_WS_ROW_Y,
  MILESTONE_ROW_STEP,
  MILESTONE_ROW_X0,
  MILESTONE_ROW_Y,
  REPO_ROW_STEP,
  REPO_ROW_X0,
  REPO_ROW_Y,
  RESEARCH_INIT_ROW_STEP,
  RESEARCH_INIT_ROW_X0,
  RESEARCH_INIT_ROW_Y,
  RESEARCH_ROOT_ROW_STEP,
  RESEARCH_ROOT_ROW_X0,
  RESEARCH_ROOT_ROW_Y,
  TIMELINE_COL_W,
  TIMELINE_COL_X0,
  WORKSPACE_ROW_STEP,
  WORKSPACE_ROW_X0,
  WORKSPACE_ROW_Y,
} from "./geometry";

// ---------------------------------------------------------------------------
// Default placement for live nodes when the blob hasn't stored a
// position yet. Deterministic (hash-free: just index-based) so the same
// entity always lands in the same slot on first render — no jitter
// between reads.
//
// Card sizes and per-row layout constants live in `./geometry` as the
// single source of truth shared with the client renderer
// (`canvas-theme.ts`). Tweaking a card width there ripples through
// these step values automatically.
// ---------------------------------------------------------------------------

function defaultWorkspacePosition(index: number): { x: number; y: number } {
  return { x: WORKSPACE_ROW_X0 + index * WORKSPACE_ROW_STEP, y: WORKSPACE_ROW_Y };
}

function defaultRepoPosition(index: number): { x: number; y: number } {
  return { x: REPO_ROW_X0 + index * REPO_ROW_STEP, y: REPO_ROW_Y };
}

function defaultInitiativePosition(index: number): { x: number; y: number } {
  return {
    x: INITIATIVE_ROW_X0 + index * INITIATIVE_ROW_STEP,
    y: INITIATIVE_ROW_Y,
  };
}

function defaultMilestonePosition(index: number): { x: number; y: number } {
  return {
    x: MILESTONE_ROW_X0 + index * MILESTONE_ROW_STEP,
    y: MILESTONE_ROW_Y,
  };
}

/**
 * Cap on loose-feature projection on an initiative sub-canvas.
 * Initiatives with deep backlogs (hundreds or thousands of features
 * with no milestone anchor) would otherwise project a giant horizontal
 * row — the canvas auto-fits and zooms out until cards are unreadable.
 * We surface the most recently active slice (`updatedAt desc`) and
 * trust users to drill into the workspace's full feature list for the
 * long tail. User-positioned overrides still survive via
 * `Canvas.data.positions[feature:<id>]` — the cap only affects which
 * features get an *initial* slot.
 *
 * Loose features on the workspace sub-canvas no longer project at all
 * (the workspace canvas is the org's ops surface, not a backlog view).
 * See `workspaceProjector` for the rationale.
 */
const LOOSE_FEATURE_LIMIT = 25;

/**
 * Default placement for a loose feature card on an initiative sub-canvas.
 * "Loose" here = `initiativeId` set but `milestoneId` null. Lays out in
 * a horizontal row below the milestone timeline.
 */
function defaultLooseFeatureInitiativePosition(index: number): { x: number; y: number } {
  return {
    x: LOOSE_FEATURE_INIT_ROW_X0 + index * LOOSE_FEATURE_INIT_ROW_STEP,
    y: LOOSE_FEATURE_INIT_ROW_Y,
  };
}

/**
 * Default placement for an assigned feature card on a workspace
 * sub-canvas. Lays out in a horizontal row below the repo row.
 *
 * Used only for the very first render of a freshly-assigned card —
 * once the user drags it, the position rides through
 * `Canvas.data.positions[feature:<id>]` and this default is ignored.
 */
function defaultAssignedFeatureWorkspacePosition(
  index: number,
): { x: number; y: number } {
  return {
    x: LOOSE_FEATURE_WS_ROW_X0 + index * LOOSE_FEATURE_WS_ROW_STEP,
    y: LOOSE_FEATURE_WS_ROW_Y,
  };
}

/**
 * Build a `feature` canvas node from a Feature row. Shared between
 * `workspaceProjector` (loose workspace features) and
 * `milestoneTimelineProjector` (every initiative-anchored feature,
 * with or without a milestone). Centralizing the shape ensures card
 * slots (`status`, `secondary`, etc.) read identically regardless of
 * which canvas the feature renders on.
 *
 * `pos` is the projector's default placement; the io layer overlays any
 * user-saved `Canvas.data.positions[feature:<id>]` on top of it.
 */
function buildFeatureNode(
  feature: {
    id: string;
    title: string;
    status: string;
    workflowStatus: string | null;
    tasks?: Array<{ status: string }>;
  },
  pos: { x: number; y: number },
): CanvasNode {
  const taskCount = feature.tasks?.length ?? 0;
  const taskDone = feature.tasks?.filter((t) => t.status === "DONE").length ?? 0;
  return {
    id: `feature:${feature.id}`,
    type: "text",
    category: "feature",
    text: feature.title,
    x: pos.x,
    y: pos.y,
    customData: {
      status: feature.status,
      workflowStatus: feature.workflowStatus,
      taskCount,
      taskDone,
      ...(taskCount > 0 && {
        secondary: `${taskDone}/${taskCount} task${taskCount === 1 ? "" : "s"}`,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Root projector — workspaces across the top of the canvas.
// ---------------------------------------------------------------------------

/**
 * Emit one live `ws:<cuid>` node per non-deleted workspace in the org.
 * Positions are placeholders — the merge step will overlay any
 * `blob.positions[id]` the user has recorded.
 *
 * The node carries `ref: "ws:<cuid>"` so clicking it drills into the
 * workspace team view (wired in v3 but the hook is free to add now).
 */
export const rootProjector: Projector = {
  async project(scope: Scope, orgId: string): Promise<ProjectionResult> {
    if (scope.kind !== "root") return { nodes: [] };

    const workspaces = await db.workspace.findMany({
      where: { sourceControlOrgId: orgId, deleted: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        _count: { select: { repositories: true } },
      },
    });

    const nodes: CanvasNode[] = workspaces.map((w, index) => {
      const liveId = `ws:${w.id}`;
      const pos = defaultWorkspacePosition(index);
      // Defensive: production Prisma always returns `_count` when it's
      // in the `select`, but test mocks may omit it. Default to 0 so
      // a missing `_count` surfaces as "0 repos" rather than a crash.
      const repoCount = w._count?.repositories ?? 0;
      return {
        id: liveId,
        type: "text",
        category: "workspace",
        text: w.name,
        ref: liveId,
        x: pos.x,
        y: pos.y,
        customData: {
          // Footer line on the workspace card, e.g. "1 repo" / "3 repos".
          // Rendered via the `secondary` slot (see canvas-theme.ts).
          secondary: `${repoCount} ${repoCount === 1 ? "repo" : "repos"}`,
        },
      };
    });

    // v1: workspaces render as identity cards with a repo-count footer.
    // A richer rollup (worst feature status, average progress, blocker
    // count) lands here in a later slice — keep the shape ready for it.
    const rollups: Record<string, Record<string, unknown>> = {};

    return { nodes, rollups };
  },
};

// ---------------------------------------------------------------------------
// Workspace projector — a workspace's sub-canvas shows its repositories.
//
// Reached by clicking the `ws:<cuid>` node on the root canvas, which
// carries a matching `ref: "ws:<cuid>"`. The scope parser turns that
// ref into `{ kind: "workspace", workspaceId }` and this projector
// emits one `repo:<cuid>` live node per repository in the workspace.
//
// Future slices on this same scope: features, members, active tasks.
// ---------------------------------------------------------------------------

export const workspaceProjector: Projector = {
  async project(
    scope: Scope,
    orgId: string,
    context?: ProjectorContext,
  ): Promise<ProjectionResult> {
    if (scope.kind !== "workspace") return { nodes: [] };

    // Guard: the workspace must belong to the org we were asked about.
    // Without this check, any authenticated user could read any
    // workspace's repos by guessing a cuid; the scope ref travels
    // through the URL and isn't validated against `orgId` otherwise.
    const workspace = await db.workspace.findFirst({
      where: {
        id: scope.workspaceId,
        sourceControlOrgId: orgId,
        deleted: false,
      },
      select: { id: true },
    });
    if (!workspace) return { nodes: [] };

    const repositories = await db.repository.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });

    const nodes: CanvasNode[] = repositories.map((r, index) => {
      const liveId = `repo:${r.id}`;
      const pos = defaultRepoPosition(index);
      return {
        id: liveId,
        type: "text",
        category: "repository",
        text: r.name,
        // No `ref` today — no deeper canvas below a repo yet. Adding
        // one is a later slice; the node just won't be clickable for
        // drill-down until then.
        x: pos.x,
        y: pos.y,
      };
    });

    // Assigned features — explicit per-canvas pins from
    // `CanvasBlob.assignedFeatures`. The workspace canvas used to
    // auto-project loose features (cap 25), which conflated "what's
    // running" with "what we're building" and crushed the auto-fit on
    // backlog-heavy workspaces. The user (or agent) now chooses which
    // features show up here, keeping the ops surface focused while
    // still letting people pin in-flight features when that adds
    // value.
    //
    // We still validate that every pinned id (a) actually exists,
    // (b) isn't soft-deleted, and (c) lives in THIS workspace. Cross-
    // workspace pins are silently dropped — the only places that can
    // write the list are `assignFeatureOnCanvas` (validates in the
    // REST/agent layer) and `splitCanvas` (preserves the list
    // verbatim from `previous`); both are trustworthy, but a stale
    // pin from a since-moved or since-deleted feature shouldn't
    // emit a phantom card.
    const assignedIds = context?.assignedFeatures ?? [];
    if (assignedIds.length > 0) {
      const features = await db.feature.findMany({
        where: {
          id: { in: assignedIds },
          workspaceId: workspace.id,
          deleted: false,
        },
        select: {
          id: true,
          title: true,
          status: true,
          workflowStatus: true,
          tasks: {
            where: { deleted: false, archived: false },
            select: { status: true },
          },
        },
      });
      // Render in the user-pinned order (not DB order) so reordering
      // the list via the agent or future drag-to-reorder UI is
      // honored at render time. Drop ids that didn't survive the
      // existence/scope filter above.
      const byId = new Map(features.map((f) => [f.id, f]));
      let slot = 0;
      for (const id of assignedIds) {
        const f = byId.get(id);
        if (!f) continue;
        nodes.push(
          buildFeatureNode(f, defaultAssignedFeatureWorkspacePosition(slot)),
        );
        slot += 1;
      }

      // Lazy stale-pin cleanup. When the pin list contains ids that
      // didn't survive the existence/scope filter — a soft-deleted
      // feature, a feature moved to another workspace, an id that
      // never resolved — drop them from the persisted list so it
      // doesn't grow monotonically. We do this on read because:
      //   (a) the diff is already computed (the `byId` lookup just
      //       failed for those ids);
      //   (b) the deletion paths don't fan out to "every workspace
      //       canvas that might pin me," which would require a JSON
      //       array_contains scan;
      //   (c) the cleanup is fire-and-forget — a failure leaves the
      //       stale id in place (renders correctly anyway) and the
      //       next read tries again.
      // Read-path mutation is unusual; this is the same pattern
      // `dedupeAuthoredResearch` uses in `io.ts` (write-side self-
      // heal), and the cleanup is idempotent + monotonic (a stale
      // id only gets dropped, never added) so concurrent reads
      // converge to the same clean state. We pull the ref off
      // `scope` (which we already type-narrowed) and route through
      // a direct `db.canvas.update` rather than the io.ts mutation
      // primitive to avoid a re-read of the row.
      const stalePinIds = assignedIds.filter((id) => !byId.has(id));
      if (stalePinIds.length > 0) {
        const survivingIds = assignedIds.filter((id) => byId.has(id));
        const workspaceRef = `ws:${workspace.id}`;
        // Fire-and-forget. Awaiting would make every read on a
        // canvas with stale pins slower for no user-visible benefit.
        void (async () => {
          try {
            // Read-modify-write: pull the row's data blob, mutate
            // ONLY the `assignedFeatures` field, write it back. We
            // can't use `assignFeatureOnCanvas` / `unassignFeatureOnCanvas`
            // here — those operate on a single id, and we'd need
            // O(stale) of them; one round-trip is enough.
            const row = await db.canvas.findUnique({
              where: { orgId_ref: { orgId, ref: workspaceRef } },
              select: { data: true },
            });
            if (!row || !row.data || typeof row.data !== "object") return;
            // TOCTOU note: between the read at the top of this
            // projector and this update, another caller could have
            // re-added one of the stale ids (e.g. the user just
            // un-soft-deleted a feature, or pinned a different
            // feature that happens to share an id — which can't
            // happen, ids are cuids). The worst case: we drop a
            // freshly-re-added id that would have rendered. Cost:
            // user has to re-pin once. Acceptable.
            const data = row.data as Record<string, unknown>;
            const currentList = Array.isArray(data.assignedFeatures)
              ? (data.assignedFeatures as unknown[]).filter(
                  (v): v is string => typeof v === "string",
                )
              : [];
            // Re-compute the survivors from the CURRENT persisted
            // list (not from our snapshot's `assignedIds`), so
            // concurrent writes between our read and this update
            // don't get clobbered. The only ids we drop are the
            // ones still present in the current list AND in our
            // stale set.
            const staleSet = new Set(stalePinIds);
            const cleaned = currentList.filter((id) => !staleSet.has(id));
            if (cleaned.length === currentList.length) return; // nothing to do
            const nextData = {
              ...data,
              assignedFeatures: cleaned.length > 0 ? cleaned : undefined,
            };
            await db.canvas.update({
              where: { orgId_ref: { orgId, ref: workspaceRef } },
              data: { data: nextData as never },
            });
            console.log(
              "[canvas/workspaceProjector] cleaned up",
              stalePinIds.length,
              "stale pin(s) on",
              workspaceRef,
            );
            // Avoid the variable being marked unused when no stale
            // ids carry through — `survivingIds` is informational
            // only; the actual cleaned list is recomputed above
            // from the fresh row to dodge TOCTOU.
            void survivingIds;
          } catch (e) {
            // Non-fatal — the stale id stays in the list, the
            // projector still doesn't render a card for it, and
            // the next read tries again.
            console.error(
              "[canvas/workspaceProjector] stale-pin cleanup failed:",
              e,
            );
          }
        })();
      }
    }

    return { nodes };
  },
};

// ---------------------------------------------------------------------------
// Initiative projector — one card per Initiative on the org root canvas.
//
// Sits on the same root scope as workspaces (we keep them as separate
// projectors so each emission is a single, focused function). The card
// shows the initiative's name plus a milestone-completion footer
// (e.g. "3/7 milestones") and progress percent. Carries
// `ref: "initiative:<cuid>"` so clicking drills into the timeline.
//
// Initiative.status (DRAFT/ACTIVE/COMPLETED/ARCHIVED) is intentionally
// NOT mapped to a canvas color — initiatives can be long-running or
// neverending, and a status traffic-light would mislead. The table UI
// in `OrgInitiatives.tsx` is still the place to manage status.
// ---------------------------------------------------------------------------

export const initiativeProjector: Projector = {
  async project(scope: Scope, orgId: string): Promise<ProjectionResult> {
    if (scope.kind !== "root") return { nodes: [] };

    const initiatives = await db.initiative.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        // We need both the count (for the denominator) and each
        // milestone's status (to count the COMPLETED ones in JS — Prisma
        // can't filter inside `_count` without a relation predicate
        // that isn't available on this model).
        milestones: { select: { status: true } },
      },
    });

    const nodes: CanvasNode[] = initiatives.map((i, index) => {
      const liveId = `initiative:${i.id}`;
      const pos = defaultInitiativePosition(index);
      const total = i.milestones.length;
      const done = i.milestones.filter((m) => m.status === "COMPLETED").length;

      // `customData.primary` drives both the progress bar (parsed via
      // `parsePercent` in canvas-theme.ts) and the first footer metric.
      // Skip it when there are no milestones — a 0% bar on an empty
      // initiative reads as "behind", which is wrong; "no milestones
      // yet" in the secondary slot is more honest.
      const customData: Record<string, unknown> = {
        secondary:
          total === 0
            ? "no milestones yet"
            : `${done}/${total} milestone${total === 1 ? "" : "s"}`,
      };
      if (total > 0) {
        customData.primary = `${Math.round((done / total) * 100)}%`;
      }

      return {
        id: liveId,
        type: "text",
        category: "initiative",
        text: i.name,
        ref: liveId,
        x: pos.x,
        y: pos.y,
        customData,
      };
    });

    return { nodes };
  },
};

// ---------------------------------------------------------------------------
// Milestone-timeline projector — milestones laid out by `sequence` on
// an initiative sub-canvas (`ref: "initiative:<cuid>"`).
//
// Includes an org-ownership guard: we look up the initiative with the
// orgId in the where clause to prevent cross-org reads via cuid
// guessing (the ref travels through the URL and isn't validated against
// orgId otherwise — same pattern as workspaceProjector).
//
// Also emits four time-window **columns** as decorative background
// chrome:
//   - Past Due — overdue, not completed
//   - This Quarter — calendar quarter containing today
//   - Next Quarter — the calendar quarter after that
//   - Later — anything beyond next quarter
//
// Columns are positional reference frames, NOT snap targets. Cards
// keep their projector-assigned x positions (sequence-based) and
// users drag freely; the columns just paint background bands so users
// can think in time.
// ---------------------------------------------------------------------------

/**
 * Calendar-quarter boundary helper. Returns the index of the quarter
 * (0-3) and the year, so we can compute "next quarter" cleanly across
 * year boundaries.
 */
function quarterOf(d: Date): { year: number; quarter: 0 | 1 | 2 | 3 } {
  const m = d.getMonth(); // 0..11
  return {
    year: d.getFullYear(),
    quarter: Math.floor(m / 3) as 0 | 1 | 2 | 3,
  };
}

/** Short label for a (year, quarter) tuple, e.g. "Q3 2026". */
function quarterLabel(year: number, quarter: 0 | 1 | 2 | 3): string {
  return `Q${quarter + 1} ${year}`;
}

/**
 * Emit the four time-window columns for the milestone timeline.
 * Pure: takes `now` so tests can pin the date and assert against
 * stable column labels.
 */
export function buildTimelineColumns(now: Date): CanvasLane[] {
  const { year: y, quarter: q } = quarterOf(now);
  const nextQ = ((q + 1) % 4) as 0 | 1 | 2 | 3;
  const nextY = q === 3 ? y + 1 : y;
  return [
    {
      id: "past-due",
      label: "Past Due",
      start: TIMELINE_COL_X0 + 0 * TIMELINE_COL_W,
      size: TIMELINE_COL_W,
    },
    {
      id: "this-quarter",
      label: `This Quarter · ${quarterLabel(y, q)}`,
      start: TIMELINE_COL_X0 + 1 * TIMELINE_COL_W,
      size: TIMELINE_COL_W,
    },
    {
      id: "next-quarter",
      label: `Next Quarter · ${quarterLabel(nextY, nextQ)}`,
      start: TIMELINE_COL_X0 + 2 * TIMELINE_COL_W,
      size: TIMELINE_COL_W,
    },
    {
      id: "later",
      label: "Later",
      start: TIMELINE_COL_X0 + 3 * TIMELINE_COL_W,
      size: TIMELINE_COL_W,
    },
  ];
}

export const milestoneTimelineProjector: Projector = {
  async project(scope: Scope, orgId: string): Promise<ProjectionResult> {
    if (scope.kind !== "initiative") return { nodes: [] };

    const initiative = await db.initiative.findFirst({
      where: { id: scope.initiativeId, orgId },
      select: { id: true },
    });
    if (!initiative) return { nodes: [] };

    const milestones = await db.milestone.findMany({
      where: { initiativeId: initiative.id },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        sequence: true,
        dueDate: true,
        // Pull each linked feature's status so we can compute a real
        // progress fraction (% of features COMPLETED). Cheaper than a
        // separate `_count` plus a `findMany` since it's one join either
        // way; we just keep the `status` alongside the id.
        //
        // Filter out soft-deleted features at the source so the
        // denominator stays honest — a deleted feature shouldn't count
        // toward "X of Y" on the milestone card.
        //
        // The nested `_count.tasks` aggregates task-level "agent in
        // flight" signals (kanban definition: PENDING + IN_PROGRESS,
        // mirrored from `src/components/tasks/KanbanView.tsx:25-73`)
        // through one extra join so we don't need a separate
        // `task.findMany`. Soft-deleted and archived tasks are
        // filtered at the predicate level — an in-progress agent on
        // an archived task isn't "active" for milestone purposes.
        features: {
          select: {
            id: true,
            status: true,
            _count: {
              select: {
                tasks: {
                  where: {
                    deleted: false,
                    archived: false,
                    workflowStatus: { in: ["PENDING", "IN_PROGRESS"] },
                  },
                },
              },
            },
            // Pull each feature's assignee + createdBy so we can build
            // a "humans involved" set for the team-stack badge. We
            // intentionally limit to these two relations in v1 — task
            // assignees and chat-message authors would N+1 the read
            // and aren't required for the v1 visual. Avatars/initials
            // resolve from `User.name` and `User.image`.
            assignee: { select: { id: true, name: true, image: true } },
            createdBy: { select: { id: true, name: true, image: true } },
          },
          where: { deleted: false },
        },
      },
    });

    const nodes: CanvasNode[] = milestones.map((m, index) => {
      const liveId = `milestone:${m.id}`;
      const pos = defaultMilestonePosition(index);
      // Defensive features access for the same reason as workspaceProjector
      // (production Prisma always returns the array; some test mocks omit it).
      const features = m.features ?? [];
      const featureCount = features.length;
      const featureDone = features.filter((f) => f.status === "COMPLETED").length;
      // Fraction in 0..1 — the system-canvas `ProgressSlot` wants this
      // shape (NodeAccessor<number>) directly. Keep it as a number, not
      // a "67%" string; the slot renderer formats display itself.
      const progress = featureCount === 0 ? 0 : featureDone / featureCount;
      // Sum of "agent in flight" tasks across all linked features.
      // Single number for the topRightOuter count badge; if/when we
      // grow per-agent identity surfacing, this becomes the badge's
      // accessibility label / hover detail rather than the visible
      // count.
      const agentCount = features.reduce(
        (sum, f) => sum + (f._count?.tasks ?? 0),
        0,
      );

      // Union of "humans involved" across linked features. v1 scope:
      // assignee + createdBy per feature (skipping nulls). Dedup by
      // user id so a single person who created and was assigned the
      // same feature only appears once. Cap the visible portion at 3
      // and surface the overflow count separately so the renderer can
      // draw a "+N" pill when the team is larger than the stack fits.
      const involvedById = new Map<
        string,
        { id: string; name: string | null; image: string | null }
      >();
      for (const f of features) {
        if (f.assignee) involvedById.set(f.assignee.id, f.assignee);
        if (f.createdBy && !involvedById.has(f.createdBy.id)) {
          involvedById.set(f.createdBy.id, f.createdBy);
        }
      }
      const TEAM_VISIBLE = 3;
      const involved = Array.from(involvedById.values());
      const team = involved.slice(0, TEAM_VISIBLE);
      const teamOverflow = Math.max(0, involved.length - TEAM_VISIBLE);

      // Footer: "Due Mar 4 · 2/3 features", or just whichever halves
      // are populated. With a denominator we surface the rollup; without
      // features the count line falls back to silence.
      const footerParts: string[] = [];
      if (m.dueDate) {
        footerParts.push(
          `Due ${m.dueDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}`,
        );
      }
      if (featureCount > 0) {
        footerParts.push(
          `${featureDone}/${featureCount} feature${featureCount === 1 ? "" : "s"}`,
        );
      }

      return {
        id: liveId,
        type: "text",
        category: "milestone",
        // No `ref` — milestones are NOT drillable. Their linked
        // features render as sibling cards on this same initiative
        // canvas (see the feature-projection block below); milestone
        // membership is expressed via a synthetic edge from each
        // feature to its milestone, not via drill-in.
        text: m.name,
        x: pos.x,
        y: pos.y,
        customData: {
          // Raw enum value; the theme maps it to a color
          // (NOT_STARTED → muted, IN_PROGRESS → blue, COMPLETED → green).
          status: m.status,
          sequence: m.sequence,
          // Progress signals consumed by the milestone-card slots:
          //   - `progress` drives the bodyTop ProgressSlot fill (0..1).
          //   - `featureCount` gates whether the bar is shown at all
          //     (a 0% bar on an empty milestone reads as "behind",
          //     which is misleading).
          //   - `featureDone` is exposed for any future slot that wants
          //     to show the raw counter without re-computing it.
          progress,
          featureCount,
          featureDone,
          // Drives the topRightOuter count badge. The `count` slot
          // hides itself when the value is 0 (built-in `hideWhenEmpty`),
          // so a milestone with no active agents shows no badge at all.
          agentCount,
          // Drives the topRight team-stack custom slot. Up to 3 users
          // are rendered as overlapping avatars; `teamOverflow` shows
          // as a "+N" pill when the actual involved count exceeds the
          // visible portion.
          team,
          teamOverflow,
          ...(footerParts.length > 0 && { secondary: footerParts.join(" · ") }),
        },
      };
    });

    // Every feature anchored to this initiative — milestone-bound and
    // initiative-loose alike. Both render on the initiative canvas
    // alongside the milestone cards; milestone membership is shown by
    // the synthetic edges emitted below, NOT by relocating the feature
    // to a separate sub-canvas (there isn't one; milestones aren't
    // drillable).
    //
    // Capped at LOOSE_FEATURE_LIMIT and ordered by `updatedAt desc`
    // for the same reason as the workspace projector: deep backlogs
    // would otherwise auto-fit-zoom the canvas out until cards are
    // unreadable. The cap covers both buckets together — if you have
    // 50 features, you see the most-recently-updated 25 regardless of
    // which milestone (if any) they're attached to.
    const features = await db.feature.findMany({
      where: {
        initiativeId: initiative.id,
        deleted: false,
      },
      orderBy: { updatedAt: "desc" },
      take: LOOSE_FEATURE_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        workflowStatus: true,
        milestoneId: true,
        tasks: {
          where: { deleted: false, archived: false },
          select: { status: true },
        },
      },
    });
    const edges: CanvasEdge[] = [];
    features.forEach((f, index) => {
      nodes.push(
        buildFeatureNode(f, defaultLooseFeatureInitiativePosition(index)),
      );
      // Synthetic membership edge: feature → milestone. The id is
      // prefixed `synthetic:` so `splitCanvas` filters it on save —
      // these never round-trip into the authored blob (DB membership
      // is the source of truth). Stable per (feature, milestone) pair
      // so React/library reconciliation doesn't churn across reads.
      // Endpoints are filtered for referential integrity in
      // `readCanvas` — a synthetic edge to a hidden milestone gets
      // pruned automatically.
      if (f.milestoneId) {
        edges.push({
          id: `synthetic:feature-milestone:${f.id}`,
          fromNode: `feature:${f.id}`,
          toNode: `milestone:${f.milestoneId}`,
        } as CanvasEdge);
      }
    });

    return { nodes, edges, columns: buildTimelineColumns(new Date()) };
  },
};

// ---------------------------------------------------------------------------
// Registry. Order is irrelevant — each projector gates on `scope.kind`.
// Add new projectors (authoredProjector, ...) here.
//
// Note: there is intentionally no `milestoneProjector`. Milestones
// render as cards on their parent initiative's canvas (emitted by
// `milestoneTimelineProjector`) alongside the features that link to
// them; clicking a milestone is a no-op — there is no sub-canvas to
// drill into. Tasks no longer project on the org canvas at all.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Research projector — emits `research:<id>` cards for `Research` rows.
//
// Two scopes:
//   - `root` (`scope.kind === "root"`): rows where `initiativeId IS NULL`.
//     These are org-wide research \u2014 the user kicked them off from the
//     org root canvas, or the agent decided to research something
//     while the user was looking at root.
//   - `initiative`: rows where `initiativeId === scope.initiativeId`.
//     These are research scoped to that initiative.
//
// Workspaces and other sub-canvases don't render research cards \u2014
// the category isn't allowed on those scopes per
// `categoryAllowedOnScope`, so the agent never sets `initiativeId` to
// a workspace, and there's no projector branch for those scopes
// either. Keeping the surface small until there's a demand.
//
// Capped at RESEARCH_LIMIT and ordered by `updatedAt desc`. The cap is
// generous \u2014 most orgs will have far fewer than 25 research docs per
// scope, but it keeps a runaway agent (or a noisy import) from
// projecting hundreds of cards and crushing the canvas auto-fit.
// ---------------------------------------------------------------------------

const RESEARCH_LIMIT = 25;

function defaultResearchRootPosition(index: number): { x: number; y: number } {
  return {
    x: RESEARCH_ROOT_ROW_X0 + index * RESEARCH_ROOT_ROW_STEP,
    y: RESEARCH_ROOT_ROW_Y,
  };
}

function defaultResearchInitiativePosition(index: number): { x: number; y: number } {
  return {
    x: RESEARCH_INIT_ROW_X0 + index * RESEARCH_INIT_ROW_STEP,
    y: RESEARCH_INIT_ROW_Y,
  };
}

/**
 * Build a `research` canvas node from a Research row. The on-card
 * label is `topic` (verbatim user wording) NOT `title` \u2014 see
 * `canvas-theme.ts` for the rationale (zero text flicker on the
 * authored\u2192live swap when the user creates a research node from the
 * `+` menu).
 *
 * `customData.status` is derived from `content`: a row with `content`
 * still null is "researching" (the agent is searching the web /
 * writing); once `update_research` lands non-null content, the row
 * flips to "ready" and the renderer drops the in-flight chrome.
 *
 * `summary` and `title` ride through `customData` so the right-panel
 * viewer can hydrate without a second fetch on click.
 */
function buildResearchNode(
  research: {
    id: string;
    topic: string;
    title: string;
    summary: string;
    content: string | null;
  },
  pos: { x: number; y: number },
): CanvasNode {
  const status = research.content !== null ? "ready" : "researching";
  return {
    id: `research:${research.id}`,
    type: "text",
    category: "research",
    text: research.topic,
    x: pos.x,
    y: pos.y,
    customData: {
      status,
      title: research.title,
      summary: research.summary,
      // Intentionally omit `content` from the projection \u2014 markdown
      // can be many KB and would bloat every canvas read for a value
      // the right panel re-fetches on click anyway. The viewer hits
      // `/api/orgs/[githubLogin]/canvas/node/research:<id>` for the
      // full row.
    },
  };
}

export const researchProjector: Projector = {
  async project(scope: Scope, orgId: string): Promise<ProjectionResult> {
    if (scope.kind === "root") {
      const rows = await db.research.findMany({
        where: { orgId, initiativeId: null },
        orderBy: { updatedAt: "desc" },
        take: RESEARCH_LIMIT,
        select: {
          id: true,
          topic: true,
          title: true,
          summary: true,
          content: true,
        },
      });
      const nodes = rows.map((r, index) =>
        buildResearchNode(r, defaultResearchRootPosition(index)),
      );
      return { nodes };
    }

    if (scope.kind === "initiative") {
      // Same org-membership guard as `milestoneTimelineProjector`:
      // the initiative ref travels through URLs and isn't validated
      // against `orgId` otherwise. Without this, a guessed cuid could
      // surface another org's research.
      const initiative = await db.initiative.findFirst({
        where: { id: scope.initiativeId, orgId },
        select: { id: true },
      });
      if (!initiative) return { nodes: [] };

      const rows = await db.research.findMany({
        where: { orgId, initiativeId: initiative.id },
        orderBy: { updatedAt: "desc" },
        take: RESEARCH_LIMIT,
        select: {
          id: true,
          topic: true,
          title: true,
          summary: true,
          content: true,
        },
      });
      const nodes = rows.map((r, index) =>
        buildResearchNode(r, defaultResearchInitiativePosition(index)),
      );
      return { nodes };
    }

    return { nodes: [] };
  },
};

export const PROJECTORS: Projector[] = [
  rootProjector,
  workspaceProjector,
  initiativeProjector,
  milestoneTimelineProjector,
  researchProjector,
];

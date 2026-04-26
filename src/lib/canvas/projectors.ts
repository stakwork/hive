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
import type { CanvasLane, CanvasNode } from "system-canvas";
import type { Projector, ProjectionResult, Scope } from "./types";
import {
  FEATURE_ROW_STEP,
  FEATURE_ROW_X0,
  FEATURE_ROW_Y,
  INITIATIVE_ROW_STEP,
  INITIATIVE_ROW_X0,
  INITIATIVE_ROW_Y,
  MILESTONE_ROW_STEP,
  MILESTONE_ROW_X0,
  MILESTONE_ROW_Y,
  REPO_ROW_STEP,
  REPO_ROW_X0,
  REPO_ROW_Y,
  TASK_STACK_STEP_Y,
  TASK_STACK_X_OFFSET,
  TASK_STACK_Y0,
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

/** Default placement for a Feature card on the milestone sub-canvas.
 *  Features lay out in a horizontal row; columnIndex is their order
 *  within the milestone (createdAt asc). */
function defaultFeaturePosition(columnIndex: number): { x: number; y: number } {
  return {
    x: FEATURE_ROW_X0 + columnIndex * FEATURE_ROW_STEP,
    y: FEATURE_ROW_Y,
  };
}

/** Default placement for a Task card on the milestone sub-canvas.
 *  Tasks stack vertically beneath their parent feature, centered on
 *  the feature column's x. */
function defaultTaskPosition(
  columnIndex: number,
  rowIndex: number,
): { x: number; y: number } {
  return {
    x: FEATURE_ROW_X0 + columnIndex * FEATURE_ROW_STEP + TASK_STACK_X_OFFSET,
    y: TASK_STACK_Y0 + rowIndex * TASK_STACK_STEP_Y,
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
  async project(scope: Scope, orgId: string): Promise<ProjectionResult> {
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
        // Drill into the milestone sub-canvas (Features + Tasks). The
        // scope parser already recognizes `milestone:<id>`; the projector
        // for that scope ships with Slice 5.
        ref: liveId,
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

    return { nodes, columns: buildTimelineColumns(new Date()) };
  },
};

// ---------------------------------------------------------------------------
// Milestone sub-canvas projector — Features + Tasks at one drill.
//
// Reached by clicking a `milestone:<cuid>` node on an initiative
// timeline. Per the milestone-progress plan (Q6), the v2 design is a
// SINGLE flat layout: each linked Feature owns a column, with its
// Tasks stacked underneath. No second drill click required to see
// task progress.
//
// Org-ownership guard travels through the milestone → initiative
// chain: a guessed milestoneId can't read another org's content.
//
// Tasks are leaves — `task:` is registered as a live id prefix (so
// authored fields are stripped on save) but `parseScope` never
// resolves to a task scope. Drilling into a task happens through the
// existing task pages (`/w/<slug>/task/<id>`), not on the canvas.
// ---------------------------------------------------------------------------

export const milestoneProjector: Projector = {
  async project(scope: Scope, orgId: string): Promise<ProjectionResult> {
    if (scope.kind !== "milestone") return { nodes: [] };

    // Org-ownership guard: the milestone must belong to an initiative
    // that belongs to this org. Without this check, any cuid in the
    // URL would surface that milestone's features regardless of org
    // membership.
    const milestone = await db.milestone.findFirst({
      where: { id: scope.milestoneId, initiative: { orgId } },
      select: { id: true },
    });
    if (!milestone) return { nodes: [] };

    // Pull each linked Feature with its non-deleted, non-archived
    // Tasks. We carry both `status` (FeatureStatus / TaskStatus) and
    // `workflowStatus` (the WorkflowStatus enum) so the theme can
    // render either signal — different visual treatments may want
    // either one (e.g. the kanban groups by workflowStatus, while the
    // feature roll-up uses status).
    const features = await db.feature.findMany({
      where: { milestoneId: milestone.id, deleted: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        workflowStatus: true,
        tasks: {
          where: { deleted: false, archived: false },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            title: true,
            status: true,
            workflowStatus: true,
            assigneeId: true,
          },
        },
      },
    });

    const nodes: CanvasNode[] = [];
    features.forEach((f, columnIndex) => {
      const fpos = defaultFeaturePosition(columnIndex);
      const taskCount = f.tasks.length;
      const taskDone = f.tasks.filter((t) => t.status === "DONE").length;

      nodes.push({
        id: `feature:${f.id}`,
        type: "text",
        category: "feature",
        text: f.title,
        // No `ref` in v1 — drilling into a feature from the canvas
        // doesn't have a destination yet. The library renders the card
        // as non-navigable; the existing `/w/<slug>/plan/<id>` page
        // remains the way to jump into a feature's full view.
        x: fpos.x,
        y: fpos.y,
        customData: {
          status: f.status,
          workflowStatus: f.workflowStatus,
          taskCount,
          taskDone,
          // Same shape as the milestone's footer — "X/Y tasks" reads
          // as a sibling of "X/Y features" on the parent milestone
          // card. Skip when the feature has no tasks (a 0/0 line on a
          // freshly-created feature reads as misleading "behind").
          ...(taskCount > 0 && {
            secondary: `${taskDone}/${taskCount} task${taskCount === 1 ? "" : "s"}`,
          }),
        },
      });

      f.tasks.forEach((t, rowIndex) => {
        const tpos = defaultTaskPosition(columnIndex, rowIndex);
        nodes.push({
          id: `task:${t.id}`,
          type: "text",
          category: "task",
          text: t.title,
          x: tpos.x,
          y: tpos.y,
          customData: {
            // Both status enums travel; the theme picks which one
            // drives the color band. Default expectation: workflow
            // status (PENDING/IN_PROGRESS/COMPLETED/ERROR/HALTED)
            // since that's the kanban-board signal.
            status: t.status,
            workflowStatus: t.workflowStatus,
            ...(t.assigneeId && { assigneeId: t.assigneeId }),
          },
        });
      });
    });

    return { nodes };
  },
};

// ---------------------------------------------------------------------------
// Registry. Order is irrelevant — each projector gates on `scope.kind`.
// Add new projectors (authoredProjector, ...) here.
// ---------------------------------------------------------------------------

export const PROJECTORS: Projector[] = [
  rootProjector,
  workspaceProjector,
  initiativeProjector,
  milestoneTimelineProjector,
  milestoneProjector,
];

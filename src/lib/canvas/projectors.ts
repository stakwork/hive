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
import type { CanvasNode } from "system-canvas";
import type { Projector, ProjectionResult, Scope } from "./types";
import {
  INITIATIVE_ROW_STEP,
  INITIATIVE_ROW_X0,
  INITIATIVE_ROW_Y,
  MILESTONE_ROW_STEP,
  MILESTONE_ROW_X0,
  MILESTONE_ROW_Y,
  REPO_ROW_STEP,
  REPO_ROW_X0,
  REPO_ROW_Y,
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
// ---------------------------------------------------------------------------

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
        _count: { select: { features: true } },
      },
    });

    const nodes: CanvasNode[] = milestones.map((m, index) => {
      const liveId = `milestone:${m.id}`;
      const pos = defaultMilestonePosition(index);
      // Defensive `_count` access for the same reason as workspaceProjector
      // (production Prisma always returns it; some test mocks omit it).
      const featureCount = m._count?.features ?? 0;

      // Footer: "Due Mar 4 · 2 features", or just one half if the other
      // is missing. Keep it terse — the milestone card is small.
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
          `${featureCount} feature${featureCount === 1 ? "" : "s"}`,
        );
      }

      return {
        id: liveId,
        type: "text",
        category: "milestone",
        text: m.name,
        // No `ref` in v1 — drilling into a milestone (to see its
        // features/tasks) is v2 work.
        x: pos.x,
        y: pos.y,
        customData: {
          // Raw enum value; the theme maps it to a color
          // (NOT_STARTED → muted, IN_PROGRESS → blue, COMPLETED → green).
          status: m.status,
          sequence: m.sequence,
          ...(footerParts.length > 0 && { secondary: footerParts.join(" · ") }),
        },
      };
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
];

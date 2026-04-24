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

// ---------------------------------------------------------------------------
// Layout: default placement for live nodes when the blob hasn't stored a
// position yet. Deterministic (hash-free: just index-based) so the same
// workspace always lands in the same slot on first render — no jitter
// between reads.
// ---------------------------------------------------------------------------

const WORKSPACE_ROW_Y = 40;
const WORKSPACE_ROW_X0 = 40;
const WORKSPACE_ROW_STEP = 260;

function defaultWorkspacePosition(index: number): { x: number; y: number } {
  return { x: WORKSPACE_ROW_X0 + index * WORKSPACE_ROW_STEP, y: WORKSPACE_ROW_Y };
}

// Repo row on a workspace sub-canvas. Cards are smaller than workspace
// cards (see `repositoryCategory` in canvas-theme.ts) so the step is
// correspondingly tighter.
const REPO_ROW_Y = 40;
const REPO_ROW_X0 = 40;
const REPO_ROW_STEP = 240;

function defaultRepoPosition(index: number): { x: number; y: number } {
  return { x: REPO_ROW_X0 + index * REPO_ROW_STEP, y: REPO_ROW_Y };
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
// Registry. Order is irrelevant — each projector gates on `scope.kind`.
// Add new projectors (authoredProjector, ...) here.
// ---------------------------------------------------------------------------

export const PROJECTORS: Projector[] = [rootProjector, workspaceProjector];

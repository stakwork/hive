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
      select: { id: true, name: true },
    });

    const nodes: CanvasNode[] = workspaces.map((w, index) => {
      const liveId = `ws:${w.id}`;
      const pos = defaultWorkspacePosition(index);
      return {
        id: liveId,
        type: "text",
        category: "workspace",
        text: w.name,
        ref: liveId,
        x: pos.x,
        y: pos.y,
      };
    });

    // v1: workspaces render as plain identity cards. A workspace rollup
    // (worst feature status, average progress, blocker count) lands
    // here in a later slice — keep the shape ready for it.
    const rollups: Record<string, Record<string, unknown>> = {};

    return { nodes, rollups };
  },
};

// ---------------------------------------------------------------------------
// Registry. Order is irrelevant — each projector gates on `scope.kind`.
// Add new projectors (authoredProjector, workspaceProjector, ...) here.
// ---------------------------------------------------------------------------

export const PROJECTORS: Projector[] = [rootProjector];

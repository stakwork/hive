/**
 * Resolve "which workspaces is this scope linked to?" for the agent
 * prompt. Initiatives have no DB-level `workspaceId` FK; the
 * association lives purely as a `ws:<id> ↔ initiative:<id>` edge on
 * the **root canvas** blob.
 *
 * The human `CreateFeatureCanvasDialog` already does this lookup
 * client-side (see `fetchLinkedWorkspaceIds`) to bias the workspace
 * dropdown. The agent path needs the same signal in its system
 * prompt — without it, an agent on an initiative sub-canvas
 * (e.g. "Human Computer Interface") has no canonical way to know it
 * should file new features under workspace "hive" instead of
 * workspace "stakwork", and will guess.
 *
 * **What we DON'T do here:**
 *   - We don't read sub-canvas blobs. The `ws ↔ initiative` edge
 *     only ever lives on root.
 *   - We don't validate the agent's choice at write time. This is a
 *     prompt-side hint only; the propose tool still trusts whatever
 *     `workspaceId` the LLM picks. (If we want hard enforcement
 *     later, do it in `propose_feature.execute`.)
 *   - We don't include initiatives projected from features (those
 *     don't get edges to workspaces anyway — features are anchored
 *     to a workspace via their FK and project elsewhere).
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface LinkedWorkspace {
  id: string;
  slug: string;
  name: string;
}

/**
 * Read the root canvas blob for `orgId` and return the workspaces
 * linked (via `ws:<id> ↔ initiative:<initiativeId>` edge) to the
 * given initiative. De-duped, ordered by edge appearance (first edge
 * wins on ties — same stability rule as the human dialog).
 *
 * Returns `[]` on any failure (no canvas row, no edges, malformed
 * blob, no matching workspaces in the org). Callers treat empty as
 * "no hint" — the prompt simply omits the linked-workspace section.
 *
 * Workspaces are filtered to `sourceControlOrgId === orgId` and
 * `deleted: false` so a stale edge to a deleted/foreign-org
 * workspace never leaks into the prompt.
 */
export async function getLinkedWorkspacesForInitiative(
  orgId: string,
  initiativeId: string,
): Promise<LinkedWorkspace[]> {
  if (!orgId || !initiativeId) return [];

  let row: { data: Prisma.JsonValue } | null;
  try {
    row = await db.canvas.findUnique({
      where: { orgId_ref: { orgId, ref: "" } },
      select: { data: true },
    });
  } catch {
    return [];
  }
  if (!row) return [];

  const blob = row.data as { edges?: unknown } | null;
  const edges = Array.isArray(blob?.edges) ? blob.edges : [];

  const target = `initiative:${initiativeId}`;
  // Walk edges in order; keep the order users laid them down so
  // "first linked workspace" is stable across requests.
  const linkedIds: string[] = [];
  for (const e of edges) {
    if (!e || typeof e !== "object") continue;
    const from =
      typeof (e as { fromNode?: unknown }).fromNode === "string"
        ? ((e as { fromNode: string }).fromNode)
        : "";
    const to =
      typeof (e as { toNode?: unknown }).toNode === "string"
        ? ((e as { toNode: string }).toNode)
        : "";
    let wsId: string | null = null;
    if (from.startsWith("ws:") && to === target) {
      wsId = from.slice("ws:".length);
    } else if (to.startsWith("ws:") && from === target) {
      wsId = to.slice("ws:".length);
    }
    if (wsId && !linkedIds.includes(wsId)) linkedIds.push(wsId);
  }

  if (linkedIds.length === 0) return [];

  // Resolve to (id, slug, name) and filter to this org. We re-order
  // the DB result back into edge-appearance order so the prompt's
  // "first linked workspace" is the visually-first edge, not
  // whatever order Postgres returned.
  const rows = await db.workspace.findMany({
    where: {
      id: { in: linkedIds },
      sourceControlOrgId: orgId,
      deleted: false,
    },
    select: { id: true, slug: true, name: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: LinkedWorkspace[] = [];
  for (const id of linkedIds) {
    const r = byId.get(id);
    if (r) ordered.push({ id: r.id, slug: r.slug, name: r.name });
  }
  return ordered;
}

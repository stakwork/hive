/**
 * Cycle detection over `Feature.dependsOnFeatureIds`.
 *
 * Mirrors `Task.dependsOnTaskIds`'s posture but does a real BFS walk
 * over the existing graph rather than the "A→B and B→A only" check
 * Tasks use, because features can have richer chains across an
 * initiative (infra → backend → frontend, etc.) where a 3-hop cycle
 * is plausible.
 *
 * Usage:
 *   - From `approveFeature` (proposal flow): the new feature doesn't
 *     exist yet, so `selfId` is `null`. We just walk `candidateBlockers`'
 *     transitive dependencies and assert none of them reaches a node
 *     we're about to become — which we can't, since we don't have an
 *     id yet. In practice, this guards against the rare case where
 *     two siblings in the same chat try to depend on each other via
 *     `dependsOnProposalIds`; that surfaces as both pointing at the
 *     same already-DB cuid in `dependsOnFeatureIds`.
 *   - From `PATCH /api/features/[id]`: `selfId` IS this feature's id;
 *     we walk `candidateBlockers` and assert none transitively
 *     reaches `selfId`.
 *
 * Returns `{ ok: true }` on success or `{ ok: false, cycle: [...] }`
 * with the offending chain on failure (for clear error messages).
 */
import { db } from "@/lib/db";

export interface CycleCheckResult {
  ok: boolean;
  /** When `ok: false`, the ids forming the cycle (blocker → ... → self). */
  cycle?: string[];
}

export async function detectFeatureDependencyCycle(
  selfId: string | null,
  candidateBlockers: string[]
): Promise<CycleCheckResult> {
  if (candidateBlockers.length === 0) {
    return { ok: true };
  }

  // Direct self-edge: A blocks A. Cheap to catch up front.
  if (selfId && candidateBlockers.includes(selfId)) {
    return { ok: false, cycle: [selfId, selfId] };
  }

  // BFS the dependency closure of every candidate blocker; if any
  // path lands on `selfId`, that's a cycle.
  //
  // We materialize the visited set incrementally so a deep graph
  // doesn't fan into an exponential walk — each id is queried once.
  const visited = new Set<string>();
  const queue: string[] = [...candidateBlockers];
  const parentOf = new Map<string, string>(); // for reconstructing the cycle path

  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length).filter((id) => !visited.has(id));
    if (batch.length === 0) break;
    batch.forEach((id) => visited.add(id));

    const rows = await db.feature.findMany({
      where: { id: { in: batch }, deleted: false },
      select: { id: true, dependsOnFeatureIds: true },
    });

    for (const row of rows) {
      for (const blockerId of row.dependsOnFeatureIds) {
        if (!parentOf.has(blockerId)) {
          parentOf.set(blockerId, row.id);
        }
        if (selfId && blockerId === selfId) {
          // Reconstruct the chain selfId → ... → original candidate.
          const path: string[] = [selfId];
          let cursor: string | undefined = row.id;
          while (cursor && cursor !== selfId) {
            path.push(cursor);
            cursor = parentOf.get(cursor);
            if (path.length > 50) break; // safety cap
          }
          path.push(selfId);
          return { ok: false, cycle: path };
        }
        if (!visited.has(blockerId)) {
          queue.push(blockerId);
        }
      }
    }
  }

  return { ok: true };
}

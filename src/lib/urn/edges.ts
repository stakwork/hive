/**
 * UrnEdge service functions — typed edges between URN-addressed nodes.
 *
 * Edges are undirected: `neighborsOf` queries both `fromUrn` and `toUrn`
 * directions and deduplicates by URN.
 */

import { db } from "@/lib/db";
import type { UrnEdge } from "@prisma/client";

export type { UrnEdge };

export interface UrnEdgeNeighbor {
  urn: string;
  edgeType: string;
  direction: "forward" | "reverse";
}

export async function createEdge(
  orgId: string,
  fromUrn: string,
  toUrn: string,
  type: string
): Promise<UrnEdge> {
  return db.urnEdge.create({
    data: { orgId, fromUrn, toUrn, type },
  });
}

export async function listEdges(
  orgId: string,
  filter?: { fromUrn?: string; toUrn?: string; type?: string }
): Promise<UrnEdge[]> {
  return db.urnEdge.findMany({
    where: {
      orgId,
      ...(filter?.fromUrn ? { fromUrn: filter.fromUrn } : {}),
      ...(filter?.toUrn ? { toUrn: filter.toUrn } : {}),
      ...(filter?.type ? { type: filter.type } : {}),
    },
  });
}

export async function deleteEdge(id: string): Promise<void> {
  await db.urnEdge.delete({ where: { id } });
}

/**
 * Return all neighbors of `urn` across both edge directions.
 * Deduplicates by neighbor URN (keeps first occurrence).
 */
export async function neighborsOf(urn: string): Promise<UrnEdgeNeighbor[]> {
  const [forwardRows, reverseRows] = await Promise.all([
    db.urnEdge.findMany({ where: { fromUrn: urn } }),
    db.urnEdge.findMany({ where: { toUrn: urn } }),
  ]);

  const seen = new Set<string>();
  const results: UrnEdgeNeighbor[] = [];

  for (const row of forwardRows) {
    if (!seen.has(row.toUrn)) {
      seen.add(row.toUrn);
      results.push({ urn: row.toUrn, edgeType: row.type, direction: "forward" });
    }
  }

  for (const row of reverseRows) {
    if (!seen.has(row.fromUrn)) {
      seen.add(row.fromUrn);
      results.push({ urn: row.fromUrn, edgeType: row.type, direction: "reverse" });
    }
  }

  return results;
}

/**
 * URN Addressing Scheme & Resolver — stub module.
 *
 * This module is a compile-time dependency of the graph-walker feature.
 * The full implementation ships as a sibling feature; these stubs exist so
 * graph-walker can be compiled and tested independently.
 *
 * DO NOT add business logic here — replace this file when the URN feature
 * ships and adjust the import path in pg-neighbors.ts if needed.
 */

export interface ParsedUrn {
  realm: string;
  type: string;
  id: string;
}

/**
 * Parse a URN string into its component parts.
 * Returns null for any string that does not match `realm:type:id`.
 */
export function parseUrn(urn: string): ParsedUrn | null {
  const parts = urn.split(":");
  if (parts.length !== 3) return null;
  const [realm, type, id] = parts;
  if (!realm || !type || !id) return null;
  return { realm, type, id };
}

/**
 * Format a URN from its component parts.
 */
export function formatUrn(realm: string, type: string, id: string): string {
  return `${realm}:${type}:${id}`;
}

export interface UrnEdgeNeighbor {
  urn: string;
  edgeType: string;
  direction: "forward" | "reverse";
}

/**
 * Cross-realm UrnEdge neighbour lookup.
 * Stub returns an empty array — the real implementation queries the UrnEdge
 * table introduced by the URN feature.
 */
export const UrnEdge = {
  async neighborsOf(_urn: string): Promise<UrnEdgeNeighbor[]> {
    return [];
  },
};

export interface PgAccessContext {
  userId: string | null;
  orgId?: string;
  workspaceId?: string;
}

/**
 * Access guard for pg: URNs.
 *
 * Stub always returns true — the real implementation enforces workspace /
 * org membership rules per entity type.
 *
 * Access guard rules (enforced by the full implementation):
 *   - task / feature / repository / deployment / workflowtask / chatmessage:
 *     caller must be a member of the entity's workspace
 *   - initiative / milestone: caller must have org membership
 *   - user / workspacemember / workspace: visible only to members of the
 *     same workspace or org
 */
export async function checkPgAccess(
  _urn: string,
  _ctx: PgAccessContext
): Promise<boolean> {
  return true;
}

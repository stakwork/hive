/**
 * pgNeighbors — bidirectional neighbour resolver for the `pg:` URN realm.
 *
 * Unions:
 *   (a) Registry-driven forward and reverse hops over Postgres FK columns
 *   (b) Cross-realm UrnEdge rows from the URN feature
 *
 * No new DB tables are introduced — all intra-pg edges follow existing FK
 * columns. Only UrnEdge rows persist cross-realm links.
 */

import { db } from "@/lib/db";
import { parseUrn, formatUrn, UrnEdge, checkPgAccess } from "@/lib/urn";
import { REGISTRY, type EdgeDefinition } from "./registry";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NeighborResult {
  /** Adjacent node's URN (pg: or stakwork: for opaque-external) */
  urn: string;
  edgeType: string;
  direction: "forward" | "reverse";
}

export interface PgNeighborContext {
  userId: string | null;
  orgId?: string;
  workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CAP = 50;
const REVERSE_TAKE = 100;

// ---------------------------------------------------------------------------
// URN entity-type → Prisma client accessor name
// URN types are lowercase (e.g. "workflowtask"), Prisma accessors are
// camelCase (e.g. "workflowTask"). Entries only needed where they differ.
// ---------------------------------------------------------------------------

const URN_TYPE_TO_PRISMA: Record<string, string> = {
  workflowtask: "workflowTask",
  chatmessage: "chatMessage",
  workspacemember: "workspaceMember",
};

function prismaAccessor(urnType: string): string {
  return URN_TYPE_TO_PRISMA[urnType] ?? urnType;
}

// ---------------------------------------------------------------------------
// Field selectors per entity type
// Includes all FK fields needed for forward-scalar and forward-array resolvers.
// ---------------------------------------------------------------------------

const FORWARD_FIELD_SELECTS: Record<string, Record<string, boolean>> = {
  feature: {
    id: true,
    initiativeId: true,
    milestoneId: true,
    dependsOnFeatureIds: true,
  },
  task: {
    id: true,
    featureId: true,
    repositoryId: true,
  },
  milestone: {
    id: true,
    initiativeId: true,
  },
  initiative: {
    id: true,
  },
  repository: {
    id: true,
  },
  workspace: {
    id: true,
  },
  workspacemember: {
    id: true,
    userId: true,
  },
  workflowtask: {
    id: true,
    workflowId: true,
  },
  deployment: {
    id: true,
  },
  chatmessage: {
    id: true,
  },
  user: {
    id: true,
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Fetch the source row with only the fields needed for forward hops. */
async function fetchSourceRow(
  type: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const select = FORWARD_FIELD_SELECTS[type];
  if (!select) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (db as any)[prismaAccessor(type)];
  if (!model?.findFirst) return null;

  try {
    return await model.findFirst({ where: { id }, select });
  } catch {
    return null;
  }
}

/** Resolve results for a single EdgeDefinition against the loaded source row. */
async function resolveEdge(
  edge: EdgeDefinition,
  sourceId: string,
  row: Record<string, unknown>
): Promise<NeighborResult[]> {
  const { resolver, edgeType, toType, direction } = edge;
  const results: NeighborResult[] = [];

  switch (resolver.kind) {
    case "forward-scalar": {
      const val = row[resolver.field];
      if (val != null) {
        results.push({
          urn: formatUrn("pg", toType, String(val)),
          edgeType,
          direction,
        });
      }
      break;
    }

    case "forward-array": {
      const arr = row[resolver.field];
      if (Array.isArray(arr)) {
        for (const id of arr as string[]) {
          results.push({
            urn: formatUrn("pg", toType, id),
            edgeType,
            direction,
          });
        }
      }
      break;
    }

    case "reverse-indexed": {
      // Special-case: GIN array-containment query for BLOCKED_BY_FEATURE
      if (edge.edgeType === "BLOCKED_BY_FEATURE") {
        const rows = await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM features
          WHERE depends_on_feature_ids @> ARRAY[${sourceId}]::text[]
          LIMIT ${REVERSE_TAKE}
        `;
        for (const r of rows) {
          results.push({
            urn: formatUrn("pg", toType, r.id),
            edgeType,
            direction,
          });
        }
        break;
      }

      // Standard indexed reverse lookup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (db as any)[resolver.prismaModel];
      if (!model?.findMany) break;

      const rawRows: unknown = await model.findMany({
        where: { [resolver.fkField]: sourceId },
        select: { id: true },
        take: resolver.take ?? REVERSE_TAKE,
      });
      const rows: { id: string }[] = Array.isArray(rawRows) ? (rawRows as { id: string }[]) : [];

      for (const r of rows) {
        results.push({
          urn: formatUrn("pg", toType, r.id),
          edgeType,
          direction,
        });
      }
      break;
    }

    case "opaque-external": {
      const val = row[resolver.field];
      if (val != null) {
        // Emit verbatim — no checkPgAccess applied to opaque-external URNs
        results.push({
          urn: `${resolver.urnPrefix}:${val}`,
          edgeType,
          direction,
        });
      }
      break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// pgNeighbors — public entry point
// ---------------------------------------------------------------------------

/**
 * Return all neighbours of `urn` in the `pg:` realm.
 *
 * Algorithm:
 *   1. Parse URN — reject non-pg realms.
 *   2. Fetch the source row and apply the source access guard.
 *   3. Walk matching REGISTRY entries (skipping requiresMigration ones).
 *   4. Union with UrnEdge cross-realm neighbours.
 *   5. Apply access guard to every pg: result URN; drop failures silently.
 *   6. Deduplicate and cap at `opts.cap ?? 50`.
 */
export async function pgNeighbors(
  urn: string,
  ctx: PgNeighborContext,
  opts?: { cap?: number }
): Promise<NeighborResult[]> {
  // Step 1 — parse URN
  const parsed = parseUrn(urn);
  if (!parsed || parsed.realm !== "pg") return [];

  const { type, id } = parsed;

  // Step 2 — apply source access guard BEFORE any DB fetch
  const sourceAllowed = await checkPgAccess(urn, ctx);
  if (!sourceAllowed) return [];

  const row = await fetchSourceRow(type, id);
  if (!row) return [];

  // Step 3 — walk registry (skip requiresMigration entries)
  const applicableEdges = REGISTRY.filter(
    (e) => e.fromType === type && !e.requiresMigration
  );

  const registryResults: NeighborResult[] = [];
  for (const edge of applicableEdges) {
    const edgeResults = await resolveEdge(edge, id, row);
    registryResults.push(...edgeResults);
  }

  // Step 4 — union with UrnEdge cross-realm neighbours
  const urnEdgeNeighbours = await UrnEdge.neighborsOf(urn);
  const urnEdgeResults: NeighborResult[] = urnEdgeNeighbours.map((n) => ({
    urn: n.urn,
    edgeType: n.edgeType,
    direction: n.direction,
  }));

  // Step 5 — deduplicate by URN (keep first occurrence)
  const seen = new Set<string>();
  const merged: NeighborResult[] = [];
  for (const r of [...registryResults, ...urnEdgeResults]) {
    if (!seen.has(r.urn)) {
      seen.add(r.urn);
      merged.push(r);
    }
  }

  // Step 6 — apply access guard to every pg: URN; opaque-external passes through
  const guarded: NeighborResult[] = [];
  for (const r of merged) {
    if (!r.urn.startsWith("pg:")) {
      // opaque-external (e.g. stakwork:workflow:…) — bypass guard
      guarded.push(r);
      continue;
    }
    const allowed = await checkPgAccess(r.urn, ctx);
    if (allowed) {
      guarded.push(r);
    }
    // Silently drop URNs that fail the access guard
  }

  // Step 7 — cap
  return guarded.slice(0, opts?.cap ?? DEFAULT_CAP);
}

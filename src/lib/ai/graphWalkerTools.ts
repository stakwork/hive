/**
 * Graph walker tools — read-only cross-realm graph traversal.
 *
 * Exposes three agent tools:
 *   - `graph_get`       — resolve a single URN to its full node content
 *   - `graph_neighbors` — return all adjacent URNs reachable in one hop
 *   - `graph_search`    — keyword search across pg and canvas realms
 *
 * v1 scope: pg and canvas realms are fully implemented.
 * kg realm is a clearly-marked stub returning { error: "kg realm not yet enabled" }.
 *
 * All tools are read-only — no node creation, edge writes, or swarm mutations.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { asBlob } from "@/lib/canvas/io";
import {
  parseUrn,
  formatUrn,
  UrnEdge,
  resolvePgNode,
  resolveCanvasNode,
  parseCanvasId,
} from "@/lib/urn";
import type { UrnEdgeNeighbor } from "@/lib/urn";

import { pgNeighbors } from "@/lib/graph-walker";
import type { NeighborResult, PgNeighborContext } from "@/lib/graph-walker";

/**
 * Verify that the URN's embedded org (a githubLogin) maps to the same
 * SourceControlOrg as `orgId` (a DB cuid). Returns true only when the
 * URN belongs to the authorized org. Must be called BEFORE any resolver
 * or DB read that is keyed off the URN's {org} segment.
 */
async function urnOrgMatchesContext(
  urnOrg: string,
  orgId: string,
): Promise<boolean> {
  const row = await db.sourceControlOrg.findUnique({
    where: { githubLogin: urnOrg },
    select: { id: true },
  });
  return row?.id === orgId;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SearchResult {
  urn: string;
  type: string;
  title: string;
  realm: "pg" | "canvas";
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolve canvas structural edges from Canvas.data for a canvas URN.
 * Returns edges where the parsed nodeId is either source or target.
 */
async function resolveCanvasNeighbors(
  urn: string,
  { orgId }: { orgId: string },
): Promise<NeighborResult[]> {
  const parsed = parseUrn(urn);
  if (!parsed || parsed.realm !== "canvas") return [];

  const canvasId = parseCanvasId(parsed.id);
  if (!canvasId) return [];
  const { ref, nodeId } = canvasId;

  const row = await db.canvas.findUnique({
    where: { orgId_ref: { orgId, ref } },
    select: { data: true },
  });
  if (!row) return [];

  const blob = asBlob(row.data);
  const results: NeighborResult[] = [];

  for (const edge of blob.edges ?? []) {
    if (edge.fromNode === nodeId) {
      results.push({
        urn: formatUrn({
          realm: "canvas",
          org: parsed.org,
          type: "node",
          id: `${parsed.id.split(".")[0]}.${edge.toNode}`,
        }),
        edgeType: edge.label ?? "canvas_edge",
        direction: "forward",
      });
    } else if (edge.toNode === nodeId) {
      results.push({
        urn: formatUrn({
          realm: "canvas",
          org: parsed.org,
          type: "node",
          id: `${parsed.id.split(".")[0]}.${edge.fromNode}`,
        }),
        edgeType: edge.label ?? "canvas_edge",
        direction: "reverse",
      });
    }
  }

  return results;
}

/**
 * Deduplicate neighbor results by URN, keeping the first occurrence.
 */
function deduplicateByUrn(
  items: Array<NeighborResult | UrnEdgeNeighbor>,
): Array<NeighborResult | UrnEdgeNeighbor> {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.urn)) return false;
    seen.add(item.urn);
    return true;
  });
}

/**
 * Keyword search over pg-realm entities: features, initiatives, milestones.
 * Scoped to the org via workspace.sourceControlOrgId for features,
 * and initiative.orgId for initiatives/milestones.
 */
async function searchPg(
  query: string,
  {
    orgId,
    type,
    limit,
  }: { orgId: string; userId: string; type?: string; limit: number },
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  // Features — linked to org via workspace.sourceControlOrgId
  if (!type || type === "feature") {
    const features = await db.feature.findMany({
      where: {
        workspace: { sourceControlOrgId: orgId },
        title: { contains: query, mode: "insensitive" },
      },
      select: { id: true, title: true },
      take: limit,
    });
    for (const f of features) {
      results.push({
        urn: formatUrn({ realm: "pg", org: orgId, type: "feature", id: f.id }),
        type: "feature",
        title: f.title,
        realm: "pg",
      });
    }
  }

  // Initiatives — direct orgId column
  if (!type || type === "initiative") {
    const initiatives = await db.initiative.findMany({
      where: {
        orgId,
        name: { contains: query, mode: "insensitive" },
      },
      select: { id: true, name: true },
      take: limit,
    });
    for (const i of initiatives) {
      results.push({
        urn: formatUrn({
          realm: "pg",
          org: orgId,
          type: "initiative",
          id: i.id,
        }),
        type: "initiative",
        title: i.name,
        realm: "pg",
      });
    }
  }

  // Milestones — scoped through initiative.orgId
  if (!type || type === "milestone") {
    const milestones = await db.milestone.findMany({
      where: {
        initiative: { orgId },
        name: { contains: query, mode: "insensitive" },
      },
      select: { id: true, name: true },
      take: limit,
    });
    for (const m of milestones) {
      results.push({
        urn: formatUrn({
          realm: "pg",
          org: orgId,
          type: "milestone",
          id: m.id,
        }),
        type: "milestone",
        title: m.name,
        realm: "pg",
      });
    }
  }

  // Deduplicate and cap
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of results) {
    if (!seen.has(r.urn)) {
      seen.add(r.urn);
      deduped.push(r);
    }
    if (deduped.length >= limit) break;
  }

  return deduped;
}

/**
 * Keyword search over canvas nodes across all canvases in the org.
 * Filters nodes where `text` or `label` matches the query (case-insensitive).
 */
async function searchCanvas(
  query: string,
  {
    orgId,
    type,
    limit,
  }: { orgId: string; type?: string; limit: number },
): Promise<SearchResult[]> {
  // Only canvas nodes have a meaningful node type — skip if caller filters by non-canvas type
  if (type && type !== "node" && type !== "text") return [];

  const canvases = await db.canvas.findMany({
    where: { orgId },
    select: { ref: true, data: true, org: { select: { githubLogin: true } } },
  });

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const canvas of canvases) {
    const blob = asBlob(canvas.data);
    for (const node of blob.nodes) {
      const text = node.text ?? node.label ?? "";
      if (text.toLowerCase().includes(lowerQuery)) {
        const encodedRef = canvas.ref.replace(/:/g, "~");
        results.push({
          urn: formatUrn({
            realm: "canvas",
            org: canvas.org.githubLogin,
            type: node.type ?? "node",
            id: `${encodedRef}.${node.id}`,
          }),
          type: node.type ?? "node",
          title: text.slice(0, 120),
          realm: "canvas",
        });
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function buildGraphWalkerTools(
  orgId: string,
  userId: string,
): ToolSet {
  return {
    graph_get: tool({
      description:
        "Resolve a single URN to its full node content. " +
        "Routes by realm: `pg` and `canvas` URNs are resolved locally; " +
        "`kg` URNs are not yet enabled in v1. " +
        "Use this when you have a specific URN and need the entity's data.",
      inputSchema: z.object({
        urn: z.string().describe(
          "Canonical URN of the node to resolve. " +
            "Format: urn:{org}:{realm}:{type}:{id} for pg/canvas; " +
            "urn:{org}:kg:{workspace}:{type}:{id} for kg.",
        ),
      }),
      execute: async ({ urn }: { urn: string }) => {
        const parsed = parseUrn(urn);
        if (!parsed) return { error: "invalid URN" };

        if (!(await urnOrgMatchesContext(parsed.org, orgId))) {
          return { error: "not found or access denied" };
        }

        switch (parsed.realm) {
          case "pg": {
            const node = await resolvePgNode(urn);
            return node ?? { error: "not found or access denied" };
          }
          case "canvas": {
            const node = await resolveCanvasNode(urn);
            return node ?? { error: "not found or access denied" };
          }
          case "kg":
            // TODO(kg-enable): swap stub for live Jarvis call.
            // When enabling: call resolveKgSeam(urn, { userId }) to get credentials,
            // then GET {swarmUrl}/v2/nodes/{parsed.id} with swarmApiKey.
            // resolveKgSeam already enforces workspace membership — keep it as the IDOR guard.
            return { error: "kg realm not yet enabled" };
        }
      },
    }),

    graph_neighbors: tool({
      description:
        "Return all adjacent URNs reachable in one hop from the given node, " +
        "with edgeType and direction. " +
        "For `pg` URNs, delegates to the full pgNeighbors registry (FK traversal + UrnEdge). " +
        "For `canvas` URNs, unions structural canvas edges with UrnEdge cross-realm edges. " +
        "`kg` URNs are not yet enabled in v1.",
      inputSchema: z.object({
        urn: z.string().describe("Canonical URN of the node to expand."),
        depth: z
          .number()
          .int()
          .min(1)
          .max(1)
          .default(1)
          .describe("Traversal depth. Currently only depth=1 is supported."),
      }),
      execute: async ({ urn }: { urn: string; depth?: number }) => {
        const parsed = parseUrn(urn);
        if (!parsed) return { error: "invalid URN" };

        if (!(await urnOrgMatchesContext(parsed.org, orgId))) {
          return { error: "not found or access denied" };
        }

        switch (parsed.realm) {
          case "pg": {
            const ctx: PgNeighborContext = { userId, orgId };
            const results = await pgNeighbors(urn, ctx);
            return { neighbors: results };
          }
          case "canvas": {
            const [canvasEdges, urnEdges] = await Promise.all([
              resolveCanvasNeighbors(urn, { orgId }),
              UrnEdge.neighborsOf(urn),
            ]);
            const merged = deduplicateByUrn([...canvasEdges, ...urnEdges]);
            return { neighbors: merged };
          }
          case "kg":
            // TODO(kg-enable): call resolveKgSeam(urn, { userId }) → GET {swarmUrl}/v2/nodes/{id}?expand=edges
            // Response shape: { nodes: [...], edges: [{ source, target, edge_type }] } — map to NeighborResult[]
            return { error: "kg realm not yet enabled" };
        }
      },
    }),

    graph_search: tool({
      description:
        "Search for nodes by keyword across pg and canvas realms, " +
        "returning ranked results with URN, type, title, and realm. " +
        "Scope with `realm`, `type`, or `workspace` to narrow results. " +
        "Default (no realm) searches pg + canvas. " +
        "`kg` realm is not yet enabled — specifying `realm: 'kg'` returns a stub error.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Keyword(s) to search for."),
        realm: z
          .enum(["pg", "canvas", "kg"])
          .optional()
          .describe(
            "Limit search to a specific realm. Omit to search pg + canvas.",
          ),
        workspace: z
          .string()
          .optional()
          .describe("Workspace slug to scope the search (kg realm only for now)."),
        type: z
          .string()
          .optional()
          .describe(
            "Filter by node type (e.g. 'feature', 'initiative', 'milestone', 'node').",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum results to return per realm arm."),
      }),
      execute: async ({
        query,
        realm,
        type,
        limit = 20,
      }: {
        query: string;
        realm?: "pg" | "canvas" | "kg";
        workspace?: string;
        type?: string;
        limit?: number;
      }) => {
        const arms: Promise<SearchResult[]>[] = [];

        if (!realm || realm === "pg") {
          arms.push(searchPg(query, { orgId, userId, type, limit }));
        }
        if (!realm || realm === "canvas") {
          arms.push(searchCanvas(query, { orgId, type, limit }));
        }
        if (realm === "kg") {
          // TODO(kg-enable): resolve workspace slug(s) → getJarvisConfigForWorkspace →
          // GET {jarvisUrl}/v2/nodes?q={query}&limit={n}&node_type={type}
          // Fan-out to all org workspaces if workspace param omitted; skip inaccessible ones silently.
          arms.push(
            Promise.resolve([
              { error: "kg realm not yet enabled" } as unknown as SearchResult,
            ]),
          );
        }

        const results = (await Promise.all(arms)).flat();
        return { results };
      },
    }),
  };
}

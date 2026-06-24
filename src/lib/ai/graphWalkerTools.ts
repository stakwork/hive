/**
 * Graph walker tools — read-only cross-realm graph traversal.
 *
 * Exposes three agent tools:
 *   - `graph_get`       — resolve a single URN to its full node content
 *   - `graph_neighbors` — return all adjacent URNs reachable in one hop
 *   - `graph_search`    — keyword search across pg, canvas, and kg realms
 *
 * All three realms are live: pg (Postgres roadmap), canvas (canvas nodes), and
 * kg (the swarm knowledge graph, served by Jarvis v2 over HTTP).
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
import { resolveKgSeam } from "@/lib/urn/resolvers/kg";
import { kgGetNode, kgGetNeighbors, kgSearch } from "./kg-adapter";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";

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
  realm: "pg" | "canvas" | "kg";
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

  // Map each canvas node id → its display text so each neighbor carries a
  // human-readable label alongside its URN (the URN still holds the node id).
  const nodeText = new Map<string, string>();
  for (const node of blob.nodes ?? []) {
    const text = node.text ?? node.label ?? "";
    if (text) nodeText.set(node.id, truncateLabel(text));
  }

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
        ...(nodeText.has(edge.toNode) ? { title: nodeText.get(edge.toNode) } : {}),
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
        ...(nodeText.has(edge.fromNode) ? { title: nodeText.get(edge.fromNode) } : {}),
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

/** Max length of a neighbor's display label. */
const LABEL_MAX = 160;

/** Trim and truncate a label for display in neighbor lists. */
function truncateLabel(s: string, max = LABEL_MAX): string {
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Per-pg-type recipe for resolving a human-readable label.
 *
 * `accessor` is the Prisma client property; `select` is the (id + candidate
 * fields) projection; `pick` chooses the best semantic identifier from the row,
 * falling back across fields since not every row populates the primary one.
 *
 * Access is already enforced upstream (pgNeighbors / UrnEdge.neighborsOf only
 * emit authorized URNs), so these lookups query by id alone.
 */
type PgTitleRecipe = {
  accessor: string;
  select: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pick: (row: any) => string;
};

const PG_TITLE_RECIPES: Record<string, PgTitleRecipe> = {
  feature: {
    accessor: "feature",
    select: { id: true, title: true },
    pick: (r) => r.title ?? "",
  },
  task: {
    accessor: "task",
    select: { id: true, title: true },
    pick: (r) => r.title ?? "",
  },
  milestone: {
    accessor: "milestone",
    select: { id: true, name: true },
    pick: (r) => r.name ?? "",
  },
  initiative: {
    accessor: "initiative",
    select: { id: true, name: true },
    pick: (r) => r.name ?? "",
  },
  repository: {
    accessor: "repository",
    select: { id: true, name: true, repositoryUrl: true },
    pick: (r) => r.name || r.repositoryUrl || "",
  },
  workspace: {
    accessor: "workspace",
    select: { id: true, name: true, slug: true },
    pick: (r) => r.name || r.slug || "",
  },
  connection: {
    accessor: "connection",
    select: { id: true, name: true },
    pick: (r) => r.name ?? "",
  },
  research: {
    accessor: "research",
    select: { id: true, title: true, topic: true, summary: true },
    pick: (r) => r.title || r.topic || r.summary || "",
  },
  conversation: {
    accessor: "sharedConversation",
    select: { id: true, title: true },
    pick: (r) => r.title || "(untitled conversation)",
  },
  user: {
    accessor: "user",
    select: { id: true, name: true, email: true },
    pick: (r) => r.name || r.email || "",
  },
  workspacemember: {
    accessor: "workspaceMember",
    select: { id: true, description: true, user: { select: { name: true, email: true } } },
    pick: (r) => r.user?.name || r.user?.email || r.description || "",
  },
  chatmessage: {
    accessor: "chatMessage",
    select: { id: true, message: true },
    pick: (r) => r.message ?? "",
  },
};

/**
 * Attach a best-effort `title` to every pg-realm neighbor by batch-fetching the
 * display label per distinct type (one query per type). Non-pg neighbors
 * (kg / canvas / opaque-external) pass through untouched — they're labeled by
 * their own realm arms. Enrichment is best-effort: a failed/empty lookup just
 * leaves `title` unset rather than failing the whole traversal.
 */
async function attachPgTitles<T extends { urn: string }>(
  neighbors: T[],
): Promise<T[]> {
  const idsByType = new Map<string, Set<string>>();
  for (const n of neighbors) {
    const p = parseUrn(n.urn);
    if (!p || p.realm !== "pg" || !PG_TITLE_RECIPES[p.type]) continue;
    const set = idsByType.get(p.type) ?? new Set<string>();
    set.add(p.id);
    idsByType.set(p.type, set);
  }
  if (idsByType.size === 0) return neighbors;

  // key: `${type}:${id}` → label
  const labelByKey = new Map<string, string>();
  await Promise.all(
    [...idsByType.entries()].map(async ([type, ids]) => {
      const recipe = PG_TITLE_RECIPES[type];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (db as any)[recipe.accessor];
      if (!model?.findMany) return;
      try {
        const rows: Array<{ id: string }> = await model.findMany({
          where: { id: { in: [...ids] } },
          select: recipe.select,
        });
        for (const row of rows ?? []) {
          const label = truncateLabel(recipe.pick(row));
          if (label) labelByKey.set(`${type}:${row.id}`, label);
        }
      } catch {
        // best-effort — never fail neighbor traversal over a label lookup
      }
    }),
  );

  return neighbors.map((n) => {
    const p = parseUrn(n.urn);
    if (!p || p.realm !== "pg") return n;
    const label = labelByKey.get(`${p.type}:${p.id}`);
    return label ? { ...n, title: label } : n;
  });
}

/**
 * Keyword search over pg-realm entities: features, initiatives, milestones,
 * and tasks. Scoped to the org via workspace.sourceControlOrgId for features
 * and tasks, and initiative.orgId for initiatives/milestones.
 *
 * `urnOrg` is the org's githubLogin — the {org} segment must be the githubLogin
 * (NOT the DB cuid) so the emitted URNs round-trip back through graph_get /
 * graph_neighbors, which key off githubLogin.
 */
async function searchPg(
  query: string,
  {
    orgId,
    urnOrg,
    type,
    limit,
  }: { orgId: string; urnOrg: string; type?: string; limit: number },
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  // Features — linked to org via workspace.sourceControlOrgId. Match the
  // title plus the rich plan columns (brief / requirements / architecture)
  // so plan content is discoverable, not just the title.
  if (!type || type === "feature") {
    const features = await db.feature.findMany({
      where: {
        workspace: { sourceControlOrgId: orgId },
        deleted: false,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { brief: { contains: query, mode: "insensitive" } },
          { requirements: { contains: query, mode: "insensitive" } },
          { architecture: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true },
      take: limit,
    });
    for (const f of features) {
      results.push({
        urn: formatUrn({ realm: "pg", org: urnOrg, type: "feature", id: f.id }),
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
          org: urnOrg,
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
          org: urnOrg,
          type: "milestone",
          id: m.id,
        }),
        type: "milestone",
        title: m.name,
        realm: "pg",
      });
    }
  }

  // Research — direct orgId column. Match title OR topic OR summary OR the
  // markdown content body. Projected onto canvas as `research:<id>` cards,
  // but searched here against the DB row (the canvas arm only sees authored
  // nodes, never projected ones).
  if (!type || type === "research") {
    const researches = await db.research.findMany({
      where: {
        orgId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { topic: { contains: query, mode: "insensitive" } },
          { summary: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, topic: true },
      take: limit,
    });
    for (const r of researches) {
      results.push({
        urn: formatUrn({
          realm: "pg",
          org: urnOrg,
          type: "research",
          id: r.id,
        }),
        type: "research",
        title: r.title || r.topic,
        realm: "pg",
      });
    }
  }

  // Connections — direct orgId column. Match name OR summary OR architecture.
  if (!type || type === "connection") {
    const connections = await db.connection.findMany({
      where: {
        orgId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { summary: { contains: query, mode: "insensitive" } },
          { architecture: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true },
      take: limit,
    });
    for (const c of connections) {
      results.push({
        urn: formatUrn({
          realm: "pg",
          org: urnOrg,
          type: "connection",
          id: c.id,
        }),
        type: "connection",
        title: c.name,
        realm: "pg",
      });
    }
  }

  // Workspaces — direct sourceControlOrgId column. Match name OR description
  // OR mission; exclude soft-deleted rows.
  if (!type || type === "workspace") {
    const workspaces = await db.workspace.findMany({
      where: {
        sourceControlOrgId: orgId,
        deleted: false,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { mission: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true },
      take: limit,
    });
    for (const w of workspaces) {
      results.push({
        urn: formatUrn({
          realm: "pg",
          org: urnOrg,
          type: "workspace",
          id: w.id,
        }),
        type: "workspace",
        title: w.name,
        realm: "pg",
      });
    }
  }

  // Repositories — linked to org via workspace.sourceControlOrgId. Match
  // name OR description OR repositoryUrl.
  if (!type || type === "repository") {
    const repositories = await db.repository.findMany({
      where: {
        workspace: { sourceControlOrgId: orgId, deleted: false },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { repositoryUrl: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true },
      take: limit,
    });
    for (const r of repositories) {
      results.push({
        urn: formatUrn({
          realm: "pg",
          org: urnOrg,
          type: "repository",
          id: r.id,
        }),
        type: "repository",
        title: r.name,
        realm: "pg",
      });
    }
  }

  // Tasks — linked to org via workspace.sourceControlOrgId. Match title OR
  // description; exclude soft-deleted and archived rows.
  if (!type || type === "task") {
    const tasks = await db.task.findMany({
      where: {
        workspace: { sourceControlOrgId: orgId, deleted: false },
        deleted: false,
        archived: false,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true },
      take: limit,
    });
    for (const t of tasks) {
      results.push({
        urn: formatUrn({ realm: "pg", org: urnOrg, type: "task", id: t.id }),
        type: "task",
        title: t.title,
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
    urnOrg,
    type,
    limit,
  }: { orgId: string; urnOrg: string; type?: string; limit: number },
): Promise<SearchResult[]> {
  // Only canvas nodes have a meaningful node type — skip if caller filters by non-canvas type
  if (type && type !== "node" && type !== "text") return [];

  const canvases = await db.canvas.findMany({
    where: { orgId },
    select: { ref: true, data: true },
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
            org: urnOrg,
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

/**
 * Keyword search over org-canvas chat conversations (SharedConversation rows),
 * scoped to the org via the direct `sourceControlOrgId` column.
 *
 * Matches the conversation `title` OR any content inside the `messages` JSON
 * blob. JSON content matching requires a raw `messages::text ILIKE` predicate —
 * Prisma's typed filters can't do substring search across an arbitrary JSON
 * column. Results are pg-realm with type "conversation".
 */
async function searchConversations(
  query: string,
  {
    orgId,
    urnOrg,
    type,
    limit,
  }: { orgId: string; urnOrg: string; type?: string; limit: number },
): Promise<SearchResult[]> {
  // Only emit conversations when the caller hasn't filtered to a different type.
  if (type && type !== "conversation") return [];

  const like = `%${query}%`;
  const rows = await db.$queryRaw<Array<{ id: string; title: string | null }>>`
    SELECT id, title
    FROM shared_conversations
    WHERE source_control_org_id = ${orgId}
      AND (
        title ILIKE ${like}
        OR messages::text ILIKE ${like}
      )
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    urn: formatUrn({
      realm: "pg",
      org: urnOrg,
      type: "conversation",
      id: r.id,
    }),
    type: "conversation",
    title: r.title ?? "(untitled conversation)",
    realm: "pg" as const,
  }));
}

// ---------------------------------------------------------------------------
// kg search helper
// ---------------------------------------------------------------------------

/**
 * Keyword search over Jarvis v2 knowledge-graph nodes.
 *
 * - With `workspace`: resolves a single synthetic kg URN → IDOR guard → search.
 * - Without `workspace`: fans out to all org workspaces the user is a member of,
 *   using getSwarmAccessByWorkspaceId (membership already confirmed by the DB query).
 */
async function searchKg(
  query: string,
  {
    orgId,
    urnOrg,
    userId,
    workspace,
    type,
    limit,
  }: {
    orgId: string;
    urnOrg: string;
    userId: string;
    workspace?: string;
    type?: string;
    limit: number;
  },
): Promise<SearchResult[]> {
  const opts = { type, limit };

  if (workspace) {
    // Single-workspace path — synthetic URN for IDOR guard
    const syntheticUrn = formatUrn({
      realm: "kg",
      org: urnOrg,
      workspace,
      type: "node",
      id: "x",
    });
    const seam = await resolveKgSeam(syntheticUrn, { userId });
    if (!seam) return [];
    const hits = await kgSearch(seam.jarvisUrl, seam.swarmApiKey, query, opts);
    return hits.map((hit) => ({
      urn: formatUrn({
        realm: "kg",
        org: urnOrg,
        workspace,
        type: hit.node_type,
        id: hit.ref_id,
      }),
      type: hit.node_type,
      title: hit.name,
      realm: "kg" as const,
    }));
  }

  // Fan-out path — all org workspaces the user is a member of
  const workspaces = await db.workspace.findMany({
    where: {
      sourceControlOrg: { githubLogin: urnOrg },
      deleted: false,
      members: { some: { userId } },
    },
    select: { id: true, slug: true },
  });

  const settled = await Promise.allSettled(
    workspaces.map(async (ws) => {
      const access = await getSwarmAccessByWorkspaceId(ws.id);
      if (!access.success || !access.data.swarmName) return [] as SearchResult[];
      // kg realm talks to Jarvis (:8444), not stakgraph (:3355).
      const jarvisUrl = getJarvisUrl(access.data.swarmName);
      const hits = await kgSearch(
        jarvisUrl,
        access.data.swarmApiKey,
        query,
        opts,
      );
      return hits.map((hit) => ({
        urn: formatUrn({
          realm: "kg",
          org: urnOrg,
          workspace: ws.slug,
          type: hit.node_type,
          id: hit.ref_id,
        }),
        type: hit.node_type,
        title: hit.name,
        realm: "kg" as const,
      }));
    }),
  );

  const merged: SearchResult[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
      if (merged.length >= limit) break;
    }
  }
  return merged.slice(0, limit);
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
        "`kg` URNs are resolved live from the swarm knowledge graph (Jarvis). " +
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
          case "kg": {
            const seam = await resolveKgSeam(urn, { userId });
            if (!seam) return { error: "swarm not configured or access denied" };
            const node = await kgGetNode(seam.jarvisUrl, seam.swarmApiKey, parsed.id);
            if (!node) return { error: "node not found" };
            return node;
          }
        }
      },
    }),

    graph_neighbors: tool({
      description:
        "Return all adjacent URNs reachable in one hop from the given node, " +
        "with edgeType and direction. " +
        "For `pg` URNs, delegates to the full pgNeighbors registry (FK traversal + UrnEdge). " +
        "For `canvas` URNs, unions structural canvas edges with UrnEdge cross-realm edges. " +
        "For `kg` URNs, calls Jarvis v2 with optional edge_type / node_type filters (kg-specific, ignored by other realms).",
      inputSchema: z.object({
        urn: z.string().describe("Canonical URN of the node to expand."),
        depth: z
          .number()
          .int()
          .min(1)
          .max(1)
          .default(1)
          .describe("Traversal depth. Currently only depth=1 is supported."),
        edge_type: z
          .array(z.string())
          .optional()
          .describe("kg realm only: filter edges by type (e.g. [\"MODIFIES\", \"CITES\"])."),
        node_type: z
          .array(z.string())
          .optional()
          .describe("kg realm only: filter neighbor nodes by type (e.g. [\"File\", \"Function\"])."),
      }),
      execute: async ({
        urn,
        edge_type,
        node_type,
      }: {
        urn: string;
        depth?: number;
        edge_type?: string[];
        node_type?: string[];
      }) => {
        const parsed = parseUrn(urn);
        if (!parsed) return { error: "invalid URN" };

        if (!(await urnOrgMatchesContext(parsed.org, orgId))) {
          return { error: "not found or access denied" };
        }

        switch (parsed.realm) {
          case "pg": {
            const ctx: PgNeighborContext = { userId, orgId };
            const results = await pgNeighbors(urn, ctx);
            const neighbors = await attachPgTitles(results);
            return { neighbors };
          }
          case "canvas": {
            const [canvasEdges, urnEdges] = await Promise.all([
              resolveCanvasNeighbors(urn, { orgId }),
              UrnEdge.neighborsOf(urn),
            ]);
            const merged = deduplicateByUrn([...canvasEdges, ...urnEdges]);
            // Canvas structural neighbors are already labeled from node text;
            // this also labels any pg-realm cross-realm UrnEdge neighbors.
            const neighbors = await attachPgTitles(merged);
            return { neighbors };
          }
          case "kg": {
            const seam = await resolveKgSeam(urn, { userId });
            if (!seam) return { error: "swarm not configured or access denied" };
            const { neighbors: raw, reachable } = await kgGetNeighbors(
              seam.jarvisUrl,
              seam.swarmApiKey,
              parsed.id,
              { edgeTypes: edge_type, nodeTypes: node_type },
            );
            if (!reachable) return { error: "swarm unreachable" };
            // Surface the derived node label as `title` (consistent with the pg
            // and canvas arms), alongside the URN/ref_id the agent still needs
            // to dereference or traverse further.
            const neighbors = raw.map(({ name, ...n }) => ({
              ...n,
              urn: formatUrn({
                realm: "kg",
                org: parsed.org,
                workspace: parsed.workspace,
                type: n.node_type,
                id: n.ref_id,
              }),
              ...(name ? { title: name } : {}),
            }));
            return { neighbors };
          }
        }
      },
    }),

    graph_search: tool({
      description:
        "Search for nodes by keyword across pg, canvas, and kg realms, " +
        "returning ranked results with URN, type, title, and realm. " +
        "The pg realm covers features, initiatives, milestones, tasks, and " +
        "org-canvas chat conversations; the canvas realm covers canvas nodes; " +
        "the kg realm searches Jarvis knowledge-graph nodes. " +
        "Scope with `realm`, `type`, or `workspace` to narrow results. " +
        "Default (no realm) searches pg + canvas. " +
        "For kg: provide `workspace` to search one workspace, or omit to fan-out across all member workspaces.",
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
            "Filter by node type (e.g. 'feature', 'initiative', 'milestone', 'task', 'conversation', 'node').",
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
        workspace,
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

        // Resolve the org's githubLogin once — the {org} segment of every
        // emitted URN must be the githubLogin (not the DB cuid) so results
        // round-trip through graph_get / graph_neighbors.
        const orgRow = await db.sourceControlOrg.findUnique({
          where: { id: orgId },
          select: { githubLogin: true },
        });

        if (!orgRow) return { results: [] };
        const urnOrg = orgRow.githubLogin;

        if (!realm || realm === "pg") {
          arms.push(searchPg(query, { orgId, urnOrg, type, limit }));
          arms.push(searchConversations(query, { orgId, urnOrg, type, limit }));
        }
        if (!realm || realm === "canvas") {
          arms.push(searchCanvas(query, { orgId, urnOrg, type, limit }));
        }
        if (realm === "kg") {
          arms.push(
            searchKg(query, { orgId, urnOrg, userId, workspace, type, limit }),
          );
        }

        const results = (await Promise.all(arms)).flat();
        return { results };
      },
    }),
  };
}

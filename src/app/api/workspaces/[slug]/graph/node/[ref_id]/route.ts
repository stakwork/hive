import { kgGetNeighbors, kgGetNode } from "@/lib/ai/kg-adapter";
import { resolveJarvisAccess } from "@/lib/helpers/graph-jarvis";
import { NextRequest, NextResponse } from "next/server";
import type { GraphNodeDetailResponse, GraphNodeNeighbor } from "@/types/graph-node";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/graph/node/[ref_id]
 *
 * One node plus its directly-linked neighbors, from a single Jarvis
 * `/v2/nodes/{ref_id}?expand=edges` call (via `kgGetNeighbors`, so the UI sees
 * exactly what the graph agent sees: importance-sorted, internal types
 * excluded, parallel edges deduped).
 *
 * `types` is an optional comma-separated neighbor-type filter. Jarvis applies
 * it inside the Cypher, BEFORE the traversal limit — so filtering yields 50
 * relevant neighbors rather than 50 arbitrary ones filtered down to a handful.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; ref_id: string }> },
) {
  try {
    const { slug, ref_id } = await params;

    // Drop blank entries so a trailing comma doesn't become an empty filter.
    const nodeTypes = (request.nextUrl.searchParams.get("types") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (!ref_id) {
      return NextResponse.json({ success: false, message: "ref_id is required" }, { status: 400 });
    }

    const access = await resolveJarvisAccess(slug);
    if (access instanceof NextResponse) return access;

    // Mock fallback — after the access check so the gate is never bypassed.
    if (process.env.USE_MOCKS === "true") {
      const { getMockGraphNode } = await import("@/app/api/mock/graph/node/fixtures");
      return NextResponse.json(getMockGraphNode(ref_id), { status: 200 });
    }

    const result = await kgGetNeighbors(access.jarvisUrl, access.apiKey, ref_id, {
      includeRoot: true,
      ...(nodeTypes.length > 0 ? { nodeTypes } : {}),
    });

    // kgGetNeighbors never throws — it reports failure as `reachable: false`.
    if (!result.reachable) {
      return NextResponse.json({ success: false, message: "Graph lookup failed" }, { status: 502 });
    }

    let root = result.root;

    // `expand=edges` omits the queried node when nothing links to it that
    // survives filtering. That's "no visible neighbors", not "no such node" —
    // resolve it on its own so the panel still opens. Two ways in: a
    // neighbor-type filter narrow enough to match nothing, or a node whose
    // every edge points at a denylisted type (an AgentSession that read no
    // Concepts has only HAS_TURN edges, and Turn is denylisted). Unguarded
    // because both look identical here, and it only costs a call when the
    // node came back empty.
    if (!root) {
      const node = await kgGetNode(access.jarvisUrl, access.apiKey, ref_id);
      if (node) root = node;
    }

    if (!root) {
      return NextResponse.json({ success: false, message: "Node not found" }, { status: 404 });
    }

    const neighbors: GraphNodeNeighbor[] = result.neighbors.map((n) => ({
      ref_id: n.ref_id,
      node_type: n.node_type,
      name: n.name,
      edge_type: n.edgeType,
      direction: n.direction,
      ...(n.importance !== undefined ? { importance: n.importance } : {}),
      ...(n.read_order !== undefined ? { read_order: n.read_order } : {}),
    }));

    const payload: GraphNodeDetailResponse = {
      node: {
        ref_id: root.ref_id,
        node_type: root.node_type,
        name: root.name,
        properties: (root.properties ?? {}) as Record<string, unknown>,
      },
      neighbors,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}

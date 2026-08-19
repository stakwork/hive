import { kgGetNeighbors } from "@/lib/ai/kg-adapter";
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
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; ref_id: string }> },
) {
  try {
    const { slug, ref_id } = await params;

    if (!ref_id) {
      return NextResponse.json({ success: false, message: "ref_id is required" }, { status: 400 });
    }

    const access = await resolveJarvisAccess(slug);
    if (access instanceof NextResponse) return access;

    // Mock fallback — after the access check so the gate is never bypassed.
    if (process.env.USE_MOCKS === "true") {
      const { getMockGraphNode } = await import("@/app/api/mock/graph/node/route");
      return NextResponse.json(getMockGraphNode(ref_id), { status: 200 });
    }

    const result = await kgGetNeighbors(access.jarvisUrl, access.apiKey, ref_id, {
      includeRoot: true,
    });

    // kgGetNeighbors never throws — it reports failure as `reachable: false`.
    if (!result.reachable) {
      return NextResponse.json({ success: false, message: "Graph lookup failed" }, { status: 502 });
    }

    if (!result.root) {
      return NextResponse.json({ success: false, message: "Node not found" }, { status: 404 });
    }

    const neighbors: GraphNodeNeighbor[] = result.neighbors.map((n) => ({
      ref_id: n.ref_id,
      node_type: n.node_type,
      name: n.name,
      edge_type: n.edgeType,
      direction: n.direction,
      ...(n.importance !== undefined ? { importance: n.importance } : {}),
    }));

    const payload: GraphNodeDetailResponse = {
      node: {
        ref_id: result.root.ref_id,
        node_type: result.root.node_type,
        name: result.root.name,
        properties: (result.root.properties ?? {}) as Record<string, unknown>,
      },
      neighbors,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Raw node fetch for the run report's concept peek.
 *
 * Unlike the lingo route, this does NOT normalize to the Lingo shape and does
 * NOT expand edges: `GET {jarvis}/v2/nodes/{ref_id}` returned whole, so a
 * Concept's full `properties` (description or any other content field) reach
 * the reader. The renderer displays everything as escaped React text.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; ref_id: string }> },
) {
  const { slug, ref_id } = await params;
  const ctx = getMiddlewareContext(request);
  const user = requireAuth(ctx);
  if (user instanceof NextResponse) return user;

  const swarmResult = await getWorkspaceSwarmAccess(slug, user.id);
  if (!swarmResult.success) {
    const { type } = swarmResult.error;
    if (type === "WORKSPACE_NOT_FOUND") {
      return NextResponse.json({ success: false, error: "Workspace not found" }, { status: 404 });
    }
    if (type === "ACCESS_DENIED") {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
  }

  const { swarmName, swarmApiKey } = swarmResult.data;
  const jarvisUrl = getJarvisUrl(swarmName);

  try {
    const response = await fetch(`${jarvisUrl}/v2/nodes/${encodeURIComponent(ref_id)}`, {
      method: "GET",
      headers: {
        "x-api-token": swarmApiKey,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
    }
    const data = await response.json();
    // Jarvis answers {nodes: [node]}, {node}, or the node itself.
    const node = Array.isArray(data?.nodes) ? (data.nodes[0] ?? null) : (data?.node ?? data);
    if (!node) {
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: node });
  } catch {
    return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
  }
}

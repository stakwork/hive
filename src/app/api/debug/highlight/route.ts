import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchEndpointNodes, formatEndpointLabel } from "@/lib/format-endpoint";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";

export const runtime = "nodejs";

/**
 * POST /api/debug/highlight?workspace=<slug>
 *
 * Fetches real endpoint nodes from the workspace swarm, picks 3 random ones,
 * and highlights them with a 1-second gap between each.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspace query parameter required" }, { status: 400 });
    }

    // Find workspace with swarm
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
      include: {
        swarm: true,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (!workspace.swarm) {
      return NextResponse.json({ error: "No swarm configured for this workspace" }, { status: 400 });
    }

    // Fetch real endpoint nodes from swarm
    const endpointNodes = await fetchEndpointNodes(workspace.swarm);

    if (endpointNodes.length === 0) {
      return NextResponse.json({ error: "No endpoint nodes found in swarm" }, { status: 404 });
    }

    // Pick 3 random endpoints (or fewer if not enough)
    const count = Math.min(3, endpointNodes.length);
    const shuffled = [...endpointNodes].sort(() => Math.random() - 0.5);
    const selectedNodes = shuffled.slice(0, count);

    const channelName = getWorkspaceChannelName(workspaceSlug);
    const highlights: { name: string; ref_id: string; label: string }[] = [];

    // Highlight each with 1-second delay
    for (let i = 0; i < selectedNodes.length; i++) {
      const node = selectedNodes[i];

      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const label = formatEndpointLabel(node.name);
      const eventPayload = {
        nodeIds: [node.ref_id],
        workspaceId: workspaceSlug,
        depth: 1,
        title: label,
        timestamp: Date.now(),
        sourceNodeRefId: node.ref_id,
        expiresIn: 10,
      };

      await pusherServer.trigger(channelName, PUSHER_EVENTS.HIGHLIGHT_NODES, eventPayload);
      highlights.push({ name: node.name, ref_id: node.ref_id, label });
    }

    return NextResponse.json({
      success: true,
      totalEndpoints: endpointNodes.length,
      highlighted: highlights,
    });
  } catch (error) {
    console.error("[Debug Highlight] Error:", error);
    return NextResponse.json({ error: "Failed to highlight endpoints" }, { status: 500 });
  }
}

/**
 * GET /api/debug/highlight?workspace=<slug>
 *
 * Returns info about the endpoint and available nodes
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceSlug = searchParams.get("workspace");

  return NextResponse.json({
    description: "Debug endpoint highlighter - fetches real nodes and highlights 3 random ones",
    usage: {
      method: "POST",
      url: `/api/debug/highlight?workspace=${workspaceSlug || "<workspace-slug>"}`,
      queryParams: {
        workspace: "Required - workspace slug",
      },
    },
    behavior: "Picks 3 random endpoint nodes from the swarm and highlights them with 1-second gaps",
  });
}

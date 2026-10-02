import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { logger } from "@/lib/logger";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { readNodeByRef, updateNodeV2 } from "@/services/swarm/api/nodes";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ slug: string; ref_id: string }> };

/**
 * PUT /api/workspaces/[slug]/graph/node/[ref_id]/docs
 *
 * Write a Concept node's `docs` straight to Jarvis, addressed by its graph
 * `ref_id` (gitree's route is keyed by the concept's slug `id`, which not
 * every Concept has). Developers and up only. Only `Concept` nodes are
 * accepted, which also keeps the mirror-owned types out.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, ref_id } = await params;

    const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
    if (access instanceof NextResponse) return access;
    if (!hasRoleLevel(access.role, WorkspaceRole.DEVELOPER)) {
      return NextResponse.json({ error: "Developer access required" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (typeof body?.docs !== "string") {
      return NextResponse.json({ error: "docs must be a string" }, { status: 400 });
    }
    const docs: string = body.docs;

    const swarm = await getSwarmAccessByWorkspaceId(access.workspaceId);
    if (!swarm.success || !swarm.data.swarmName) {
      return NextResponse.json({ error: "Graph DB not configured for this workspace" }, { status: 400 });
    }
    const config = { jarvisUrl: getJarvisUrl(swarm.data.swarmName), apiKey: swarm.data.swarmApiKey };

    const node = await readNodeByRef(config, ref_id);
    // Jarvis being down or slow isn't the node being missing.
    if (!node.success && node.status !== "404") {
      return NextResponse.json({ error: node.message ?? "Couldn't read the node" }, { status: 502 });
    }
    if (!node.success || !node.node_type) {
      return NextResponse.json({ error: `Node "${ref_id}" not found` }, { status: 404 });
    }
    if (node.node_type !== "Concept") {
      return NextResponse.json({ error: "Only Concept nodes have editable docs" }, { status: 400 });
    }

    const result = await updateNodeV2(config, ref_id, { docs });
    if (!result.success) {
      return NextResponse.json({ error: result.message ?? "Failed to update node docs" }, { status: 502 });
    }

    return NextResponse.json({ success: true, ref_id, docs });
  } catch (error) {
    logger.error("[graph/node/docs] PUT failed", "graph-node-docs", { error: String(error) });
    return NextResponse.json({ error: "Failed to update node docs" }, { status: 500 });
  }
}

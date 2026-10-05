/**
 * GET /api/workspaces/:slug/system-map/nodes
 *      — the workspace graph's `systemmap` namespace (nodes + the edges
 *      between them), read live from its swarm through boltwall (`:8444`).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listSystemMapDomainNodes } from "@/lib/system-map/domain-nodes";
import type { SystemMapDomainNodesResponse } from "@/types/system-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorBody(error: string): SystemMapDomainNodesResponse {
  return { status: "error", types: [], nodes: [], edges: [], truncated: false, edgeReadFailures: 0, error };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) return NextResponse.json(errorBody("Workspace swarm is not configured"));

    const listed = await listSystemMapDomainNodes(jarvisConfig);
    if (!listed.ok) return NextResponse.json(errorBody(listed.error));

    const body: SystemMapDomainNodesResponse = {
      status: "ready",
      types: listed.types,
      nodes: listed.nodes,
      edges: listed.edges,
      truncated: listed.truncated,
      edgeReadFailures: listed.edgeReadFailures,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] nodes GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

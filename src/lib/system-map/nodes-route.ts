/**
 * Handler behind `GET /api/workspaces/:slug/system-map/nodes` (namespace
 * `systemmap`). The server picks the namespace; it is never read from the
 * request. `?types=A,B` narrows the read to those node types (jarvis'
 * allowlist), so the tab can leave packages out until asked for them.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listSystemMapDomainNodes } from "@/lib/system-map/domain-nodes";
import { parseNodeTypesParam } from "@/lib/system-map/node-types";
import type { SystemMapDomainNodesResponse } from "@/types/system-map";

function errorBody(error: string): SystemMapDomainNodesResponse {
  return { status: "error", types: [], nodes: [], edges: [], truncated: false, edgeReadFailures: 0, error };
}

export async function handleSystemMapNodesRoute(
  request: NextRequest,
  slug: string,
  namespace: string,
): Promise<NextResponse> {
  try {
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const types = parseNodeTypesParam(request.nextUrl.searchParams.get("types"));
    if (types === null) {
      return NextResponse.json({ error: "types must be a comma-separated list of node type names" }, { status: 400 });
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) return NextResponse.json(errorBody("Workspace swarm is not configured"));

    const listed = await listSystemMapDomainNodes(jarvisConfig, namespace, { types });
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
    console.error(`[SystemMap] ${namespace} nodes GET error:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

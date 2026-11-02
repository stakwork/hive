/**
 * Handler behind `GET /api/workspaces/:slug/system-map/nodes` (namespace
 * `systemmap`). The server picks the namespace; it is never read from the
 * request. `?types=A,B` narrows the read to those node types (jarvis'
 * allowlist), so the tab can leave packages out until asked for them.
 *
 * Read through Cypher on stakgraph (two paged queries); when that cannot
 * answer — or with mocks on — through jarvis' node listing, the slower way.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { readSystemMapNodes } from "@/lib/system-map/read-nodes";
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

    // Under mocks the flag is not required: the org canvas's System view reads this too, and the mock pod has it off.
    if (process.env.USE_MOCKS !== "true" && !canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const types = parseNodeTypesParam(request.nextUrl.searchParams.get("types"));
    if (types === null) {
      return NextResponse.json({ error: "types must be a comma-separated list of node type names" }, { status: 400 });
    }

    const listed = await readSystemMapNodes({
      slug: member.slug,
      userId: member.userId,
      workspaceId: member.workspaceId,
      namespace,
      types: types ?? undefined,
    });
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

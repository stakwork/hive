/**
 * Shared handler behind both `GET /api/workspaces/:slug/system-map/nodes`
 * (namespace `systemmap`) and `GET /api/workspaces/:slug/system-map/infosec-nodes`
 * (namespace `infosec`, the workflow inspector's SystemMap tab). One
 * implementation so the access-check order and the Jarvis read can't drift
 * between the two routes.
 *
 * Access order (IDOR-safe): `resolveWorkspaceAccess` → `requireProtectMemberAccess`
 * → feature flag → `getJarvisConfigForWorkspace(member.workspaceId)` → the
 * Jarvis read. Credentials are always derived from the authenticated
 * `member.workspaceId`, never from the raw `slug`.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { checkRateLimit } from "@/lib/rate-limit";
import { listSystemMapDomainNodes } from "@/lib/system-map/domain-nodes";
import type { SystemMapDomainNodesResponse } from "@/types/system-map";

const ROUTE_RATE_LIMIT = 30;
const ROUTE_WINDOW_SECS = 60;

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

    const rate = await checkRateLimit(
      `system-map:nodes:${namespace}:${member.workspaceId}:${member.userId}`,
      ROUTE_RATE_LIMIT,
      ROUTE_WINDOW_SECS,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) return NextResponse.json(errorBody("Workspace swarm is not configured"));

    const listed = await listSystemMapDomainNodes(jarvisConfig, namespace);
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

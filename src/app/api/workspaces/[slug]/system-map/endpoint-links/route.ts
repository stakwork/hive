/**
 * GET /api/workspaces/:slug/system-map/endpoint-links
 *      — every link between a System Map node and an Endpoint (CALLS,
 *      EXPOSES, …), for the Domain nodes graph's endpoint bundles. One
 *      read-only Cypher query through stakgraph.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { listSystemMapEndpointLinks } from "@/lib/system-map/endpoint-links";
import type { SystemMapEndpointLinksResponse } from "@/types/system-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const listed = await listSystemMapEndpointLinks({ slug: member.slug, userId: member.userId });
    const body: SystemMapEndpointLinksResponse = listed.ok
      ? { status: "ready", links: listed.links, endpoints: listed.endpoints, truncated: listed.truncated }
      : { status: "error", links: [], endpoints: [], truncated: false, error: listed.error };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] endpoint-links GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

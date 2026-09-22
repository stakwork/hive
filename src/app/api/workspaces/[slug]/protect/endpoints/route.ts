import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listProtectEndpoints } from "@/lib/protect/endpoints";
import type { ProtectEndpointsResponse } from "@/types/protect";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) {
      const body: ProtectEndpointsResponse = {
        status: "error",
        endpoints: [],
        systems: [],
        callersUnavailable: false,
        error: "Workspace swarm is not configured",
      };
      return NextResponse.json(body);
    }

    const listed = await listProtectEndpoints(jarvisConfig);
    if (!listed.ok) {
      const body: ProtectEndpointsResponse = {
        status: "error",
        endpoints: [],
        systems: [],
        callersUnavailable: false,
        error: listed.error,
      };
      return NextResponse.json(body);
    }

    const body: ProtectEndpointsResponse = {
      status: "ready",
      endpoints: listed.endpoints,
      systems: listed.systems,
      callersUnavailable: listed.callersUnavailable,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[Protect] endpoints GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getSwarmConfig, decideProposal } from "@/app/api/learnings/utils";
import {
  resolveWorkspaceAccess,
  requireMemberAccess,
} from "@/lib/auth/workspace-access";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/learnings/concepts/proposals/[id]/reject
 *
 * Rejects a concept proposal. Requires DEVELOPER role or above.
 * `decidedBy` is always set server-side from the authenticated user's id —
 * any `decidedBy` value in the request body is ignored to prevent spoofing.
 *
 * Body (optional):
 *   reason: string — optional rejection reason
 *
 * Swarm responses are forwarded verbatim (status + body), including:
 *   200 { status: "success", proposal }
 *   409 { error, status }   — proposal already decided
 *   404 { error }           — proposal not found
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json(
        { error: "Missing required parameter: workspace" },
        { status: 400 },
      );
    }

    const access = await resolveWorkspaceAccess(request, { slug: workspaceSlug });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    if (!hasRoleLevel(ok.role, WorkspaceRole.DEVELOPER)) {
      return NextResponse.json(
        { error: "Forbidden: DEVELOPER role or above required" },
        { status: 403 },
      );
    }

    const { id } = await params;

    // Read only `reason` from the body; ignore any `decidedBy` supplied by the caller.
    let reason: string | undefined;
    try {
      const body = await request.json();
      if (typeof body?.reason === "string") reason = body.reason;
    } catch {
      // body is optional — ignore parse errors
    }

    let base: string;
    let apiKey: string;

    if (config.USE_MOCKS) {
      base = `${config.MOCK_BASE}/api/mock/stakgraph`;
      apiKey = "mock";
    } else {
      const swarmConfig = await getSwarmConfig(ok.workspaceId);
      if ("error" in swarmConfig) {
        return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
      }
      base = swarmConfig.baseSwarmUrl;
      apiKey = swarmConfig.decryptedSwarmApiKey;
    }

    const result = await decideProposal({
      id,
      action: "reject",
      base,
      apiKey,
      decidedBy: ok.userId,
      extraBody: reason !== undefined ? { reason } : undefined,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Proposal reject proxy error:", error);
    return NextResponse.json({ error: "Failed to reject proposal" }, { status: 500 });
  }
}

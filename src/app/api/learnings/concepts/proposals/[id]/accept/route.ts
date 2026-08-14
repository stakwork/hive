import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import {
  resolveWorkspaceAccess,
  requireMemberAccess,
} from "@/lib/auth/workspace-access";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/learnings/concepts/proposals/[id]/accept
 *
 * Accepts a concept proposal. Requires DEVELOPER role or above.
 * `decidedBy` is always set server-side from the authenticated user's id —
 * any `decidedBy` value in the request body is ignored to prevent spoofing.
 *
 * Body (optional):
 *   force: boolean — bypass stale_base drift check
 *
 * Swarm responses are forwarded verbatim (status + body), including:
 *   200 { status: "success", proposal }
 *   409 { error, code: "stale_base", conceptId } — concept drifted; force not set
 *   409 { error, status }                        — proposal already decided
 *   404 { error }                                — proposal not found
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

    // Read only `force` from the body; ignore any `decidedBy` supplied by the caller.
    let force: boolean | undefined;
    try {
      const body = await request.json();
      if (typeof body?.force === "boolean") force = body.force;
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

    const upstream = `${base}/gitree/proposals/${encodeURIComponent(id)}/accept`;

    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
      body: JSON.stringify({
        decidedBy: ok.userId,
        ...(force !== undefined && { force }),
      }),
    });

    // Guard the parse: a non-JSON upstream body (proxy 502 HTML, empty 204)
    // must not collapse the real status into a generic 500 — especially here,
    // where the accept may already have been applied upstream.
    const body = await response
      .json()
      .catch(() => ({ error: `Upstream returned a non-JSON response (status ${response.status})` }));
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error("Proposal accept proxy error:", error);
    return NextResponse.json({ error: "Failed to accept proposal" }, { status: 500 });
  }
}

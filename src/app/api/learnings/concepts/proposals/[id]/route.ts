import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/learnings/concepts/proposals/[id]
 *
 * Fetches a single concept proposal by id.
 * Proxies to stakgraph's GET /gitree/proposals/:id, returning body verbatim
 * (including 404 { error } when not found).
 *
 * Member-only, consistent with the list route: proposals are un-reviewed
 * internal content and are not exposed to public viewers.
 */
export async function GET(
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

    const { id } = await params;

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

    const upstream = `${base}/gitree/proposals/${encodeURIComponent(id)}`;

    const response = await fetch(upstream, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
    });

    // Guard the parse: a non-JSON upstream body (proxy 502 HTML, empty 204)
    // must not collapse the real status into a generic 500.
    const body = await response
      .json()
      .catch(() => ({ error: `Upstream returned a non-JSON response (status ${response.status})` }));
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error("Proposal detail proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}

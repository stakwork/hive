import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/learnings/concepts/proposals/[id]
 *
 * Fetches a single concept proposal by id.
 * Proxies to stakgraph's GET /gitree/proposals/:id, returning body verbatim
 * (including 404 { error } when not found).
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
    const ok = requireReadAccess(access);
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

    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error("Proposal detail proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}

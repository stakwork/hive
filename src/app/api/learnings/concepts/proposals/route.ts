import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/learnings/concepts/proposals
 *
 * Lists pending (or filtered) concept proposals for a workspace.
 * Proxies to stakgraph's GET /gitree/proposals, returning the body verbatim.
 *
 * Query params:
 *   workspace (required) — workspace slug
 *   repo      (optional) — filter by repo
 *   status    (optional) — filter by status (pending | accepted | rejected)
 */
export async function GET(request: NextRequest) {
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

    const upstream = new URL(`${base}/gitree/proposals`);

    const repo = searchParams.get("repo");
    const status = searchParams.get("status");
    if (repo) upstream.searchParams.set("repo", repo);
    if (status) upstream.searchParams.set("status", status);

    const response = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
    });

    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error("Proposals list proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 });
  }
}

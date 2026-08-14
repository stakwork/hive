import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/learnings/concepts/proposals
 *
 * Lists pending (or filtered) concept proposals for a workspace.
 * Proxies to stakgraph's GET /gitree/proposals, returning the body verbatim.
 *
 * Member-only: proposals are un-reviewed internal content (draft docs,
 * rationales, PR references), so unlike published concepts they are NOT
 * readable by public viewers — even though the middleware wildcard marks
 * /api/learnings/concepts/* GET as public, requireMemberAccess here rejects
 * anonymous and public-viewer callers.
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
    const ok = requireMemberAccess(access);
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

    // Guard the parse: a non-JSON upstream body (proxy 502 HTML, empty 204)
    // must not collapse the real status into a generic 500.
    const body = await response
      .json()
      .catch(() => ({ error: `Upstream returned a non-JSON response (status ${response.status})` }));
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error("Proposals list proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 });
  }
}

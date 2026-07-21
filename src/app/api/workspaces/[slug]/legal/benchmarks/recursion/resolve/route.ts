import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { resolveEvalSetRefIdBySlug } from "@/services/legal-benchmark-recursion";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/recursion/resolve?taskSlug=...
 *
 * Resolves the EvalSet ref_id for a task slug. Used by `useEvalRunHistory` as
 * a server-side slug-to-ref_id resolver when the client does not already have
 * the ref_id (rare fallback path — `RecursionEntry.refId` is always populated
 * in production, but this ensures correctness when it isn't).
 *
 * Authorization mirrors sibling recursion routes:
 *   requireAuth + openlaw workspace gate + getWorkspaceSwarmAccess (IDOR).
 *
 * Gated to the `openlaw` workspace only.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Openlaw-only gate
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const taskSlug = searchParams.get("taskSlug");
    if (!taskSlug) {
      return NextResponse.json({ error: "taskSlug query param is required" }, { status: 400 });
    }

    // IDOR guard — validate caller has swarm access for this workspace
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      const errorMap: Record<string, { message: string; status: number }> = {
        WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
        ACCESS_DENIED: { message: "Access denied", status: 403 },
        SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
        SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
        SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
        SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
      };
      const info = errorMap[swarmResult.error.type] ?? { message: "Unknown error", status: 500 };
      return NextResponse.json({ error: info.message }, { status: info.status });
    }

    const { swarmName, swarmApiKey } = swarmResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    const refId = await resolveEvalSetRefIdBySlug(
      { jarvisUrl, apiKey: swarmApiKey },
      taskSlug,
    );

    if (!refId) {
      return NextResponse.json({ refId: null }, { status: 200 });
    }

    return NextResponse.json({ refId });
  } catch (err) {
    console.error("[legal/benchmarks/recursion/resolve] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

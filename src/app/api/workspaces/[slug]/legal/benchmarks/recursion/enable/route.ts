import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { enableRecursionForTaskSlug } from "@/services/legal-benchmark-recursion";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * POST /api/workspaces/[slug]/legal/benchmarks/recursion/enable
 *
 * Resolves the EvalSet ref_id for the given task-slug server-side (never
 * trusting a client-supplied ref_id), then sets `recursion=true` on that node.
 *
 * Body: `{ taskSlug: string }`
 *
 * Returns:
 *  - 200 `{ success: true }` on success (idempotent)
 *  - 404 if no EvalSet matches the task-slug
 *  - 502 on graph write failure
 *
 * Gated to the `openlaw` workspace only.
 * Rate-limited: 20 requests / 60 seconds per IP.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Step 1: Auth
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Step 2: Openlaw-only guard (before any side effects)
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Step 3: Parse + validate body
    const body = await request.json().catch(() => ({})) as { taskSlug?: unknown };
    if (typeof body.taskSlug !== "string" || !body.taskSlug.trim()) {
      return NextResponse.json({ error: "taskSlug must be a non-empty string" }, { status: 400 });
    }
    const { taskSlug } = body as { taskSlug: string };

    // Step 4: Rate limit
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`recursion:enable:${ip}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // Step 5: Resolve workspace swarm access
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    // Step 6: Resolve Jarvis config for graph operations
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
    }

    // Step 7: Resolve EvalSet ref_id from task-slug + toggle (server-side, single round trip)
    const result = await enableRecursionForTaskSlug(jarvisConfig, taskSlug);

    if (!result.ok) {
      if ("notFound" in result && result.notFound) {
        return NextResponse.json({ error: "EvalSet not found for task slug" }, { status: 404 });
      }
      return NextResponse.json(
        { error: result.error ?? "Failed to enable recursion" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[legal/benchmarks/recursion/enable] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

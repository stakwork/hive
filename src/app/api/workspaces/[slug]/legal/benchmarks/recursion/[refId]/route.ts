import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { kgGetNode } from "@/lib/ai/kg-adapter";
import { setEvalSetRecursion } from "@/services/legal-benchmark-recursion";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string; refId: string }> };

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
 * PATCH /api/workspaces/[slug]/legal/benchmarks/recursion/[refId]
 *
 * Toggle the `recursion` attribute on an EvalSet graph node.
 * Body: `{ enabled: boolean }`
 *
 * Gated to the `openlaw` workspace only.
 * IDOR-guarded: resolves the node before writing to confirm it is an EvalSet.
 * Rate-limited: 20 requests / 60 seconds per IP.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Step 1: Auth
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug, refId } = await params;

    // Step 2: Openlaw-only guard
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Step 3: Parse + validate body
    const body = await request.json().catch(() => ({})) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    const { enabled } = body as { enabled: boolean };

    // Step 4: Rate limit
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`recursion:patch:${ip}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // Step 5: Resolve workspace swarm access (for jarvisUrl + kgGetNode IDOR guard)
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId, swarmName, swarmApiKey } = swarmResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    // Step 6: IDOR guard — resolve node before writing
    const node = await kgGetNode(jarvisUrl, swarmApiKey, refId);
    if (!node || node.node_type !== "EvalSet") {
      return NextResponse.json({ error: "EvalSet not found" }, { status: 404 });
    }

    // Step 7: Derive namespace from the fetched node's `properties.id` (the task slug).
    // EvalSets are created under namespace = task_slug by Stakwork workflow 57389.
    // Jarvis strips `namespace` from node-get responses, so we rely on `properties.id`
    // being the slug. If absent, we cannot safely derive the namespace and must error
    // rather than fall back to `refId` (which would silently fail with INVALID_NAMESPACE).
    const namespace = (node as { properties?: Record<string, unknown> }).properties?.id;
    if (!namespace || typeof namespace !== "string") {
      return NextResponse.json(
        { error: "Cannot resolve namespace for EvalSet" },
        { status: 502 },
      );
    }

    // Step 8: Resolve Jarvis config for updateNode (workspaceId from authorized swarm access)
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
    }

    // Step 9: Toggle the recursion attribute, targeting the node's actual namespace
    const result = await setEvalSetRecursion(jarvisConfig, refId, enabled, namespace);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Failed to update EvalSet recursion" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    console.error("[legal/benchmarks/recursion/[refId]] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

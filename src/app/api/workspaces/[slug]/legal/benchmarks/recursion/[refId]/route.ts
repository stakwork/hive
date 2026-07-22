import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { kgGetNode } from "@/lib/ai/kg-adapter";
import { setEvalSetRecursion, isEvalSetLabel } from "@/services/legal-benchmark-recursion";
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

    // Step 6: IDOR guard — resolve node before writing.
    // Uses isEvalSetLabel (case-insensitive) to match both "EvalSet" and "Evalset"
    // — a bridge for the jarvis label-casing defect (see EVALSET_NODE_LABELS comment
    // in legal-benchmark-recursion.ts). Guard remains fail-closed and runs before any write.
    const node = await kgGetNode(jarvisUrl, swarmApiKey, refId);
    if (!node || !isEvalSetLabel(node.node_type)) {
      return NextResponse.json({ error: "EvalSet not found" }, { status: 404 });
    }

    // Step 7: Resolve Jarvis config for updateNode (workspaceId from authorized swarm access)
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
    }

    // Step 8: Toggle the recursion attribute
    const result = await setEvalSetRecursion(jarvisConfig, refId, enabled);

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

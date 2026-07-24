import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { kgGetNode } from "@/lib/ai/kg-adapter";
import { isEvalSetLabel } from "@/services/legal-benchmark-recursion";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { walkFixChain } from "@/lib/harvey-lab/fix-chain-walker";
import { logger } from "@/lib/logger";

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
 * GET /api/workspaces/[slug]/legal/benchmarks/fix-chain?evalSetRefId=...
 *
 * Returns the full fix-chain subgraph for the given EvalSet by walking
 * Jarvis's per-hop `/v2/nodes/{ref_id}?expand=edges` endpoint — no label
 * whitelist, so casing drift can never corrupt the result.
 *
 * Auth sequence (enforced in this exact order):
 *   1. requireAuth — 401 if unauthenticated
 *   2. openlaw-only workspace gate — 404 for other slugs
 *   3. getWorkspaceSwarmAccess — validates workspace membership + swarm active
 *   4. IDOR guard — resolves evalSetRefId and verifies it is an EvalSet node
 *      belonging to THIS workspace's swarm (not just workspace membership)
 *   5. Rate limit — 20 requests / 60 seconds per IP
 *   6. walkFixChain — fans out up to ~100 Jarvis calls, hence rate-limit above
 *
 * Gated to the `openlaw` workspace only.
 * Mirrors the auth pattern from the `recursion/[refId]` PATCH route.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Step 1: Auth — must be first; userId not safe to derive until authed
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Step 2: openlaw-only gate
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Step 3: Parse + validate query params
    const { searchParams } = new URL(request.url);
    const evalSetRefId = searchParams.get("evalSetRefId");
    if (!evalSetRefId || evalSetRefId.trim().length === 0) {
      return NextResponse.json(
        { error: "evalSetRefId query param is required" },
        { status: 400 },
      );
    }

    // Step 4: Workspace swarm access (validates workspace membership + swarm)
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { swarmName, swarmApiKey } = swarmResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    // Step 5: IDOR guard — resolve node and verify it is an EvalSet.
    // getWorkspaceSwarmAccess only proves workspace membership, not that the
    // caller-supplied ref_id belongs to this workspace's graph partition.
    // Uses isEvalSetLabel (case-insensitive) to handle "EvalSet"/"Evalset" casing.
    const node = await kgGetNode(jarvisUrl, swarmApiKey, evalSetRefId);
    if (!node || !isEvalSetLabel(node.node_type)) {
      return NextResponse.json({ error: "EvalSet not found" }, { status: 404 });
    }

    // Step 6: Rate limit — placed after IDOR guard but before walkFixChain since
    // each request can fan out ~100 Jarvis calls, amplifying downstream load.
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`fix-chain:get:${ip}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // Step 7: USE_MOCKS guard — return fixture response in dev/test mode
    if (process.env.USE_MOCKS === "true") {
      logger.info(
        "[legal/benchmarks/fix-chain] USE_MOCKS=true, returning mock fixture",
        "legal",
        { evalSetRefId },
      );
      const { buildRecursionNodes, buildRecursionEdges } = await import(
        "@/app/api/mock/jarvis/graph/recursion-fixture"
      );
      return NextResponse.json({
        success: true,
        data: {
          nodes: buildRecursionNodes(),
          edges: buildRecursionEdges(),
          partial: false,
        },
      });
    }

    // Step 8: Walk the fix chain
    logger.info(
      "[legal/benchmarks/fix-chain] Walking fix chain",
      "legal",
      { evalSetRefId, slug },
    );

    const result = await walkFixChain(jarvisUrl, swarmApiKey, evalSetRefId, {
      triggerEdgeTypes: ["HAS_BASELINE_TRIGGER"],
    });

    if (result.partial) {
      logger.warn(
        "[legal/benchmarks/fix-chain] walkFixChain returned partial result",
        "legal",
        { evalSetRefId, failedBranches: result.failedBranches },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        nodes: result.nodes,
        edges: result.edges,
        partial: result.partial,
        ...(result.failedBranches?.length ? { failedBranches: result.failedBranches } : {}),
      },
    });
  } catch (error) {
    logger.error(
      "[legal/benchmarks/fix-chain] GET error",
      "legal",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

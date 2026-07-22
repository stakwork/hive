import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { kgGetNode } from "@/lib/ai/kg-adapter";
import { updateNode } from "@/services/swarm/api/nodes";
import { publishVersion } from "@/services/prompts/prompt-sync";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = {
  params: Promise<{ slug: string; refId: string }>;
};

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
 * PATCH /api/workspaces/[slug]/legal/benchmarks/proposed-fixes/[refId]
 *
 * Accept or reject a ProposedFix graph node.
 * - accept: publishes the new prompt version, then marks the fix accepted.
 * - reject: marks the fix rejected (no publish).
 *
 * Gated to the `openlaw` workspace only.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Step 1: Auth
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug, refId } = await params;

    // Step 2: Openlaw-only guard (explicit, before any other side effect)
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Step 3: Parse + validate body before any DB/Jarvis calls
    const body = await request.json().catch(() => ({})) as { action?: unknown };
    const { action } = body;
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json(
        { error: 'action must be "accept" or "reject"' },
        { status: 400 },
      );
    }

    // Step 4: Rate limit (defense-in-depth against replay/double-submit)
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`proposed-fixes:patch:${ip}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // Step 5: USE_MOCKS short-circuit (after slug + action guards)
    if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
      logger.info("[proposed-fixes/patch] USE_MOCKS: short-circuiting", "proposed-fixes", {
        refId,
        userId,
        action,
      });
      return NextResponse.json({
        success: true,
        status: action === "accept" ? "accepted" : "rejected",
      });
    }

    // Step 6: Resolve workspace swarm access (jarvisUrl + swarmApiKey for kgGetNode)
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId, swarmName, swarmApiKey } = swarmResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    // Step 7: Resolve Jarvis config for updateNode
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
    }

    // Step 8: Fetch the fix node server-side (cross-workspace boundary via swarm-scoped key)
    const node = await kgGetNode(jarvisUrl, swarmApiKey, refId);
    const properties = node?.properties as Record<string, unknown> | undefined;

    if (!node || !properties) {
      return NextResponse.json({ error: "Fix not found" }, { status: 404 });
    }
    if (node.node_type !== "ProposedFix") {
      return NextResponse.json({ error: "Fix not found" }, { status: 404 });
    }

    // Step 9: Best-effort idempotency precheck
    const currentStatus = properties["status"];
    if (currentStatus === "accepted" || currentStatus === "rejected") {
      logger.info("[proposed-fixes/patch] Idempotent no-op — already resolved", "proposed-fixes", {
        refId,
        userId,
        action,
        currentStatus,
      });
      return NextResponse.json({ success: true, status: currentStatus, noOp: true });
    }

    const now = new Date().toISOString();

    if (action === "accept") {
      // Validate we have a version id and at least one prompt identifier to publish
      const promptId = properties["prompt_id"] ? String(properties["prompt_id"]) : null;
      const promptName = properties["prompt_name"] ? String(properties["prompt_name"]) : null;
      const newVersionId = properties["new_prompt_version_id"]
        ? String(properties["new_prompt_version_id"])
        : null;

      if (!newVersionId || (!promptId && !promptName)) {
        logger.warn(
          "[proposed-fixes/patch] Accept failed: missing prompt identifier (prompt_id or prompt_name) or new_prompt_version_id",
          "proposed-fixes",
          { refId, userId },
        );
        return NextResponse.json(
          { error: "Cannot accept: fix has no new_prompt_version_id to publish" },
          { status: 400 },
        );
      }

      // Prefer prompt_name (stable/durable on the ProposedFix node); fall back to prompt_id.
      // Exactly one publishVersion call — never retry or double-call.
      const promptIdentifier = promptName ?? promptId!;
      logger.info("[proposed-fixes/patch] Resolving prompt by identifier", "proposed-fixes", {
        refId,
        userId,
        identifierType: promptName ? "prompt_name" : "prompt_id",
        identifier: promptIdentifier,
      });

      // Publish first — only mark accepted if publish succeeds
      try {
        // Pass undefined for workspaceId: prompts are global (no owning workspace),
        // so we avoid mis-attributing the publish graph recorder to the openlaw graph.
        await publishVersion(promptIdentifier, newVersionId, undefined);
      } catch (err: unknown) {
        const e = err as { status?: number; message?: string };
        logger.error("[proposed-fixes/patch] publishVersion failed", "proposed-fixes", {
          refId,
          userId,
          action,
          error: e.message,
        });
        if (e.status === 404) {
          return NextResponse.json({ error: e.message ?? "Version not found" }, { status: 404 });
        }
        return NextResponse.json(
          { error: e.message ?? "Failed to publish prompt version" },
          { status: 500 },
        );
      }

      // Publish succeeded — now mark as accepted (dual-write eval_status + legacy status)
      const updateResult = await updateNode(jarvisConfig, {
        ref_id: refId,
        node_type: "ProposedFix",
        node_data: { eval_status: "accepted", status: "accepted", resolved_by: userId, resolved_at: now },
      });

      if (!updateResult.success) {
        logger.error(
          "[proposed-fixes/patch] updateNode failed after publish",
          "proposed-fixes",
          { refId, userId, action, error: updateResult.error },
        );
        // Publish already went through; log but don't fail the response
        // (the fix will appear accepted on next fetch when Jarvis reflects the write)
      }

      logger.info("[proposed-fixes/patch] Accepted", "proposed-fixes", {
        refId,
        userId,
        action,
        outcome: "success",
      });
      return NextResponse.json({ success: true, status: "accepted" });
    }

    // action === "reject" (dual-write eval_status + legacy status)
    const updateResult = await updateNode(jarvisConfig, {
      ref_id: refId,
      node_type: "ProposedFix",
      node_data: { eval_status: "rejected", status: "rejected", resolved_by: userId, resolved_at: now },
    });

    if (!updateResult.success) {
      logger.error("[proposed-fixes/patch] updateNode reject failed", "proposed-fixes", {
        refId,
        userId,
        action,
        error: updateResult.error,
      });
      return NextResponse.json({ error: "Failed to reject fix" }, { status: 500 });
    }

    logger.info("[proposed-fixes/patch] Rejected", "proposed-fixes", {
      refId,
      userId,
      action,
      outcome: "success",
    });
    return NextResponse.json({ success: true, status: "rejected" });
  } catch (error) {
    console.error("[proposed-fixes/patch] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

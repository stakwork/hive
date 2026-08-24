import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { kgGetNode } from "@/lib/ai/kg-adapter";
import { updateNode } from "@/services/swarm/api/nodes";
import { publishVersion } from "@/services/prompts/prompt-sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";

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
 *
 * Prompt fixes:
 *   - accept: publishes the new prompt version, then marks the fix accepted.
 *   - reject: marks the fix rejected (no publish).
 *
 * Concept fixes (target_type === "concept" AND no new_prompt_version_id):
 *   - accept: records the review decision ONLY — does NOT write new_value back to
 *     the target Concept node. That write is owned by the upstream Stakwork workflow,
 *     which auto-accepts concept fixes before Hive sees them. Callers must not infer
 *     that the concept edit was applied by this endpoint (the response carries
 *     `applied: false` explicitly).
 *   - reject: also a review annotation only — does NOT unwind the workflow's already-
 *     applied graph write. The UI must not imply otherwise.
 *
 * Transition rules:
 *   - Same-action on an already-resolved fix → no-op (idempotent).
 *   - accepted → rejected is allowed ONLY for concept fixes (human re-review of an
 *     auto-accepted node). For prompt fixes, `publishVersion` already ran with no
 *     unpublish path, so this transition is refused.
 *   - `rejected` is terminal for both kinds.
 *
 * Security: rate-limited per authenticated user (not per IP, which is spoofable).
 * IDOR guard requires the fix's task_slug to map to a benchmark run owned by the
 * caller's workspace before any graph write is attempted.
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

    // Step 4: Rate limit keyed on authenticated userId — not on IP.
    // getClientIp() reads the client-controlled x-forwarded-for header, so keying
    // on IP would allow a caller to bypass the limit by rotating that header.
    // userId is resolved at Step 1 and is not spoofable.
    const rl = await checkRateLimit(`proposed-fixes:patch:${userId}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // Step 6: Resolve workspace swarm access (jarvisUrl + swarmApiKey for kgGetNode)
    // NOTE: USE_MOCKS short-circuit is intentionally placed AFTER this step and the
    // IDOR guard below (Step 8b) so that mock mode traverses the same auth sequence
    // as production. A short-circuit before swarm access would let a non-member get
    // a success response in mock mode.
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

    // Step 8b: IDOR guard — the fix's task_slug must map to a benchmark run owned by
    // this workspace. kgGetNode fetches any ref_id in the swarm partition with no
    // ownership filter; this check prevents an authenticated openlaw member from
    // writing eval_status/resolved_by onto a ProposedFix that belongs to a different
    // workspace's benchmark run.
    //
    // Fail-closed: a node with no task_slug cannot be scoped to any workspace run, so
    // it is refused rather than allowed through. Skipping the check for slug-less nodes
    // would let any authenticated openlaw member write onto arbitrary ProposedFix nodes.
    const taskSlug = properties["task_slug"] ? String(properties["task_slug"]) : null;
    if (!taskSlug) {
      logger.warn(
        "[proposed-fixes/patch] IDOR guard: ProposedFix node has no task_slug — refusing write",
        "proposed-fixes",
        { refId, userId, workspaceId },
      );
      return NextResponse.json({ error: "Fix not found" }, { status: 404 });
    }

    // Look for a benchmark run in this workspace whose result JSON encodes this taskSlug.
    // We search all runner/scorer types since either can carry the slug.
    const scopedRun = await db.stakworkRun.findFirst({
      where: {
        workspaceId,
        type: {
          in: [
            StakworkRunType.LEGAL_BENCHMARK_RUNNER,
            StakworkRunType.LEGAL_BENCHMARK_SCORER,
          ],
        },
        result: {
          string_contains: taskSlug,
        },
      },
      select: { id: true },
    });
    if (!scopedRun) {
      logger.warn(
        "[proposed-fixes/patch] IDOR guard: task_slug not found in any workspace run",
        "proposed-fixes",
        { refId, userId, workspaceId, taskSlug },
      );
      return NextResponse.json({ error: "Fix not found" }, { status: 404 });
    }

    // Step 8c: USE_MOCKS short-circuit — placed AFTER auth + IDOR checks so that mock
    // mode exercises the same authorization path as production.
    if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
      logger.info("[proposed-fixes/patch] USE_MOCKS: short-circuiting after auth checks", "proposed-fixes", {
        refId,
        userId,
        action,
      });
      // Return a concept-aware payload so mock-mode callers can exercise the concept branch.
      return NextResponse.json({
        success: true,
        status: action === "accept" ? "accepted" : "rejected",
        applied: false,
        kind: "concept",
      });
    }

    // Step 9: Idempotency precheck — read canonical eval_status first, fall back to
    // legacy status. Concept fixes may arrive already eval_status="accepted" (auto-
    // accepted by the upstream workflow), so blocking on ANY resolved status would make
    // every concept fix a permanent no-op.
    const rawEvalStatus = properties["eval_status"];
    const rawStatus = properties["status"];
    const currentStatus = (rawEvalStatus ?? rawStatus) as string | null | undefined;

    // Resolve fix kind for transition-rule enforcement below.
    const rawKind = String(properties["target_type"] ?? properties["fix_type"] ?? "").trim().toLowerCase();
    const isConceptFix = rawKind === "concept";

    // Same-action no-op (idempotent for both kinds).
    if (currentStatus === "accepted" && action === "accept") {
      logger.info("[proposed-fixes/patch] Idempotent no-op — already accepted", "proposed-fixes", {
        refId, userId, action, currentStatus,
      });
      return NextResponse.json({ success: true, status: currentStatus, noOp: true });
    }
    if (currentStatus === "rejected" && action === "reject") {
      logger.info("[proposed-fixes/patch] Idempotent no-op — already rejected", "proposed-fixes", {
        refId, userId, action, currentStatus,
      });
      return NextResponse.json({ success: true, status: currentStatus, noOp: true });
    }

    // Terminal state: rejected is final for both kinds.
    if (currentStatus === "rejected" && action === "accept") {
      logger.warn("[proposed-fixes/patch] Attempt to accept a rejected fix — terminal state", "proposed-fixes", {
        refId, userId, action,
      });
      return NextResponse.json(
        { error: "Cannot accept: fix is already rejected" },
        { status: 409 },
      );
    }

    // Transition rule: accepted → rejected is only allowed for concept fixes.
    // For prompt fixes, publishVersion already ran with no unpublish path; flipping
    // to rejected would leave a published prompt version behind a "rejected" node.
    if (currentStatus === "accepted" && action === "reject") {
      if (!isConceptFix) {
        logger.warn(
          "[proposed-fixes/patch] Attempt to reject an accepted prompt fix — not permitted",
          "proposed-fixes",
          { refId, userId, action, currentStatus },
        );
        return NextResponse.json(
          { error: "Cannot reject: prompt fix is already accepted" },
          { status: 409 },
        );
      }
      // Concept fix: accepted → rejected is allowed (human re-review of auto-accepted node).
      logger.info(
        "[proposed-fixes/patch] Concept fix: accepted → rejected transition (human re-review)",
        "proposed-fixes",
        { refId, userId, action },
      );
    }

    const now = new Date().toISOString();

    // Build the resolved_by_history array — append rather than overwrite so a second
    // reviewer cannot silently reattribute a prior decision.
    const existingHistory = Array.isArray(properties["resolved_by_history"])
      ? (properties["resolved_by_history"] as unknown[])
      : properties["resolved_by"] != null
      ? [{ resolved_by: String(properties["resolved_by"]), resolved_at: properties["resolved_at"] ?? null, action: currentStatus }]
      : [];
    const resolved_by_history = [...existingHistory, { resolved_by: userId, resolved_at: now, action }];

    if (action === "accept") {
      // Resolve new_prompt_version_id to determine which path to take.
      const newVersionId = properties["new_prompt_version_id"]
        ? String(properties["new_prompt_version_id"])
        : null;

      // Concept path: take when kind === "concept" AND no new_prompt_version_id.
      // A node labelled "concept" that ALSO carries new_prompt_version_id falls through
      // to the prompt path — a mislabelled or malicious node cannot bypass publish.
      if (isConceptFix && !newVersionId) {
        // Positive validation: the fix must carry target_ref (or target_name) and new_value
        // so the review has something to annotate. The route does NOT write new_value back
        // to the target Concept node — that write is owned by the Stakwork workflow.
        const hasTargetId = !!(properties["target_ref"] || properties["target_name"]);
        const hasNewValue = !!properties["new_value"];
        if (!hasTargetId || !hasNewValue) {
          logger.warn(
            "[proposed-fixes/patch] Concept accept failed: missing target_ref/target_name or new_value",
            "proposed-fixes",
            { refId, userId, hasTargetId, hasNewValue },
          );
          return NextResponse.json(
            { error: "Cannot accept: concept fix is missing target_ref (or target_name) or new_value" },
            { status: 400 },
          );
        }

        logger.info(
          "[proposed-fixes/patch] Concept fix: skipping publishVersion (review annotation only; workflow already applied the value)",
          "proposed-fixes",
          { refId, userId, action, applied: false },
        );

        // TOCTOU guard: pass the status we read as a compare-and-set condition so two
        // concurrent PATCHes on the same pending fix cannot both succeed.
        // The CAS is expressed via the conditional node_data field checked_eval_status.
        // Jarvis will only commit the write when eval_status matches this value.
        const updateResult = await updateNode(jarvisConfig, {
          ref_id: refId,
          node_type: "ProposedFix",
          node_data: {
            eval_status: "accepted",
            status: "accepted",
            resolved_by: userId,
            resolved_at: now,
            resolved_by_history: JSON.stringify(resolved_by_history),
            // CAS sentinel: the write is conditional on the current eval_status matching
            // what we observed at read time.
            _cas_eval_status: currentStatus ?? null,
          },
        });

        if (!updateResult.success) {
          logger.error(
            "[proposed-fixes/patch] updateNode failed for concept accept",
            "proposed-fixes",
            { refId, userId, action, error: updateResult.error },
          );
          return NextResponse.json({ error: "Failed to accept fix" }, { status: 500 });
        }

        logger.info("[proposed-fixes/patch] Concept fix accepted", "proposed-fixes", {
          refId, userId, action, outcome: "success", applied: false,
        });
        return NextResponse.json({
          success: true,
          status: "accepted",
          applied: false,
          kind: "concept",
        });
      }

      // Prompt path (default): validate we have a version id and at least one prompt identifier.
      const promptId = properties["prompt_id"] ? String(properties["prompt_id"]) : null;
      const promptName = properties["prompt_name"] ? String(properties["prompt_name"]) : null;

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

      // Publish first — only mark accepted if publish succeeds.
      // NOTE: if a node is mislabelled as "concept" but also carries new_prompt_version_id,
      // it reaches this path, which turns the publish catch block into a potential probe
      // surface. The catch block therefore returns a fixed, non-reflective client string
      // and logs the real message server-side only.
      try {
        // Pass undefined for workspaceId: prompts are global (no owning workspace),
        // so we avoid mis-attributing the publish graph recorder to the openlaw graph.
        await publishVersion(promptIdentifier, newVersionId, undefined);
      } catch (err: unknown) {
        const e = err as { status?: number; message?: string };
        // Log the real error server-side only — never reflect internal messages to callers.
        logger.error("[proposed-fixes/patch] publishVersion failed", "proposed-fixes", {
          refId,
          userId,
          action,
          error: e.message,
        });
        if (e.status === 404) {
          return NextResponse.json({ error: "Prompt version not found" }, { status: 404 });
        }
        return NextResponse.json(
          { error: "Failed to publish prompt version" },
          { status: 500 },
        );
      }

      // Publish succeeded — now mark as accepted (dual-write eval_status + legacy status)
      const updateResult = await updateNode(jarvisConfig, {
        ref_id: refId,
        node_type: "ProposedFix",
        node_data: {
          eval_status: "accepted",
          status: "accepted",
          resolved_by: userId,
          resolved_at: now,
          resolved_by_history: JSON.stringify(resolved_by_history),
          _cas_eval_status: currentStatus ?? null,
        },
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

      logger.info("[proposed-fixes/patch] Prompt fix accepted", "proposed-fixes", {
        refId, userId, action, outcome: "success",
      });
      return NextResponse.json({ success: true, status: "accepted" });
    }

    // action === "reject" (dual-write eval_status + legacy status)
    const updateResult = await updateNode(jarvisConfig, {
      ref_id: refId,
      node_type: "ProposedFix",
      node_data: {
        eval_status: "rejected",
        status: "rejected",
        resolved_by: userId,
        resolved_at: now,
        resolved_by_history: JSON.stringify(resolved_by_history),
        _cas_eval_status: currentStatus ?? null,
      },
    });

    if (!updateResult.success) {
      logger.error("[proposed-fixes/patch] updateNode reject failed", "proposed-fixes", {
        refId, userId, action, error: updateResult.error,
      });
      return NextResponse.json({ error: "Failed to reject fix" }, { status: 500 });
    }

    logger.info("[proposed-fixes/patch] Fix rejected", "proposed-fixes", {
      refId, userId, action, outcome: "success",
    });
    return NextResponse.json({ success: true, status: "rejected" });
  } catch (error) {
    console.error("[proposed-fixes/patch] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

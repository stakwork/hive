import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { logger } from "@/lib/logger";
import { resolveHiveAgentName } from "@/lib/utils/hive-agent";
import { DEFAULT_AGENT_SPECS } from "@/services/bifrost/agent-catalog";

async function verifyRequirementOwnership(
  jarvisUrl: string,
  apiKey: string,
  requirementId: string
): Promise<boolean> {
  try {
    const res = await fetch(`${jarvisUrl}/node/${requirementId}`, {
      headers: { "x-api-token": apiKey },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const nodeType: string = data?.node_type ?? data?.type ?? "";
    return nodeType === "EvalRequirement";
  } catch {
    return false;
  }
}

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ slug: string; workflowId: string }> };

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

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Auth — middleware-based (same as flag-as-eval)
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, workflowId } = await params;

    // Swarm access check (also verifies workspace membership)
    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      logger.warn("[EvalCapture] Swarm access denied", swarmAccessResult.error.type);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    // Parse and validate body
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { step_id, requirement, requirementId, reason, inputs, outputs, evalSetId, prompts, agentName: agentNameRaw } = body as {
      run_id?: string;
      step_id?: string | number;
      requirement?: string;
      requirementId?: string;
      reason?: string;
      inputs?: Record<string, unknown> | null;
      outputs?: unknown;
      evalSetId?: string;
      prompts?: Array<{ name: string; prompt_id: number; prompt_version_id: number; resolution?: string }>;
      agentName?: string;
    };

    if (!requirement?.trim() && !requirementId?.trim()) {
      return NextResponse.json(
        { error: "requirement or requirementId is required" },
        { status: 400 }
      );
    }

    if (!evalSetId?.trim()) {
      return NextResponse.json({ error: "evalSetId is required" }, { status: 400 });
    }

    // Dev mode — delegate to mock
    if (process.env.NODE_ENV === "development") {
      const origin = request.nextUrl.origin;
      try {
        const mockRes = await fetch(
          `${origin}/api/mock/workspaces/${slug}/workflows/${workflowId}/eval/capture`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (mockRes.ok) {
          return NextResponse.json(await mockRes.json());
        }
      } catch {
        // fall through
      }
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const nodeConfig = { jarvisUrl, apiKey: swarmApiKey };

    // ── 1. Use provided EvalSet ──────────────────────────────────────────────
    const evalSetRef = evalSetId.trim();
    logger.info(`[EvalCapture] Using EvalSet ref_id: ${evalSetRef}`);

    // ── 2. Resolve requirement ref ───────────────────────────────────────────
    let requirementRef: string;

    if (requirementId?.trim()) {
      // IDOR guard: verify the node exists and is of type EvalRequirement
      const isOwned = await verifyRequirementOwnership(jarvisUrl, swarmApiKey, requirementId.trim());
      if (!isOwned) {
        logger.warn("[EvalCapture] requirementId not found or wrong type", requirementId);
        return NextResponse.json(
          { error: "Requirement not found or access denied" },
          { status: 403 }
        );
      }
      requirementRef = requirementId.trim();
      logger.info(`[EvalCapture] Attaching trigger to existing requirement ${requirementRef}`);
    } else {
      // Create a new EvalRequirement node
      const reqResult = await addNode(nodeConfig, {
        node_type: "EvalRequirement",
        node_data: {
          id: randomUUID(),
          name: requirement!.trim(),
        },
      });

      if (!reqResult.success || !reqResult.ref_id) {
        logger.error("[EvalCapture] Failed to create EvalRequirement", reqResult.error);
        return NextResponse.json({ error: "Failed to create requirement" }, { status: 502 });
      }
      requirementRef = reqResult.ref_id;
      logger.info(`[EvalCapture] EvalRequirement created, ref_id: ${requirementRef}`);
    }

    // ── 3. Build EvalTrigger from posted IO ──────────────────────────────────
    // Resolve canonical agent — prefer caller-supplied agentName, fall back to
    // source-bucket default for `provider_direct` (workflow capture path).
    const resolvedAgent = resolveHiveAgentName("provider_direct", agentNameRaw);
    logger.info(`[EvalCapture] Resolved agent: ${resolvedAgent} (override=${agentNameRaw ?? "none"})`);

    const promptSnapshot = JSON.stringify(inputs ?? null);
    const outputSnapshot = JSON.stringify(outputs ?? null);

    const triggerResult = await addNode(nodeConfig, {
      node_type: "EvalTrigger",
      node_data: {
        id: randomUUID(),
        agent: resolvedAgent,
        environment: String(workflowId),
        start_point: `step:${step_id ?? ""}`,
        end_point: `step:${step_id ?? ""}`,
        change_type: "prompt",
        source: "provider_direct" as const,
        body: JSON.stringify({
          prompt_snapshot: promptSnapshot,
          output_snapshot: outputSnapshot,
          tool_call_trace: null,
          feedback_note: reason ?? null,
        }),
        // Each prompt entry is individually JSON-stringified so the downstream
        // API receives an array of strings rather than one big JSON blob.
        ...(prompts?.length ? { prompts: prompts.map((p: any) => JSON.stringify(p)) } : {}),
      },
    });

    if (!triggerResult.success || !triggerResult.ref_id) {
      logger.error("[EvalCapture] Failed to create EvalTrigger", triggerResult.error);
      return NextResponse.json({ error: "Failed to create trigger" }, { status: 502 });
    }
    const triggerRef = triggerResult.ref_id;
    logger.info(`[EvalCapture] EvalTrigger created, ref_id: ${triggerRef}`);

    // ── 4. Upsert HiveAgent node + ATTRIBUTED_TO edge (non-fatal) ────────────
    try {
      const agentSpec = DEFAULT_AGENT_SPECS[resolvedAgent];
      const hiveAgentResult = await addNode(nodeConfig, {
        node_type: "HiveAgent",
        node_data: {
          name: resolvedAgent,
          display_name: agentSpec.displayName,
          description: agentSpec.description,
        },
      });
      logger.info(
        `[EvalCapture] HiveAgent upsert: success=${hiveAgentResult.success} alreadyExists=${hiveAgentResult.alreadyExists ?? false} ref_id=${hiveAgentResult.ref_id ?? "n/a"}`,
      );

      if (hiveAgentResult.success) {
        const attrEdgeResult = await addEdge(nodeConfig, {
          edge: { edge_type: "ATTRIBUTED_TO" },
          source: { ref_id: triggerRef },
          target: { node_type: "HiveAgent", node_data: { name: resolvedAgent } },
        });
        logger.info(`[EvalCapture] ATTRIBUTED_TO edge: success=${attrEdgeResult.success}`);
        if (!attrEdgeResult.success) {
          logger.warn(`[EvalCapture] ATTRIBUTED_TO edge failed (non-fatal): ${attrEdgeResult.error}`);
        }
      } else {
        logger.warn(`[EvalCapture] HiveAgent upsert failed (non-fatal): ${hiveAgentResult.error}`);
      }
    } catch (err) {
      logger.warn(`[EvalCapture] HiveAgent/ATTRIBUTED_TO step threw (non-fatal): ${String(err)}`);
    }

    // ── 5. Wire edges ────────────────────────────────────────────────────────
    if (!requirementId?.trim()) {
      // Only create EvalSet -> EvalRequirement edge when creating a new requirement
      await addEdge(nodeConfig, {
        edge: { edge_type: "HAS_REQUIREMENT" },
        source: { ref_id: evalSetRef },
        target: { ref_id: requirementRef },
      });
      logger.info("[EvalCapture] HAS_REQUIREMENT edge created");
    }

    // EvalRequirement -[HAS_TRIGGER]-> EvalTrigger
    await addEdge(nodeConfig, {
      edge: { edge_type: "HAS_TRIGGER" },
      source: { ref_id: requirementRef },
      target: { ref_id: triggerRef },
    });
    logger.info("[EvalCapture] HAS_TRIGGER edge created");

    return NextResponse.json({
      success: true,
      data: { evalSetRef, requirementRef, triggerRef, agentName: resolvedAgent },
    });
  } catch (error) {
    console.error("[EvalCapture] Raw error body:", error);
    logger.error("[EvalCapture] Unexpected error", String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

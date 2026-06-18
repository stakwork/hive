import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { logger } from "@/lib/logger";

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

    const { step_id, requirement, reason, inputs, outputs, evalSetId } = body as {
      run_id?: string;
      step_id?: string;
      requirement?: string;
      reason?: string;
      inputs?: Record<string, unknown> | null;
      outputs?: unknown;
      evalSetId?: string;
    };

    if (!requirement?.trim()) {
      return NextResponse.json({ error: "requirement is required" }, { status: 400 });
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

    // ── 2. Create EvalRequirement ────────────────────────────────────────────
    const reqResult = await addNode(nodeConfig, {
      node_type: "EvalRequirement",
      node_data: {
        id: randomUUID(),
        name: requirement.trim(),
      },
    });

    if (!reqResult.success || !reqResult.ref_id) {
      logger.error("[EvalCapture] Failed to create EvalRequirement", reqResult.error);
      return NextResponse.json({ error: "Failed to create requirement" }, { status: 502 });
    }
    const requirementRef = reqResult.ref_id;
    logger.info(`[EvalCapture] EvalRequirement created, ref_id: ${requirementRef}`);

    // ── 3. Build EvalTrigger from posted IO ──────────────────────────────────
    const stepName = step_id ?? "unknown_step";
    const promptSnapshot = JSON.stringify(inputs ?? null);
    const outputSnapshot = JSON.stringify(outputs ?? null);

    const triggerResult = await addNode(nodeConfig, {
      node_type: "EvalTrigger",
      node_data: {
        id: randomUUID(),
        agent: stepName,
        environment: String(workflowId),
        start_point: `step:${step_id ?? ""}`,
        end_point: `step:${step_id ?? ""}`,
        change_type: "prompt",
        body: JSON.stringify({
          prompt_snapshot: promptSnapshot,
          output_snapshot: outputSnapshot,
          tool_call_trace: null,
          feedback_note: reason ?? null,
        }),
      },
    });

    if (!triggerResult.success || !triggerResult.ref_id) {
      logger.error("[EvalCapture] Failed to create EvalTrigger", triggerResult.error);
      return NextResponse.json({ error: "Failed to create trigger" }, { status: 502 });
    }
    const triggerRef = triggerResult.ref_id;
    logger.info(`[EvalCapture] EvalTrigger created, ref_id: ${triggerRef}`);

    // ── 4. Wire edges ────────────────────────────────────────────────────────
    // EvalSet -[HAS_REQUIREMENT]-> EvalRequirement
    await addEdge(nodeConfig, {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: evalSetRef },
      target: { ref_id: requirementRef },
    });
    logger.info("[EvalCapture] HAS_REQUIREMENT edge created");

    // EvalRequirement -[HAS_TRIGGER]-> EvalTrigger
    await addEdge(nodeConfig, {
      edge: { edge_type: "HAS_TRIGGER" },
      source: { ref_id: requirementRef },
      target: { ref_id: triggerRef },
    });
    logger.info("[EvalCapture] HAS_TRIGGER edge created");

    return NextResponse.json({
      success: true,
      data: { evalSetRef, requirementRef, triggerRef },
    });
  } catch (error) {
    console.error("[EvalCapture] Raw error body:", error);
    logger.error("[EvalCapture] Unexpected error", String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { lookupAgentSessionByLogUrl } from "@/lib/utils/agent-session-lookup";
import { isEvalTriggerSource, type EvalTriggerSource } from "@/lib/utils/eval-source";
import { resolveCaptureSource } from "@/lib/eval-capture/resolve-capture-source";
import { extractMetadataPrompts } from "@/lib/eval-capture/extract-metadata-prompts";
import { logger } from "@/lib/logger";

type RouteParams = { params: Promise<{ slug: string; logId: string }> };

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, logId } = await params;

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      logger.warn("[FlagAsEval] Swarm access denied", swarmAccessResult.error.type);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    // Parse and validate request body
    const body = await request.json();
    const {
      evalSetId,
      requirementName,
      requirementDescription,
      positiveCases,
      negativeCases,
      agent,
      environment,
      startPoint,
      endPoint,
      runCount,
      source,
    } = body ?? {};

    const evalTriggerSource: EvalTriggerSource = isEvalTriggerSource(source) ? source : "repo_agent";

    if (
      !evalSetId ||
      !requirementName ||
      !requirementDescription ||
      !Array.isArray(positiveCases) ||
      positiveCases.length === 0 ||
      !Array.isArray(negativeCases) ||
      negativeCases.length === 0 ||
      !agent ||
      !environment
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: evalSetId, requirementName, requirementDescription, positiveCases (non-empty), negativeCases (non-empty), agent, environment",
        },
        { status: 400 },
      );
    }

    // IDOR guard — verify the log (AgentLog OR SharedConversation) belongs to this workspace
    const captured = await resolveCaptureSource(slug, logId);

    if (captured === null) {
      return NextResponse.json({ error: "Agent log not found" }, { status: 404 });
    }
    if ("denied" in captured) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // USE_MOCKS branch (after IDOR check — mock routes are id-agnostic)
    if (process.env.USE_MOCKS === "true") {
      logger.info("[FlagAsEval] USE_MOCKS=true, routing to mock endpoint");
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/agent-logs/${logId}/flag-as-eval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return NextResponse.json(await mockResponse.json());
    }

    // Live path
    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    // 1. Create EvalRequirement node
    const reqResult = await addNode(config, {
      node_type: "EvalRequirement",
      node_data: {
        id: randomUUID(),
        name: requirementName,
        prompt_snippet: requirementDescription,
        desirable_cases: positiveCases,
        undesirable_cases: negativeCases,
      },
    });

    if (!reqResult.success || !reqResult.ref_id) {
      logger.error("[FlagAsEval] Failed to create EvalRequirement", reqResult.error);
      return NextResponse.json({ error: "Failed to create requirement" }, { status: 502 });
    }

    const reqRefId = reqResult.ref_id;

    // 2. Create HAS_REQUIREMENT edge: EvalSet → EvalRequirement
    await addEdge(config, {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: evalSetId },
      target: { ref_id: reqRefId },
    });

    // 3. Resolve prompts from metadata (agent_log branch only)
    let metadataPrompts: string[] = [];
    if (captured.kind === "agent_log") {
      metadataPrompts = extractMetadataPrompts(captured.metadata);
      logger.info(`[FlagAsEval] resolved ${metadataPrompts.length} prompts from metadata`);
    }

    // 4. Create EvalTrigger node
    const triggerResult = await addNode(config, {
      node_type: "EvalTrigger",
      node_data: {
        id: randomUUID(),
        agent,
        environment,
        start_point: startPoint ?? null,
        end_point: endPoint ?? null,
        run_count: runCount ?? 3,
        source: evalTriggerSource,
        ...(metadataPrompts.length > 0 ? { prompts: metadataPrompts } : {}),
      },
    });

    if (!triggerResult.success || !triggerResult.ref_id) {
      logger.error("[FlagAsEval] Failed to create EvalTrigger", triggerResult.error);
      return NextResponse.json({ error: "Failed to create trigger" }, { status: 502 });
    }

    const triggerRefId = triggerResult.ref_id;

    // 5. Create HAS_TRIGGER edge: EvalRequirement → EvalTrigger
    await addEdge(config, {
      edge: { edge_type: "HAS_TRIGGER" },
      source: { ref_id: reqRefId },
      target: { ref_id: triggerRefId },
    });

    // 6. Optional: look up AgentSession by log URL (only available for AgentLog branch)
    let sessionRefId: string | undefined;
    if (captured.kind === "agent_log") {
      const foundSession = await lookupAgentSessionByLogUrl(config, captured.blobUrl);
      if (foundSession) {
        sessionRefId = foundSession;
        await addEdge(config, {
          edge: { edge_type: "EVALUATED" },
          source: { ref_id: triggerRefId },
          target: { ref_id: sessionRefId },
        });
      }
    }

    logger.info(`[FlagAsEval] resolved source=${captured.kind} logId=${logId}`);

    return NextResponse.json({
      success: true,
      data: {
        reqRefId,
        triggerRefId,
        ...(sessionRefId ? { sessionRefId } : {}),
      },
    });
  } catch (error) {
    logger.error("[FlagAsEval] Unexpected error", String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

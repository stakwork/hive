import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { lookupAgentSessionByLogUrl } from "@/lib/utils/agent-session-lookup";
import { db } from "@/lib/db";
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

    // IDOR guard — verify the log belongs to this workspace
    const agentLog = await db.agentLog.findUnique({
      where: { id: logId },
      select: { workspaceId: true, blobUrl: true },
    });

    if (!agentLog) {
      return NextResponse.json({ error: "Agent log not found" }, { status: 404 });
    }

    const logWorkspace = await db.workspace.findUnique({
      where: { id: agentLog.workspaceId },
      select: { slug: true },
    });

    if (!logWorkspace || logWorkspace.slug !== slug) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
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
    } = body ?? {};

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

    // USE_MOCKS branch
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
        positive_cases: positiveCases,
        negative_cases: negativeCases,
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

    // 3. Create EvalTrigger node
    const triggerResult = await addNode(config, {
      node_type: "EvalTrigger",
      node_data: {
        id: randomUUID(),
        agent,
        environment,
        start_point: startPoint ?? null,
        end_point: endPoint ?? null,
        run_count: runCount ?? 3,
      },
    });

    if (!triggerResult.success || !triggerResult.ref_id) {
      logger.error("[FlagAsEval] Failed to create EvalTrigger", triggerResult.error);
      return NextResponse.json({ error: "Failed to create trigger" }, { status: 502 });
    }

    const triggerRefId = triggerResult.ref_id;

    // 4. Create HAS_TRIGGER edge: EvalRequirement → EvalTrigger
    await addEdge(config, {
      edge: { edge_type: "HAS_TRIGGER" },
      source: { ref_id: reqRefId },
      target: { ref_id: triggerRefId },
    });

    // 5. Optional: look up AgentSession by log URL and create EVALUATED edge
    let sessionRefId: string | undefined;
    const foundSession = await lookupAgentSessionByLogUrl(config, agentLog.blobUrl);
    if (foundSession) {
      sessionRefId = foundSession;
      await addEdge(config, {
        edge: { edge_type: "EVALUATED" },
        source: { ref_id: triggerRefId },
        target: { ref_id: sessionRefId },
      });
    }

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

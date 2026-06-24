import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { db } from "@/lib/db";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import { deriveEvalTriggerSource } from "@/lib/utils/eval-source";
import { mapPromptResolutions, type PromptResolution } from "@/types/evals";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

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
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Auth
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, logId } = await params;

    // 2. Swarm access (also verifies workspace membership)
    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      logger.warn("[AgentEvalCapture] Swarm access denied", swarmAccessResult.error.type);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    // 3. IDOR guard — verify log belongs to this workspace (before any blob/Jarvis calls)
    const agentLog = await db.agentLog.findUnique({
      where: { id: logId },
      select: {
        workspaceId: true,
        blobUrl: true,
        agent: true,
        source: true,
        metadata: true,
        config: true,
      },
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

    // 4. Validate body
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { evalSetId, requirement, reason, turnIndex } = body as {
      evalSetId?: string;
      requirement?: string;
      reason?: string;
      turnIndex?: number;
    };

    if (!evalSetId?.trim()) {
      return NextResponse.json({ error: "evalSetId is required" }, { status: 400 });
    }

    if (!requirement?.trim()) {
      return NextResponse.json({ error: "requirement is required" }, { status: 400 });
    }

    // 5. USE_MOCKS → delegate to mock endpoint
    if (process.env.USE_MOCKS === "true") {
      logger.info("[AgentEvalCapture] USE_MOCKS=true, routing to mock endpoint");
      const mockRes = await fetch(
        `${request.nextUrl.origin}/api/mock/agent-logs/${logId}/eval/capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return NextResponse.json(await mockRes.json());
    }

    // 6. Fetch blob and parse conversation + config (blob still needed for conversation)
    const blobContent = await fetchBlobContent(agentLog.blobUrl);
    const { conversation, config: blobConfig } = parseAgentLogStats(blobContent);

    // Prefer DB column (canonical); fall back to blob-parsed config for legacy rows
    const effectiveConfig =
      agentLog.config && typeof agentLog.config === "object"
        ? (agentLog.config as Record<string, unknown>)
        : (blobConfig as Record<string, unknown> | undefined);

    // 7. Slice conversation
    const slicedConversation =
      turnIndex != null ? conversation.slice(0, turnIndex + 1) : conversation;

    // 8. Build prompt_snapshot
    const promptSnapshot = JSON.stringify({
      url: (effectiveConfig as { resolvedRequestUrl?: string } | undefined)?.resolvedRequestUrl ?? "",
      method: "post",
      request_params: {
        // Full harness config spread
        ...(effectiveConfig
          ? {
              systemOverride: effectiveConfig.systemOverride,
              toolsConfig: effectiveConfig.toolsConfig,
              tools: effectiveConfig.tools,
              schema: effectiveConfig.schema,
              providerConfig: effectiveConfig.providerConfig,
              baseUrl: effectiveConfig.baseUrl,
              mcpServers: effectiveConfig.mcpServers,
              model: effectiveConfig.model,
              provider: effectiveConfig.provider,
              temperature: effectiveConfig.temperature,
              source: effectiveConfig.source,
              repos: effectiveConfig.repos,
            }
          : {}),
        messages: slicedConversation, // role:"system" at index 0 is preserved by slice(0, n+1)
      },
    });

    // 9. Extract metadata.prompts (handles both flat array and PromptResolution map shapes)
    const metadata =
      agentLog.metadata != null && typeof agentLog.metadata === "object"
        ? (agentLog.metadata as Record<string, unknown>)
        : {};
    const rawPrompts = metadata.prompts;
    const metadataPrompts: unknown[] = Array.isArray(rawPrompts)
      ? (rawPrompts as unknown[])
      : (mapPromptResolutions(
          rawPrompts as Record<string, PromptResolution> | null | undefined,
        ) ?? []);

    // 10. Resolve change_type
    const changeType = agentLog.source ?? (effectiveConfig?.source as string | undefined) ?? "swarm_agent";

    // 10a. Derive EvalTrigger source discriminator
    const evalTriggerSource = deriveEvalTriggerSource(
      agentLog.source,
      (effectiveConfig as { resolvedRequestUrl?: string } | undefined)?.resolvedRequestUrl,
    );

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const nodeConfig = { jarvisUrl, apiKey: swarmApiKey };

    const evalSetRef = evalSetId.trim();
    logger.info(`[AgentEvalCapture] Using EvalSet ref_id: ${evalSetRef}`);

    // 11. Create EvalRequirement node
    const reqResult = await addNode(nodeConfig, {
      node_type: "EvalRequirement",
      node_data: {
        id: randomUUID(),
        name: requirement.trim(),
      },
    });

    if (!reqResult.success || !reqResult.ref_id) {
      logger.error("[AgentEvalCapture] Failed to create EvalRequirement", reqResult.error);
      return NextResponse.json({ error: "Failed to create requirement" }, { status: 502 });
    }
    const requirementRef = reqResult.ref_id;
    logger.info(`[AgentEvalCapture] EvalRequirement created, ref_id: ${requirementRef}`);

    // 12. Create EvalTrigger node
    const scopeKey = turnIndex != null ? `turn:${turnIndex}` : "session:full";

    const triggerResult = await addNode(nodeConfig, {
      node_type: "EvalTrigger",
      node_data: {
        id: randomUUID(),
        agent: agentLog.agent ?? "swarm_agent",
        environment: logId,
        change_type: changeType,
        source: evalTriggerSource,
        start_point: scopeKey,
        end_point: scopeKey,
        body: JSON.stringify({
          prompt_snapshot: promptSnapshot,
          output_snapshot: null,
          tool_call_trace: null,
          feedback_note: reason ?? null,
        }),
        ...(metadataPrompts.length > 0
          ? { prompts: metadataPrompts.map((p) => JSON.stringify(p)) }
          : {}),
      },
    });

    if (!triggerResult.success || !triggerResult.ref_id) {
      logger.error("[AgentEvalCapture] Failed to create EvalTrigger", triggerResult.error);
      return NextResponse.json({ error: "Failed to create trigger" }, { status: 502 });
    }
    const triggerRef = triggerResult.ref_id;
    logger.info(`[AgentEvalCapture] EvalTrigger created, ref_id: ${triggerRef}`);

    // 13. Wire edges
    // EvalSet -[HAS_REQUIREMENT]-> EvalRequirement
    await addEdge(nodeConfig, {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: evalSetRef },
      target: { ref_id: requirementRef },
    });
    logger.info("[AgentEvalCapture] HAS_REQUIREMENT edge created");

    // EvalRequirement -[HAS_TRIGGER]-> EvalTrigger
    await addEdge(nodeConfig, {
      edge: { edge_type: "HAS_TRIGGER" },
      source: { ref_id: requirementRef },
      target: { ref_id: triggerRef },
    });
    logger.info("[AgentEvalCapture] HAS_TRIGGER edge created");

    // 14. Return success
    return NextResponse.json({
      success: true,
      data: { evalSetRef, requirementRef, triggerRef },
    });
  } catch (error) {
    logger.error("[AgentEvalCapture] Unexpected error", String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

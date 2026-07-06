import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { deriveEvalTriggerSource } from "@/lib/utils/eval-source";
import {
  parseCanonicalAgent,
  resolveHiveAgentName,
  isCaptureAgentName,
} from "@/lib/utils/hive-agent";
import { mapPromptResolutions, type PromptResolution } from "@/types/evals";
import { resolveCaptureSource } from "@/lib/eval-capture/resolve-capture-source";
import { createEvalNodes } from "@/lib/eval-capture/create-eval-nodes";
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

    // 3. Validate body early (before IDOR check — no side-effects yet)
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { evalSetId, requirement, reason, turnIndex, agentName: agentOverride } = body as {
      evalSetId?: string;
      requirement?: string;
      reason?: string;
      turnIndex?: number;
      agentName?: string;
    };

    if (!evalSetId?.trim()) {
      return NextResponse.json({ error: "evalSetId is required" }, { status: 400 });
    }

    if (!requirement?.trim()) {
      return NextResponse.json({ error: "requirement is required" }, { status: 400 });
    }

    // 4. IDOR + transcript resolution (AgentLog OR SharedConversation)
    //    Must run before USE_MOCKS delegation and any external call.
    const captured = await resolveCaptureSource(slug, logId);

    if (captured === null) {
      return NextResponse.json({ error: "Agent log not found" }, { status: 404 });
    }
    if ("denied" in captured) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // 5. USE_MOCKS → delegate to mock endpoint (id-agnostic, preserved for both branches)
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

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const nodeConfig = { jarvisUrl, apiKey: swarmApiKey };

    const evalSetRef = evalSetId.trim();
    logger.info(`[AgentEvalCapture] Using EvalSet ref_id: ${evalSetRef}`);

    // 6. Branch: build prompt_snapshot, resolve agent, etc.
    let promptSnapshot: string;
    let changeType: string;
    let evalTriggerSource: ReturnType<typeof deriveEvalTriggerSource>;
    let resolvedAgent: string;
    let metadataPrompts: string[] = [];
    let environment: string;

    if (captured.kind === "agent_log") {
      // ── AgentLog branch (identical to previous behaviour) ──────────────────
      const { conversation, effectiveConfig, agent, source, metadata } = captured;

      // Slice conversation
      const slicedConversation =
        turnIndex != null ? conversation.slice(0, turnIndex + 1) : conversation;

      // Build prompt_snapshot
      promptSnapshot = JSON.stringify({
        url: (effectiveConfig as { resolvedRequestUrl?: string } | undefined)?.resolvedRequestUrl ?? "",
        method: "post",
        request_params: {
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
          messages: slicedConversation,
        },
      });

      // Extract metadata.prompts
      const metaObj =
        metadata != null && typeof metadata === "object"
          ? (metadata as Record<string, unknown>)
          : {};
      const rawPrompts = metaObj.prompts;
      const promptsArr: unknown[] = Array.isArray(rawPrompts)
        ? (rawPrompts as unknown[])
        : (mapPromptResolutions(
            rawPrompts as Record<string, PromptResolution> | null | undefined,
          ) ?? []);
      metadataPrompts = promptsArr.map((p) => JSON.stringify(p));

      changeType = source ?? (effectiveConfig?.source as string | undefined) ?? "swarm_agent";

      evalTriggerSource = deriveEvalTriggerSource(
        source,
        (effectiveConfig as { resolvedRequestUrl?: string } | undefined)?.resolvedRequestUrl,
      );

      // Agent override takes priority when it's a valid catalog name; otherwise
      // parse from AgentLog.agent (primary), fall back to source-bucket default.
      if (agentOverride != null && isCaptureAgentName(agentOverride)) {
        resolvedAgent = agentOverride;
      } else {
        const parsedAgent = parseCanonicalAgent(agent ?? "");
        resolvedAgent = parsedAgent ?? resolveHiveAgentName(evalTriggerSource);
      }

      environment = logId;
    } else {
      // ── SharedConversation branch ───────────────────────────────────────────
      const { conversation, source, conversationId } = captured;

      // For conversations no blob or config exists; snapshot is just the messages
      const slicedConversation =
        turnIndex != null ? conversation.slice(0, turnIndex + 1) : conversation;

      promptSnapshot = JSON.stringify({
        url: "",
        method: "post",
        request_params: {
          messages: slicedConversation,
        },
      });

      changeType = source ?? "canvas_chat";

      // canvas_chat → jamie_agent → canvas-agent default
      evalTriggerSource = deriveEvalTriggerSource("canvas_chat", undefined);

      // Agent override takes priority; otherwise default to canvas-agent
      if (agentOverride != null && isCaptureAgentName(agentOverride)) {
        resolvedAgent = agentOverride;
      } else {
        resolvedAgent = resolveHiveAgentName(evalTriggerSource);
      }

      environment = conversationId;
    }

    logger.info(
      `[AgentEvalCapture] Resolved agent: ${resolvedAgent} (source=${evalTriggerSource}, kind=${captured.kind}, override=${agentOverride ?? "none"})`,
    );

    const scopeKey = turnIndex != null ? `turn:${turnIndex}` : "session:full";

    // 7. Create eval nodes + edges via shared helper
    const result = await createEvalNodes({
      nodeConfig,
      evalSetRef,
      requirement,
      reason,
      promptSnapshot,
      changeType,
      evalTriggerSource,
      resolvedAgent,
      scopeKey,
      environment,
      metadataPrompts,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // 8. Return success
    return NextResponse.json({
      success: true,
      data: {
        evalSetRef,
        requirementRef: result.requirementRef,
        triggerRef: result.triggerRef,
        agentName: result.agentName,
      },
    });
  } catch (error) {
    logger.error("[AgentEvalCapture] Unexpected error", String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

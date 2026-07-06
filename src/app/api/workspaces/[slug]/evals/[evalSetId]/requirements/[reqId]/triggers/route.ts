import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { resolveHiveAgentName, isBifrostAgentName, isCaptureAgentName, getCaptureAgentSpec } from "@/lib/utils/hive-agent";
import { extractMetadataPrompts } from "@/lib/eval-capture/extract-metadata-prompts";
import { db } from "@/lib/db";
import type { JarvisConnectionConfig } from "@/types/jarvis";

type RouteParams = {
  params: Promise<{ slug: string; evalSetId: string; reqId: string }>;
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
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * Resolves prompt resolutions for an EvalTrigger from an AgentSession's linked AgentLog.
 *
 * Flow: session node (Jarvis) → properties.log_url → AgentLog.blobUrl → metadata.prompts
 *
 * IDOR guard: verifies the resolved AgentLog belongs to the same workspace as the request.
 * Never throws — all failures are caught, logged as warnings, and return [].
 */
async function resolveSessionPrompts(
  config: JarvisConnectionConfig,
  sessionRefId: string,
  workspaceId: string,
): Promise<string[]> {
  try {
    // 1. Fetch AgentSession node from Jarvis
    const sessionRes = await fetch(`${config.jarvisUrl}/v2/nodes/${sessionRefId}`, {
      headers: { "x-api-token": config.apiKey },
    });

    if (!sessionRes.ok) {
      console.warn(
        `[Evals Triggers POST] session→log prompt resolution failed (non-fatal): Jarvis returned ${sessionRes.status} for session ${sessionRefId}`,
      );
      return [];
    }

    const sessionData = await sessionRes.json();

    // Jarvis node shape: properties or node_data may carry log_url
    const logUrl: string | undefined =
      sessionData?.properties?.log_url ??
      sessionData?.node_data?.log_url ??
      undefined;

    if (!logUrl) {
      return [];
    }

    // 2. Look up AgentLog by blobUrl
    const agentLog = await db.agentLog.findFirst({
      where: { blobUrl: logUrl },
      select: { workspaceId: true, metadata: true },
    });

    if (!agentLog) {
      return [];
    }

    // 3. IDOR guard: ensure the log belongs to this workspace
    if (agentLog.workspaceId !== workspaceId) {
      console.warn(
        `[Evals Triggers POST] session→log prompt resolution failed (non-fatal): IDOR — agentLog belongs to workspace ${agentLog.workspaceId}, not ${workspaceId}`,
      );
      return [];
    }

    // 4. Extract prompts from metadata
    return extractMetadataPrompts(agentLog.metadata);
  } catch (err) {
    console.warn(
      `[Evals Triggers POST] session→log prompt resolution failed (non-fatal): ${String(err)}`,
    );
    return [];
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId, reqId } = await params;
    console.log(`[Evals Triggers GET] slug=${slug}, evalSetId=${evalSetId}, reqId=${reqId}, userId=${userOrResponse.id}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Triggers GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Triggers GET] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements/${reqId}/triggers`,
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    // Fetch EvalTrigger nodes via HAS_TRIGGER edge from requirement
    const edgeType = encodeURIComponent("['HAS_TRIGGER']");
    const nodeType = encodeURIComponent("['EvalTrigger']");
    const triggersRes = await fetch(
      `${jarvisUrl}/v2/nodes/${reqId}?expand=edges&edge_type=${edgeType}&node_type=${nodeType}&depth=1`,
      { headers: { "x-api-token": swarmApiKey } },
    );

    if (!triggersRes.ok) {
      console.error(`[Evals Triggers GET] Jarvis error ${triggersRes.status}`);
      return NextResponse.json(
        { error: "Failed to fetch triggers from Jarvis" },
        { status: 502 },
      );
    }

    const triggersData = await triggersRes.json();
    const triggerNodes = triggersData?.nodes ?? [];

    // For each trigger, fetch EvalTriggerOutput nodes via HAS_OUTPUT edge
    const outputEdgeType = encodeURIComponent("['HAS_OUTPUT']");
    const outputNodeType = encodeURIComponent("['EvalTriggerOutput']");

    const triggersWithOutputs = await Promise.all(
      triggerNodes.map(async (trigger: { ref_id: string }) => {
        const outputsRes = await fetch(
          `${jarvisUrl}/v2/nodes/${trigger.ref_id}?expand=edges&edge_type=${outputEdgeType}&node_type=${outputNodeType}&depth=1`,
          { headers: { "x-api-token": swarmApiKey } },
        );
        if (!outputsRes.ok) return { ...trigger, outputs: [] };
        const outputsData = await outputsRes.json();
        return { ...trigger, outputs: (outputsData?.nodes ?? []).filter((n: { ref_id: string }) => n.ref_id !== trigger.ref_id) };
      }),
    );

    return NextResponse.json({
      success: true,
      data: { nodes: triggersWithOutputs, total: triggersWithOutputs.length },
    });
  } catch (error) {
    console.error("[Evals/Triggers] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId, reqId } = await params;
    console.log(`[Evals Triggers POST] slug=${slug}, evalSetId=${evalSetId}, reqId=${reqId}, userId=${userOrResponse.id}`);

    const body = await request.json();
    const {
      agent,
      agentName: agentNameRaw,
      start_point,
      end_point,
      environment,
      session_ref_id,
      change_type,
      run_count,
      desirable_cases,
      undesirable_cases,
    } = body ?? {};

    // Resolve canonical agent name:
    // - prefer explicit `agentName` if it is a valid capture agent name (incl. wfe-agent)
    // - else try to resolve from free-text `agent` (legacy, kept for back-compat)
    // - else fall back to source-bucket default (no fine-grained signal here)
    const agentOverride = isCaptureAgentName(agentNameRaw)
      ? agentNameRaw
      : isCaptureAgentName(agent)
      ? agent
      : undefined;
    const resolvedAgent = resolveHiveAgentName("repo_agent", agentOverride);

    // `agent` is still required as a field for backward-compat validation, but we
    // accept either `agent` or `agentName` to satisfy the check.
    const agentInput = agentNameRaw ?? agent;
    if (!agentInput || typeof agentInput !== "string" || !agentInput.trim()) {
      return NextResponse.json({ error: "agent is required" }, { status: 400 });
    }
    if (!start_point || typeof start_point !== "string" || !start_point.trim()) {
      return NextResponse.json({ error: "start_point is required" }, { status: 400 });
    }
    if (!end_point || typeof end_point !== "string" || !end_point.trim()) {
      return NextResponse.json({ error: "end_point is required" }, { status: 400 });
    }
    if (!environment || typeof environment !== "string" || !environment.trim()) {
      return NextResponse.json({ error: "environment is required" }, { status: 400 });
    }
    if (!session_ref_id || typeof session_ref_id !== "string" || !session_ref_id.trim()) {
      return NextResponse.json({ error: "session_ref_id is required" }, { status: 400 });
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Triggers POST] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Triggers POST] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements/${reqId}/triggers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey, workspaceId } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    console.log(`[Evals Triggers POST] Resolved agent: ${resolvedAgent} (override=${agentNameRaw ?? agent ?? "none"})`);

    // Resolve prompts from session → AgentLog metadata (non-fatal)
    const sessionPrompts = await resolveSessionPrompts(config, session_ref_id.trim(), workspaceId);
    console.log(`[Evals Triggers POST] resolved ${sessionPrompts.length} prompts from session→log`);

    // Step 1: Create EvalTrigger node
    const triggerId = randomUUID();
    const nodeData: Record<string, unknown> = {
      id: triggerId,
      agent: resolvedAgent,
      start_point: start_point.trim(),
      end_point: end_point.trim(),
      environment: environment.trim(),
      run_count: typeof run_count === "number" ? run_count : 1,
    };
    if (change_type) nodeData.change_type = change_type;
    if (Array.isArray(desirable_cases)) nodeData.desirable_cases = desirable_cases;
    if (Array.isArray(undesirable_cases)) nodeData.undesirable_cases = undesirable_cases;
    if (sessionPrompts.length > 0) nodeData.prompts = sessionPrompts;

    const nodeResult = await addNode(config, {
      node_type: "EvalTrigger",
      node_data: nodeData,
    });
    console.log(`[Evals Triggers POST] addNode result: success=${nodeResult.success}, ref_id=${nodeResult.ref_id ?? "n/a"}`);

    if (!nodeResult.success || !nodeResult.ref_id) {
      return NextResponse.json(
        { error: nodeResult.error ?? "Failed to create EvalTrigger node" },
        { status: 502 },
      );
    }

    const createdTriggerId = nodeResult.ref_id;

    // Step 2: HAS_TRIGGER edge (EvalRequirement → EvalTrigger)
    const hasTriggerResult = await addEdge(config, {
      edge: { edge_type: "HAS_TRIGGER" },
      source: { ref_id: reqId },
      target: { ref_id: createdTriggerId },
    });
    console.log(`[Evals Triggers POST] HAS_TRIGGER edge result: success=${hasTriggerResult.success}`);

    if (!hasTriggerResult.success) {
      return NextResponse.json(
        { error: hasTriggerResult.error ?? "Failed to create HAS_TRIGGER edge" },
        { status: 502 },
      );
    }

    // Step 3: EVALUATED edge (EvalTrigger → AgentSession)
    const evaluatedResult = await addEdge(config, {
      edge: { edge_type: "EVALUATED" },
      source: { ref_id: createdTriggerId },
      target: { ref_id: session_ref_id.trim() },
    });
    console.log(`[Evals Triggers POST] EVALUATED edge result: success=${evaluatedResult.success}`);

    if (!evaluatedResult.success) {
      return NextResponse.json(
        { error: evaluatedResult.error ?? "Failed to create EVALUATED edge" },
        { status: 502 },
      );
    }

    // Step 4: Upsert HiveAgent node + ATTRIBUTED_TO edge (non-fatal)
    try {
      const agentSpec = getCaptureAgentSpec(resolvedAgent);
      const hiveAgentResult = await addNode(config, {
        node_type: "HiveAgent",
        node_data: {
          name: resolvedAgent,
          display_name: agentSpec.displayName,
          description: agentSpec.description,
        },
      });
      console.log(
        `[Evals Triggers POST] HiveAgent upsert: success=${hiveAgentResult.success} alreadyExists=${hiveAgentResult.alreadyExists ?? false} ref_id=${hiveAgentResult.ref_id ?? "n/a"}`,
      );

      if (hiveAgentResult.success) {
        const attrEdgeResult = await addEdge(config, {
          edge: { edge_type: "ATTRIBUTED_TO" },
          source: { ref_id: createdTriggerId },
          target: { node_type: "HiveAgent", node_data: { name: resolvedAgent } },
        });
        console.log(`[Evals Triggers POST] ATTRIBUTED_TO edge: success=${attrEdgeResult.success}`);
        if (!attrEdgeResult.success) {
          console.warn(`[Evals Triggers POST] ATTRIBUTED_TO edge failed (non-fatal): ${attrEdgeResult.error}`);
        }
      } else {
        console.warn(`[Evals Triggers POST] HiveAgent upsert failed (non-fatal): ${hiveAgentResult.error}`);
      }
    } catch (err) {
      console.warn(`[Evals Triggers POST] HiveAgent/ATTRIBUTED_TO step threw (non-fatal): ${String(err)}`);
    }

    return NextResponse.json({ success: true, data: { ref_id: createdTriggerId, agentName: resolvedAgent } });
  } catch (error) {
    console.error("[Evals/Triggers] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

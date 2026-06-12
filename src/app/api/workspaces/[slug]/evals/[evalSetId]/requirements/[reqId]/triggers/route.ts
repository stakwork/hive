import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";

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
        return { ...trigger, outputs: outputsData?.nodes ?? [] };
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
      start_point,
      end_point,
      environment,
      session_ref_id,
      change_type,
      run_count,
      positive_cases,
      negative_cases,
    } = body ?? {};

    // Validate required fields
    if (!agent || typeof agent !== "string" || !agent.trim()) {
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

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    // Step 1: Create EvalTrigger node
    const triggerId = randomUUID();
    const nodeData: Record<string, unknown> = {
      id: triggerId,
      agent: agent.trim(),
      start_point: start_point.trim(),
      end_point: end_point.trim(),
      environment: environment.trim(),
      run_count: typeof run_count === "number" ? run_count : 1,
    };
    if (change_type) nodeData.change_type = change_type;
    if (Array.isArray(positive_cases)) nodeData.positive_cases = positive_cases;
    if (Array.isArray(negative_cases)) nodeData.negative_cases = negative_cases;

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

    return NextResponse.json({ success: true, data: { ref_id: createdTriggerId } });
  } catch (error) {
    console.error("[Evals/Triggers] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

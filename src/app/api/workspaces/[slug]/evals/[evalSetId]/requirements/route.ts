import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import type { JarvisNode } from "@/types/jarvis";


type RouteParams = { params: Promise<{ slug: string; evalSetId: string }> };

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

    const { slug, evalSetId } = await params;
    console.log(`[Evals Requirements GET] slug=${slug}, evalSetId=${evalSetId}, userId=${userOrResponse.id}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Requirements GET] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements`,
        { method: "GET" },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    console.log(`[Evals Requirements GET] Jarvis URL: ${jarvisUrl}`);

    const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
    const nodeType = encodeURIComponent("['EvalRequirement']");
    const url = `${jarvisUrl}/v2/nodes/${evalSetId}?expand=edges&edge_type=${edgeType}&node_type=${nodeType}&depth=1`;

    const jarvisRes = await fetch(url, {
      headers: { "x-api-token": swarmApiKey },
    });

    if (!jarvisRes.ok) {
      const text = await jarvisRes.text().catch(() => "");
      console.error(`[Evals Requirements GET] Jarvis error ${jarvisRes.status}: ${text}`);
      return NextResponse.json(
        { error: "Failed to fetch requirements from Jarvis" },
        { status: 502 },
      );
    }

    const jarvisData = await jarvisRes.json();
    const nodes: JarvisNode[] = jarvisData?.nodes ?? [];
    const edges: Array<{ target_ref_id: string; properties?: { order?: number }; edge_data?: { order?: number } }> =
      jarvisData?.edges ?? [];

    // Merge edge order into each node's properties
    for (const node of nodes) {
      const edge = edges.find((e) => e.target_ref_id === node.ref_id);
      if (edge) {
        const order = edge.properties?.order ?? edge.edge_data?.order;
        if (order !== undefined) {
          node.properties = { ...node.properties, order };
        }
      }
    }

    return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
  } catch (error) {
    console.error("[Evals/Requirements] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId } = await params;
    console.log(`[Evals Requirements POST] slug=${slug}, evalSetId=${evalSetId}, userId=${userOrResponse.id}`);

    const body = await request.json();
    const { name, description, prompt_snippet, positive_cases, negative_cases, order } =
      body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!prompt_snippet || typeof prompt_snippet !== "string" || !prompt_snippet.trim()) {
      return NextResponse.json(
        { error: "prompt_snippet is required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(positive_cases) || positive_cases.length === 0) {
      return NextResponse.json(
        { error: "positive_cases must be a non-empty array" },
        { status: 400 },
      );
    }
    if (!Array.isArray(negative_cases) || negative_cases.length === 0) {
      return NextResponse.json(
        { error: "negative_cases must be a non-empty array" },
        { status: 400 },
      );
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements POST] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }
    console.log(`[Evals Requirements POST] Swarm access granted — swarmName=${swarmAccessResult.data.swarmName}, apiKey present=${!!swarmAccessResult.data.swarmApiKey}`);

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Requirements POST] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements`,
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
    console.log(`[Evals Requirements POST] Jarvis URL: ${jarvisUrl}`);

    const nodeResult = await addNode(config, {
      node_type: "EvalRequirement",
      node_data: {
        name: name.trim(),
        description,
        prompt_snippet: prompt_snippet.trim(),
        positive_cases,
        negative_cases,
      },
    });
    console.log(`[Evals Requirements POST] addNode result: success=${nodeResult.success}, ref_id=${nodeResult.ref_id ?? 'n/a'}, error=${nodeResult.error ?? 'none'}`);

    if (!nodeResult.success || !nodeResult.ref_id) {
      return NextResponse.json(
        { error: nodeResult.error ?? "Failed to create requirement node" },
        { status: 502 },
      );
    }

    // Determine order: use provided value or default to 0
    const edgeOrder = typeof order === "number" ? order : 0;

    const edgeResult = await addEdge(config, {
      edge: { edge_type: "HAS_REQUIREMENT", edge_data: { order: edgeOrder } },
      source: { ref_id: evalSetId },
      target: { ref_id: nodeResult.ref_id },
    });
    console.log(`[Evals Requirements POST] addEdge result: success=${edgeResult.success}, error=${edgeResult.error ?? 'none'}`);

    if (!edgeResult.success) {
      console.warn(`[Evals Requirements POST] Failed to link requirement to eval set: ${edgeResult.error}`);
      return NextResponse.json(
        { error: edgeResult.error ?? "Failed to link requirement to eval set" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, data: { ref_id: nodeResult.ref_id } });
  } catch (error) {
    console.error("[Evals/Requirements] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

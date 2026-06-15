import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";


type RouteParams = { params: Promise<{ slug: string }> };

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

    const { slug } = await params;
    const { searchParams } = request.nextUrl;
    const roleRefId = searchParams.get("role_ref_id");

    console.log(`[Evals Sessions GET] slug=${slug}, userId=${userOrResponse.id}, roleRefId=${roleRefId ?? "none"}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Sessions GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }
    console.log(`[Evals Sessions GET] Swarm access granted — swarmName=${swarmAccessResult.data.swarmName}, apiKey present=${!!swarmAccessResult.data.swarmApiKey}`);

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Sessions GET] USE_MOCKS=true, routing to mock endpoint`);
      // Return the AgentSession nodes from the mock graph endpoint
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/jarvis/graph`,
        { headers: { "Content-Type": "application/json" } },
      );
      const mockData = await mockResponse.json();
      let sessionNodes = (mockData?.nodes ?? []).filter(
        (n: { node_type: string }) => n.node_type === "AgentSession",
      );
      // When role_ref_id is provided, filter to only sessions linked from that role.
      // In mock mode we don't have real HAS_SESSION edges, so we return an empty list
      // for any role_ref_id that doesn't match well-known mock values.
      if (roleRefId) {
        // Mock: role-1 → first session, role-2 → second, role-3 → all remaining
        const roleSessionMap: Record<string, number> = { "role-1": 0, "role-2": 1, "role-3": 2 };
        const idx = roleSessionMap[roleRefId];
        sessionNodes = idx !== undefined ? [sessionNodes[idx]].filter(Boolean) : [];
      }
      return NextResponse.json({
        success: true,
        data: { nodes: sessionNodes, total: sessionNodes.length },
      });
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    console.log(`[Evals Sessions GET] Jarvis URL: ${jarvisUrl}`);

    let nodes: unknown[] = [];
    let total = 0;

    if (roleRefId) {
      // Traverse HAS_SESSION edges from AgentRole → AgentSession
      console.log(`[Evals Sessions GET] Fetching sessions via HAS_SESSION from roleRefId=${roleRefId}`);
      const edgeType = encodeURIComponent("['HAS_SESSION']");
      const nodeType = encodeURIComponent("['AgentSession']");
      const response = await fetch(
        `${jarvisUrl}/v2/nodes/${roleRefId}?expand=edges&edge_type=${edgeType}&node_type=${nodeType}&depth=1`,
        { headers: { "x-api-token": swarmApiKey } },
      );
      console.log(`[Evals Sessions GET] Jarvis HAS_SESSION response status: ${response.status}`);
      if (!response.ok) {
        console.warn(`[Evals Sessions GET] Jarvis returned non-OK status: ${response.status}`);
        return NextResponse.json(
          { error: "Failed to fetch agent sessions for role" },
          { status: 502 },
        );
      }
      const data = await response.json();
      nodes = data?.nodes ?? [];
      total = nodes.length;
    } else {
      // Default: all AgentSession nodes
      console.log(`[Evals Sessions GET] Fetching all AgentSession nodes`);
      const response = await fetch(
        `${jarvisUrl}/v2/nodes?type=AgentSession&limit=50`,
        {
          headers: {
            "x-api-token": swarmApiKey,
            "Content-Type": "application/json",
          },
        },
      );
      console.log(`[Evals Sessions GET] Swarm response status: ${response.status}`);
      if (!response.ok) {
        console.warn(`[Evals Sessions GET] Swarm returned non-OK status: ${response.status}`);
        return NextResponse.json(
          { error: "Failed to fetch agent sessions" },
          { status: 502 },
        );
      }
      const data = await response.json();
      nodes = data?.nodes ?? [];
      total = data?.total ?? nodes.length;
    }

    return NextResponse.json({ success: true, data: { nodes, total } });
  } catch (error) {
    console.error("[Evals/Sessions] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

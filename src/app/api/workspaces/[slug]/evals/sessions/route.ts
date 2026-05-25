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
    console.log(`[Evals Sessions GET] slug=${slug}, userId=${userOrResponse.id}`);

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
      const sessionNodes = (mockData?.nodes ?? []).filter(
        (n: { node_type: string }) => n.node_type === "AgentSession",
      );
      return NextResponse.json({
        success: true,
        data: { nodes: sessionNodes, total: sessionNodes.length },
      });
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    console.log(`[Evals Sessions GET] Jarvis URL: ${jarvisUrl}`);

    console.log(`[Evals Sessions GET] Fetching swarm: ${jarvisUrl}/v2/nodes?type=AgentSession&limit=50`);
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
    return NextResponse.json({
      success: true,
      data: { nodes: data.nodes ?? [], total: data.total ?? 0 },
    });
  } catch (error) {
    console.error("[Evals/Sessions] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

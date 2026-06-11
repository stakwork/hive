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
    const nameFilter = searchParams.get("name");

    console.log(`[Evals AgentRoles GET] slug=${slug}, userId=${userOrResponse.id}, nameFilter=${nameFilter ?? "none"}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals AgentRoles GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals AgentRoles GET] USE_MOCKS=true, routing to mock endpoint`);
      const mockUrl = new URL(`${request.nextUrl.origin}/api/mock/evals/agent-roles`);
      if (nameFilter) mockUrl.searchParams.set("name", nameFilter);
      const mockResponse = await fetch(mockUrl.toString());
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    const jarvisUrl2 = new URL(`${jarvisUrl}/v2/nodes`);
    jarvisUrl2.searchParams.set("type", "AgentRole");
    jarvisUrl2.searchParams.set("limit", "100");

    const jarvisRes = await fetch(jarvisUrl2.toString(), {
      headers: { "x-api-token": swarmApiKey },
    });

    if (!jarvisRes.ok) {
      console.error(`[Evals AgentRoles GET] Jarvis error ${jarvisRes.status}`);
      return NextResponse.json(
        { error: "Failed to fetch agent roles from Jarvis" },
        { status: 502 },
      );
    }

    const jarvisData = await jarvisRes.json();
    let nodes = jarvisData?.nodes ?? [];

    if (nameFilter) {
      const lower = nameFilter.toLowerCase();
      nodes = nodes.filter(
        (n: { properties?: { name?: string } }) =>
          n.properties?.name?.toLowerCase().includes(lower),
      );
    }

    return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
  } catch (error) {
    console.error("[Evals/AgentRoles] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

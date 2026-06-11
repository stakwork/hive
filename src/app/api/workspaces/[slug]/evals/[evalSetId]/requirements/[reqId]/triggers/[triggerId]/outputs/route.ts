import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";

type RouteParams = {
  params: Promise<{ slug: string; evalSetId: string; reqId: string; triggerId: string }>;
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

    const { slug, evalSetId, reqId, triggerId } = await params;
    console.log(`[Evals Trigger Outputs GET] slug=${slug}, evalSetId=${evalSetId}, reqId=${reqId}, triggerId=${triggerId}, userId=${userOrResponse.id}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Trigger Outputs GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Trigger Outputs GET] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements/${reqId}/triggers/${triggerId}/outputs`,
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    const edgeType = encodeURIComponent("['HAS_OUTPUT']");
    const nodeType = encodeURIComponent("['EvalTriggerOutput']");

    const outputsRes = await fetch(
      `${jarvisUrl}/v2/nodes/${triggerId}?expand=edges&edge_type=${edgeType}&node_type=${nodeType}&depth=1`,
      { headers: { "x-api-token": swarmApiKey } },
    );

    if (!outputsRes.ok) {
      console.error(`[Evals Trigger Outputs GET] Jarvis error ${outputsRes.status}`);
      return NextResponse.json(
        { error: "Failed to fetch trigger outputs from Jarvis" },
        { status: 502 },
      );
    }

    const outputsData = await outputsRes.json();
    const nodes = outputsData?.nodes ?? [];

    return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
  } catch (error) {
    console.error("[Evals/Trigger/Outputs] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

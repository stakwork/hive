import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode } from "@/services/swarm/api/nodes";


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

    if (process.env.USE_MOCKS === "true") {
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals`,
        { headers: { "Content-Type": "application/json" } },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    const response = await fetch(
      `${jarvisUrl}/v2/nodes?type=EvalSet&limit=100`,
      {
        headers: {
          "x-api-token": swarmApiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch eval sets" },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      data: { nodes: data.nodes ?? [], total: data.total ?? 0 },
    });
  } catch (error) {
    console.error("[Evals] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    const body = await request.json();
    const { name, description } = body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    if (process.env.USE_MOCKS === "true") {
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    const result = await addNode(
      { jarvisUrl, apiKey: swarmApiKey },
      { node_type: "EvalSet", node_data: { name: name.trim(), description } },
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true, data: { ref_id: result.ref_id } });
  } catch (error) {
    console.error("[Evals] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

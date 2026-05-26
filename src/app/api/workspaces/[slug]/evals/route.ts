import { randomUUID } from "crypto";
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
    console.log(`[Evals GET] slug=${slug}, userId=${userOrResponse.id}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }
    console.log(`[Evals GET] Swarm access granted — swarmName=${swarmAccessResult.data.swarmName}, apiKey present=${!!swarmAccessResult.data.swarmApiKey}`);

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals GET] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals`,
        { headers: { "Content-Type": "application/json" } },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    console.log(`[Evals GET] Jarvis URL: ${jarvisUrl}`);

    console.log(`[Evals GET] Fetching swarm: ${jarvisUrl}/v2/nodes?type=EvalSet&limit=100`);
    const response = await fetch(
      `${jarvisUrl}/v2/nodes?type=EvalSet&limit=100`,
      {
        headers: {
          "x-api-token": swarmApiKey,
          "Content-Type": "application/json",
        },
      },
    );
    console.log(`[Evals GET] Swarm response status: ${response.status}`);

    if (!response.ok) {
      console.warn(`[Evals GET] Swarm returned non-OK status: ${response.status}`);
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

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals POST] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }
    console.log(`[Evals POST] slug=${slug}, userId=${userOrResponse.id}`);
    console.log(`[Evals POST] Swarm access granted — swarmName=${swarmAccessResult.data.swarmName}, apiKey present=${!!swarmAccessResult.data.swarmApiKey}`);

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals POST] USE_MOCKS=true, routing to mock endpoint`);
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

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    console.log(`[Evals POST] Jarvis URL: ${jarvisUrl}`);

    const id = randomUUID();
    const result = await addNode(
      { jarvisUrl, apiKey: swarmApiKey },
      { node_type: "EvalSet", node_data: { id, name: name.trim(), description } },
    );
    console.log(`[Evals POST] addNode result: success=${result.success}, ref_id=${result.ref_id ?? 'n/a'}, error=${result.error ?? 'none'}`);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true, data: { ref_id: result.ref_id } });
  } catch (error) {
    console.error("[Evals] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

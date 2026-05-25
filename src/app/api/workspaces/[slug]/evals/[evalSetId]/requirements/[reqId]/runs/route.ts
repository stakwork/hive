import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addEdge } from "@/services/swarm/api/nodes";


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

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId: _evalSetId, reqId } = await params;

    const body = await request.json();
    const { session_ids } = body ?? {};

    if (!Array.isArray(session_ids) || session_ids.length === 0) {
      return NextResponse.json(
        { error: "session_ids must be a non-empty array" },
        { status: 400 },
      );
    }

    if (process.env.USE_MOCKS === "true") {
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${_evalSetId}/requirements/${reqId}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_ids }),
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
    const config = { jarvisUrl, apiKey: swarmApiKey };

    const results = await Promise.all(
      session_ids.map((session_id: string) =>
        addEdge(config, {
          edge: { edge_type: "EVAL_RUN" },
          source: { ref_id: reqId },
          target: { ref_id: session_id },
        }),
      ),
    );

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      return NextResponse.json(
        { error: `Failed to link ${failed.length} session(s)` },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, linked: session_ids.length });
  } catch (error) {
    console.error("[Evals/Runs] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

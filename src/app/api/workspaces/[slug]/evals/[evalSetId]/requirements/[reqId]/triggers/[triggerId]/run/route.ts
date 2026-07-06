import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { dispatchEvalTriggerRun, fetchTriggerSource } from "@/lib/evals/dispatch-eval-trigger-run";

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

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId, reqId, triggerId } = await params;
    console.log(`[Evals Trigger Run POST] slug=${slug}, evalSetId=${evalSetId}, reqId=${reqId}, triggerId=${triggerId}, userId=${userOrResponse.id}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Trigger Run POST] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Trigger Run POST] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements/${reqId}/triggers/${triggerId}/run`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey, swarmUrl, swarmSecretAlias, workspaceId } =
      swarmAccessResult.data;

    // Check env vars early so we can return a clear 400 before any external calls
    const evalWorkflowId = process.env.STAKWORK_EVAL_WORKFLOW_ID;
    if (!evalWorkflowId) {
      console.error("[Evals Trigger Run POST] STAKWORK_EVAL_WORKFLOW_ID is not set");
      return NextResponse.json(
        { error: "STAKWORK_EVAL_WORKFLOW_ID is not configured" },
        { status: 400 },
      );
    }
    if (!process.env.STAKWORK_API_KEY) {
      return NextResponse.json(
        { error: "STAKWORK_API_KEY is not configured" },
        { status: 400 },
      );
    }

    const jarvisUrl = getJarvisUrl(swarmName);

    // Fetch the EvalTrigger node to read the stored `source` discriminator.
    const { source: triggerSource, ok: triggerFetchOk } = await fetchTriggerSource(
      jarvisUrl,
      swarmApiKey,
      triggerId,
    );
    if (!triggerFetchOk) {
      console.error(`[Evals Trigger Run POST] Failed to fetch trigger node`);
      return NextResponse.json({ error: "Failed to fetch trigger node" }, { status: 502 });
    }

    console.log(`[Evals Trigger Run POST] swarmUrl set=${!!swarmUrl}, swarmSecretAlias set=${!!swarmSecretAlias}, source=${triggerSource}`);

    const result = await dispatchEvalTriggerRun({
      triggerId,
      reqId,
      evalSetId,
      workspaceSlug: slug,
      workspaceId,
      userId: userOrResponse.id,
      swarmName,
      swarmApiKey,
      swarmUrl: swarmUrl ?? "",
      swarmSecretAlias: swarmSecretAlias ?? null,
      triggerSource,
    });

    return NextResponse.json({ success: true, project_id: result.project_id });
  } catch (error) {
    console.error("[Evals/Trigger/Run] POST error:", error);
    if (error instanceof Error && error.message === "Failed to trigger eval workflow") {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

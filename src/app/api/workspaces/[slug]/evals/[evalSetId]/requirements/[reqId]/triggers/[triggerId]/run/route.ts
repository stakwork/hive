import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { getBaseUrl } from "@/lib/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";

type RouteParams = {
  params: Promise<{ slug: string; evalSetId: string; reqId: string; triggerId: string }>;
};

async function fetchEvalTriggerNodeData(
  jarvisConfig: { jarvisUrl: string; apiKey: string },
  triggerId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const url = `${jarvisConfig.jarvisUrl}/v2/nodes?type=EvalTrigger&ref_id=${encodeURIComponent(triggerId)}`;
    const res = await fetch(url, { headers: { "x-api-token": jarvisConfig.apiKey } });
    if (!res.ok) return null;
    const data = await res.json();
    const nodes: Array<{ node_data?: Record<string, unknown> }> = data?.nodes ?? [];
    return nodes[0]?.node_data ?? null;
  } catch {
    return null;
  }
}

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

    const evalWorkflowId = process.env.STAKWORK_EVAL_WORKFLOW_ID;
    if (!evalWorkflowId) {
      console.error("[Evals Trigger Run POST] STAKWORK_EVAL_WORKFLOW_ID is not set");
      return NextResponse.json(
        { error: "STAKWORK_EVAL_WORKFLOW_ID is not configured" },
        { status: 400 },
      );
    }

    const stakworkApiKey = process.env.STAKWORK_API_KEY;
    if (!stakworkApiKey) {
      return NextResponse.json(
        { error: "STAKWORK_API_KEY is not configured" },
        { status: 400 },
      );
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisConfig = { jarvisUrl: getJarvisUrl(swarmName), apiKey: swarmApiKey };

    // Fetch EvalTrigger node data to get prompt_version_id (non-fatal)
    const triggerNodeData = await fetchEvalTriggerNodeData(jarvisConfig, triggerId);
    const promptVersionId = (triggerNodeData?.prompt_version_id as string | undefined) ?? null;

    const stakworkBaseUrl =
      process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1";

    const baseUrl = getBaseUrl();
    const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?trigger_id=${triggerId}`;

    const vars = {
      triggerId,
      reqId,
      evalSetId,
      slug,
      tokenReference: getStakworkTokenReference(),
      sourceHiveUrl: baseUrl,
    };

    const stakworkPayload: Record<string, unknown> = {
      name: `hive-eval-trigger-${triggerId}`,
      workflow_id: parseInt(evalWorkflowId, 10),
      webhook_url: workflowWebhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    if (promptVersionId) {
      stakworkPayload.version_overrides = { [triggerId]: promptVersionId };
    }

    const stakworkRes = await fetch(`${stakworkBaseUrl}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token="${stakworkApiKey}"`,
      },
      body: JSON.stringify(stakworkPayload),
    });

    if (!stakworkRes.ok) {
      const text = await stakworkRes.text().catch(() => "");
      console.error(`[Evals Trigger Run POST] Stakwork error ${stakworkRes.status}: ${text}`);
      return NextResponse.json(
        { error: "Failed to trigger eval workflow" },
        { status: 502 },
      );
    }

    const stakworkData = await stakworkRes.json();
    const project_id = stakworkData?.project_id ?? stakworkData?.data?.project_id;

    return NextResponse.json({ success: true, project_id });
  } catch (error) {
    console.error("[Evals/Trigger/Run] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

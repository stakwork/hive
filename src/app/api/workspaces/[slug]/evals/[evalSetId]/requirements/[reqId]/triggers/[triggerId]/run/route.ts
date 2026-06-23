import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { getBaseUrl } from "@/lib/utils";
import { getJarvisUrl, transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import type { BifrostAgentName } from "@/services/bifrost/orchestrator";
import type { EvalTriggerSource } from "@/lib/utils/eval-source";

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

function buildReplayUrl(
  source: EvalTriggerSource,
  swarmUrl: string,
  hiveBaseUrl: string,
): string | null {
  if (source === "provider_direct") return null; // URL lives in body.prompt_snapshot.url on the node
  if (source === "repo_agent")
    return transformSwarmUrlToRepo2Graph(swarmUrl) + "/repo/agent";
  if (source === "jamie_agent")
    return hiveBaseUrl + "/api/ask/sync";
  return null;
}

const EVAL_BIFROST_AGENT: Partial<Record<EvalTriggerSource, BifrostAgentName>> = {
  repo_agent: "repo-agent",
  jamie_agent: "canvas-agent",
  // provider_direct: no Bifrost — direct provider URL is self-contained
};

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

    const stakworkBaseUrl =
      process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1";

    const baseUrl = getBaseUrl();
    const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?trigger_id=${triggerId}`;

    const { swarmName, swarmApiKey, swarmUrl, swarmSecretAlias, workspaceId } =
      swarmAccessResult.data;
    console.log(`[Evals Trigger Run POST] swarmUrl set=${!!swarmUrl}, swarmSecretAlias set=${!!swarmSecretAlias}`);

    // Fetch the EvalTrigger node to read the stored `source` discriminator.
    // Uses workspace-scoped Jarvis credentials — no cross-workspace access possible.
    const jarvisUrl = getJarvisUrl(swarmName);
    const triggerRes = await fetch(`${jarvisUrl}/node/${triggerId}`, {
      headers: { "x-api-token": swarmApiKey },
    });
    if (!triggerRes.ok) {
      console.error(`[Evals Trigger Run POST] Failed to fetch trigger node: ${triggerRes.status}`);
      return NextResponse.json({ error: "Failed to fetch trigger node" }, { status: 502 });
    }
    const triggerNode = await triggerRes.json();
    const triggerSource: EvalTriggerSource =
      triggerNode?.properties?.source ?? triggerNode?.source ?? "repo_agent";

    // Conditionally resolve Bifrost credentials for the triggering user.
    const bifrostAgentName = EVAL_BIFROST_AGENT[triggerSource];
    const bifrost = bifrostAgentName
      ? await getBifrostForLLM(
          { workspaceSlug: slug, workspaceId, userId: userOrResponse.id },
          { agentName: bifrostAgentName },
        )
      : undefined;

    const vars = {
      triggerId,
      reqId,
      evalSetId,
      slug,
      tokenReference: getStakworkTokenReference(),
      sourceHiveUrl: baseUrl,
      swarmUrl: swarmUrl ?? "",                  // KEPT — Stakwork uses this for node operations
      swarmSecretAlias: swarmSecretAlias ?? "",  // Bifrost VK alias
      source: triggerSource,                     // NEW
      replayUrl: buildReplayUrl(triggerSource, swarmUrl ?? "", baseUrl), // NEW (null for provider_direct)
      // Bifrost credentials — only present when enabled for this user + source:
      ...(bifrost
        ? {
            bifrostApiKey: bifrost.apiKey,
            bifrostBaseUrl: bifrost.baseUrl,
            bifrostHeaders: bifrost.headers,
          }
        : {}),
    };

    const stakworkPayload = {
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

/**
 * Shared helper for dispatching a single EvalTrigger run via Stakwork.
 *
 * Factored out of the workspace-scoped trigger run route so the gateway
 * proxy routes can reuse the same logic without duplicating it.
 */
import { getBaseUrl } from "@/lib/utils";
import { getJarvisUrl, transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import type { BifrostAgentName } from "@/services/bifrost/orchestrator";
import type { EvalTriggerSource } from "@/lib/utils/eval-source";

export interface DispatchEvalTriggerRunParams {
  /** Trigger node ref_id */
  triggerId: string;
  /** EvalRequirement ref_id */
  reqId: string;
  /** EvalSet ref_id */
  evalSetId: string;
  /** Workspace slug — used for Bifrost workspace gate */
  workspaceSlug: string;
  /** Workspace id — used for Bifrost VK resolution */
  workspaceId: string;
  /**
   * User id for Bifrost credential resolution.
   * Must be the real user/key-creator id — never "system" — because
   * getBifrostForLLM returns undefined when userId is missing/undefined,
   * which silently falls back to the swarm default key.
   */
  userId: string;
  /** Swarm name, used to build Jarvis URL */
  swarmName: string;
  /** Decrypted swarm API key */
  swarmApiKey: string;
  /** Swarm URL, forwarded in workflow vars for Stakwork downstream use */
  swarmUrl: string;
  /** Swarm secret alias for Bifrost VK */
  swarmSecretAlias: string | null;
  /** EvalTrigger source discriminator (resolved by the caller) */
  triggerSource: EvalTriggerSource;
}

export interface DispatchEvalTriggerRunResult {
  success: true;
  project_id: string | undefined;
}

const EVAL_BIFROST_AGENT: Partial<Record<EvalTriggerSource, BifrostAgentName>> = {
  repo_agent: "repo-agent",
  jamie_agent: "canvas-agent",
  // provider_direct: no Bifrost — direct provider URL is self-contained
};

function buildReplayUrl(
  source: EvalTriggerSource,
  swarmUrl: string,
  hiveBaseUrl: string,
): string | null {
  if (source === "provider_direct") return null;
  if (source === "repo_agent")
    return transformSwarmUrlToRepo2Graph(swarmUrl) + "/repo/agent";
  if (source === "jamie_agent")
    return hiveBaseUrl + "/api/ask/sync";
  return null;
}

/**
 * Dispatch a single EvalTrigger run via Stakwork /projects.
 *
 * @throws Error if the Stakwork call fails — callers should catch and surface as 502.
 */
export async function dispatchEvalTriggerRun(
  params: DispatchEvalTriggerRunParams,
): Promise<DispatchEvalTriggerRunResult> {
  const {
    triggerId,
    reqId,
    evalSetId,
    workspaceSlug,
    workspaceId,
    userId,
    swarmName,
    swarmApiKey,
    swarmUrl,
    swarmSecretAlias,
    triggerSource,
  } = params;

  const evalWorkflowId = process.env.STAKWORK_EVAL_WORKFLOW_ID;
  if (!evalWorkflowId) {
    throw new Error("STAKWORK_EVAL_WORKFLOW_ID is not configured");
  }

  const stakworkApiKey = process.env.STAKWORK_API_KEY;
  if (!stakworkApiKey) {
    throw new Error("STAKWORK_API_KEY is not configured");
  }

  const stakworkBaseUrl =
    process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1";

  const baseUrl = getBaseUrl();
  const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?trigger_id=${triggerId}`;
  const jarvisUrl = getJarvisUrl(swarmName);

  // Conditionally resolve Bifrost credentials for the triggering user.
  const bifrostAgentName = EVAL_BIFROST_AGENT[triggerSource];
  const bifrost = bifrostAgentName
    ? await getBifrostForLLM(
        { workspaceSlug, workspaceId, userId },
        { agentName: bifrostAgentName },
      )
    : undefined;

  const vars = {
    triggerId,
    reqId,
    evalSetId,
    slug: workspaceSlug,
    tokenReference: getStakworkTokenReference(),
    sourceHiveUrl: baseUrl,
    swarmUrl: swarmUrl ?? "",
    swarmSecretAlias: swarmSecretAlias ?? "",
    source: triggerSource,
    replayUrl: buildReplayUrl(triggerSource, swarmUrl ?? "", baseUrl),
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
    console.error(
      `[Evals dispatchEvalTriggerRun] Stakwork error ${stakworkRes.status}: ${text}`,
      { triggerId, workspaceId },
    );
    throw new Error("Failed to trigger eval workflow");
  }

  const stakworkData = await stakworkRes.json();
  const project_id = stakworkData?.project_id ?? stakworkData?.data?.project_id;

  return { success: true, project_id };
}

/**
 * Fetch the EvalTrigger node from Jarvis and return its `source` discriminator.
 * Returns "repo_agent" as a safe default if the node can't be fetched or has no source.
 *
 * Exported so gateway routes can reuse the same fetch pattern.
 */
export async function fetchTriggerSource(
  jarvisUrl: string,
  swarmApiKey: string,
  triggerId: string,
): Promise<{ source: EvalTriggerSource; ok: boolean }> {
  const triggerRes = await fetch(`${jarvisUrl}/node/${triggerId}`, {
    headers: { "x-api-token": swarmApiKey },
  });
  if (!triggerRes.ok) {
    return { source: "repo_agent", ok: false };
  }
  const triggerNode = await triggerRes.json();
  const source: EvalTriggerSource =
    triggerNode?.properties?.source ?? triggerNode?.source ?? "repo_agent";
  return { source, ok: true };
}

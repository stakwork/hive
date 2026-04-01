import { db } from "@/lib/db";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { stakworkService } from "@/lib/service-factory";
import { getBaseUrl } from "@/lib/utils";
import { config } from "@/config/env";
import { generateSignedUrl } from "@/lib/signed-urls";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";

const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * Trigger a Stakwork learning analysis workflow for a merged PR.
 *
 * Collects all AgentLog records associated with the given task IDs and/or
 * feature ID, generates HMAC-signed blob URLs, and dispatches a Stakwork
 * workflow that will write extracted learnings into the workspace Neo4j graph.
 *
 * Returns null (silently) when:
 * - STAKWORK_LEARNING_WORKFLOW_ID is not configured
 * - No agent logs are found for the supplied IDs
 */
export async function triggerLearningRun(input: {
  workspaceId: string;
  taskIds: string[];
  featureId?: string | null;
  prUrl: string;
}): Promise<{ runId: string; projectId: number | null } | null> {
  const { workspaceId, taskIds, featureId, prUrl } = input;

  // 1. Guard: workflow ID must be configured
  const workflowId = config.STAKWORK_LEARNING_WORKFLOW_ID;
  if (!workflowId) {
    console.warn(
      "[LearningRun] STAKWORK_LEARNING_WORKFLOW_ID is not set — skipping learning trigger",
      { workspaceId, prUrl }
    );
    return null;
  }

  // 2. Fetch workspace swarm (swarmUrl + swarmSecretAlias only — no swarmApiKey)
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      swarm: {
        select: {
          swarmUrl: true,
          swarmSecretAlias: true,
        },
      },
    },
  });

  const swarmUrl = workspace?.swarm?.swarmUrl ?? null;
  const swarmSecretAlias = workspace?.swarm?.swarmSecretAlias ?? null;

  // 3. Query AgentLog records by taskId OR featureId; deduplicate by id
  const orConditions: Array<Record<string, unknown>> = [];
  if (taskIds.length > 0) {
    orConditions.push({ taskId: { in: taskIds } });
  }
  if (featureId) {
    orConditions.push({ featureId });
  }

  const rawLogs =
    orConditions.length > 0
      ? await db.agentLog.findMany({
          where: { OR: orConditions },
          select: { id: true, agent: true, blobUrl: true },
        })
      : [];

  // Deduplicate by id
  const seen = new Set<string>();
  const logs = rawLogs.filter((log) => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });

  // 4. Nothing to analyse — skip silently
  if (logs.length === 0) {
    console.log(
      "[LearningRun] No agent logs found — skipping learning trigger",
      { workspaceId, prUrl, taskIds, featureId }
    );
    return null;
  }

  // 5. Generate signed URLs for each log
  const baseUrl = getBaseUrl();
  const agentLogs = logs.map((log) => ({
    id: log.id,
    agent: log.agent,
    url: generateSignedUrl(baseUrl, `/api/agent-logs/${log.id}/content`, SIGNED_URL_EXPIRY_SECONDS),
  }));

  // 6. Build webhook URL and create StakworkRun record
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=LEARNING&workspace_id=${workspaceId}`;

  const run = await db.stakworkRun.create({
    data: {
      type: StakworkRunType.LEARNING,
      workspaceId,
      ...(featureId ? { featureId } : {}),
      status: WorkflowStatus.PENDING,
      webhookUrl,
    },
  });

  // 7. Build and dispatch the Stakwork payload
  try {
    const stakworkPayload = {
      name: `learning-run-${workspaceId}-${Date.now()}`,
      workflow_id: parseInt(workflowId, 10),
      webhook_url: webhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              runId: run.id,
              workspaceId,
              featureId: featureId ?? null,
              prUrl,
              agentLogs,
              swarmUrl,
              swarmSecretAlias,
              tokenReference: getStakworkTokenReference(),
              webhookUrl,
            },
          },
        },
      },
    };

    // 8. Call Stakwork
    const response = await stakworkService().stakworkRequest<{
      success: boolean;
      data: { project_id: number };
    }>("/projects", stakworkPayload);

    const projectId = response?.data?.project_id;

    // 9. Update run to IN_PROGRESS with projectId
    await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        projectId,
        status: WorkflowStatus.IN_PROGRESS,
      },
    });

    return { runId: run.id, projectId: projectId ?? null };
  } catch (error) {
    await db.stakworkRun.update({
      where: { id: run.id },
      data: { status: WorkflowStatus.FAILED },
    });
    throw error;
  }
}

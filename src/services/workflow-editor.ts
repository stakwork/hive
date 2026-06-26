/**
 * Reusable workflow-editor service.
 * Extracted from /api/workflow-editor/route.ts so that internal callers
 * (e.g. assign-all, createTicket) don't have to make HTTP self-calls.
 */
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { WorkflowStatus, TaskStatus, StakworkRunType } from "@prisma/client";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { fetchChatHistory } from "@/lib/helpers/chat-history";
import { getWorkflowJsonFromNode } from "@/lib/workflow/get-workflow-json-from-node";
import { resolveExtraSwarms } from "@/services/roadmap/feature-chat";

/**
 * Fetch the latest workflow JSON from the graph API for a given workflow ID.
 * Used to capture a baseline snapshot at run-start time so the Changes tab
 * can compute a diff after the agent edits the workflow.
 * Non-fatal: returns null if env vars are missing or the fetch fails.
 */
export async function fetchLatestWorkflowJson(workflowId: number | null): Promise<string | null> {
  if (workflowId === null) return null;
  const graphApiUrl = process.env.STAKWORK_JARVIS_URL;
  const graphApiKey = process.env.STAKWORK_GRAPH_API_KEY;
  if (!graphApiUrl || !graphApiKey) return null;
  try {
    const res = await fetch(`${graphApiUrl}/api/graph/search/attributes`, {
      method: "POST",
      headers: { "x-api-token": graphApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        node_type: ["Workflow_version"],
        include_properties: true,
        limit: 50,
        skip: 0,
        skip_cache: true,
        search_filters: [
          { attribute: "workflow_id", value: workflowId, comparator: "=" },
          { attribute: "published", value: true, comparator: "=" },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const nodes: any[] = data.nodes ?? data.data ?? [];
    // Sort descending client-side — same pattern as versions route
    nodes.sort(
      (a, b) => (b.properties?.workflow_version_id ?? 0) - (a.properties?.workflow_version_id ?? 0)
    );
    const latestJson = getWorkflowJsonFromNode(nodes[0]);
    if (!latestJson) return null;
    return latestJson;
  } catch {
    return null;
  }
}

/**
 * Builds a FeatureContext payload for a workflow editor run, selecting
 * all tasks across all phases (no phase filter). Best-effort: returns
 * null if featureId is not found or any DB error occurs.
 */
export async function buildWorkflowEditorFeatureContext(
  featureId: string
): Promise<object | null> {
  try {
    const feature = await db.feature.findFirst({
      where: { id: featureId },
      select: {
        id: true,
        title: true,
        brief: true,
        requirements: true,
        architecture: true,
        userStories: {
          orderBy: { order: "asc" },
          select: { title: true },
        },
        workspace: {
          select: {
            repositories: {
              select: { id: true, name: true, repositoryUrl: true, branch: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        phases: {
          select: {
            tasks: {
              where: { deleted: false },
              orderBy: { order: "asc" },
              select: { id: true, title: true, description: true, status: true, summary: true },
            },
          },
        },
      },
    });

    if (!feature) return null;

    const allTickets = feature.phases.flatMap((p) => p.tasks);

    return {
      feature: {
        id: feature.id,
        title: feature.title,
        brief: feature.brief,
        userStories: feature.userStories.map((us) => us.title),
        requirements: feature.requirements,
        architecture: feature.architecture,
      },
      workspaceRepositories: (feature.workspace?.repositories ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        repositoryUrl: r.repositoryUrl,
        branch: r.branch,
      })),
      currentPhase: {
        name: "All Tasks",
        description: null,
        tickets: allTickets,
      },
    };
  } catch {
    return null;
  }
}

interface WorkflowTaskContext {
  workflowId: number | null;
  workflowName?: string | null;
  workflowRefId?: string | null;
  workflowVersionId?: string | null;
}

/**
 * Seed an initial WORKFLOW-type assistant message + artifact for a newly
 * created workflow-editor task.  Mirrors the artifact shape written by
 * `/api/workflow-editor/route.ts` after a successful Stakwork call.
 */
export async function saveWorkflowArtifact(
  taskId: string,
  workflowContext: WorkflowTaskContext
): Promise<void> {
  const { workflowId, workflowName, workflowRefId } = workflowContext;

  try {
    const newMessage = await db.chatMessage.create({
      data: {
        taskId,
        message: "",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        contextTags: JSON.stringify([]),
        artifacts: {
          create: [
            {
              type: ArtifactType.WORKFLOW,
              content: {
                workflowId: workflowId ?? null,
                workflowName: workflowName || (workflowId ? `Workflow ${workflowId}` : "New Workflow"),
                workflowRefId: workflowRefId || "",
                originalWorkflowJson: "",
              },
            },
          ],
        },
      },
      include: { artifacts: true },
    });

    // Notify frontend via Pusher
    const channelName = getTaskChannelName(taskId);
    await pusherServer.trigger(channelName, PUSHER_EVENTS.NEW_MESSAGE, newMessage.id);
  } catch (error) {
    console.error("[saveWorkflowArtifact] Failed to seed WORKFLOW artifact:", error);
    // Non-fatal — task already exists, artifact can be added later
  }
}

/**
 * Trigger a Stakwork workflow-editor run for an existing task.
 * Replicates the Stakwork payload build + API call + status update that
 * was previously inline in `/api/workflow-editor/route.ts`.
 */
export async function triggerWorkflowEditorRun(params: {
  taskId: string;
  workflowTask: WorkflowTaskContext;
  message: string;
  userId: string;
}): Promise<void> {
  const { taskId, workflowTask, message, userId } = params;
  const { workflowId, workflowName, workflowRefId, workflowVersionId } = workflowTask;

  if (!config.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID) {
    throw new Error("Workflow editor is not configured (STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID missing)");
  }

  // Fetch task with workspace + swarm details, and confirm userId is a workspace member
  const task = await db.task.findFirst({
    where: { id: taskId, deleted: false },
    select: {
      workspaceId: true,
      featureId: true,
      autoMerge: true,
      workspace: {
        select: {
          slug: true,
          ownerId: true,
          members: {
            where: { userId },
            select: { role: true },
          },
          swarm: {
            select: {
              swarmUrl: true,
              swarmSecretAlias: true,
              poolName: true,
              name: true,
              id: true,
            },
          },
        },
      },
    },
  });

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  // Authorization: caller must be workspace owner or member before any credential/secret access
  const isOwner = task.workspace.ownerId === userId;
  const isMember = task.workspace.members.length > 0;
  if (!isOwner && !isMember) {
    throw new Error(`Access denied to task ${taskId}`);
  }

  // Create the USER chat message
  const chatMessage = await db.chatMessage.create({
    data: {
      taskId,
      message,
      role: ChatRole.USER,
      contextTags: JSON.stringify([]),
      status: ChatStatus.SENT,
    },
  });

  // Fetch history excluding the message just created
  const history = await fetchChatHistory(taskId, chatMessage.id);

  // GitHub credentials
  const githubProfile = await getGithubUsernameAndPAT(userId, task.workspace.slug);
  const userName = githubProfile?.username || null;
  const accessToken = githubProfile?.token || null;

  // Swarm details
  const swarm = task.workspace.swarm;
  const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";
  const swarmSecretAlias = swarm?.swarmSecretAlias || null;
  const poolName = swarm?.id || null;
  const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);

  // Webhook URLs
  const appBaseUrl = getBaseUrl();
  const webhookUrl = `${appBaseUrl}/api/chat/response`;
  const workflowWebhookUrl = `${appBaseUrl}/api/stakwork/webhook?task_id=${taskId}`;

  const vars: Record<string, unknown> = {
    taskId,
    message,
    webhookUrl,
    workflow_id: workflowId,
    workflow_name: workflowName,
    workflow_ref_id: workflowRefId,
    // No stepName/stepUniqueId/stepDisplayName/stepType/stepData — optional in route
    history,
    alias: userName,
    username: userName,
    accessToken,
    swarmUrl,
    swarmSecretAlias,
    poolName,
    repo2graph_url: repo2GraphUrl,
    workspaceId: task.workspaceId,
    tokenReference: getStakworkTokenReference(),
  };

  if (task.featureId) {
    vars.featureId = task.featureId;
    const featureContext = await buildWorkflowEditorFeatureContext(task.featureId);
    if (featureContext) {
      vars.featureContext = featureContext;
    }
  }

  if (workflowVersionId) {
    vars.workflow_version_id = workflowVersionId;
  }

  vars.autoMergePr = task.autoMerge;

  // Resolve @mentioned workspaces as sub-agents and attach to vars
  const extraSwarms = await resolveExtraSwarms(message, userId);
  if (extraSwarms.length) {
    (vars as Record<string, unknown>).subAgents = extraSwarms;
    console.log("[triggerWorkflowEditorRun] forwarding subAgents:", extraSwarms.map((a) => a.name));
  }

  const stakworkPayload = {
    name: `workflow_editor - ${taskId}`,
    workflow_id: parseInt(config.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID),
    webhook_url: workflowWebhookUrl,
    workflow_params: {
      set_var: {
        attributes: { vars },
      },
    },
  };

  const stakworkURL = `${config.STAKWORK_BASE_URL}/projects`;

  const response = await fetch(stakworkURL, {
    method: "POST",
    body: JSON.stringify(stakworkPayload),
    headers: {
      Authorization: `Token token=${config.STAKWORK_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    await db.task.update({
      where: { id: taskId },
      data: { workflowStatus: WorkflowStatus.FAILED },
    });
    throw new Error(`Stakwork call failed: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.success) {
    const updateData: {
      workflowStatus: WorkflowStatus;
      workflowStartedAt: Date;
      haltRetryAttempted: boolean;
      status: TaskStatus;
      stakworkProjectId?: number;
    } = {
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      workflowStartedAt: new Date(),
      haltRetryAttempted: false,
      status: TaskStatus.IN_PROGRESS,
    };

    if (result.data?.project_id) {
      updateData.stakworkProjectId = result.data.project_id;
    }

    await db.task.update({ where: { id: taskId }, data: updateData });

    // Seed a WORKFLOW artifact so the task page can poll the project
    if (result.data?.project_id) {
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.WORKFLOW_EDITOR,
          taskId,
          featureId: task.featureId ?? null,
          workspaceId: task.workspaceId,
          projectId: result.data.project_id,
          status: WorkflowStatus.IN_PROGRESS,
          webhookUrl: workflowWebhookUrl,
        },
      });

      try {
        // Fetch live baseline at run-start time (agent hasn't touched workflow yet)
        const baselineWorkflowJson = await fetchLatestWorkflowJson(workflowId);

        const newMessage = await db.chatMessage.create({
          data: {
            taskId,
            message: "",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
            artifacts: {
              create: [
                {
                  type: ArtifactType.WORKFLOW,
                  content: {
                    projectId: result.data.project_id.toString(),
                    workflowId: workflowId ?? null,
                    workflowName: workflowName || (workflowId ? `Workflow ${workflowId}` : "New Workflow"),
                    workflowRefId: workflowRefId || "",
                    originalWorkflowJson: "",
                    ...(baselineWorkflowJson ? { workflowJson: baselineWorkflowJson } : {}),
                  },
                },
              ],
            },
          },
          include: { artifacts: true },
        });

        const channelName = getTaskChannelName(taskId);
        await pusherServer.trigger(channelName, PUSHER_EVENTS.NEW_MESSAGE, newMessage.id);
      } catch (artifactError) {
        console.error("[triggerWorkflowEditorRun] Error creating WORKFLOW artifact:", artifactError);
      }
    }
  } else {
    await db.task.update({
      where: { id: taskId },
      data: { workflowStatus: WorkflowStatus.FAILED },
    });
    throw new Error("Stakwork returned success: false");
  }
}

/**
 * Reusable workflow-editor service.
 * Extracted from /api/workflow-editor/route.ts so that internal callers
 * (e.g. assign-all, createTicket) don't have to make HTTP self-calls.
 */
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { WorkflowStatus } from "@prisma/client";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { fetchChatHistory } from "@/lib/helpers/chat-history";

interface WorkflowTaskContext {
  workflowId: number;
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
                workflowId: workflowId,
                workflowName: workflowName || `Workflow ${workflowId}`,
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

  if (workflowVersionId) {
    vars.workflow_version_id = workflowVersionId;
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
      stakworkProjectId?: number;
    } = {
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      workflowStartedAt: new Date(),
      haltRetryAttempted: false,
    };

    if (result.data?.project_id) {
      updateData.stakworkProjectId = result.data.project_id;
    }

    await db.task.update({ where: { id: taskId }, data: updateData });

    // Seed a WORKFLOW artifact so the task page can poll the project
    if (result.data?.project_id) {
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
                    projectId: result.data.project_id.toString(),
                    workflowId: workflowId,
                    workflowName: workflowName || `Workflow ${workflowId}`,
                    workflowRefId: workflowRefId || "",
                    originalWorkflowJson: "",
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

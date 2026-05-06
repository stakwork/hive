import { db } from "@/lib/db";
import { WorkflowStatus, ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
import { config } from "@/config/env";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { getBaseUrl } from "@/lib/utils";
import { WorkflowContent } from "@/lib/chat";
import { fetchChatHistory } from "@/lib/helpers/chat-history";

interface WorkflowContext {
  workflowId: string | number;
  workflowName: string;
  workflowRefId: string;
  workflowVersionId?: string;
  projectId?: string;
}

/**
 * Core execution logic for retrying a workflow_editor task.
 * Recovers workflow context from DB artifacts, finds the last USER message,
 * calls Stakwork, updates the task to IN_PROGRESS, creates a WORKFLOW artifact,
 * and triggers Pusher.
 *
 * Returns `true` on success, `false` on any failure (no context, no user message,
 * Stakwork error, etc.).
 *
 * Does NOT check or modify `haltRetryAttempted` — that guard lives in
 * `retryWorkflowEditorTask` (auto-retry path only).
 */
export async function executeWorkflowEditorRetry(
  taskId: string,
  userId: string,
): Promise<boolean> {
  // Fetch task with all data needed to reconstruct the workflow context
  const task = await db.task.findFirst({
    where: { id: taskId, deleted: false },
    select: {
      id: true,
      createdById: true,
      workspaceId: true,
      workspace: {
        select: {
          slug: true,
          ownerId: true,
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
      chatMessages: {
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          message: true,
          artifacts: {
            select: {
              type: true,
              content: true,
            },
          },
        },
      },
    },
  });

  if (!task) return false;

  // Recover workflow context by scanning WORKFLOW artifacts oldest→newest (last match wins)
  const workflowContext = recoverWorkflowContext(task.chatMessages);
  if (!workflowContext) return false;

  // Recover last USER message text
  const lastUserMessage = [...task.chatMessages]
    .reverse()
    .find((m) => m.role === ChatRole.USER);

  if (!lastUserMessage?.message) return false;

  try {
    // Get GitHub credentials using the task creator
    const githubProfile = await getGithubUsernameAndPAT(task.createdById, task.workspace.slug);
    const userName = githubProfile?.username ?? null;
    const accessToken = githubProfile?.token ?? null;

    // Get swarm details
    const swarm = task.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";
    const swarmSecretAlias = swarm?.swarmSecretAlias ?? null;
    const poolName = swarm?.id ?? null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);

    // Build webhook URLs
    const appBaseUrl = getBaseUrl();
    const webhookUrl = `${appBaseUrl}/api/chat/response`;
    const workflowWebhookUrl = `${appBaseUrl}/api/stakwork/webhook?task_id=${taskId}`;

    // Fetch full chat history (excluding the new user message)
    const history = await fetchChatHistory(taskId);

    const vars = {
      taskId,
      message: lastUserMessage.message,
      webhookUrl,

      workflow_id: workflowContext.workflowId,
      workflow_name: workflowContext.workflowName,
      workflow_ref_id: workflowContext.workflowRefId,

      ...(workflowContext.workflowVersionId && {
        workflow_version_id: workflowContext.workflowVersionId,
      }),

      // No step-specific context on retry — send empty values
      workflow_step_name: "",
      step_unique_id: "",
      step_display_name: "",
      step_type: "",
      step_data: {},

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

    const stakworkPayload = {
      name: "workflow_editor_retry",
      workflow_id: parseInt(config.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID!),
      webhook_url: workflowWebhookUrl,
      workflow_params: {
        set_var: {
          attributes: { vars },
        },
      },
    };

    const response = await fetch(`${config.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return false;
    }

    const result = await response.json();

    if (!result.success) {
      return false;
    }

    // Retry succeeded — reset task to IN_PROGRESS and clear the halt-retry flag
    await db.task.update({
      where: { id: taskId },
      data: {
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: new Date(),
        ...(result.data?.project_id && { stakworkProjectId: result.data.project_id }),
      },
    });

    // Create an assistant WORKFLOW artifact message so the frontend can resume polling
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
                projectId: result.data?.project_id?.toString() ?? workflowContext.projectId ?? "",
                workflowId: workflowContext.workflowId,
                workflowName: workflowContext.workflowName,
                workflowRefId: workflowContext.workflowRefId,
              } satisfies WorkflowContent,
            },
          ],
        },
      },
    });

    // Notify frontend via Pusher
    try {
      await pusherServer.trigger(
        getTaskChannelName(taskId),
        PUSHER_EVENTS.NEW_MESSAGE,
        newMessage.id,
      );
    } catch (pusherError) {
      // Non-fatal; frontend will catch up on next poll
      console.error("[workflow-editor-retry] Pusher trigger failed:", pusherError);
    }

    return true;
  } catch (error) {
    console.error("[workflow-editor-retry] Unexpected error during retry:", error);
    return false;
  }
}

/**
 * Attempts an automatic single retry for a workflow_editor task that has entered a terminal state.
 *
 * Returns `true` if a retry was successfully fired (task stays IN_PROGRESS, Pusher notified).
 * Returns `false` if the retry was skipped (wrong mode, already retried, no context) or failed
 * (Stakwork API error) — caller should proceed with the normal terminal-state flow.
 */
export async function retryWorkflowEditorTask(taskId: string): Promise<boolean> {
  // Fetch task with minimal fields needed for guard checks
  const task = await db.task.findFirst({
    where: { id: taskId, deleted: false },
    select: {
      id: true,
      mode: true,
      haltRetryAttempted: true,
      createdById: true,
    },
  });

  if (!task) return false;

  // Only retry workflow_editor tasks that haven't already been retried
  if (task.mode !== "workflow_editor") return false;
  if (task.haltRetryAttempted) return false;

  // Set haltRetryAttempted = true BEFORE calling Stakwork (race-condition guard)
  await db.task.update({
    where: { id: taskId },
    data: { haltRetryAttempted: true },
  });

  return executeWorkflowEditorRetry(taskId, task.createdById);
}

/**
 * Scans all WORKFLOW artifacts in chat history oldest→newest.
 * Last match wins (mirrors the frontend restore logic in page.tsx).
 */
function recoverWorkflowContext(
  chatMessages: Array<{
    role: string;
    artifacts: Array<{ type: string; content: unknown }>;
  }>,
): WorkflowContext | null {
  let ctx: WorkflowContext | null = null;

  for (const msg of chatMessages) {
    for (const artifact of msg.artifacts) {
      if (artifact.type !== "WORKFLOW") continue;

      const content = artifact.content as WorkflowContent | null;
      if (!content?.workflowId) continue;

      // Capture previous versionId before overwriting ctx (last match wins)
      const prevVersionId: string | undefined = ctx != null ? ctx.workflowVersionId : undefined;

      const next: WorkflowContext = {
        workflowId: content.workflowId,
        workflowName: content.workflowName ?? `Workflow ${content.workflowId}`,
        workflowRefId: content.workflowRefId ?? "",
        workflowVersionId:
          content.workflowVersionId != null
            ? String(content.workflowVersionId)
            : prevVersionId,
        projectId: content.projectId,
      };
      ctx = next;
    }
  }

  // A workflowRefId is required to call the workflow editor
  if (!ctx?.workflowRefId) return null;

  return ctx;
}

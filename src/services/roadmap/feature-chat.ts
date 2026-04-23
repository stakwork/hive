import { db } from "@/lib/db";
import { config } from "@/config/env";
import { getS3Service } from "@/services/s3";
import {
  ChatRole,
  ChatStatus,
  ArtifactType,
  WorkflowStatus,
} from "@/lib/chat";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { EncryptionService } from "@/lib/encryption";
import { callStakworkAPI } from "@/services/task-workflow";
import { buildFeatureContext } from "@/services/task-coordinator";
import {
  pusherServer,
  getFeatureChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { joinRepoUrls } from "@/lib/helpers/repository";

/**
 * Fetch chat history for a feature, excluding a specific message.
 */
export async function fetchFeatureChatHistory(
  featureId: string,
  excludeMessageId: string,
): Promise<Record<string, unknown>[]> {
  const chatHistory = await db.chatMessage.findMany({
    where: {
      featureId,
      id: { not: excludeMessageId },
    },
    include: {
      artifacts: {
        where: {
          type: ArtifactType.PLAN,
        },
      },
      attachments: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return chatHistory.map((msg) => ({
    id: msg.id,
    message: msg.message,
    role: msg.role,
    status: msg.status,
    timestamp: msg.createdAt.toISOString(),
    contextTags: msg.contextTags ? JSON.parse(msg.contextTags as string) : [],
    artifacts: msg.artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      content: artifact.content,
      icon: artifact.icon,
    })),
    attachments:
      msg.attachments?.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        path: attachment.path,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })) || [],
  }));
}

const FEATURE_SELECT_FOR_CHAT = {
  id: true,
  planUpdatedAt: true,
  workspaceId: true,
  phases: {
    where: { order: 0 },
    take: 1,
    select: { id: true },
  },
  workspace: {
    select: {
      slug: true,
      ownerId: true,
      swarm: {
        select: {
          swarmUrl: true,
          swarmSecretAlias: true,
          poolName: true,
          id: true,
        },
      },
      members: {
        select: {
          userId: true,
          role: true,
        },
      },
      repositories: {
        orderBy: { createdAt: "asc" as const },
        select: {
          name: true,
          repositoryUrl: true,
          branch: true,
        },
      },
    },
  },
} as const;

/**
 * Parse @workspace-slug mentions from a message, resolve each to swarm
 * credentials, and return them as extraSwarms for the Stakwork workflow.
 * Silently skips slugs that are not accessible, have no swarm, or have no repos.
 */
interface SubAgent {
  name: string,
  url: string;
  apiKey: string;
  repoUrls: string;
  toolsConfig?: Record<string, string | boolean>;
}

export async function resolveExtraSwarms(
  message: string,
  userId: string,
): Promise<SubAgent[]> {
  const slugMatches = [...message.matchAll(/\B@([\w-]+)/g)];
  const uniqueSlugs = [...new Set(slugMatches.map((m) => m[1]))];

  const encryptionService = EncryptionService.getInstance();
  const results: SubAgent[] = [];

  for (const slug of uniqueSlugs) {
    try {
      const workspace = await db.workspace.findFirst({
        where: {
          slug,
          deleted: false,
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
        include: {
          swarm: true,
          repositories: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!workspace?.swarm?.swarmUrl || !workspace.repositories.length) {
        continue;
      }

      const { swarm, repositories } = workspace;
      const url = transformSwarmUrlToRepo2Graph(swarm.swarmUrl);
      const apiKey = encryptionService.decryptField(
        "swarmApiKey",
        swarm.swarmApiKey ?? "",
      );
      const repoUrls = repositories
        .map((r) => r.repositoryUrl)
        .join(",");

      results.push({ name: slug, url, apiKey, repoUrls, toolsConfig: { learn_concepts: true } });
    } catch {
      // Silently skip any workspace that fails to resolve
    }
  }

  return results;
}

/**
 * Send a message in a feature-level conversation and trigger the Stakwork
 * planning workflow. Shared by both the API route and MCP tool.
 */
export async function sendFeatureChatMessage({
  featureId,
  userId,
  message,
  contextTags = [],
  sourceWebsocketID,
  webhook,
  replyId,
  history: bodyHistory,
  isPrototype,
  attachments,
  model,
}: {
  featureId: string;
  userId: string;
  message: string;
  contextTags?: { type: string; id: string }[];
  sourceWebsocketID?: string;
  webhook?: string;
  replyId?: string;
  history?: Record<string, unknown>[];
  isPrototype?: boolean;
  attachments?: Array<{ path: string; filename: string; mimeType: string; size: number }>;
  model?: string;
}) {
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      ...FEATURE_SELECT_FOR_CHAT,
      workflowStatus: true,
      model: true,
    },
  });

  if (!feature) {
    throw new Error("Feature not found");
  }

  // Prevent sending while the planning workflow is already running
  if (feature.workflowStatus === "IN_PROGRESS") {
    throw new Error("A planning workflow is already running for this feature");
  }

  // Create the chat message linked to feature (no task)
  const chatMessage = await db.chatMessage.create({
    data: {
      featureId,
      message,
      role: ChatRole.USER,
      userId,
      contextTags: JSON.stringify(contextTags),
      status: ChatStatus.SENT,
      sourceWebsocketID,
      replyId,
      attachments: {
        create: (attachments ?? []).map((a) => ({
          path: a.path,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      },
    },
    include: {
      artifacts: true,
      attachments: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  // Broadcast user message to other connected clients
  try {
    await pusherServer.trigger(
      getFeatureChannelName(featureId),
      PUSHER_EVENTS.NEW_MESSAGE,
      chatMessage.id,
      sourceWebsocketID ? { socket_id: sourceWebsocketID } : {},
    );
  } catch (error) {
    console.error(
      "Error broadcasting user message to Pusher (feature):",
      error,
    );
  }

  // Call Stakwork workflow
  const useStakwork =
    config.STAKWORK_API_KEY &&
    config.STAKWORK_BASE_URL &&
    config.STAKWORK_WORKFLOW_ID;
  let stakworkData = null;

  if (useStakwork) {
    const githubProfile = await getGithubUsernameAndPAT(
      userId,
      feature.workspace.slug,
    );
    const userName = githubProfile?.username || null;
    const accessToken = githubProfile?.token || null;
    const swarm = feature.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl
      ? swarm.swarmUrl.replace("/api", ":8444/api")
      : "";
    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.id || null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);
    const repos = feature.workspace.repositories ?? [];
    const repoUrl = joinRepoUrls(repos);
    const baseBranch = repos[0]?.branch || null;
    const repoName = repos[0]?.name || null;

    const dbHistory = await fetchFeatureChatHistory(
      featureId,
      chatMessage.id,
    );

    // Drop failed exchanges: keep USER+ASSISTANT pairs only when
    // the ASSISTANT has a PLAN artifact (i.e. Stakwork responded successfully).
    const filteredHistory = dbHistory.filter((msg, idx) => {
      if (msg.role === "ASSISTANT") {
        const artifacts = msg.artifacts as { type: string }[];
        return artifacts.length > 0;
      }
      if (msg.role === "USER") {
        const next = dbHistory[idx + 1];
        if (!next || next.role !== "ASSISTANT") return false;
        const artifacts = next.artifacts as { type: string }[];
        return artifacts.length > 0;
      }
      return true;
    });

    const isFirstMessage = filteredHistory.length === 0;
    const mergedHistory = [...filteredHistory, ...(bodyHistory ?? [])];

    // Build feature context using the auto-created Phase 1
    let featureContext = undefined;
    const phase = feature.phases?.[0];
    if (phase) {
      try {
        featureContext = await buildFeatureContext(featureId, phase.id);
      } catch (error) {
        console.error("Error building feature context:", error);
      }
    }

    // Detect if user has manually edited plan fields since last AI update
    const lastPlanArtifact = await db.artifact.findFirst({
      where: {
        type: ArtifactType.PLAN,
        message: { featureId },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const planEdited =
      lastPlanArtifact && feature.planUpdatedAt
        ? feature.planUpdatedAt > lastPlanArtifact.createdAt
        : false;

    const extraSwarms = await resolveExtraSwarms(message, userId);

    // Generate presigned download URLs for any attachments
    const attachmentUrls = await Promise.all(
      (attachments ?? []).map((a) => getS3Service().generatePresignedDownloadUrl(a.path)),
    );

    stakworkData = await callStakworkAPI({
      taskId: featureId,
      message,
      contextTags,
      userName,
      accessToken,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2GraphUrl,
      mode: "plan_mode",
      workspaceId: feature.workspaceId,
      repoUrl,
      baseBranch,
      repoName,
      history: mergedHistory,
      webhook,
      featureId,
      featureContext,
      planEdited,
      isPrototype: isPrototype && isFirstMessage,
      subAgents: extraSwarms,
      attachments: attachmentUrls,
      taskModel: feature.model || model || undefined,
    });

    // Only update workflow status when Stakwork confirms a project was created
    if (stakworkData?.projectId) {
      await db.feature.update({
        where: { id: featureId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: new Date(),
          stakworkProjectId: stakworkData.projectId,
        },
      });

      await pusherServer.trigger(
        getFeatureChannelName(featureId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        { taskId: featureId, workflowStatus: WorkflowStatus.IN_PROGRESS },
      );
    }
    // All other cases (network error, non-2xx, body-level failure, missing project_id):
    // no-op — leave workflowStatus unchanged
  }

  return { chatMessage, stakworkData };
}

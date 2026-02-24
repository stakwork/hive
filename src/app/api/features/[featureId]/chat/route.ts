import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus, ArtifactType, WorkflowStatus, type ContextTag, type Artifact } from "@/lib/chat";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { callStakworkAPI } from "@/services/task-workflow";
import { buildFeatureContext } from "@/services/task-coordinator";
import { pusherServer, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

async function fetchFeatureChatHistory(
  featureId: string,
  excludeMessageId: string,
): Promise<Record<string, unknown>[]> {
  const chatHistory = await db.chatMessage.findMany({
    where: {
      featureId,
      id: { not: excludeMessageId },
    },
    include: {
      artifacts: true,
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

/**
 * GET /api/features/[featureId]/chat
 * Load existing chat messages for a feature
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const userOrResponse = await requireAuthOrApiToken(request, feature.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const messages = await db.chatMessage.findMany({
      where: { featureId },
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
      orderBy: { createdAt: "asc" },
    });

    const clientMessages = messages.map((msg) => ({
      ...msg,
      createdBy: msg.createdBy || undefined,
      contextTags: JSON.parse(msg.contextTags as string) as ContextTag[],
      artifacts: msg.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    }));

    return NextResponse.json({ success: true, data: clientMessages }, { status: 200 });
  } catch (error) {
    console.error("Error fetching feature chat messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * POST /api/features/[featureId]/chat
 * Send a message in a feature-level conversation, triggers Stakwork workflow
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        updatedAt: true,
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
              take: 1,
              orderBy: { createdAt: "asc" },
              select: {
                name: true,
                repositoryUrl: true,
                branch: true,
              },
            },
          },
        },
      },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const userOrResponse = await requireAuthOrApiToken(request, feature.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { message, contextTags = [], sourceWebsocketID, webhook } = body;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Create the chat message linked to feature (no task)
    const chatMessage = await db.chatMessage.create({
      data: {
        featureId,
        message,
        role: ChatRole.USER,
        userId: userOrResponse.id,
        contextTags: JSON.stringify(contextTags),
        status: ChatStatus.SENT,
        sourceWebsocketID,
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

    const clientMessage = {
      ...chatMessage,
      createdBy: chatMessage.createdBy || undefined,
      contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    };

    // Call Stakwork workflow
    const useStakwork = config.STAKWORK_API_KEY && config.STAKWORK_BASE_URL && config.STAKWORK_WORKFLOW_ID;
    let stakworkData = null;

    if (useStakwork) {
      const githubProfile = await getGithubUsernameAndPAT(
        userOrResponse.id,
        feature.workspace.slug,
      );
      const userName = githubProfile?.username || null;
      const accessToken = githubProfile?.token || null;
      const swarm = feature.workspace.swarm;
      const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";
      const swarmSecretAlias = swarm?.swarmSecretAlias || null;
      const poolName = swarm?.id || null;
      const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);
      const repoUrl = feature.workspace.repositories?.[0]?.repositoryUrl || null;
      const baseBranch = feature.workspace.repositories?.[0]?.branch || null;
      const repoName = feature.workspace.repositories?.[0]?.name || null;

      const history = await fetchFeatureChatHistory(featureId, chatMessage.id);

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
      const planEdited = lastPlanArtifact
        ? feature.updatedAt > lastPlanArtifact.createdAt
        : false;

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
        history,
        webhook,
        featureId,
        featureContext,
        planEdited,
      });

      // Set workflow status to IN_PROGRESS as soon as Stakwork is called
      const updateData: Record<string, unknown> = {
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: new Date(),
      };
      if (stakworkData?.data?.project_id) {
        updateData.stakworkProjectId = stakworkData.data.project_id;
      }
      await db.feature.update({
        where: { id: featureId },
        data: updateData,
      });

      await pusherServer.trigger(
        getFeatureChannelName(featureId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        { taskId: featureId, workflowStatus: WorkflowStatus.IN_PROGRESS },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: clientMessage,
        workflow: stakworkData?.data,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating feature chat message:", error);
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }
}

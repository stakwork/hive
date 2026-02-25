import { NextRequest, NextResponse } from "next/server";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus, ArtifactType, type ContextTag, type Artifact, type ChatMessage } from "@/lib/chat";
import { WorkflowStatus } from "@prisma/client";
import { getS3Service } from "@/services/s3";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { callStakworkAPI } from "@/services/task-workflow";
import { EncryptionService } from "@/lib/encryption";
import { buildFeatureContext } from "@/services/task-coordinator";
import { updateTaskWorkflowStatus } from "@/lib/helpers/workflow-status";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

const encryptionService = EncryptionService.getInstance();

export const runtime = "nodejs";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

interface AttachmentRequest {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

async function fetchChatHistory(taskId: string, excludeMessageId: string): Promise<Record<string, unknown>[]> {
  const chatHistory = await db.chatMessage.findMany({
    where: {
      taskId,
      id: { not: excludeMessageId },
    },
    include: {
      artifacts: {
        where: {
          type: ArtifactType.LONGFORM,
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

async function callMock(
  taskId: string,
  message: string,
  userId: string,
  artifacts: ArtifactRequest[],
  request?: NextRequest,
  history?: Record<string, unknown>[],
) {
  const baseUrl = getBaseUrl(request?.headers.get("host"));

  try {
    const response = await fetch(`${baseUrl}/api/mock/chat`, {
      method: "POST",
      body: JSON.stringify({
        taskId,
        message,
        userId,
        artifacts,
        history: history || [],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Failed to send message to mock server: ${response.statusText}`);
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: true, data: result };
  } catch (error) {
    console.error("Error calling mock server:", error);
    return { success: false, error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const body = await request.json();
    const {
      taskId,
      message,
      contextTags = [] as ContextTag[],
      sourceWebsocketID,
      artifacts = [] as ArtifactRequest[],
      attachments = [] as AttachmentRequest[],
      webhook,
      replyId,
      mode,
    } = body;

    // Validate required fields
    if (!message && artifacts.length === 0) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    // Find the task and get its workspace with swarm details
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        workspaceId: true,
        branch: true,
        podId: true,
        agentPassword: true,
        featureId: true,
        phaseId: true,
        repository: {
          select: {
            name: true,
            repositoryUrl: true,
            branch: true,
          },
        },
        workspace: {
          select: {
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
            members: {
              where: {
                userId: userId,
              },
              select: {
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

    // Get user details
    const user = await db.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        name: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = task.workspace.ownerId === userId;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create the chat message
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message,
        role: ChatRole.USER,
        userId,
        contextTags: JSON.stringify(contextTags),
        status: ChatStatus.SENT,
        sourceWebsocketID,
        replyId,
        artifacts: {
          create: artifacts.map((artifact: ArtifactRequest) => ({
            type: artifact.type,
            content: artifact.content,
          })),
        },
        attachments: {
          create: attachments.map((attachment: AttachmentRequest) => ({
            path: attachment.path,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
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
            githubAuth: {
              select: { githubUsername: true },
            },
          },
        },
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    // Convert to client-side type
    const clientMessage = {
      ...chatMessage,
      contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
      attachments: chatMessage.attachments || [],
    } as ChatMessage;

    // Broadcast user message to other connected clients (exclude sender to prevent duplicates)
    try {
      await pusherServer.trigger(
        getTaskChannelName(taskId),
        PUSHER_EVENTS.NEW_MESSAGE,
        chatMessage.id,
        sourceWebsocketID ? { socket_id: sourceWebsocketID } : {},
      );
    } catch (error) {
      console.error("Error broadcasting user message to Pusher (task):", error);
    }

    const useStakwork = config.STAKWORK_API_KEY && config.STAKWORK_BASE_URL && config.STAKWORK_WORKFLOW_ID;

    // Get workspace slug for GitHub credentials
    const workspace = await db.workspace.findUnique({
      where: { id: task.workspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const githubProfile = await getGithubUsernameAndPAT(userId, workspace.slug);
    const userName = githubProfile?.username || null;
    const accessToken = githubProfile?.token || null;
    const swarm = task.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";

    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.id || null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);

    // Extract repository URL, branch, and name — prefer task-linked repo, fallback to workspace first repo
    const repoUrl = task.repository?.repositoryUrl || task.workspace.repositories?.[0]?.repositoryUrl || null;
    const baseBranch = task.repository?.branch || task.workspace.repositories?.[0]?.branch || null;
    const repoName = task.repository?.name || task.workspace.repositories?.[0]?.name || null;
    const taskBranch = task.branch || null;

    let stakworkData = null;

    if (useStakwork) {
      // Extract attachment paths for Stakwork
      const attachmentPaths = chatMessage.attachments?.map((att) => att.path) || [];

      // Fetch chat history for this task (excluding the current message)
      const history = await fetchChatHistory(taskId, chatMessage.id);

      // Generate presigned URLs for attachments
      const attachmentUrls = await Promise.all(
        attachmentPaths.map((path) => getS3Service().generatePresignedDownloadUrl(path)),
      );

      // Decrypt pod password if available
      const podPassword = task.agentPassword
        ? encryptionService.decryptField("agentPassword", task.agentPassword)
        : null;

      // Build feature context if task is linked to a feature and phase
      let featureContext;
      if (task.featureId && task.phaseId) {
        try {
          featureContext = await buildFeatureContext(task.featureId, task.phaseId);
        } catch (error) {
          console.error("Error building feature context:", error);
          // Continue without feature context if it fails
        }
      }

      stakworkData = await callStakworkAPI({
        taskId,
        message,
        contextTags,
        userName,
        accessToken,
        swarmUrl,
        swarmSecretAlias,
        poolName,
        repo2GraphUrl,
        attachments: attachmentUrls,
        mode,
        featureContext,
        workspaceId: task.workspaceId,
        repoUrl,
        baseBranch,
        branch: taskBranch,
        repoName,
        podId: task.podId,
        podPassword,
        history,
        webhook,
      });

      if (stakworkData.success) {
        await updateTaskWorkflowStatus({
          taskId,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: new Date(),
          additionalData: stakworkData.data?.project_id
            ? { stakworkProjectId: stakworkData.data.project_id }
            : undefined,
        });
      } else {
        await updateTaskWorkflowStatus({
          taskId,
          workflowStatus: WorkflowStatus.FAILED,
        });
      }
    } else {
      // Fetch chat history for this task (excluding the current message)
      const history = await fetchChatHistory(taskId, chatMessage.id);

      stakworkData = await callMock(taskId, message, userId, artifacts, request, history);
    }

    return NextResponse.json(
      {
        success: true,
        message: clientMessage,
        workflow: stakworkData.data,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating chat message:", error);
    return NextResponse.json({ error: "Failed to create chat message" }, { status: 500 });
  }
}

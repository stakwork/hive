import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/lib/env";
import { ChatRole, ChatStatus, ArtifactType, type ContextTag, type Artifact, type ChatMessage } from "@/lib/chat";
import { WorkflowStatus } from "@prisma/client";
import { getS3Service } from "@/services/s3";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

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

export interface StakworkWorkflowPayload {
  name: string;
  workflow_id: number;
  webhook_url?: string; // New webhook URL for workflow status updates
  workflow_params: {
    set_var: {
      attributes: {
        vars: Record<string, unknown>;
      };
    };
  };
}

async function callMock(
  taskId: string,
  message: string,
  userId: string,
  artifacts: ArtifactRequest[],
  request?: NextRequest,
) {
  const baseUrl = getBaseUrl(request?.headers.get("host"));

  try {
    const response = await fetch(`${baseUrl}/api/mock`, {
      method: "POST",
      body: JSON.stringify({
        taskId,
        message,
        userId,
        artifacts,
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

async function callStakwork(
  taskId: string,
  message: string,
  contextTags: ContextTag[],
  userName: string | null,
  accessToken: string | null,
  swarmUrl: string | null,
  swarmSecretAlias: string | null,
  poolName: string | null,
  request: NextRequest,
  repo2GraphUrl: string,
  attachmentPaths: string[] = [],
  webhook?: string,
  mode?: string,
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_WORKFLOW_ID) {
      throw new Error("STAKWORK_WORKFLOW_ID is required for Stakwork integration");
    }

    const baseUrl = getBaseUrl(request?.headers.get("host"));
    let webhookUrl = `${baseUrl}/api/chat/response`;
    if (process.env.CUSTOM_WEBHOOK_URL) {
      webhookUrl = process.env.CUSTOM_WEBHOOK_URL;
    }

    // New webhook URL for workflow status updates
    const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?task_id=${taskId}`;

    // Generate presigned URLs for attachments
    const attachmentUrls = await Promise.all(
      attachmentPaths.map((path) => getS3Service().generatePresignedDownloadUrl(path)),
    );

    // stakwork workflow vars
    const vars = {
      taskId,
      message,
      contextTags,
      webhookUrl,
      alias: userName,
      username: userName,
      accessToken,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
      attachments: attachmentUrls,
      taskMode: mode,
    };

    const stakworkWorkflowIds = config.STAKWORK_WORKFLOW_ID.split(",");

    let workflowId: string;
    if (mode === "live") {
      workflowId = stakworkWorkflowIds[0];
    } else if (mode === "unit") {
      workflowId = stakworkWorkflowIds[2];
    } else if (mode === "integration") {
      workflowId = stakworkWorkflowIds[2];
    } else {
      workflowId = stakworkWorkflowIds[1]; // default to test mode
    }
    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_autogen",
      workflow_id: parseInt(workflowId),
      webhook_url: workflowWebhookUrl, // Add workflow status webhook URL
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    const stakworkURL = webhook || `${config.STAKWORK_BASE_URL}/projects`;

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Failed to send message to Stakwork: ${response.statusText}`);
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: result.success, data: result.data };
  } catch (error) {
    console.error("Error calling Stakwork:", error);
    return { success: false, error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

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
    if (!message) {
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
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    // Convert to client-side type
    const clientMessage: ChatMessage = {
      ...chatMessage,
      contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
      attachments: chatMessage.attachments || [],
    };

    console.log("clientMessage", clientMessage);

    const useStakwork = config.STAKWORK_API_KEY && config.STAKWORK_BASE_URL && config.STAKWORK_WORKFLOW_ID;

    const githubProfile = await getGithubUsernameAndPAT(userId);
    const userName = githubProfile?.username || null;
    const accessToken = githubProfile?.appAccessToken || githubProfile?.pat || null;
    const swarm = task.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";

    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.id || null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);

    let stakworkData = null;

    if (useStakwork) {
      // Extract attachment paths for Stakwork
      const attachmentPaths = chatMessage.attachments?.map((att) => att.path) || [];

      stakworkData = await callStakwork(
        taskId,
        message,
        contextTags,
        userName,
        accessToken,
        swarmUrl,
        swarmSecretAlias,
        poolName,
        request,
        repo2GraphUrl,
        attachmentPaths,
        webhook,
        mode,
      );

      if (stakworkData.success) {
        const updateData: {
          workflowStatus: WorkflowStatus;
          workflowStartedAt: Date;
          stakworkProjectId?: number;
        } = {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: new Date(),
        };

        // Store the Stakwork project ID if available
        if (stakworkData.data?.project_id) {
          updateData.stakworkProjectId = stakworkData.data.project_id;
        }

        await db.task.update({
          where: { id: taskId },
          data: updateData,
        });
      } else {
        await db.task.update({
          where: { id: taskId },
          data: {
            workflowStatus: WorkflowStatus.FAILED,
          },
        });
      }
    } else {
      stakworkData = await callMock(taskId, message, userId, artifacts, request);
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

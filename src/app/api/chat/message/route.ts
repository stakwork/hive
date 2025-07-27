import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/lib/env";
import {
  ChatRole,
  ChatStatus,
  ArtifactType,
  type ContextTag,
  type Artifact,
  type ChatMessage,
} from "@/lib/chat";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

interface StakworkWorkflowPayload {
  name: string;
  workflow_id: number;
  workflow_params: {
    set_var: {
      attributes: {
        vars: Record<string, unknown>;
      };
    };
  };
}

function getBaseUrl(request?: NextRequest): string {
  // Use the request host or fallback to localhost
  const host = request?.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;
  return baseUrl;
}

async function callMock(
  taskId: string,
  message: string,
  userId: string,
  request?: NextRequest
) {
  const baseUrl = getBaseUrl(request);
  console.log("Sending message to mock server", {
    taskId,
    message,
    baseUrl,
  });

  try {
    const response = await fetch(`${baseUrl}/api/mock`, {
      method: "POST",
      body: JSON.stringify({
        taskId,
        message,
        userId,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `Failed to send message to mock server: ${response.statusText}`
      );
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    console.log("mock result", result);
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
  webhook?: string
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_WORKFLOW_ID) {
      throw new Error(
        "STAKWORK_WORKFLOW_ID is required for Stakwork integration"
      );
    }

    const baseUrl = getBaseUrl(request);
    let webhookUrl = `${baseUrl}/api/chat/response`;
    if (process.env.CUSTOM_WEBHOOK_URL) {
      webhookUrl = process.env.CUSTOM_WEBHOOK_URL;
    }
    // stakwork workflow vars
    const vars = {
      taskId,
      message,
      contextTags,
      webhookUrl,
      alias: userName,
      accessToken,
      swarmUrl,
      swarmSecretAlias,
      poolName,
    };
    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_autogen",
      workflow_id: parseInt(config.STAKWORK_WORKFLOW_ID),
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    const stakworkURL = webhook || `${config.STAKWORK_BASE_URL}/projects`;

    console.log("Sending message to Stakwork", {
      url: stakworkURL,
      payload: stakworkPayload,
    });

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `Failed to send message to Stakwork: ${response.statusText}`
      );
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    console.log("Stakwork result", result);
    return { success: true, data: result };
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
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      taskId,
      message,
      contextTags = [] as ContextTag[],
      sourceWebsocketID,
      artifacts = [] as ArtifactRequest[],
      webhook,
      replyId,
    } = body;

    // Validate required fields
    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }
    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
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

    // Get user details including name and accounts
    const user = await db.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        name: true,
        accounts: {
          select: {
            access_token: true,
            provider: true,
          },
        },
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
      },
      include: {
        artifacts: true,
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
      contextTags: JSON.parse(
        chatMessage.contextTags as string
      ) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    };

    // Check if Stakwork environment variables are defined
    const useStakwork =
      config.STAKWORK_API_KEY &&
      config.STAKWORK_BASE_URL &&
      config.STAKWORK_WORKFLOW_ID;

    // Extract data for Stakwork payload
    const userName = user.name;
    const accessToken =
      user.accounts.find((account) => account.access_token)?.access_token ||
      null;
    const swarm = task.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl || null;
    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.poolName || null;

    // Check if this is a debug message and handle it specially
    const debugMatch = message.match(/🐛 Debug (click|selection) at \((\d+), (\d+)\)(?:\s+\((\d+)×(\d+)\))?\s+on (.+)/);
    
    if (debugMatch) {
      // This is a debug message - process it with our debug element API
      const [, type, x, y, width = '0', height = '0', iframeUrl] = debugMatch;
      
      try {
        console.log('Processing debug message:', { type, x, y, width, height, iframeUrl });
        
        // Call our debug element API internally
        const debugResponse = await fetch(`${getBaseUrl(request)}/api/debug-element`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('Cookie') || '', // Forward authentication
          },
          body: JSON.stringify({
            x: parseInt(x),
            y: parseInt(y),
            width: parseInt(width),
            height: parseInt(height),
            iframeUrl,
            taskId
          })
        });
        
        if (debugResponse.ok) {
          const debugResult = await debugResponse.json();
          
          if (debugResult.success) {
            // Create a response message with the source file mappings
            const sourceFiles = debugResult.data.sourceFiles;
            const responseText = sourceFiles.length > 0 
              ? `Found source mappings:\n${sourceFiles.map((sf: { file: string; lines: number[] }) => 
                  `📄 ${sf.file}:${sf.lines.join(',')}`
                ).join('\n')}`
              : 'No source mappings found for the selected area.';
            
            // Create assistant response message
            await db.chatMessage.create({
              data: {
                taskId,
                message: responseText,
                role: ChatRole.ASSISTANT,
                status: ChatStatus.SENT,
                replyId: chatMessage.id,
              },
            });
          }
        }
      } catch (error) {
        console.error('Error processing debug message:', error);
        
        // Create error response message
        await db.chatMessage.create({
          data: {
            taskId,
            message: 'Sorry, I encountered an error while analyzing the debug coordinates. Please try again.',
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            replyId: chatMessage.id,
          },
        });
      }
    } else {
      // Regular message - call appropriate service based on environment configuration
      if (useStakwork) {
        await callStakwork(
          taskId,
          message,
          contextTags,
          userName,
          accessToken,
          swarmUrl,
          swarmSecretAlias,
          poolName,
          request,
          webhook
        );
      } else {
        await callMock(taskId, message, userId, request);
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: clientMessage,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating chat message:", error);
    return NextResponse.json(
      { error: "Failed to create chat message" },
      { status: 500 }
    );
  }
}

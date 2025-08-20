import { db } from "@/lib/db";
import { Priority, TaskStatus, TaskSourceType } from "@prisma/client";
import { config } from "@/lib/env";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

/**
 * Create a task and immediately trigger Stakwork workflow
 * This replicates the flow: POST /api/tasks -> POST /api/chat/message
 * Used by both janitor recommendations and direct task creation
 */
export async function createTaskWithStakworkWorkflow(params: {
  title: string;
  description: string;
  workspaceId: string;
  assigneeId?: string;
  repositoryId?: string;  
  priority: Priority;
  sourceType?: TaskSourceType;
  userId: string;
  initialMessage: string;
  status?: TaskStatus;
  mode?: string;
}) {
  const { 
    title, 
    description, 
    workspaceId, 
    assigneeId, 
    repositoryId, 
    priority, 
    sourceType = "USER", 
    userId, 
    initialMessage,
    status = "TODO",
    mode = "default"
  } = params;

  // Step 1: Create task (replicating POST /api/tasks logic)
  const task = await db.task.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      workspaceId,
      status,
      priority,
      assigneeId: assigneeId || null,
      repositoryId: repositoryId || null,
      sourceType,
      createdById: userId,
      updatedById: userId,
    },
    include: {
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      repository: {
        select: {
          id: true,
          name: true,
          repositoryUrl: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          githubAuth: {
            select: {
              githubUsername: true,
            },
          },
        },
      },
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
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

  // Step 2: Create chat message and trigger Stakwork (replicating POST /api/chat/message logic)
  const stakworkResult = await createChatMessageAndTriggerStakwork({
    taskId: task.id,
    message: initialMessage,
    userId: userId,
    task: task,
    mode: mode,
  });

  return {
    task,
    stakworkResult: stakworkResult.stakworkData,
    chatMessage: stakworkResult.chatMessage,
  };
}

/**
 * Create chat message and trigger Stakwork workflow for existing task
 * This replicates the POST /api/chat/message logic
 * Used when you already have a task and want to send a message to Stakwork
 */
export async function sendMessageToStakwork(params: {
  taskId: string;
  message: string;
  userId: string;
  contextTags?: any[];
  attachments?: string[];
}) {
  const { taskId, message, userId, contextTags = [], attachments = [] } = params;

  // Get task with workspace and swarm details
  const task = await db.task.findFirst({
    where: {
      id: taskId,
      deleted: false,
    },
    include: {
      workspace: {
        include: {
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
    throw new Error("Task not found");
  }

  return await createChatMessageAndTriggerStakwork({
    taskId,
    message,
    userId,
    task,
    contextTags,
    attachments,
  });
}

/**
 * Internal function to create chat message and trigger Stakwork workflow
 */
async function createChatMessageAndTriggerStakwork(params: {
  taskId: string;
  message: string;
  userId: string;
  task: any; // Task with workspace and swarm details
  contextTags?: any[];
  attachments?: string[];
  mode?: string;
}) {
  const { taskId, message, userId, task, contextTags = [], attachments = [], mode = "default" } = params;

  // Create the chat message (replicating chat message creation logic)
  const chatMessage = await db.chatMessage.create({
    data: {
      taskId,
      message,
      role: "USER",
      contextTags: JSON.stringify(contextTags),
      status: "SENT",
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });

  // Get user details for Stakwork integration
  const user = await db.user.findUnique({
    where: { id: userId },
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

  if (!user) {
    throw new Error("User not found");
  }

  // Get GitHub auth details
  const githubAuth = await db.gitHubAuth.findUnique({ where: { userId } });
  const userName = githubAuth?.githubUsername || null;

  // Decrypt access token
  let accessToken: string | null = null;
  try {
    const accountWithToken = user.accounts.find((account) => account.access_token);
    if (accountWithToken?.access_token) {
      accessToken = encryptionService.decryptField("access_token", accountWithToken.access_token);
    }
  } catch (error) {
    console.error("Failed to decrypt access_token:", error);
    const accountWithToken = user.accounts.find((account) => account.access_token);
    accessToken = accountWithToken?.access_token || null;
  }

  // Prepare Stakwork integration (replicating callStakwork logic)
  const useStakwork = config.STAKWORK_API_KEY && config.STAKWORK_BASE_URL && config.STAKWORK_WORKFLOW_ID;
  let stakworkData = null;

  if (useStakwork) {
    const swarm = task.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";
    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.id || null;
    const repo2GraphUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":3355") : "";

    try {
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
        attachments,
        mode,
      });

      if (stakworkData.success) {
        const updateData: any = {
          workflowStatus: "IN_PROGRESS",
          workflowStartedAt: new Date(),
        };

        // Extract project ID from various possible locations in response
        const projectId = stakworkData.data?.project_id || 
                         stakworkData.data?.id ||
                         (stakworkData.data as any)?.data?.project_id ||
                         (stakworkData.data as any)?.data?.id;
        
        if (projectId) {
          updateData.stakworkProjectId = projectId;
        }

        await db.task.update({
          where: { id: taskId },
          data: updateData,
        });
      } else {
        await db.task.update({
          where: { id: taskId },
          data: { workflowStatus: "FAILED" },
        });
      }
    } catch (error) {
      console.error("Error calling Stakwork:", error);
      await db.task.update({
        where: { id: taskId },
        data: { workflowStatus: "FAILED" },
      });
    }
  }

  return {
    chatMessage,
    stakworkData,
  };
}

/**
 * Call Stakwork API - extracted from callStakwork function in chat/message route
 */
async function callStakworkAPI(params: {
  taskId: string;
  message: string;
  contextTags?: any[];
  userName: string | null;
  accessToken: string | null;
  swarmUrl: string;
  swarmSecretAlias: string | null;
  poolName: string | null;
  repo2GraphUrl: string;
  attachments?: string[];
  mode?: string;
}) {
  const { 
    taskId, 
    message, 
    contextTags = [], 
    userName, 
    accessToken, 
    swarmUrl, 
    swarmSecretAlias, 
    poolName, 
    repo2GraphUrl,
    attachments = [],
    mode = "default"
  } = params;

  if (!config.STAKWORK_API_KEY || !config.STAKWORK_WORKFLOW_ID) {
    throw new Error("Stakwork configuration missing");
  }

  // Build webhook URLs (replicating the webhook URL logic)
  const baseUrl = config.STAKWORK_BASE_URL;
  const webhookUrl = `${baseUrl}/api/chat/response`;
  const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?task_id=${taskId}`;

  // Build vars object (replicating the vars structure from chat/message route)
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
    attachments,
    taskMode: mode,
  };

  // Get workflow ID (replicating workflow selection logic)
  const stakworkWorkflowIds = config.STAKWORK_WORKFLOW_ID.split(",");
  
  let workflowId: string;
  if (mode === "live") {
    workflowId = stakworkWorkflowIds[0];
  } else if (mode === "unit") {
    workflowId = stakworkWorkflowIds[2];
  } else if (mode === "integration") {
    workflowId = stakworkWorkflowIds[2];
  } else {
    workflowId = stakworkWorkflowIds[1] || stakworkWorkflowIds[0]; // default to test mode or first
  }

  // Build Stakwork payload (replicating StakworkWorkflowPayload structure)
  const stakworkPayload = {
    name: "hive_autogen",
    workflow_id: parseInt(workflowId),
    webhook_url: workflowWebhookUrl,
    workflow_params: {
      set_var: {
        attributes: {
          vars,
        },
      },
    },
  };

  // Make Stakwork API call (replicating fetch call from chat/message route)
  const response = await fetch(`${config.STAKWORK_BASE_URL}/projects`, {
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
  return { success: true, data: result };
}
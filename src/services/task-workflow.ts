import { db } from "@/lib/db";
import { Priority, TaskStatus, TaskSourceType, WorkflowStatus, JanitorType } from "@prisma/client";
import { config } from "@/config/env";
import { getBaseUrl } from "@/lib/utils";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { buildFeatureContext } from "@/services/task-coordinator";
import { EncryptionService } from "@/lib/encryption";
import { updateTaskWorkflowStatus } from "@/lib/helpers/workflow-status";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { fetchChatHistory } from "@/lib/helpers/chat-history";

const encryptionService = EncryptionService.getInstance();

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
  status?: TaskStatus;
  mode?: string;
  runBuild?: boolean;
  runTestSuite?: boolean;
  autoMergePr?: boolean;
  janitorType?: JanitorType;
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
    status = TaskStatus.IN_PROGRESS,  // Default to IN_PROGRESS since workflow starts immediately
    mode = "default",
    runBuild = true,
    runTestSuite = true,
    autoMergePr,
    janitorType,
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
      runBuild,
      runTestSuite,
      createdById: userId,
      updatedById: userId,
      janitorType: janitorType || null,
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
          branch: true,
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

  // Step 2: Build message and trigger Stakwork workflow
  const message = `${task.title}\n\n${task.description || ""}`.trim();

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

  const stakworkResult = await createChatMessageAndTriggerStakwork({
    taskId: task.id,
    message,
    userId,
    task,
    mode,
    generateChatTitle: false, // Don't generate title - task already has one
    featureContext,
    autoMergePr,
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
  generateChatTitle?: boolean;
  featureContext?: object;
}) {
  const { taskId, message, userId, contextTags = [], attachments = [], generateChatTitle, featureContext } = params;

  // Get task with workspace and swarm details
  const task = await db.task.findFirst({
    where: {
      id: taskId,
      deleted: false,
    },
    include: {
      repository: {
        select: {
          name: true,
          repositoryUrl: true,
          branch: true,
        },
      },
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
    generateChatTitle,
    featureContext,
  });
}

/**
 * Start Stakwork workflow for an existing task
 * Used by: Task Coordinator cron, "Start Task" button, PATCH /api/tasks/[taskId]
 * Automatically uses task description as message and builds feature context
 */
export async function startTaskWorkflow(params: {
  taskId: string;
  userId: string;
  mode?: string;
  includeHistory?: boolean;
}) {
  const { taskId, userId, mode = "live", includeHistory = false } = params;

  // Get task with workspace and swarm details
  const task = await db.task.findFirst({
    where: {
      id: taskId,
      deleted: false,
    },
    select: {
      id: true,
      title: true,
      description: true,
      branch: true,
      featureId: true,
      phaseId: true,
      sourceType: true,
      runBuild: true,
      runTestSuite: true,
      autoMerge: true,
      repository: {
        select: {
          name: true,
          repositoryUrl: true,
          branch: true,
        },
      },
      workspace: {
        select: {
          id: true,
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

  if (!task) {
    throw new Error("Task not found");
  }

  // Build message from task title and description
  const message = `${task.title}\n\n${task.description || ""}`.trim();

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

  // Fetch chat history if includeHistory is true
  let history: Record<string, unknown>[] = [];
  if (includeHistory) {
    try {
      const fetchedHistory = await fetchChatHistory(taskId);
      history = fetchedHistory || [];
    } catch (error) {
      console.error("Error fetching chat history:", error);
      // Continue without history if it fails
    }
  }

  return await createChatMessageAndTriggerStakwork({
    taskId,
    message,
    userId,
    task,
    contextTags: [],
    attachments: [],
    mode,
    generateChatTitle: false, // Don't generate title - task already has one
    featureContext,
    autoMergePr: task.autoMerge,
    history,
  });
}

/**
 * Internal function to create chat message and trigger Stakwork workflow
 * Exported for testing purposes
 */
export async function createChatMessageAndTriggerStakwork(params: {
  taskId: string;
  message: string;
  userId: string;
  task?: any; // Task with workspace and swarm details (optional, will be fetched if not provided)
  contextTags?: any[];
  attachments?: string[];
  mode?: string;
  generateChatTitle?: boolean;
  featureContext?: object;
  autoMergePr?: boolean;
  history?: Record<string, unknown>[];
}) {
  const { taskId, message, userId, task: providedTask, contextTags = [], attachments = [], mode = "default", generateChatTitle, featureContext, autoMergePr, history = [] } = params;

  // Fetch task if not provided
  let task = providedTask;
  if (!task) {
    task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        repository: {
          select: {
            name: true,
            repositoryUrl: true,
            branch: true,
          },
        },
        workspace: {
          include: {
            swarm: true,
            repositories: true,
          },
        },
      },
    });

    if (!task) {
      throw new Error("Task not found");
    }
  }

  // Create the chat message (replicating chat message creation logic)
  const chatMessage = await db.chatMessage.create({
    data: {
      taskId,
      message,
      role: "USER",
      userId,
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
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const githubProfile = await getGithubUsernameAndPAT(userId, task.workspace.slug);
  const userName = githubProfile?.username || null;
  const accessToken = githubProfile?.token || null;

  // Prepare Stakwork integration (replicating callStakwork logic)
  const useStakwork = config.STAKWORK_API_KEY && config.STAKWORK_BASE_URL && config.STAKWORK_WORKFLOW_ID;
  let stakworkData = null;

  if (useStakwork) {
    const swarm = task.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";
    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.id || null;
    const repo2GraphUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":3355") : "";

    // Get repository URL and branch — prefer task-linked repo, fallback to workspace first repo
    const repoUrl = task.repository?.repositoryUrl || task.workspace.repositories?.[0]?.repositoryUrl || null;
    const baseBranch = task.repository?.branch || task.workspace.repositories?.[0]?.branch || null;
    const repoName = task.repository?.name || task.workspace.repositories?.[0]?.name || null;
    const taskBranch = task.branch || null;

    // Decrypt pod password if available
    const podPassword = task.agentPassword
      ? encryptionService.decryptField("agentPassword", task.agentPassword)
      : null;

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
        taskSource: task.sourceType,
        generateChatTitle,
        featureContext,
        workspaceId: task.workspace.id,
        runBuild: task.runBuild,
        runTestSuite: task.runTestSuite,
        repoUrl,
        baseBranch,
        branch: taskBranch,
        repoName,
        podId: task.podId,
        podPassword,
        autoMergePr,
        history,
      });

      if (stakworkData.success) {
        // Extract project ID from Stakwork response
        if (!stakworkData.data?.project_id) {
          console.warn("No project_id found in Stakwork response:", stakworkData);
        }

        // Update task status to IN_PROGRESS if it's currently TODO
        const currentTask = await db.task.findUnique({
          where: { id: taskId },
          select: { status: true },
        });

        const additionalData: Record<string, unknown> = {};
        if (stakworkData.data?.project_id) {
          additionalData.stakworkProjectId = stakworkData.data.project_id;
        }
        if (currentTask?.status === TaskStatus.TODO) {
          additionalData.status = TaskStatus.IN_PROGRESS;
        }

        await updateTaskWorkflowStatus({
          taskId,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: new Date(),
          additionalData: Object.keys(additionalData).length > 0 ? additionalData : undefined,
        });
      } else {
        await updateTaskWorkflowStatus({
          taskId,
          workflowStatus: WorkflowStatus.FAILED,
        });
      }
    } catch (error) {
      console.error("Error calling Stakwork:", error);
      await updateTaskWorkflowStatus({
        taskId,
        workflowStatus: WorkflowStatus.FAILED,
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
export async function callStakworkAPI(params: {
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
  taskSource?: string;
  generateChatTitle?: boolean;
  featureContext?: object;
  workspaceId: string;
  runBuild?: boolean;
  runTestSuite?: boolean;
  repoUrl?: string | null;
  baseBranch?: string | null;
  branch?: string | null;
  history?: Record<string, unknown>[];
  autoMergePr?: boolean;
  webhook?: string;
  repoName?: string | null;
  podId?: string | null;
  podPassword?: string | null;
  featureId?: string | null;
  planEdited?: boolean;
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
    mode = "default",
    taskSource = "USER",
    generateChatTitle,
    featureContext,
    workspaceId,
    runBuild = true,
    runTestSuite = true,
    repoUrl = null,
    baseBranch = null,
    branch = null,
    history = [],
    autoMergePr,
    webhook,
    repoName = null,
    podId = null,
    podPassword = null,
    featureId = null,
    planEdited,
  } = params;

  if (!config.STAKWORK_API_KEY || !config.STAKWORK_WORKFLOW_ID) {
    throw new Error("Stakwork configuration missing");
  }

  // Build webhook URLs (replicating the webhook URL logic)
  const appBaseUrl = getBaseUrl();
  let webhookUrl = `${appBaseUrl}/api/chat/response`;
  if (process.env.CUSTOM_WEBHOOK_URL) {
    webhookUrl = process.env.CUSTOM_WEBHOOK_URL;
  }
  const workflowWebhookUrl = `${appBaseUrl}/api/stakwork/webhook?task_id=${taskId}`;

  // Build vars object (replicating the vars structure from chat/message route)
  const vars: Record<string, any> = {
    taskId,
    message,
    contextTags,
    webhookUrl,
    sourceHiveUrl: appBaseUrl,
    alias: userName,
    username: userName,
    accessToken,
    swarmUrl,
    swarmSecretAlias,
    poolName,
    repo2graph_url: repo2GraphUrl,
    attachments,
    taskMode: mode,
    taskSource: taskSource.toLowerCase(),
    workspaceId,
    runBuild,
    runTestSuite,
    repo_url: repoUrl,
    base_branch: baseBranch,
    repo_name: repoName,
    history,
    tokenReference: getStakworkTokenReference(),
  };

  // Add optional parameters if provided
  if (generateChatTitle !== undefined) {
    vars.generateChatTitle = generateChatTitle;
  }
  if (autoMergePr !== undefined) {
    vars.autoMergePr = autoMergePr;
  }
  if (featureContext !== undefined) {
    vars.featureContext = featureContext;
  }
  if (podId) {
    vars.podId = podId;
  }
  if (podPassword) {
    vars.podPassword = podPassword;
  }
  if (featureId) {
    vars.featureId = featureId;
  }
  if (branch) {
    vars.branch = branch;
  }
  if (planEdited !== undefined) {
    vars.planEdited = planEdited;
  }
  if (process.env.EXA_API_KEY) {
    vars.searchApiKey = process.env.EXA_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    vars.summaryApiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.PLAN_MODE_MODEL) {
    vars.model = process.env.PLAN_MODE_MODEL;
  }

  // Get workflow ID (replicating workflow selection logic)
  const stakworkWorkflowIds = config.STAKWORK_WORKFLOW_ID.split(",");

  let workflowId: string;
  // Use plan mode workflow for conversational planning
  if (config.STAKWORK_PLAN_MODE_WORKFLOW_ID && mode === "plan_mode") {
    workflowId = config.STAKWORK_PLAN_MODE_WORKFLOW_ID;
  } else if (config.STAKWORK_TASK_WORKFLOW_ID && mode === "live" && taskSource !== "JANITOR") {
    workflowId = config.STAKWORK_TASK_WORKFLOW_ID;
  } else if (mode === "live") {
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
  // If webhook is provided, use it to continue existing workflow; otherwise start new project
  const stakworkURL = webhook || `${config.STAKWORK_BASE_URL}/projects`;

  try {
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

/**
 * Call Stackwork bounty workflow to generate a mini-app repo for a bounty.
 * Fire-and-forget: Stackwork will call back to Hive when done.
 */
export async function callStakworkBountyAPI(params: {
  taskId: string;
  podId: string;
  agentPassword: string;
  username: string;
  accessToken: string;
  bountyTitle: string;
  bountyDescription: string;
  artifactId: string;
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const workflowId = config.STAKWORK_BOUNTY_WORKFLOW_ID;
  if (!workflowId) {
    console.error("STAKWORK_BOUNTY_WORKFLOW_ID is not configured");
    return { success: false, error: "Bounty workflow ID not configured" };
  }

  const webhookUrl = `${getBaseUrl()}/api/bounty/webhook`;

  const payload = {
    name: "hive_bounty",
    workflow_id: parseInt(workflowId),
    workflow_params: {
      set_var: {
        attributes: {
          vars: {
            taskId: params.taskId,
            podId: params.podId,
            username: params.username,
            accessToken: params.accessToken,
            bountyTitle: params.bountyTitle,
            bountyDescription: params.bountyDescription,
            artifactId: params.artifactId,
            podPassword: params.agentPassword,
            webhookUrl,
            tokenReference: getStakworkTokenReference(),
          },
        },
      },
    },
  };

  try {
    const response = await fetch(`${config.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Failed to call Stakwork bounty API: ${response.statusText}`);
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: result.success, data: result.data };
  } catch (error) {
    console.error("Error calling Stakwork bounty API:", error);
    return { success: false, error: String(error) };
  }
}

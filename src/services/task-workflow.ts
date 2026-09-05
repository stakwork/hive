import { db } from "@/lib/db";
import { Priority, TaskStatus, TaskSourceType, WorkflowStatus, JanitorType } from "@prisma/client";
import { config } from "@/config/env";
import { getBaseUrl } from "@/lib/utils";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { buildFeatureContext } from "@/services/task-coordinator";
import { EncryptionService } from "@/lib/encryption";
import { updateTaskWorkflowStatus } from "@/lib/helpers/workflow-status";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { getApiKeyForModel, getDefaultModel, PROVIDER_API_KEY_ENV_VARS } from "@/lib/ai/models";
import { fetchChatHistory } from "@/lib/helpers/chat-history";
import { isDevelopmentMode } from "@/lib/runtime";
import type { McpServerConfig } from "@/services/mcpServers";
// Deep-import directly from the orchestrator (rather than the barrel
// `@/services/bifrost`) so we don't transitively pull in the 17-
// module surface — BifrostClient / macaroon-keys / trust-reconciler
// etc. — at every test file's module graph. The integration suite
// runs single-threaded in a vm and that bloat showed up as worker
// OOM. Same approach used at every other LLM call site.
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";

const encryptionService = EncryptionService.getInstance();

// Upper bound on the Stakwork dispatch call. Kept comfortably under the
// platform function maxDuration so the request fails fast (and the claim is
// rolled back) instead of being killed mid-flight and stranding the task.
const STAKWORK_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Guards the caller-controlled `webhook` override used to continue an
 * existing Stakwork project (as opposed to starting a new one at
 * `${STAKWORK_BASE_URL}/projects`). This value ultimately becomes the
 * URL `callStakworkAPI` POSTs the Stakwork API key AND the resolved
 * provider LLM key to — an unvalidated value would let a caller
 * redirect that request (and both secrets) to an arbitrary host.
 *
 * Only same-origin-as-`STAKWORK_BASE_URL` URLs are accepted. This
 * mirrors the allowlist spirit of `src/lib/run-report/url-guard.ts`
 * but is deliberately simpler: `webhook` has exactly one legitimate
 * destination (continuing a Stakwork project), so origin equality is
 * the whole check — no bucket/region pattern matching needed.
 */
function isAllowedStakworkWebhook(webhook: string | undefined): boolean {
  if (!webhook) return false;
  let webhookUrl: URL;
  let baseUrl: URL;
  try {
    webhookUrl = new URL(webhook);
    baseUrl = new URL(config.STAKWORK_BASE_URL);
  } catch {
    return false;
  }
  return webhookUrl.origin === baseUrl.origin;
}

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
    // This path only ever feeds the MCP `send_message` / `send_to_task_agent`
    // tools (the function's sole callers). Inherit the target task's own mode
    // so the workflow-selection ladder in callStakworkAPI routes to the right
    // workflow — `live` → STAKWORK_TASK_WORKFLOW_ID, `workflow_editor` → the
    // editor workflow, etc. Fall back to "live" (not the "default" test-mode
    // workflow) when the task has no explicit mode.
    mode: task.mode ?? "live",
  });
}

/**
 * Start Stakwork workflow for an existing task
 * Used by: Task Coordinator cron, "Start Task" button, PATCH /api/tasks/[taskId]
 * Automatically uses task description as message and builds feature context
 *
 * Returns null if the task was already claimed by a concurrent invocation (idempotency guard).
 */
export async function startTaskWorkflow(params: {
  taskId: string;
  userId: string;
  mode?: string;
  includeHistory?: boolean;
}): Promise<{ chatMessage: any; stakworkData: any } | null> {
  const { taskId, userId, mode = "live", includeHistory = false } = params;

  // Atomic claim: only one concurrent invocation can proceed per task.
  // updateMany is conditional — it only updates if workflowStatus is PENDING or HALTED
  // (HALTED tasks are eligible for retry) AND either no stakworkProjectId is assigned yet
  // OR the task is HALTED (its existing project ID is stale and will be cleared).
  const claimed = await db.task.updateMany({
    where: {
      id: taskId,
      deleted: false,
      workflowStatus: { in: [WorkflowStatus.PENDING, WorkflowStatus.HALTED] },
      OR: [
        { stakworkProjectId: null },
        { workflowStatus: WorkflowStatus.HALTED }, // HALTED tasks may have a stale project ID
      ],
    },
    data: {
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      workflowStartedAt: new Date(),
      stakworkProjectId: null, // clear stale project ID so a new one can be assigned
    },
  });

  if (claimed.count === 0) {
    console.log(`[startTaskWorkflow] Task ${taskId} already claimed — bailing`);
    return null;
  }

  try {
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
        model: true,
        podId: true,
        agentPassword: true,
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

    // Build message from task title and description (may be overridden by last USER message when includeHistory is true)
    let message = `${task.title}\n\n${task.description || ""}`.trim();

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
        const allHistory = fetchedHistory || [];

        // Find the last USER message to use as the outgoing message
        const lastUserMessage = [...allHistory].reverse().find(
          (msg) => (msg.role as string) === "USER"
        ) as (Record<string, unknown> & { id: string; message: string }) | undefined;

        if (lastUserMessage) {
          // Use last user message text as the outgoing message
          message = lastUserMessage.message;
          // Re-fetch history excluding the last user message (it will be re-sent as the new message)
          history = (await fetchChatHistory(taskId, lastUserMessage.id)) || [];
        }
        // If no USER message found, fall back to task.title + task.description with empty history
      } catch (error) {
        console.error("Error fetching chat history:", error);
        // Continue without history if it fails
      }
    }

    const result = await createChatMessageAndTriggerStakwork({
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
      featureId: task.featureId,
      taskModel: task.model ?? undefined,
    });

    // If Stakwork returned no project_id (silent failure), roll back the claim immediately
    if (!result.stakworkData?.projectId) {
      console.error(`[startTaskWorkflow] No project_id returned for task ${taskId}, rolling back claim`);
      await db.task.updateMany({
        where: { id: taskId, workflowStatus: WorkflowStatus.IN_PROGRESS, stakworkProjectId: null },
        data: { workflowStatus: WorkflowStatus.PENDING, workflowStartedAt: null },
      });
    }

    return result;
  } catch (error) {
    // Roll back the claim so the task becomes eligible again on the next sweep
    console.error(`[startTaskWorkflow] Error dispatching task ${taskId}, rolling back claim:`, error);
    await db.task.updateMany({
      where: { id: taskId, workflowStatus: WorkflowStatus.IN_PROGRESS, stakworkProjectId: null },
      data: { workflowStatus: WorkflowStatus.PENDING, workflowStartedAt: null },
    });
    throw error;
  }
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
  featureId?: string | null;
  taskModel?: string;
}) {
  const { taskId, message, userId, task: providedTask, contextTags = [], attachments = [], mode = "default", generateChatTitle, featureContext, autoMergePr, history = [], featureId = null, taskModel } = params;

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
      workspaceSlug: task.workspace.slug,
      userId,
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
      featureId,
      taskModel,
    });

    if (stakworkData.projectId) {
      // Update task status to IN_PROGRESS if it's currently TODO
      const currentTask = await db.task.findUnique({
        where: { id: taskId },
        select: { status: true },
      });

      const additionalData: Record<string, unknown> = {
        stakworkProjectId: stakworkData.projectId,
      };
      if (currentTask?.status === TaskStatus.TODO) {
        additionalData.status = TaskStatus.IN_PROGRESS;
      }

      await updateTaskWorkflowStatus({
        taskId,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: new Date(),
        additionalData,
      });
      await db.chatMessage.update({
        where: { id: chatMessage.id },
        data: { stakworkProjectId: String(stakworkData.projectId) },
      });
    }
    // All other cases (network error, non-2xx, body-level failure, missing project_id):
    // no-op — leave workflowStatus unchanged
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
  /**
   * NextAuth user id of the caller. Required so the Stakwork workflow
   * can mint its LLM creds against the right per-user Bifrost VK.
   * Background paths without a real session (e.g. PR-monitor) should
   * pass `task.createdById` / `task.workspace.ownerId`.
   */
  userId: string;
  /**
   * Workspace slug — needed only for the `BIFROST_ENABLED` rollout
   * flag (which is keyed on slug, not id). Trivially available
   * everywhere `workspaceId` is.
   */
  workspaceSlug: string;
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
  isPrototype?: boolean;
  subAgents?: { name: string, description?: string; url: string; apiKey: string; repoUrls: string }[];
  taskModel?: string;
  /**
   * MCP servers to expose to the swarm-side `repo/agent`. The agent
   * receives these on its workflow vars and treats each as a tool
   * source (per its `McpServer` interface).
   *
   * Plan-mode populates this with a single entry for Hive's
   * org-scope MCP (`org_agent`), minted per-dispatch with a
   * short-lived JWT. Future writers (voice, etc.) build their own
   * entries the same way. Absent when no callback is configured.
   */
  mcpServers?: McpServerConfig[];
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
    userId,
    workspaceSlug,
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
    isPrototype,
    subAgents,
    taskModel,
    mcpServers,
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
    // The plan-mode org-context scout result (when present) is
    // attached as `featureContext.orgContext` by the caller in
    // `sendFeatureChatMessage` — we don't need a separate top-level
    // var because the whole `featureContext` blob is forwarded as-is.
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
  if (isPrototype) {
    vars.isPrototype = true;
  }
  if (subAgents?.length) {
    vars.subAgents = subAgents;
  }
  if (mcpServers?.length) {
    // Forwarded verbatim to the stakwork workflow, which lands it on
    // `vars.mcpServers` for repo/agent to consume. Shape matches
    // repo/agent's `McpServer` interface exactly so the workflow
    // does no reshaping in the middle.
    vars.mcpServers = mcpServers;
  }
  if (process.env.EXA_API_KEY) {
    vars.searchApiKey = process.env.EXA_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    vars.summaryApiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (mode === "plan_mode" && process.env.PLAN_MODE_MODEL) {
    vars.model = process.env.PLAN_MODE_MODEL;
  }

  // Signal the Stakwork plan workflow that workflow targeting is enabled
  // (stakwork workspace only, or development mode)
  if (mode === "plan_mode") {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });
    if (workspace?.slug === "stakwork" || isDevelopmentMode()) {
      vars.workflowPlanningEnabled = true;
      console.log(`[PlanMode] workflowPlanningEnabled injected for workspace ${workspaceId}`);
    }
  }
  const effectiveModel = taskModel || await getDefaultModel(mode === "plan_mode" ? "plan" : "task");
  if (effectiveModel) {
    vars.model = effectiveModel;
    const resolvedApiKey = getApiKeyForModel(effectiveModel);
    if (resolvedApiKey) vars.apiKey = resolvedApiKey;
  }

  // ──────────────────────────────────────────────────────────────────
  // Bifrost routing for the Stakwork-side LLM calls.
  //
  // When the rollout flag covers this workspace, mint a per-workflow
  // Bifrost VK + macaroon and override the `vars.apiKey` we shipped
  // above. The workflow worker reads `vars.apiKey` / `vars.baseUrl` /
  // `vars.headers` and threads them onto every LLM HTTP call it makes
  // — same protocol `repoAgent` already follows. When the flag is off
  // or the orchestrator returns `undefined`, leave the existing
  // `vars.apiKey` (resolved from `getApiKeyForModel` above) in place
  // for byte-for-byte unchanged behavior.
  //
  // `agentName` splits on `mode`:
  //   - `plan_mode` → "plan-agent"  (planning workflow, conversational)
  //   - everything else (`live` / `unit` / `integration` / `default`)
  //                  → "coding-agent" (hive4 / goose-style task workflow)
  //
  // Workflows can run for hours and burn through many LLM steps, but
  // the orchestrator's defaults are tuned for chat turns — caller
  // tuning of ttlSeconds / maxCostUsd / maxSteps is intentionally
  // deferred to a follow-up so this initial wiring stays small.
  //
  // xAI bypass: the Bifrost VK provider allow-list (`DEFAULT_PROVIDERS`)
  // doesn't list "xai" and the swarm gateways have no xai provider key
  // configured, so routing an `xai/*` selection through Bifrost today
  // would fail. Skip the Bifrost call entirely for xai/* and fall
  // through to the direct `vars.apiKey` (XAI_API_KEY) resolved above.
  // Remove this bypass once the gateways carry an xai key and
  // `DEFAULT_PROVIDERS` lists it (aieo already maps xai onto the
  // /openai/v1 gateway path) — until then this trades away per-agent
  // cost attribution / macaroon observability for Grok runs only.
  const isXaiModel = effectiveModel?.startsWith("xai/") ?? false;
  const bifrost = isXaiModel
    ? undefined
    : await getBifrostForLLM(
        { workspaceId, workspaceSlug, userId },
        {
          agentName: mode === "plan_mode" ? "plan-agent" : "coding-agent",
          // Pass the selected model so the Bifrost VK reconciler resolves
          // the correct provider suffix on `baseUrl` (e.g. `/genai/v1beta`
          // for google/* models). Without this it defaults to anthropic
          // and Google/OpenAI models get routed to the wrong provider.
          model: effectiveModel ?? undefined,
        },
      );
  if (bifrost) {
    vars.apiKey = bifrost.apiKey;
    vars.baseUrl = bifrost.baseUrl;
    if (Object.keys(bifrost.headers).length > 0) {
      // Empty headers map = orchestrator's "macaroon mint failed,
      // shadow-mode degraded" state. Don't ship an empty `headers`
      // key in that case so older workflow versions that don't read
      // it stay byte-identical.
      vars.headers = bifrost.headers;
    }
  }

  // Diagnostic: surfaces how the model resolved to an LLM provider/key
  // route for this dispatch. Look for "[callStakworkAPI] model routing"
  // in Vercel logs (filter by /api/chat/message). `baseUrl` should carry
  // the model's provider suffix (e.g. /genai/v1beta for google/* models).
  //
  // Deliberately excludes any substring of the resolved key — a prior
  // version logged `vars.apiKey.slice(0, 7)` as `apiKeyPrefix`, which
  // for a short fixed-prefix key (e.g. xAI's `xai-...`) is real key
  // material, not a discriminator. `providerKeySet` (derived from the
  // model prefix) replaces the Google-only `googleKeySet` so a missing
  // key is visible for any provider, not just Google.
  const routingProvider = effectiveModel?.includes("/") ? effectiveModel.split("/")[0].toUpperCase() : null;
  const routingEnvVar = routingProvider ? PROVIDER_API_KEY_ENV_VARS[routingProvider] : null;
  console.log("[callStakworkAPI] model routing", {
    taskId,
    mode,
    effectiveModel,
    bifrostActive: Boolean(bifrost),
    baseUrl: vars.baseUrl,
    providerKeySet: routingEnvVar ? Boolean(process.env[routingEnvVar]) : null,
  });

  // A prefixed model whose provider maps to a real env var but resolved
  // to no key anywhere (not from `getApiKeyForModel` above, not from
  // Bifrost) means the dispatch is about to go out key-less. Log which
  // env var is missing — name + boolean only, never the value — so this
  // is diagnosable in Vercel logs without leaking secret material. This
  // is a log-only change; control flow is unaffected and any subsequent
  // `{ error }` this function returns must stay generic ("model
  // provider not configured") with no env-var names in the HTTP response.
  if (routingEnvVar && !vars.apiKey) {
    console.error("[callStakworkAPI] model provider key missing", {
      taskId,
      mode,
      effectiveModel,
      envVar: routingEnvVar,
      envVarSet: Boolean(process.env[routingEnvVar]),
    });
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
  } else if (mode === "workflow_editor" && config.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID) {
    workflowId = config.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID;
    console.warn(`[callStakworkAPI] workflow_editor fell through for task ${taskId} — using fallback routing`);
  } else {
    workflowId = stakworkWorkflowIds[1] || stakworkWorkflowIds[0]; // default to test mode or first
  }

  // Build Stakwork payload (replicating StakworkWorkflowPayload structure)
  const stakworkPayload = {
    name: mode === "plan_mode" ? `hive-plan-${featureId ?? taskId}` : `hive-task-${taskId}`,
    workflow_id: parseInt(workflowId),
    webhook_url: workflowWebhookUrl,
    ...(mode === "plan_mode" || mode === "workflow_editor"
      ? { webhook_full_output: false }
      : {}),
    workflow_params: {
      set_var: {
        attributes: {
          vars,
        },
      },
    },
  };

  // Make Stakwork API call (replicating fetch call from chat/message route)
  // If webhook is provided, use it to continue existing workflow; otherwise start new project.
  //
  // `webhook` arrives on a caller-controlled request body (see
  // /api/chat/message and the roadmap feature-chat dispatcher) and this
  // request carries `Authorization: Token token=${STAKWORK_API_KEY}` plus
  // `vars.apiKey` (the resolved provider LLM key) in its body — an
  // unvalidated `webhook` value lets any caller redirect that fetch to an
  // attacker-chosen host and exfiltrate both secrets. Only accept it when
  // its origin matches `STAKWORK_BASE_URL`; anything else falls back to
  // the default `/projects` endpoint (silently — same behavior as if
  // `webhook` had been omitted) with a warning logged for visibility.
  const stakworkURL = isAllowedStakworkWebhook(webhook)
    ? webhook!
    : `${config.STAKWORK_BASE_URL}/projects`;
  if (webhook && webhook !== stakworkURL) {
    console.warn("[callStakworkAPI] rejected webhook URL with non-Stakwork origin; using default", {
      taskId,
    });
  }

  try {
    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify({ project: stakworkPayload }),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
      // Bound the call so a slow/hung Stakwork can't outlive the function's
      // maxDuration. An unbounded fetch here strands tasks in limbo:
      // startTaskWorkflow commits the IN_PROGRESS claim before this call, and
      // its compensating rollback only runs if we return control to it. On
      // timeout we throw → caught below → { error } → caller rolls the claim
      // back to PENDING (see startTaskWorkflow).
      signal: AbortSignal.timeout(STAKWORK_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Failed to send message to Stakwork: ${response.statusText}`);
      return { error: response.statusText };
    }

    const result = await response.json();
    return { projectId: result.data?.project_id, data: result.data };
  } catch (error) {
    console.error("Error calling Stakwork:", error);
    return { error: String(error) };
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

import { db } from "@/lib/db";
import {
  WorkflowStatus,
  StakworkRunType,
  StakworkRunDecision,
  Prisma,
} from "@prisma/client";
import {
  CreateStakworkRunInput,
  StakworkRunWebhookPayload,
  UpdateStakworkRunDecisionInput,
  StakworkRunQuery,
  DataType,
} from "@/types/stakwork";
import { stakworkService } from "@/lib/service-factory";
import { config } from "@/config/env";
import { getBaseUrl } from "@/lib/utils";
import {
  pusherServer,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { buildFeatureContext } from "@/lib/ai/utils";
import { EncryptionService } from "@/lib/encryption";
import { createUserStory } from "@/services/roadmap/user-stories";

const encryptionService = EncryptionService.getInstance();

/**
 * Get feature run history for building chat-like conversation with Stakwork
 * Returns alternating assistant/user messages from all completed runs with results
 */
export async function getFeatureRunHistory(
  featureId: string,
  type: StakworkRunType
): Promise<Array<{ role: "assistant" | "user"; content: string }>> {
  const runs = await db.stakworkRun.findMany({
    where: {
      featureId,
      type,
      status: WorkflowStatus.COMPLETED,
      result: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      result: true,
      feedback: true,
      createdAt: true,
    },
  });

  const history: Array<{ role: "assistant" | "user"; content: string }> = [];

  for (const run of runs) {
    // Add assistant message with the result
    if (run.result) {
      history.push({
        role: "assistant",
        content: run.result,
      });
    }

    // Add user message with feedback if it exists
    if (run.feedback) {
      history.push({
        role: "user",
        content: run.feedback,
      });
    }
  }

  return history;
}

/**
 * Create a new Stakwork AI generation run
 * Follows the janitor pattern: Create DB record → Call Stakwork → Update with projectId
 */
export async function createStakworkRun(
  input: CreateStakworkRunInput,
  userId: string
) {
  // Validate workspace access and fetch related data
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: {
      id: true,
      ownerId: true,
      deleted: true,
      members: {
        where: { userId },
        select: { role: true },
      },
      swarm: {
        select: {
          swarmUrl: true,
          swarmApiKey: true,
          swarmSecretAlias: true,
          poolName: true,
          id: true,
        },
      },
      sourceControlOrg: {
        include: {
          tokens: {
            where: { userId },
            take: 1,
          },
        },
      },
      repositories: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          repositoryUrl: true,
          branch: true,
        },
      },
    },
  });

  if (!workspace || workspace.deleted) {
    throw new Error("Workspace not found");
  }

  // Validate user has access to this workspace
  const isOwner = workspace.ownerId === userId;
  const isMember = workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  // Decrypt sensitive data
  const decryptedPAT =
    workspace.sourceControlOrg?.tokens[0]?.token
      ? encryptionService.decryptField(
          "access_token",
          workspace.sourceControlOrg.tokens[0].token
        )
      : null;

  const decryptedSwarmApiKey =
    workspace.swarm?.swarmApiKey
      ? encryptionService.decryptField(
          "swarmApiKey",
          workspace.swarm.swarmApiKey
        )
      : null;

  // Get user info for username
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      githubAuth: {
        select: {
          githubUsername: true,
        },
      },
    },
  });

  const githubUsername = user?.githubAuth?.githubUsername || null;

  // Fetch feature data if featureId provided
  let featureContext: ReturnType<typeof buildFeatureContext> | null = null;

  if (input.featureId) {
    const feature = await db.feature.findFirst({
      where: {
        id: input.featureId,
        workspaceId: input.workspaceId,
        deleted: false,
      },
      include: {
        userStories: {
          orderBy: { order: "asc" },
          select: { title: true },
        },
        workspace: {
          select: { description: true },
        },
        phases: {
          include: {
            tasks: {
              where: { deleted: false },
              select: {
                title: true,
                description: true,
                status: true,
                priority: true,
              },
            },
          },
        },
      },
    });

    if (!feature) {
      throw new Error("Feature not found");
    }

    // Build feature context for ARCHITECTURE, TASK_GENERATION, USER_STORIES, and REQUIREMENTS types
    if (
      input.type === StakworkRunType.ARCHITECTURE ||
      input.type === StakworkRunType.TASK_GENERATION ||
      input.type === StakworkRunType.USER_STORIES ||
      input.type === StakworkRunType.REQUIREMENTS
    ) {
      featureContext = buildFeatureContext(feature as Parameters<typeof buildFeatureContext>[0]);
    }
  }

  // Step 1: Create DB record with PENDING status
  const baseUrl = getBaseUrl();

  // Create initial run to get ID
  let run = await db.stakworkRun.create({
    data: {
      type: input.type,
      workspaceId: input.workspaceId,
      featureId: input.featureId || null,
      status: WorkflowStatus.PENDING,
      webhookUrl: "", // Will be updated below
      dataType: "string", // Default, will be updated by webhook based on actual result type
    },
  });

  // Build webhook URLs (now that we have run.id)
  const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?run_id=${run.id}`;
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${input.type}&workspace_id=${input.workspaceId}${input.featureId ? `&feature_id=${input.featureId}` : ""}`;

  // Update run with webhookUrl
  await db.stakworkRun.update({
    where: { id: run.id },
    data: { webhookUrl },
  });

  try {
    // Step 2: Build Stakwork payload
    const workflowId = config.STAKWORK_AI_GENERATION_WORKFLOW_ID;
    if (!workflowId) {
      throw new Error("STAKWORK_AI_GENERATION_WORKFLOW_ID not configured");
    }

    const vars: Record<string, unknown> = {
      runId: run.id,
      type: input.type,
      workspaceId: input.workspaceId,
      featureId: input.featureId,
      webhookUrl,

      // Repository & credentials
      repo_url: workspace.repositories[0]?.repositoryUrl || null,
      base_branch: workspace.repositories[0]?.branch || null,
      username: githubUsername,
      pat: decryptedPAT,

      // Swarm data
      swarmUrl: workspace.swarm?.swarmUrl || null,
      swarmApiKey: decryptedSwarmApiKey,
      swarmSecretAlias: workspace.swarm?.swarmSecretAlias || null,
      poolName: workspace.swarm?.poolName || workspace.swarm?.id || null,

      // Include formatted feature context for ARCHITECTURE and TASK_GENERATION types
      ...(featureContext && {
        featureTitle: featureContext.title,
        featureBrief: featureContext.brief,
        workspaceDesc: featureContext.workspaceDesc,
        personas: featureContext.personasText,
        userStories: featureContext.userStoriesText,
        requirements: featureContext.requirementsText,
        architecture: featureContext.architectureText,
        existingTasks: featureContext.tasksText,
      }),

      // Allow params override
      ...(input.params || {}),

      // Include conversation history if provided
      ...(input.history && input.history.length > 0 && {
        history: input.history,
      }),
    };

    const stakworkPayload = {
      name: `ai-gen-${input.type.toLowerCase()}-${Date.now()}`,
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

    // Step 3: Call Stakwork using the service (DRY!)
    const response = await stakworkService().stakworkRequest<{
      success: boolean;
      data: { project_id: number };
    }>("/projects", stakworkPayload);

    const projectId = response?.data?.project_id;

    if (!projectId) {
      throw new Error("Failed to get project ID from Stakwork");
    }

    // Step 4: Update DB record with projectId and set status to IN_PROGRESS
    run = await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        projectId,
        status: WorkflowStatus.IN_PROGRESS,
      },
    });

    return run;
  } catch (error) {
    // Update status to FAILED if Stakwork call fails
    await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        status: WorkflowStatus.FAILED,
      },
    });

    throw error;
  }
}

/**
 * Process webhook from Stakwork for AI generation runs
 * Uses atomic updateMany to prevent race conditions
 */
export async function processStakworkRunWebhook(
  webhookData: StakworkRunWebhookPayload,
  queryParams: {
    type: string;
    workspace_id: string;
    feature_id?: string;
  }
) {
  const { result, project_status, project_id } = webhookData;
  const { workspace_id, feature_id, type } = queryParams;

  // Find the run by webhookUrl or projectId
  let run = await db.stakworkRun.findFirst({
    where: {
      OR: [
        { projectId: project_id || undefined },
        {
          workspaceId: workspace_id,
          type: type as StakworkRunType,
          featureId: feature_id || null,
          status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
        },
      ],
    },
    include: {
      workspace: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!run) {
    throw new Error("StakworkRun not found");
  }

  // Map Stakwork status to our internal status
  const status = project_status
    ? mapStakworkStatus(project_status)
    : WorkflowStatus.COMPLETED;

  if (status === null) {
    console.warn(`Unknown status: ${project_status}`);
    return { runId: run.id, status: run.status };
  }

  // Determine data type from result
  const dataType = determineDataType(result);

  // Serialize result based on type
  let serializedResult: string | null = null;
  if (result !== undefined && result !== null) {
    serializedResult =
      typeof result === "string" ? result : JSON.stringify(result);
  }

  // Step 1: Atomic update to prevent race conditions
  const updateResult = await db.stakworkRun.updateMany({
    where: {
      id: run.id,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    },
    data: {
      status,
      result: serializedResult,
      dataType,
      updatedAt: new Date(),
    },
  });

  if (updateResult.count === 0) {
    console.warn(`Run ${run.id} was already updated by another request`);
    return { runId: run.id, status: run.status };
  }

  // Step 2: Broadcast via Pusher for real-time updates
  try {
    const channelName = getWorkspaceChannelName(run.workspace.slug);
    await pusherServer.trigger(channelName, PUSHER_EVENTS.STAKWORK_RUN_UPDATE, {
      runId: run.id,
      type: run.type,
      status,
      featureId: run.featureId,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error broadcasting to Pusher:", error);
    // Don't throw - webhook processing succeeded
  }

  return {
    runId: run.id,
    status,
    dataType,
  };
}

/**
 * Get Stakwork runs with filters
 */
export async function getStakworkRuns(
  query: StakworkRunQuery,
  userId: string
) {
  // Validate workspace access
  const workspace = await db.workspace.findUnique({
    where: { id: query.workspaceId },
    select: {
      id: true,
      ownerId: true,
      deleted: true,
      members: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!workspace || workspace.deleted) {
    throw new Error("Workspace not found");
  }

  const isOwner = workspace.ownerId === userId;
  const isMember = workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  // Build where clause
  const where: Prisma.StakworkRunWhereInput = {
    workspaceId: query.workspaceId,
    ...(query.type && { type: query.type }),
    ...(query.featureId && { featureId: query.featureId }),
    ...(query.status && { status: query.status }),
  };

  // Get total count
  const total = await db.stakworkRun.count({ where });

  // Get paginated runs
  const runs = await db.stakworkRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: query.offset,
    take: query.limit,
    include: {
      feature: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });

  return {
    runs,
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

/**
 * Update user decision on a Stakwork run
 * If ACCEPTED: updates StakworkRun.featureId and the appropriate feature field based on type
 * - ARCHITECTURE: updates feature.architecture
 * - Future: REQUIREMENTS, USER_STORIES, etc.
 */
export async function updateStakworkRunDecision(
  runId: string,
  userId: string,
  input: UpdateStakworkRunDecisionInput
) {
  const run = await db.stakworkRun.findUnique({
    where: { id: runId },
    include: {
      workspace: {
        select: {
          id: true,
          slug: true,
          ownerId: true,
          deleted: true,
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!run || run.workspace.deleted) {
    throw new Error("StakworkRun not found");
  }

  const isOwner = run.workspace.ownerId === userId;
  const isMember = run.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  // Prevent duplicate decisions (except for FEEDBACK which can be applied)
  if (run.decision && input.decision !== StakworkRunDecision.FEEDBACK) {
    throw new Error("This run has already been decided on");
  }

  // For FEEDBACK, require feedback text
  if (input.decision === StakworkRunDecision.FEEDBACK && !input.feedback) {
    throw new Error("Feedback is required when decision is FEEDBACK");
  }

  // If ACCEPTED, validate and verify the feature exists
  if (input.decision === StakworkRunDecision.ACCEPTED && input.featureId) {
    const feature = await db.feature.findUnique({
      where: { id: input.featureId },
      select: { id: true, workspaceId: true },
    });

    if (!feature) {
      throw new Error("Feature not found");
    }

    if (feature.workspaceId !== run.workspaceId) {
      throw new Error("Feature does not belong to the same workspace as the run");
    }
  }

  // Prepare update data
  const updateData: Prisma.StakworkRunUpdateInput = {
    decision: input.decision,
    feedback: input.feedback || null,
  };

  // If ACCEPTED, update the featureId using connect syntax for relation
  if (input.decision === StakworkRunDecision.ACCEPTED && input.featureId) {
    updateData.feature = {
      connect: { id: input.featureId }
    };
  }

  // Update the decision
  const updatedRun = await db.stakworkRun.update({
    where: { id: runId },
    data: updateData,
  });

  // Handle FEEDBACK case: Build history and create new run
  if (input.decision === StakworkRunDecision.FEEDBACK && updatedRun.featureId) {
    // Get full history including the current run with feedback
    const previousHistory = await getFeatureRunHistory(
      updatedRun.featureId,
      updatedRun.type
    );

    // Create new run with history
    const newRun = await createStakworkRun(
      {
        type: updatedRun.type,
        workspaceId: updatedRun.workspaceId,
        featureId: updatedRun.featureId,
        history: previousHistory,
      },
      userId
    );

    // Broadcast the new run creation
    try {
      const channelName = getWorkspaceChannelName(run.workspace.slug);
      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.STAKWORK_RUN_UPDATE,
        {
          runId: newRun.id,
          type: newRun.type,
          status: newRun.status,
          featureId: newRun.featureId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      console.error("Error broadcasting new run to Pusher:", error);
    }
  }

  // If ACCEPTED with result, update the appropriate feature field based on type
  if (
    input.decision === StakworkRunDecision.ACCEPTED &&
    updatedRun.featureId &&
    updatedRun.result
  ) {
    switch (updatedRun.type) {
      case StakworkRunType.ARCHITECTURE:
        await db.feature.update({
          where: { id: updatedRun.featureId },
          data: {
            architecture: updatedRun.result,
          },
        });
        break;

      case StakworkRunType.TASK_GENERATION:
        // Parse the result JSON (phasesTasksSchema format)
        const tasksData = JSON.parse(updatedRun.result);

        // Get feature and its first phase
        const featureWithPhase = await db.feature.findUnique({
          where: { id: updatedRun.featureId },
          include: {
            phases: {
              orderBy: { order: 'asc' },
              take: 1
            },
            workspace: {
              select: { id: true }
            }
          }
        });

        if (!featureWithPhase) {
          throw new Error("Feature not found");
        }

        const defaultPhase = featureWithPhase.phases[0];
        if (!defaultPhase) {
          throw new Error("No phase found for feature");
        }

        // Extract tasks from FIRST phase only (matches quick generation)
        const tasks = tasksData.phases[0]?.tasks || [];

        // Map tempId to real database ID for dependency handling
        const tempIdToRealId: Record<string, string> = {};

        // Create tasks sequentially to handle dependencies
        for (const task of tasks) {
          // Map tempId dependencies to real IDs
          const dependsOnTaskIds = (task.dependsOn || [])
            .map((tempId: string) => tempIdToRealId[tempId])
            .filter(Boolean);

          const createdTask = await db.task.create({
            data: {
              title: task.title,
              description: task.description || null,
              priority: task.priority,
              phaseId: defaultPhase.id,
              featureId: updatedRun.featureId,
              workspaceId: featureWithPhase.workspace.id,
              status: 'TODO',
              dependsOnTaskIds,
              createdById: userId,
              updatedById: userId,
            },
          });

          // Store mapping for next tasks' dependencies
          tempIdToRealId[task.tempId] = createdTask.id;
        }
        break;

      case StakworkRunType.REQUIREMENTS:
        if (!updatedRun.result) {
          throw new Error("No result found in run");
        }

        // Update feature.requirements field
        await db.feature.update({
          where: { id: updatedRun.featureId },
          data: { requirements: updatedRun.result },
        });
        break;

      case StakworkRunType.USER_STORIES:
        if (!updatedRun.result) {
          throw new Error("No result found in run");
        }

        try {
          const parsedStories = JSON.parse(updatedRun.result);

          if (!Array.isArray(parsedStories)) {
            throw new Error("Result is not an array");
          }

          // Create user stories from the parsed result, maintaining order
          for (const storyData of parsedStories) {
            if (!storyData.title || typeof storyData.title !== "string") {
              console.warn("Skipping invalid story data:", storyData);
              continue;
            }

            await createUserStory(updatedRun.featureId, userId, {
              title: storyData.title,
            });
          }
        } catch (error) {
          console.error("Failed to parse or create user stories:", error);
          throw new Error("Failed to process user stories result");
        }
        break;

      default:
        console.warn(`Unhandled StakworkRunType: ${updatedRun.type}`);
    }
  }

  // Broadcast decision via Pusher
  try {
    const channelName = getWorkspaceChannelName(run.workspace.slug);
    await pusherServer.trigger(
      channelName,
      PUSHER_EVENTS.STAKWORK_RUN_DECISION,
      {
        runId: updatedRun.id,
        type: updatedRun.type,
        featureId: updatedRun.featureId,
        decision: updatedRun.decision,
        timestamp: new Date(),
      }
    );
  } catch (error) {
    console.error("Error broadcasting decision to Pusher:", error);
    // Don't throw - decision update succeeded
  }

  return updatedRun;
}

/**
 * Helper to determine data type from result value
 */
function determineDataType(result: unknown): DataType {
  if (result === null || result === undefined) {
    return "null";
  }

  const type = typeof result;

  if (type === "string") {
    return "string";
  }

  if (type === "number") {
    return "number";
  }

  if (type === "boolean") {
    return "boolean";
  }

  if (Array.isArray(result)) {
    return "array";
  }

  if (type === "object") {
    return "json";
  }

  return "string"; // Fallback
}

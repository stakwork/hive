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
import { validateWorkspaceAccess } from "@/services/workspace";
import { stakworkService } from "@/lib/service-factory";
import { config } from "@/lib/env";
import { getBaseUrl } from "@/lib/utils";
import {
  pusherServer,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";

/**
 * Create a new Stakwork AI generation run
 * Follows the janitor pattern: Create DB record → Call Stakwork → Update with projectId
 */
export async function createStakworkRun(
  input: CreateStakworkRunInput,
  userId: string
) {
  // Validate workspace access
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    include: {
      swarm: {
        select: {
          swarmUrl: true,
          swarmSecretAlias: true,
          poolName: true,
          id: true,
        },
      },
    },
  });

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  // Fetch feature data if featureId provided and type is ARCHITECTURE
  let featureData: {
    title: string;
    brief: string | null;
    requirements: string | null;
    userStories: { title: string }[];
  } | null = null;

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
      },
    });

    if (!feature) {
      throw new Error("Feature not found");
    }

    // Store feature data for ARCHITECTURE type
    if (input.type === StakworkRunType.ARCHITECTURE) {
      featureData = {
        title: feature.title,
        brief: feature.brief,
        requirements: feature.requirements,
        userStories: feature.userStories,
      };
    }
  }

  // Step 1: Create DB record with PENDING status
  const baseUrl = getBaseUrl();
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${input.type}&workspace_id=${input.workspaceId}${input.featureId ? `&feature_id=${input.featureId}` : ""}`;

  let run = await db.stakworkRun.create({
    data: {
      type: input.type,
      workspaceId: input.workspaceId,
      featureId: input.featureId || null,
      status: WorkflowStatus.PENDING,
      webhookUrl,
      dataType: "json", // Default, will be updated by webhook
    },
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
      swarmUrl: workspace.swarm?.swarmUrl || null,
      swarmSecretAlias: workspace.swarm?.swarmSecretAlias || null,
      poolName: workspace.swarm?.poolName || workspace.swarm?.id || null,

      // Include feature data for ARCHITECTURE type
      ...(featureData && {
        featureTitle: featureData.title,
        featureBrief: featureData.brief,
        featureRequirements: featureData.requirements,
        featureUserStories: featureData.userStories.map((s) => s.title),
      }),

      // Allow params override
      ...(input.params || {}),
    };

    const stakworkPayload = {
      name: `ai-gen-${input.type.toLowerCase()}-${Date.now()}`,
      workflow_id: parseInt(workflowId),
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
    include: {
      members: {
        where: { userId },
      },
    },
  });

  if (!workspace || workspace.members.length === 0) {
    throw new Error("Workspace not found or access denied");
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
 * If ACCEPTED and type=ARCHITECTURE, also updates feature.architecture
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
        include: {
          members: {
            where: { userId },
          },
        },
        select: {
          slug: true,
          members: true,
        },
      },
    },
  });

  if (!run || run.workspace.members.length === 0) {
    throw new Error("StakworkRun not found or access denied");
  }

  // Update the decision
  const updatedRun = await db.stakworkRun.update({
    where: { id: runId },
    data: {
      decision: input.decision,
      feedback: input.feedback || null,
    },
  });

  // If ACCEPTED and ARCHITECTURE type, update feature.architecture
  if (
    input.decision === StakworkRunDecision.ACCEPTED &&
    updatedRun.type === StakworkRunType.ARCHITECTURE &&
    updatedRun.featureId &&
    updatedRun.result
  ) {
    await db.feature.update({
      where: { id: updatedRun.featureId },
      data: {
        architecture: updatedRun.result,
      },
    });
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

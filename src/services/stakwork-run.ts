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
  getWhiteboardChannelName,
  getFeatureChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { buildFeatureContext } from "@/lib/ai/utils";
import { EncryptionService } from "@/lib/encryption";
import { createUserStory } from "@/services/roadmap/user-stories";
import type { ParsedDiagram } from "@/services/excalidraw-layout";
import { logger } from "@/lib/logger";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";

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
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
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
      autoAccept: input.autoAccept ?? false,
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

    // Fetch history if includeHistory flag is set, then append any inline history
    let history: Array<{ role: "assistant" | "user"; content: string }> = [];
    if (input.includeHistory && input.featureId) {
      history = await getFeatureRunHistory(input.featureId, input.type);
    }
    if (input.history) {
      history = [...history, ...input.history];
    }

    const vars: Record<string, unknown> = {
      runId: run.id,
      type: input.type,
      workspaceId: input.workspaceId,
      featureId: input.featureId,
      webhookUrl,

      // Repository & credentials — send all repo URLs comma-separated for multi-repo support
      repo_url: workspace.repositories.map(r => r.repositoryUrl).join(",") || null,
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

      // Auto-accept flag
      autoAccept: input.autoAccept ?? false,

      // Skip clarifying questions flag
      skipClarifyingQuestions: input.params?.skipClarifyingQuestions ?? false,

      // Allow params override
      ...(input.params || {}),

      // Include conversation history if provided or fetched
      ...(history && history.length > 0 && {
        history,
      }),

      // Token reference for Stakwork
      tokenReference: getStakworkTokenReference(),
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
 * Create a lightweight Stakwork run for diagram generation.
 * Unlike createStakworkRun, this doesn't fetch repos, PATs, or swarm credentials.
 */
export async function createDiagramStakworkRun(input: {
  workspaceId: string;
  featureId?: string;
  whiteboardId: string;
  architectureText: string;
  layout: string;
  userId: string;
  diagramContext?: string | null;
}) {
  // Validate workspace access
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: {
      id: true,
      ownerId: true,
      deleted: true,
      members: {
        where: { userId: input.userId },
        select: { role: true },
      },
    },
  });

  if (!workspace || workspace.deleted) {
    throw new Error("Workspace not found");
  }

  const isOwner = workspace.ownerId === input.userId;
  const isMember = workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  const baseUrl = getBaseUrl();

  // Create DB record with PENDING status
  let run = await db.stakworkRun.create({
    data: {
      type: StakworkRunType.DIAGRAM_GENERATION,
      workspaceId: input.workspaceId,
      featureId: input.featureId ?? null,
      status: WorkflowStatus.PENDING,
      webhookUrl: "",
      dataType: "string",
    },
  });

  // Build webhook URL with layout param for post-processing
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=DIAGRAM_GENERATION&workspace_id=${input.workspaceId}&whiteboard_id=${input.whiteboardId}&layout=${input.layout}${input.featureId ? `&feature_id=${input.featureId}` : ''}`;
  const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?run_id=${run.id}`;

  await db.stakworkRun.update({
    where: { id: run.id },
    data: { webhookUrl },
  });

  try {
    const workflowId = config.STAKWORK_DIAGRAM_WORKFLOW_ID;
    if (!workflowId) {
      throw new Error("STAKWORK_DIAGRAM_WORKFLOW_ID not configured");
    }

    const vars: Record<string, unknown> = {
      runId: run.id,
      architectureText: input.architectureText,
      layout: input.layout,
      webhookUrl,
      tokenReference: getStakworkTokenReference(),
    };
    if (input.diagramContext) {
      vars.diagramContext = input.diagramContext;
    }

    const stakworkPayload = {
      name: `diagram-gen-${Date.now()}`,
      workflow_id: parseInt(workflowId),
      webhook_url: workflowWebhookUrl,
      workflow_params: {
        set_var: {
          attributes: { vars },
        },
      },
    };

    const response = await stakworkService().stakworkRequest<{
      success: boolean;
      data: { project_id: number };
    }>("/projects", stakworkPayload);

    const projectId = response?.data?.project_id;
    if (!projectId) {
      throw new Error("Failed to get project ID from Stakwork");
    }

    run = await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        projectId,
        status: WorkflowStatus.IN_PROGRESS,
      },
    });

    return run;
  } catch (error) {
    await db.stakworkRun.update({
      where: { id: run.id },
      data: { status: WorkflowStatus.FAILED },
    });
    throw error;
  }
}

/**
 * Extract diagram data (components + connections) from a Stakwork webhook result.
 * Stakwork may nest the diagram under `request_params.result`, so we check
 * multiple levels before giving up.
 */
function extractDiagramData(parsed: unknown): ParsedDiagram {
  logger.info("[diagram] extractDiagramData input", "stakwork-run", { type: typeof parsed });
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const topKeys = Object.keys(obj);
    logger.info("[diagram] extractDiagramData top-level keys", "stakwork-run", { keys: topKeys });

    // Helper to check for non-empty components at a given level
    const tryExtract = (source: Record<string, unknown>, label: string): ParsedDiagram | null => {
      if (Array.isArray(source.components) && source.components.length > 0) {
        logger.info(`[diagram] Found components at ${label}`, "stakwork-run", { count: source.components.length });
        return { components: source.components, connections: (source.connections as ParsedDiagram["connections"]) ?? [] };
      }
      if (Array.isArray(source.components)) {
        logger.info(`[diagram] Found empty components at ${label}, searching deeper`, "stakwork-run");
      }
      return null;
    };

    // Top-level components (backward compat)
    const topLevel = tryExtract(obj, "top-level");
    if (topLevel) return topLevel;

    // Nested under request_params.result (current Stakwork format)
    const rp = obj.request_params as Record<string, unknown> | undefined;
    if (rp && typeof rp === "object") {
      logger.info("[diagram] Found request_params", "stakwork-run", { keys: Object.keys(rp) });
      if (rp.result && typeof rp.result === "object") {
        const inner = rp.result as Record<string, unknown>;
        logger.info("[diagram] Found request_params.result", "stakwork-run", { keys: Object.keys(inner) });
        const nested = tryExtract(inner, "request_params.result");
        if (nested) return nested;
      }
      // Also try extracting directly from request_params (without .result nesting)
      const rpDirect = tryExtract(rp, "request_params");
      if (rpDirect) return rpDirect;
    }

    // Nested under .result (fallback)
    if (obj.result && typeof obj.result === "object") {
      const inner = obj.result as Record<string, unknown>;
      logger.info("[diagram] Found .result", "stakwork-run", { keys: Object.keys(inner) });
      const resultLevel = tryExtract(inner, ".result");
      if (resultLevel) return resultLevel;
    }

    // If result is a string, try parsing it as JSON (double-stringified)
    if (typeof obj.result === "string") {
      try {
        const innerParsed = JSON.parse(obj.result);
        if (innerParsed && typeof innerParsed === "object") {
          logger.info("[diagram] Parsed string .result as JSON", "stakwork-run", { keys: Object.keys(innerParsed) });
          const stringResult = tryExtract(innerParsed as Record<string, unknown>, ".result (parsed string)");
          if (stringResult) return stringResult;
        }
      } catch {
        // Not valid JSON, ignore
      }
    }

    // Log the actual structure to help debug
    logger.error("[diagram] Could not find non-empty components array", "stakwork-run", { structure: JSON.stringify(parsed).slice(0, 1000) });
  } else {
    logger.error("[diagram] Parsed result is not an object", "stakwork-run", { type: typeof parsed, value: String(parsed).slice(0, 200) });
  }

  throw new Error("Diagram data not found: expected components array in result");
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
    whiteboard_id?: string;
    layout?: string;
  }
) {
  const { result, project_status, project_id } = webhookData;
  const { workspace_id, feature_id, type } = queryParams;

  logger.info("[webhook] processStakworkRunWebhook called", "stakwork-run", {
    type,
    workspace_id,
    feature_id,
    project_id,
    project_status,
    hasResult: result !== undefined && result !== null,
    resultType: typeof result,
  });

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
          ownerId: true,
        },
      },
      feature: {
        select: {
          createdById: true,
        },
      },
    },
  });

  if (!run) {
    logger.error("[webhook] StakworkRun not found", "stakwork-run", { project_id, workspace_id, type, feature_id });
    throw new Error("StakworkRun not found");
  }

  logger.info("[webhook] Found run", "stakwork-run", { runId: run.id, runStatus: run.status, runType: run.type });

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
  // Include COMPLETED in the status filter so the result webhook can still
  // write data even if the status-only webhook (/api/stakwork/webhook) arrived first.
  const updateResult = await db.stakworkRun.updateMany({
    where: {
      id: run.id,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS, WorkflowStatus.COMPLETED] },
    },
    data: {
      status,
      result: serializedResult,
      dataType,
      updatedAt: new Date(),
    },
  });

  logger.info("[webhook] Atomic update result", "stakwork-run", { count: updateResult.count, runId: run.id, newStatus: status, dataType });

  if (updateResult.count === 0) {
    logger.warn("[webhook] Run was already updated by another request", "stakwork-run", { runId: run.id });
    return { runId: run.id, status: run.status };
  }

  // Step 2: Post-process DIAGRAM_GENERATION — run ELK layout and upsert/update whiteboard
  const { whiteboard_id } = queryParams;
  logger.debug("[diagram] Post-process check", "stakwork-run", {
    type,
    status,
    hasResult: !!serializedResult,
    resultLength: serializedResult?.length,
    feature_id,
    whiteboard_id,
  });
  
  if (
    type === "DIAGRAM_GENERATION" &&
    status === WorkflowStatus.COMPLETED &&
    serializedResult &&
    (feature_id || whiteboard_id)
  ) {
    try {
      logger.info("[diagram] Starting post-processing", "stakwork-run", { feature_id, whiteboard_id });
      logger.debug("[diagram] Raw serializedResult (first 500 chars)", "stakwork-run", { preview: serializedResult.slice(0, 500) });

      const { relayoutDiagram } = await import("@/services/excalidraw-layout");
      // Strip markdown code fences if LLM wrapped the JSON in ```json ... ```
      let cleanedResult = serializedResult.trim();
      if (cleanedResult.startsWith("```")) {
        cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      const parsedResult = JSON.parse(cleanedResult);
      logger.debug("[diagram] Parsed result", "stakwork-run", { type: typeof parsedResult, isArray: Array.isArray(parsedResult) });

      const diagramData = extractDiagramData(parsedResult);
      logger.info("[diagram] Extracted diagram", "stakwork-run", {
        componentCount: diagramData.components.length,
        connectionCount: diagramData.connections.length,
        componentNames: diagramData.components.map((c: { name?: string }) => c.name).slice(0, 10),
      });

      if (diagramData.components.length === 0) {
        throw new Error("Diagram has no components to layout");
      }

      const validLayouts = ["layered", "force", "stress", "mrtree"] as const;
      const layoutAlgo = validLayouts.includes(queryParams.layout as typeof validLayouts[number])
        ? (queryParams.layout as typeof validLayouts[number])
        : "layered";
      logger.info("[diagram] Running ELK layout", "stakwork-run", { algorithm: layoutAlgo });

      const layoutData = await relayoutDiagram(diagramData, layoutAlgo);
      logger.info("[diagram] Layout complete", "stakwork-run", { elementCount: layoutData.elements.length });

      let upsertedWhiteboard: { id: string } | null = null;

      if (feature_id) {
        // Feature-linked path: upsert whiteboard by featureId
        const feature = await db.feature.findUnique({
          where: { id: feature_id },
          select: { title: true },
        });

        await db.whiteboard.upsert({
          where: { featureId: feature_id },
          update: {
            elements: layoutData.elements as unknown as Prisma.InputJsonValue,
            appState: layoutData.appState as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
          create: {
            name: `${feature?.title || "Feature"} - Architecture`,
            workspaceId: workspace_id,
            featureId: feature_id,
            elements: layoutData.elements as unknown as Prisma.InputJsonValue,
            appState: layoutData.appState as Prisma.InputJsonValue,
            files: {},
          },
        });
        logger.info("[diagram] Whiteboard upserted successfully", "stakwork-run", { feature_id });

        upsertedWhiteboard = await db.whiteboard.findUnique({
          where: { featureId: feature_id },
          select: { id: true },
        });
      } else if (whiteboard_id) {
        // Standalone path: whiteboard already exists, just update elements
        await db.whiteboard.update({
          where: { id: whiteboard_id },
          data: {
            elements: layoutData.elements as unknown as Prisma.InputJsonValue,
            appState: layoutData.appState as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        logger.info("[diagram] Whiteboard updated successfully", "stakwork-run", { whiteboard_id });

        upsertedWhiteboard = await db.whiteboard.findUnique({
          where: { id: whiteboard_id },
          select: { id: true },
        });
      }

      // Persist ASSISTANT message and broadcast via Pusher
      if (upsertedWhiteboard) {
        const assistantMessage = await db.whiteboardMessage.create({
          data: {
            whiteboardId: upsertedWhiteboard.id,
            role: "ASSISTANT",
            content: "Diagram updated based on your request.",
            status: "SENT",
          },
        });

        try {
          const whiteboardChannel = getWhiteboardChannelName(upsertedWhiteboard.id);
          await pusherServer.trigger(
            whiteboardChannel,
            PUSHER_EVENTS.WHITEBOARD_CHAT_MESSAGE,
            { message: assistantMessage, timestamp: new Date() }
          );
        } catch (pusherError) {
          logger.error("[diagram] Failed to broadcast chat message", "stakwork-run", { error: String(pusherError) });
        }
      }
    } catch (postProcessError) {
      logger.error("[diagram] Error post-processing diagram generation", "stakwork-run", { error: String(postProcessError) });
      // Don't throw — the result is already saved in the run

      // Notify the user so the chat panel clears the spinner
      const errorWhiteboardId = whiteboard_id
        ?? (feature_id ? (await db.whiteboard.findUnique({ where: { featureId: feature_id }, select: { id: true } }))?.id : null);

      if (errorWhiteboardId) {
        try {
          const errorMessage = await db.whiteboardMessage.create({
            data: {
              whiteboardId: errorWhiteboardId,
              role: "ASSISTANT",
              content: "Sorry, I couldn't process the diagram. Please try again.",
              status: "SENT",
            },
          });

          const errorChannel = getWhiteboardChannelName(errorWhiteboardId);
          await pusherServer.trigger(errorChannel, PUSHER_EVENTS.WHITEBOARD_CHAT_MESSAGE, {
            message: errorMessage,
            timestamp: new Date(),
          });
        } catch (notifyError) {
          logger.error("[diagram] Failed to notify user of error", "stakwork-run", { error: String(notifyError) });
        }
      }
    }
  }

  // Step 3: Broadcast via Pusher for real-time updates
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

  // Step 3: Auto-accept if flag is set and run completed successfully
  if (run.autoAccept && status === WorkflowStatus.COMPLETED && run.featureId && serializedResult) {
    try {
      await db.stakworkRun.update({
        where: { id: run.id },
        data: { decision: StakworkRunDecision.ACCEPTED },
      });

      await applyAcceptResult(
        {
          type: run.type,
          featureId: run.featureId,
          result: serializedResult,
          workspaceId: run.workspaceId,
        },
        run.feature?.createdById ?? run.workspace.ownerId
      );

      // Broadcast the auto-accept decision
      try {
        const channelName = getWorkspaceChannelName(run.workspace.slug);
        await pusherServer.trigger(
          channelName,
          PUSHER_EVENTS.STAKWORK_RUN_DECISION,
          {
            runId: run.id,
            type: run.type,
            featureId: run.featureId,
            decision: StakworkRunDecision.ACCEPTED,
            timestamp: new Date(),
          }
        );
      } catch (pusherError) {
        console.error("Error broadcasting auto-accept decision to Pusher:", pusherError);
      }

      // Also notify feature channel so plan mode listeners refetch
      try {
        const featureChannelName = getFeatureChannelName(run.featureId);
        await pusherServer.trigger(featureChannelName, PUSHER_EVENTS.FEATURE_UPDATED, {
          featureId: run.featureId,
          timestamp: new Date().toISOString(),
        });
      } catch (pusherError) {
        console.error("Error broadcasting feature update to Pusher:", pusherError);
      }
    } catch (error) {
      console.error(`Auto-accept failed for run ${run.id}:`, error);
      // Don't throw - the webhook result was already saved successfully
    }
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
 * Apply the accepted result to the appropriate feature field based on run type.
 * Shared between manual accept (updateStakworkRunDecision) and auto-accept (webhook).
 */
async function applyAcceptResult(
  run: { type: StakworkRunType; featureId: string; result: string; workspaceId: string },
  userId: string
) {
  switch (run.type) {
    case StakworkRunType.ARCHITECTURE:
      await db.feature.update({
        where: { id: run.featureId },
        data: { architecture: run.result },
      });
      break;

    case StakworkRunType.TASK_GENERATION: {
      const tasksData = JSON.parse(run.result);

      // Defensive: handle phases being a JSON string instead of a parsed array
      // (can happen when the Stakwork workflow double-serializes the LLM output)
      if (typeof tasksData.phases === "string") {
        tasksData.phases = JSON.parse(tasksData.phases);
      }

      const featureWithPhase = await db.feature.findUnique({
        where: { id: run.featureId },
        include: {
          phases: { orderBy: { order: "asc" }, take: 1 },
          workspace: { select: { id: true } },
        },
      });

      if (!featureWithPhase) {
        throw new Error("Feature not found");
      }

      const defaultPhase = featureWithPhase.phases[0];
      if (!defaultPhase) {
        throw new Error("No phase found for feature");
      }

      // Build URL→ID map for multi-repo task assignment
      const repos = await db.repository.findMany({
        where: { workspaceId: featureWithPhase.workspace.id },
        select: { id: true, repositoryUrl: true },
      });
      const repoUrlToId = new Map(repos.map(r => [r.repositoryUrl, r.id]));
      const firstRepoId = repos[0]?.id || null;

      const tasks = tasksData.phases[0]?.tasks || [];
      const tempIdToRealId: Record<string, string> = {};

      for (const task of tasks) {
        const dependsOnTaskIds = (task.dependsOn || [])
          .map((tempId: string) => tempIdToRealId[tempId])
          .filter(Boolean);

        // Resolve repositoryId from repoUrl if provided by AI, fallback to first repo
        const repositoryId = (task.repoUrl && repoUrlToId.get(task.repoUrl)) || firstRepoId;

        const createdTask = await db.task.create({
          data: {
            title: task.title,
            description: task.description || null,
            priority: task.priority,
            phaseId: defaultPhase.id,
            featureId: run.featureId,
            workspaceId: featureWithPhase.workspace.id,
            status: "TODO",
            dependsOnTaskIds,
            repositoryId,
            createdById: userId,
            updatedById: userId,
          },
        });

        tempIdToRealId[task.tempId] = createdTask.id;
      }
      break;
    }

    case StakworkRunType.REQUIREMENTS:
      await db.feature.update({
        where: { id: run.featureId },
        data: { requirements: run.result },
      });
      break;

    case StakworkRunType.USER_STORIES: {
      const parsedStories = JSON.parse(run.result);

      if (!Array.isArray(parsedStories)) {
        throw new Error("Result is not an array");
      }

      for (const storyData of parsedStories) {
        if (!storyData.title || typeof storyData.title !== "string") {
          console.warn("Skipping invalid story data:", storyData);
          continue;
        }

        await createUserStory(run.featureId, userId, {
          title: storyData.title,
        });
      }
      break;
    }

    default:
      console.warn(`Unhandled StakworkRunType: ${run.type}`);
  }
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

    // Create new run with history (preserve autoAccept from the original run)
    const newRun = await createStakworkRun(
      {
        type: updatedRun.type,
        workspaceId: updatedRun.workspaceId,
        featureId: updatedRun.featureId,
        history: previousHistory,
        autoAccept: updatedRun.autoAccept,
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

  // If ACCEPTED with result, apply to the feature
  if (
    input.decision === StakworkRunDecision.ACCEPTED &&
    updatedRun.featureId &&
    updatedRun.result
  ) {
    await applyAcceptResult(
      {
        type: updatedRun.type,
        featureId: updatedRun.featureId,
        result: updatedRun.result,
        workspaceId: updatedRun.workspaceId,
      },
      userId
    );
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

/**
 * Stop an in-progress Stakwork run
 * @param runId - The run ID to stop
 * @param userId - The authenticated user ID
 * @returns Updated StakworkRun with status HALTED
 * @throws Error if run not found, workspace access denied, or projectId is null
 */
export async function stopStakworkRun(
  runId: string,
  userId: string,
) {
  // Query run with workspace access validation
  const run = await db.stakworkRun.findUnique({
    where: { id: runId },
    include: {
      workspace: {
        select: {
          id: true,
          slug: true,
          ownerId: true,
          deleted: true,
          members: { where: { userId }, select: { role: true } },
        },
      },
    },
  });

  // Validate run exists
  if (!run) {
    throw new Error("Run not found");
  }

  // Validate workspace not deleted
  if (run.workspace.deleted) {
    throw new Error("Workspace has been deleted");
  }

  // Validate user access (must be owner or member)
  const isOwner = run.workspace.ownerId === userId;
  const isMember = run.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied: user is not a member of this workspace");
  }

  // Validate projectId exists
  if (!run.projectId) {
    throw new Error("Run does not have a projectId - cannot stop");
  }

  // Attempt to stop the Stakwork project (optimistic - don't fail if API errors)
  try {
    await stakworkService().stopProject(run.projectId);
  } catch (error) {
    console.error(`Failed to stop Stakwork project ${run.projectId}:`, error);
    // Continue with optimistic update even if Stakwork API fails
  }

  // Optimistically update the run
  const updatedRun = await db.stakworkRun.update({
    where: { id: runId },
    data: {
      status: WorkflowStatus.HALTED,
      result: null,
      feedback: null,
    },
  });

  // Broadcast Pusher event for real-time UI updates
  try {
    const channelName = getWorkspaceChannelName(run.workspace.slug);
    await pusherServer.trigger(channelName, PUSHER_EVENTS.STAKWORK_RUN_UPDATE, {
      runId: updatedRun.id,
      type: updatedRun.type,
      status: WorkflowStatus.HALTED,
      featureId: updatedRun.featureId,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error broadcasting to Pusher:", error);
    // Don't throw - update succeeded
  }

  return updatedRun;
}

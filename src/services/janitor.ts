import { db } from "@/lib/db";
import {
  JanitorType,
  JanitorStatus,
  JanitorTrigger,
  RecommendationStatus,
  Priority,
  Prisma,
} from "@prisma/client";
import {
  JanitorConfigUpdate,
  AcceptRecommendationRequest,
  DismissRecommendationRequest,
  StakworkWebhookPayload,
  JanitorRunFilters,
  JanitorRecommendationFilters,
} from "@/types/janitor";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { validateWorkspaceAccess } from "@/services/workspace";
import { createTaskWithStakworkWorkflow } from "@/services/task-workflow";
import { stakworkService } from "@/lib/service-factory";
import { config as envConfig } from "@/lib/env";

/**
 * Get or create janitor configuration for a workspace
 */
export async function getOrCreateJanitorConfig(workspaceSlug: string, userId: string) {
  const validation = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!validation.hasAccess || !validation.canRead) {
    throw new Error(JANITOR_ERRORS.WORKSPACE_NOT_FOUND);
  }

  const workspaceId = validation.workspace!.id;
  let config = await db.janitorConfig.findUnique({
    where: { workspaceId }
  });

  if (!config) {
    config = await db.janitorConfig.create({
      data: { workspaceId }
    });
  }

  return config;
}

/**
 * Update janitor configuration
 */
export async function updateJanitorConfig(
  workspaceSlug: string,
  userId: string,
  data: JanitorConfigUpdate
) {
  const validation = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!validation.hasAccess || !validation.canAdmin) {
    throw new Error(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  const workspaceId = validation.workspace!.id;
  let config = await db.janitorConfig.findUnique({
    where: { workspaceId }
  });

  if (!config) {
    config = await db.janitorConfig.create({
      data: { workspaceId }
    });
  }

  return await db.janitorConfig.update({
    where: { id: config.id },
    data,
  });
}

/**
 * Create a new janitor run
 */
export async function createJanitorRun(
  workspaceSlug: string,
  userId: string,
  janitorTypeString: string,
  triggeredBy: JanitorTrigger = "MANUAL"
) {
  const validation = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!validation.hasAccess || !validation.canWrite) {
    throw new Error(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  // Parse janitor type
  const janitorTypeUpper = janitorTypeString.toUpperCase();
  if (!Object.values(JanitorType).includes(janitorTypeUpper as JanitorType)) {
    throw new Error(`Invalid janitor type: ${janitorTypeString}`);
  }
  const janitorType = janitorTypeUpper as JanitorType;

  const workspaceId = validation.workspace!.id;
  let config = await db.janitorConfig.findUnique({
    where: { workspaceId }
  });

  if (!config) {
    config = await db.janitorConfig.create({
      data: { workspaceId }
    });
  }

  // Check if janitor is enabled
  const enabledField = janitorType === "UNIT_TESTS" 
    ? "unitTestsEnabled" 
    : "integrationTestsEnabled";
  
  if (!config[enabledField]) {
    throw new Error(JANITOR_ERRORS.JANITOR_DISABLED);
  }

  // Allow multiple manual runs - concurrent check removed for manual triggers
  // This will be replaced by cron scheduling in the future

  // First create the database record without stakwork project ID
  let janitorRun = await db.janitorRun.create({
    data: {
      janitorConfigId: config.id,
      janitorType,
      triggeredBy,
      status: "PENDING",
      metadata: {
        triggeredByUserId: userId,
        workspaceId,
      }
    },
    include: {
      janitorConfig: {
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
                }
              }
            }
          }
        }
      }
    }
  });

  try {
    // Check if Stakwork is configured for janitors
    if (!envConfig.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for janitor runs");
    }
    if (!envConfig.STAKWORK_JANITOR_WORKFLOW_ID) {
      throw new Error("STAKWORK_JANITOR_WORKFLOW_ID is required for janitor runs");
    }

    // Get workflow ID - single workflow for janitors
    const workflowId = envConfig.STAKWORK_JANITOR_WORKFLOW_ID;

    // Build webhook URL for janitor completion (recommendations endpoint)
    const baseUrl = envConfig.STAKWORK_BASE_URL;
    const webhookUrl = `${baseUrl.replace('/api/v1', '')}/api/janitors/webhook`;

    // Get swarm data from workspace
    const swarm = janitorRun.janitorConfig.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl || "";
    const swarmSecretAlias = swarm?.swarmSecretAlias || "";

    // Prepare variables - include janitorType, webhookUrl, swarmUrl, and swarmSecretAlias
    const vars = {
      janitorType: janitorType,
      webhookUrl: webhookUrl,
      swarmUrl: swarmUrl,
      swarmSecretAlias: swarmSecretAlias,
    };

    // Create Stakwork project using the stakworkRequest method (following existing pattern)
    const stakworkPayload = {
      name: `janitor-${janitorType.toLowerCase()}-${Date.now()}`,
      workflow_id: parseInt(workflowId),
      workflow_params: {
        set_var: {
          attributes: {
            vars
          }
        }
      }
    };

    const stakworkProject = await stakworkService().stakworkRequest(
      "/projects",
      stakworkPayload
    );

    // Extract project ID from Stakwork response
    const projectId = (stakworkProject as any)?.data?.project_id;

    if (!projectId) {
      console.error("No project_id found in Stakwork response:", stakworkProject);
      throw new Error("No project ID returned from Stakwork");
    }


    // Update the run with the Stakwork project ID
    janitorRun = await db.janitorRun.update({
      where: { id: janitorRun.id },
      data: {
        stakworkProjectId: projectId,
        status: "RUNNING",
        startedAt: new Date(),
      },
      include: {
        janitorConfig: {
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
                  }
                }
              }
            }
          }
        }
      }
    });

    return janitorRun;

  } catch (stakworkError) {
    console.error("Failed to create Stakwork project for janitor run:", stakworkError);
    
    // Update the run status to failed
    await db.janitorRun.update({
      where: { id: janitorRun.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: `Failed to initialize Stakwork project: ${stakworkError instanceof Error ? stakworkError.message : 'Unknown error'}`
      }
    });

    // Throw error to be handled by the API route
    throw new Error(`Failed to start janitor run: ${stakworkError instanceof Error ? stakworkError.message : 'Stakwork integration failed'}`);
  }
}



/**
 * Get janitor runs with filters
 */
export async function getJanitorRuns(
  workspaceSlug: string,
  userId: string,
  filters: JanitorRunFilters = {}
) {
  const validation = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!validation.hasAccess || !validation.canRead) {
    throw new Error(JANITOR_ERRORS.WORKSPACE_NOT_FOUND);
  }

  const workspaceId = validation.workspace!.id;
  let config = await db.janitorConfig.findUnique({
    where: { workspaceId }
  });

  if (!config) {
    config = await db.janitorConfig.create({
      data: { workspaceId }
    });
  }
  
  const { type, status, limit = 10, page = 1 } = filters;
  const skip = (page - 1) * limit;

  const where: Prisma.JanitorRunWhereInput = {
    janitorConfigId: config.id,
  };

  if (type) {
    where.janitorType = type;
  }

  if (status) {
    where.status = status;
  }

  const [runs, total] = await Promise.all([
    db.janitorRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        _count: {
          select: {
            recommendations: true
          }
        }
      }
    }),
    db.janitorRun.count({ where })
  ]);

  return {
    runs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    }
  };
}

/**
 * Get janitor recommendations with filters
 */
export async function getJanitorRecommendations(
  workspaceSlug: string,
  userId: string,
  filters: JanitorRecommendationFilters = {}
) {
  const validation = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!validation.hasAccess || !validation.canRead) {
    throw new Error(JANITOR_ERRORS.WORKSPACE_NOT_FOUND);
  }

  const workspaceId = validation.workspace!.id;
  const config = await db.janitorConfig.findUnique({
    where: { workspaceId }
  });

  if (!config) {
    return {
      recommendations: [],
      pagination: {
        page: 1,
        limit: filters.limit || 10,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      }
    };
  }

  const { status, janitorType, priority, limit = 10, page = 1 } = filters;
  const skip = (page - 1) * limit;

  const where: Prisma.JanitorRecommendationWhereInput = {
    janitorRun: {
      janitorConfigId: config.id,
      ...(janitorType && { janitorType }),
    }
  };

  // Default to PENDING status if no status filter is provided
  if (status) {
    where.status = status;
  } else {
    where.status = "PENDING";
  }

  if (priority) {
    where.priority = priority;
  }

  const [recommendations, total] = await Promise.all([
    db.janitorRecommendation.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { priority: "desc" },
        { createdAt: "desc" }
      ],
      skip,
      take: limit,
      include: {
        janitorRun: {
          select: {
            id: true,
            janitorType: true,
            status: true,
            createdAt: true,
          }
        },
        acceptedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
        dismissedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    }),
    db.janitorRecommendation.count({ where })
  ]);

  return {
    recommendations,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    }
  };
}

/**
 * Accept a janitor recommendation and create a task
 */
export async function acceptJanitorRecommendation(
  recommendationId: string,
  userId: string,
  options: AcceptRecommendationRequest = {}
) {
  const recommendation = await db.janitorRecommendation.findUnique({
    where: { id: recommendationId },
    include: {
      janitorRun: {
        include: {
          janitorConfig: {
            include: {
              workspace: true
            }
          }
        }
      }
    }
  });

  if (!recommendation) {
    throw new Error(JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND);
  }

  // Verify user has permission - use proper workspace validation
  const workspaceSlug = recommendation.janitorRun.janitorConfig.workspace.slug;
  const validation = await validateWorkspaceAccess(workspaceSlug, userId);
  
  if (!validation.hasAccess || !validation.canWrite) {
    throw new Error(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  if (recommendation.status !== "PENDING") {
    throw new Error(JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED);
  }

  // Validate assignee if provided
  if (options.assigneeId) {
    const assigneeExists = await db.workspaceMember.findFirst({
      where: {
        userId: options.assigneeId,
        workspaceId: recommendation.janitorRun.janitorConfig.workspace.id
      }
    });

    if (!assigneeExists) {
      throw new Error(JANITOR_ERRORS.ASSIGNEE_NOT_MEMBER);
    }
  }

  // Validate repository if provided
  if (options.repositoryId) {
    const repositoryExists = await db.repository.findFirst({
      where: {
        id: options.repositoryId,
        workspaceId: recommendation.janitorRun.janitorConfig.workspace.id
      }
    });

    if (!repositoryExists) {
      throw new Error(JANITOR_ERRORS.REPOSITORY_NOT_FOUND);
    }
  }

  // Update recommendation status 
  const updatedRecommendation = await db.janitorRecommendation.update({
    where: { id: recommendationId },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      acceptedById: userId,
      metadata: {
        ...recommendation.metadata as object,
        assigneeId: options.assigneeId,
        repositoryId: options.repositoryId,
      }
    }
  });

  // Create task and trigger Stakwork workflow using shared service
  const message = `Task: ${recommendation.title}\n\nDescription: ${recommendation.description}\n\n. Please implement the requested changes.`;
  
  const taskResult = await createTaskWithStakworkWorkflow({
    title: recommendation.title,
    description: recommendation.description,
    workspaceId: recommendation.janitorRun.janitorConfig.workspace.id,
    assigneeId: options.assigneeId,
    repositoryId: options.repositoryId,
    priority: recommendation.priority,
    sourceType: "JANITOR",
    userId: userId,
    initialMessage: message,
    mode: "live"  // Use production workflow for janitor-created tasks
  });

  return { 
    recommendation: updatedRecommendation,
    task: taskResult.task,
    workflow: taskResult.stakworkResult
  };
}

/**
 * Dismiss a janitor recommendation
 */
export async function dismissJanitorRecommendation(
  recommendationId: string,
  userId: string,
  options: DismissRecommendationRequest = {}
) {
  const recommendation = await db.janitorRecommendation.findUnique({
    where: { id: recommendationId },
    include: {
      janitorRun: {
        include: {
          janitorConfig: {
            include: {
              workspace: true
            }
          }
        }
      }
    }
  });

  if (!recommendation) {
    throw new Error(JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND);
  }

  // Verify user has permission - use proper workspace validation
  const workspaceSlug = recommendation.janitorRun.janitorConfig.workspace.slug;
  const validation = await validateWorkspaceAccess(workspaceSlug, userId);
  
  if (!validation.hasAccess || !validation.canWrite) {
    throw new Error(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  if (recommendation.status !== "PENDING") {
    throw new Error(JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED);
  }

  return await db.janitorRecommendation.update({
    where: { id: recommendationId },
    data: {
      status: "DISMISSED",
      dismissedAt: new Date(),
      dismissedById: userId,
      metadata: {
        ...recommendation.metadata as object,
        dismissalReason: options.reason,
      }
    },
    include: {
      dismissedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        }
      }
    }
  });
}

/**
 * Process Stakwork webhook for janitor run completion
 */
export async function processJanitorWebhook(webhookData: StakworkWebhookPayload) {
  const { projectId, status, results, error } = webhookData;

  const isCompleted = status.toLowerCase() === "completed" || status.toLowerCase() === "success";
  const isFailed = status.toLowerCase() === "failed" || status.toLowerCase() === "error";

  if (isCompleted) {
    // Use atomic updateMany to prevent race conditions
    const updateResult = await db.janitorRun.updateMany({
      where: {
        stakworkProjectId: projectId,
        status: { in: ["PENDING", "RUNNING"] }
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      }
    });

    if (updateResult.count === 0) {
      throw new Error(JANITOR_ERRORS.RUN_NOT_FOUND);
    }

    // Get the updated run for processing recommendations
    const janitorRun = await db.janitorRun.findFirst({
      where: {
        stakworkProjectId: projectId,
        status: "COMPLETED"
      },
      include: {
        janitorConfig: {
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
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    });

    if (!janitorRun) {
      throw new Error(JANITOR_ERRORS.RUN_NOT_FOUND);
    }

    // Update metadata and create recommendations in a transaction
    await db.$transaction(async (tx) => {
      await tx.janitorRun.update({
        where: { id: janitorRun.id },
        data: {
          metadata: {
            ...janitorRun.metadata as object,
            stakworkStatus: status,
            completedByWebhook: true,
          }
        }
      });

      if (results?.recommendations?.length) {
        const recommendations = results.recommendations.map(rec => {
          let priority: Priority = "MEDIUM";
          
          if (rec.priority) {
            const priorityUpper = rec.priority.toUpperCase();
            if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priorityUpper)) {
              priority = priorityUpper as Priority;
            }
          }

          return {
            janitorRunId: janitorRun.id,
            title: rec.title,
            description: rec.description,
            priority,
            impact: rec.impact,
            status: "PENDING" as RecommendationStatus,
            metadata: {
              ...rec.metadata,
              source: "stakwork_webhook",
              janitorType: janitorRun.janitorType,
              workspaceId: janitorRun.janitorConfig.workspace.id,
            }
          };
        });

        await tx.janitorRecommendation.createMany({
          data: recommendations
        });
      }
    });

    return {
      runId: janitorRun.id,
      status: "COMPLETED" as JanitorStatus,
      recommendationCount: results?.recommendations?.length || 0
    };
  } else if (isFailed) {
    // Use atomic updateMany to prevent race conditions
    const updateResult = await db.janitorRun.updateMany({
      where: {
        stakworkProjectId: projectId,
        status: { in: ["PENDING", "RUNNING"] }
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: error || `Stakwork project failed with status: ${status}`,
      }
    });

    if (updateResult.count === 0) {
      throw new Error(JANITOR_ERRORS.RUN_NOT_FOUND);
    }

    // Get the updated run for return data
    const janitorRun = await db.janitorRun.findFirst({
      where: {
        stakworkProjectId: projectId,
        status: "FAILED"
      },
      orderBy: { updatedAt: "desc" }
    });

    if (janitorRun) {
      // Update metadata separately
      await db.janitorRun.update({
        where: { id: janitorRun.id },
        data: {
          metadata: {
            ...janitorRun.metadata as object,
            stakworkStatus: status,
            failedByWebhook: true,
          }
        }
      });
    }

    return {
      runId: janitorRun?.id || "",
      status: "FAILED" as JanitorStatus,
      error: error || status
    };
  } else {
    // Use atomic updateMany to prevent race conditions
    const updateResult = await db.janitorRun.updateMany({
      where: {
        stakworkProjectId: projectId,
        status: { in: ["PENDING", "RUNNING"] }
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
      }
    });

    if (updateResult.count === 0) {
      throw new Error(JANITOR_ERRORS.RUN_NOT_FOUND);
    }

    // Get the updated run for metadata update
    const janitorRun = await db.janitorRun.findFirst({
      where: {
        stakworkProjectId: projectId,
        status: "RUNNING"
      },
      orderBy: { updatedAt: "desc" }
    });

    if (janitorRun) {
      // Update metadata separately
      await db.janitorRun.update({
        where: { id: janitorRun.id },
        data: {
          metadata: {
            ...janitorRun.metadata as object,
            stakworkStatus: status,
            lastWebhookUpdate: new Date(),
          }
        }
      });
    }

    return {
      runId: janitorRun?.id || "",
      status: "RUNNING" as JanitorStatus
    };
  }
}


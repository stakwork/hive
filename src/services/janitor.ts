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
import { JANITOR_ERRORS, JANITOR_PERMISSION_LEVELS } from "@/lib/constants/janitor";

/**
 * Get or create janitor configuration for a workspace
 */
export async function getOrCreateJanitorConfig(workspaceId: string) {
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
  workspaceId: string,
  userId: string,
  data: JanitorConfigUpdate
) {
  // Verify user has permission
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
      role: { in: JANITOR_PERMISSION_LEVELS.CONFIGURE }
    }
  });

  if (!member) {
    throw new Error(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  const config = await getOrCreateJanitorConfig(workspaceId);

  return await db.janitorConfig.update({
    where: { id: config.id },
    data,
  });
}

/**
 * Create a new janitor run
 */
export async function createJanitorRun(
  workspaceId: string,
  userId: string,
  janitorType: JanitorType,
  triggeredBy: JanitorTrigger = "MANUAL"
) {
  // Verify user has permission
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
      role: { in: JANITOR_PERMISSION_LEVELS.EXECUTE }
    }
  });

  if (!member) {
    throw new Error(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  const config = await getOrCreateJanitorConfig(workspaceId);

  // Check if janitor is enabled
  const enabledField = janitorType === "UNIT_TESTS" 
    ? "unitTestsEnabled" 
    : "integrationTestsEnabled";
  
  if (!config[enabledField]) {
    throw new Error(JANITOR_ERRORS.JANITOR_DISABLED);
  }

  // Check for existing run in progress
  const existingRun = await db.janitorRun.findFirst({
    where: {
      janitorConfigId: config.id,
      janitorType,
      status: { in: ["PENDING", "RUNNING"] }
    }
  });

  if (existingRun) {
    throw new Error(JANITOR_ERRORS.RUN_IN_PROGRESS);
  }

  // Create new run
  return await db.janitorRun.create({
    data: {
      janitorConfigId: config.id,
      janitorType,
      triggeredBy,
      status: "PENDING",
      metadata: {
        triggeredByUserId: userId,
        workspaceId,
      }
    }
  });
}

/**
 * Get janitor runs with filters
 */
export async function getJanitorRuns(
  workspaceId: string,
  filters: JanitorRunFilters = {}
) {
  const config = await getOrCreateJanitorConfig(workspaceId);
  
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
  workspaceId: string,
  filters: JanitorRecommendationFilters = {}
) {
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

  if (status) {
    where.status = status;
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

  // Verify user has permission
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId: recommendation.janitorRun.janitorConfig.workspace.id,
      userId,
      role: { in: JANITOR_PERMISSION_LEVELS.EXECUTE }
    }
  });

  if (!member) {
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

  // Use transaction to ensure consistency
  return await db.$transaction(async (tx) => {
    const updatedRecommendation = await tx.janitorRecommendation.update({
      where: { id: recommendationId },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedById: userId,
      }
    });

    const task = await tx.task.create({
      data: {
        title: recommendation.title,
        description: recommendation.description,
        workspaceId: recommendation.janitorRun.janitorConfig.workspace.id,
        assigneeId: options.assigneeId,
        repositoryId: options.repositoryId,
        priority: recommendation.priority,
        sourceType: "JANITOR",
        createdById: userId,
        updatedById: userId,
      },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
        repository: {
          select: {
            id: true,
            name: true,
            repositoryUrl: true,
          }
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    });

    return { recommendation: updatedRecommendation, task };
  });
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

  // Verify user has permission
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId: recommendation.janitorRun.janitorConfig.workspace.id,
      userId,
      role: { in: JANITOR_PERMISSION_LEVELS.EXECUTE }
    }
  });

  if (!member) {
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

  const janitorRun = await db.janitorRun.findFirst({
    where: { 
      stakworkProjectId: projectId,
      status: { in: ["PENDING", "RUNNING"] }
    },
    include: {
      janitorConfig: {
        include: {
          workspace: true
        }
      }
    }
  });

  if (!janitorRun) {
    throw new Error(JANITOR_ERRORS.RUN_NOT_FOUND);
  }

  const isCompleted = status.toLowerCase() === "completed" || status.toLowerCase() === "success";
  const isFailed = status.toLowerCase() === "failed" || status.toLowerCase() === "error";

  if (isCompleted) {
    await db.$transaction(async (tx) => {
      await tx.janitorRun.update({
        where: { id: janitorRun.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
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
    await db.janitorRun.update({
      where: { id: janitorRun.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: error || `Stakwork project failed with status: ${status}`,
        metadata: {
          ...janitorRun.metadata as object,
          stakworkStatus: status,
          failedByWebhook: true,
        }
      }
    });

    return {
      runId: janitorRun.id,
      status: "FAILED" as JanitorStatus,
      error: error || status
    };
  } else {
    await db.janitorRun.update({
      where: { id: janitorRun.id },
      data: {
        status: "RUNNING",
        startedAt: janitorRun.startedAt || new Date(),
        metadata: {
          ...janitorRun.metadata as object,
          stakworkStatus: status,
          lastWebhookUpdate: new Date(),
        }
      }
    });

    return {
      runId: janitorRun.id,
      status: "RUNNING" as JanitorStatus
    };
  }
}

/**
 * Check if a janitor type is enabled for a workspace
 */
export async function isJanitorEnabled(
  workspaceId: string,
  janitorType: JanitorType
): Promise<boolean> {
  const config = await db.janitorConfig.findUnique({
    where: { workspaceId }
  });

  if (!config) return false;

  switch (janitorType) {
    case "UNIT_TESTS":
      return config.unitTestsEnabled;
    case "INTEGRATION_TESTS":
      return config.integrationTestsEnabled;
    default:
      return false;
  }
}
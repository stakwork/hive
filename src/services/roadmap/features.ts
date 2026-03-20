import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority, NotificationTriggerType, Prisma } from "@prisma/client";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { validateFeatureAccess } from "./utils";
import { USER_SELECT } from "@/lib/db/selects";
import { validateEnum } from "@/lib/validators";
import { getSystemAssigneeUser } from "@/lib/system-assignees";
import { createAndSendNotification } from "@/services/notifications";

/**
 * Lists features for a workspace with pagination, filtering, and sorting
 */
export async function listFeatures({
  workspaceId,
  userId,
  page = 1,
  limit = 10,
  statuses,
  priorities,
  assigneeId,
  search,
  sortBy,
  sortOrder,
  needsAttention,
}: {
  workspaceId: string;
  userId: string;
  page?: number;
  limit?: number;
  statuses?: FeatureStatus[]; // Array of statuses for multi-select filtering
  priorities?: FeaturePriority[]; // Array of priorities for multi-select filtering
  assigneeId?: string; // String including "UNASSIGNED" special value
  search?: string; // Text search for feature title
  sortBy?: "title" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
  needsAttention?: boolean; // Filter features that have pending StakworkRuns awaiting user decision
}) {
  const workspaceAccess = await validateWorkspaceAccessById(workspaceId, userId);
  if (!workspaceAccess.hasAccess) {
    throw new Error("Access denied");
  }

  const skip = (page - 1) * limit;

  // Build where clause with filters
  const whereClause: any = {
    workspaceId,
    deleted: false,
  };

  // Handle multiple statuses with Prisma 'in' clause
  if (statuses && statuses.length > 0) {
    whereClause.status = { in: statuses };
  }

  // Handle multiple priorities with Prisma 'in' clause
  if (priorities && priorities.length > 0) {
    whereClause.priority = { in: priorities };
  }

  // Handle assigneeId filter — mirrors the UI Owner column (assignee ?? createdBy)
  if (assigneeId !== undefined) {
    if (assigneeId === "UNASSIGNED") {
      // Return features with no assignee set (regardless of creator)
      whereClause.assigneeId = null;
    } else {
      // Return features where the user is the explicit assignee OR
      // the creator when no assignee is set (matching the displayed owner)
      whereClause.OR = [
        { assigneeId: assigneeId },
        { assigneeId: null, createdById: assigneeId },
      ];
    }
  }

  // Handle search - case-insensitive title search
  if (search && search.trim()) {
    whereClause.title = {
      contains: search.trim(),
      mode: "insensitive",
    };
  }

  // Handle needsAttention filter - features where last chat message is ASSISTANT and no tasks exist
  if (needsAttention) {
    const rows = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        SELECT f.id
        FROM features f
        WHERE f.workspace_id = ${workspaceId}
          AND f.deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.feature_id = f.id
              AND t.deleted = false
              AND t.archived = false
          )
          AND (
            SELECT role FROM chat_messages cm
            WHERE cm.feature_id = f.id
            ORDER BY cm.created_at DESC LIMIT 1
          ) = 'ASSISTANT'::"ChatRole"
      `
    );
    const ids = rows.map(r => r.id);
    if (ids.length === 0) {
      return {
        features: [],
        pagination: { page, limit, totalCount: 0, totalPages: 0, hasMore: false, totalCountWithoutFilters: 0 },
      };
    }
    whereClause.id = { in: ids };
  }

  // Build orderBy clause
  const orderByClause: any = sortBy
    ? { [sortBy]: sortOrder || "asc" }
    : { updatedAt: "desc" };

  const [rawFeatures, totalCount, totalCountWithoutFilters] = await Promise.all([
    db.features.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        assignee: {
          select: USER_SELECT,
        },
        createdBy: {
          select: USER_SELECT,
        },
        _count: {
          select: {
            userStories: true,
            tasks: { where: { deleted: false, archived: false } },
          },
        },
        chatMessages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true },
        },
        // Fetch tasks for deployment status calculation (excluding archived/deleted)
        phases: {
          select: {
            tasks: {
              where: {
                deleted: false,
                archived: false,
              },
              select: {
                id: true,
                deploymentStatus: true,
                deployedToProductionAt: true,
              },
            },
          },
        },
      },
      orderBy: orderByClause,
      skip,
      take: limit,
    }),
    db.features.count({
      where: whereClause,
    }),
    // Count total features in workspace without any filters (for UI logic)
    db.features.count({
      where: {
        workspaceId,
        deleted: false,
      },
    }),
  ]);

  // Compute awaitingFeedback and deployment status per feature
  const features = rawFeatures.map(feature => {
    // Compute awaitingFeedback: last chat message is ASSISTANT and no tasks exist
    const lastMsgRole = feature.chatMessages[0]?.role ?? null;
    const hasTasks = feature._count.tasks > 0;
    const awaitingFeedback = lastMsgRole === "ASSISTANT" && !hasTasks;

    // Calculate deployment status by aggregating all tasks across phases
    const allTasks = feature.phases?.flatMap(phase => phase.tasks) || [];
    let deploymentStatus: "staging" | "production" | null = null;
    let deploymentUrl: string | null = null;

    if (allTasks.length > 0) {
      const allProduction = allTasks.every(
        task => task.deploymentStatus === "production"
      );
      const allStagingOrProduction = allTasks.every(
        task => task.deploymentStatus === "staging" || task.deploymentStatus === "production"
      );

      if (allProduction) {
        deploymentStatus = "production";
        deploymentUrl = null; // Can be enhanced later to fetch actual URL
      } else if (allStagingOrProduction) {
        deploymentStatus = "staging";
      }
    }

    return {
      id: feature.id,
      title: feature.title,
      status: feature.status,
      priority: feature.priority,
      createdAt: feature.createdAt,
      updatedAt: feature.updatedAt,
      assignee: feature.assignee,
      createdBy: feature.createdBy,
      _count: {
        userStories: feature._count.userStories,
      },
      awaitingFeedback,
      deploymentStatus,
      deploymentUrl,
    };
  });

  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    features,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore,
      totalCountWithoutFilters,
    },
  };
}

/**
 * Creates a new feature
 */
export async function createFeature(
  userId: string,
  data: {
    title: string;
    workspaceId: string;
    status?: FeatureStatus;
    priority?: FeaturePriority;
    assigneeId?: string | null;
    brief?: string;
    requirements?: string;
    architecture?: string;
    personas?: string[];
    isFastTrack?: boolean;
  }
) {
  const workspaceAccess = await validateWorkspaceAccessById(data.workspaceId, userId);
  if (!workspaceAccess.hasAccess) {
    throw new Error("Access denied");
  }

  if (!data.title || !data.title.trim()) {
    throw new Error("Title is required");
  }

  const user = await db.users.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  validateEnum(data.status, FeatureStatus, "status");
  validateEnum(data.priority, FeaturePriority, "priority");

  if (data.assigneeId) {
    const assignee = await db.users.findFirst({
      where: {
        id: data.assigneeId,
        deleted: false,
      },
    });

    if (!assignee) {
      throw new Error("Assignee not found");
    }
  }

  const feature = await db.features.create({
    data: {
      title: data.title.trim(),
      brief: data.brief?.trim() || null,
      requirements: data.requirements?.trim() || null,
      architecture: data.architecture?.trim() || null,
      personas: data.personas || [],
      workspaceId: data.workspaceId,
      status: data.status || FeatureStatus.BACKLOG,
      priority: data.priority || FeaturePriority.LOW,
      assigneeId: data.assigneeId || null,
      isFastTrack: data.isFastTrack ?? false,
      createdById: userId,
      updatedById: userId,
      phases: {
        create: {
          name: "Phase 1",
          description: null,
          status: "NOT_STARTED",
          order: 0,
        },
      },
    },
    include: {
      assignee: {
        select: USER_SELECT,
      },
      createdBy: {
        select: USER_SELECT,
      },
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      _count: {
        select: {
          userStories: true,
        },
      },
    },
  });

  return feature;
}

/**
 * Updates a feature
 */
export async function updateFeature(
  featureId: string,
  userId: string,
  data: {
    title?: string;
    status?: FeatureStatus;
    priority?: FeaturePriority;
    assigneeId?: string | null;
    brief?: string | null;
    requirements?: string | null;
    architecture?: string | null;
    personas?: string[];
  }
) {
  // Validates access and throws specific "Feature not found" or "Access denied" errors
  await validateFeatureAccess(featureId, userId);

  validateEnum(data.status, FeatureStatus, "status");
  validateEnum(data.priority, FeaturePriority, "priority");

  if (data.assigneeId !== undefined && data.assigneeId !== null) {
    const assignee = await db.users.findFirst({
      where: {
        id: data.assigneeId,
      },
    });

    if (!assignee) {
      throw new Error("Assignee not found");
    }
  }

  const updateData: any = {
    updatedBy: {
      connect: {
        id: userId,
      },
    },
  };

  if (data.title !== undefined) {
    updateData.title = data.title.trim();
  }
  if (data.brief !== undefined) {
    updateData.brief = data.brief?.trim() || null;
  }
  if (data.requirements !== undefined) {
    updateData.requirements = data.requirements?.trim() || null;
  }
  if (data.architecture !== undefined) {
    updateData.architecture = data.architecture?.trim() || null;
  }
  if (data.personas !== undefined) {
    updateData.personas = data.personas;
  }
  if (data.status !== undefined) {
    updateData.status = data.status;
  }
  if (data.priority !== undefined) {
    updateData.priority = data.priority;
  }
  if (data.assigneeId !== undefined) {
    if (data.assigneeId === null) {
      updateData.assignee = { disconnect: true };
    } else {
      updateData.assignee = { connect: { id: data.assigneeId } };
    }
  }

  // Stamp planUpdatedAt only when user explicitly edits plan content
  const isPlanEdit =
    data.brief !== undefined ||
    data.requirements !== undefined ||
    data.architecture !== undefined;
  if (isPlanEdit) {
    updateData.planUpdatedAt = new Date();
  }

  const updatedFeature = await db.features.update({
    where: {
      id: featureId,
    },
    data: updateData,
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      assignee: {
        select: USER_SELECT,
      },
      createdBy: {
        select: USER_SELECT,
      },
      updatedBy: {
        select: USER_SELECT,
      },
      userStories: {
        orderBy: {
          order: "asc",
        },
      },
      phases: {
        where: {
          deleted: false,
        },
        orderBy: {
          order: "asc",
        },
        include: {
          tasks: {
            where: {
              deleted: false,
            },
            orderBy: {
              order: "asc",
            },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              order: true,
              featureId: true,
              phaseId: true,
              deleted: true,
              createdAt: true,
              updatedAt: true,
              systemAssigneeType: true,
              assignee: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      },
      tasks: {
        where: {
          phaseId: null,
          deleted: false,
        },
        orderBy: {
          order: "asc",
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          order: true,
          featureId: true,
          phaseId: true,
          deleted: true,
          createdAt: true,
          updatedAt: true,
          systemAssigneeType: true,
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      },
    },
  });

  // Transform system assignees to virtual user objects
  const transformedFeature = {
    ...updatedFeature,
    phases: updatedFeature.phases.map(phase => ({
      ...phase,
      tasks: phase.tasks.map(task => {
        if (task.systemAssigneeType && !task.assignee) {
          return {
            ...task,
            assignee: getSystemAssigneeUser(task.systemAssigneeType),
          };
        }
        return task;
      }),
    })),
    tasks: updatedFeature.tasks.map(task => {
      if (task.systemAssigneeType && !task.assignee) {
        return {
          ...task,
          assignee: getSystemAssigneeUser(task.systemAssigneeType),
        };
      }
      return task;
    }),
  };

  // Fire FEATURE_ASSIGNED notification (fire-and-forget)
  if (data.assigneeId && typeof data.assigneeId === "string" && data.assigneeId !== userId) {
    void (async () => {
      try {
        const featureForNotif = await db.features.findUnique({
          where: { id: featureId },
          select: { workspaceId: true, title: true, workspace: { select: { slug: true } } },
        });
        if (featureForNotif) {
          const featureUrl = `${process.env.NEXTAUTH_URL}/w/${featureForNotif.workspace.slug}/plan/${featureId}`;
          const [targetUser, originatingUser] = await Promise.all([
            db.users.findUnique({ where: { id: data.assigneeId! }, select: { sphinxAlias: true, name: true } }),
            db.users.findUnique({ where: { id: userId }, select: { name: true } }),
          ]);
          const alias = targetUser?.sphinxAlias ?? targetUser?.name ?? "User";
          const originatorName = originatingUser?.name ?? "Someone";
          await createAndSendNotification({
            targetUserId: data.assigneeId!,
            originatingUserId: userId,
            featureId,
            workspaceId: featureForNotif.workspaceId,
            notificationType: NotificationTriggerType.FEATURE_ASSIGNED,
            message: `@${alias} — ${originatorName} has assigned you to the feature '${featureForNotif.title}': ${featureUrl}`,
          });
        }
      } catch (notifError) {
        console.error("[updateFeature] Error firing FEATURE_ASSIGNED notification:", notifError);
      }
    })();
  }

  return transformedFeature;
}

/**
 * Soft deletes a feature
 */
export async function deleteFeature(
  featureId: string,
  userId: string
): Promise<void> {
  await validateFeatureAccess(featureId, userId);

  await db.features.update({
    where: { id: featureId },
    data: {
      deleted: true,
      deletedAt: new Date(),
    },
  });
}

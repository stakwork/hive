import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { validateFeatureAccess } from "./utils";
import { USER_SELECT } from "@/lib/db/selects";
import { validateEnum } from "@/lib/validators";

/**
 * Lists features for a workspace with pagination, filtering, and sorting
 */
export async function listFeatures({
  workspaceId,
  userId,
  page = 1,
  limit = 10,
  statuses,
  assigneeId,
  sortBy,
  sortOrder,
}: {
  workspaceId: string;
  userId: string;
  page?: number;
  limit?: number;
  statuses?: FeatureStatus[]; // Array of statuses for multi-select filtering
  assigneeId?: string; // String including "UNASSIGNED" special value
  sortBy?: "title" | "createdAt";
  sortOrder?: "asc" | "desc";
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

  // Handle assigneeId - convert "UNASSIGNED" to null for Prisma query
  if (assigneeId !== undefined) {
    if (assigneeId === "UNASSIGNED") {
      whereClause.assigneeId = null;
    } else {
      whereClause.assigneeId = assigneeId;
    }
  }

  // Build orderBy clause
  const orderByClause: any = sortBy
    ? { [sortBy]: sortOrder || "asc" }
    : { createdAt: "desc" };

  const [features, totalCount] = await Promise.all([
    db.feature.findMany({
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
          },
        },
      },
      orderBy: orderByClause,
      skip,
      take: limit,
    }),
    db.feature.count({
      where: whereClause,
    }),
  ]);

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
  }
) {
  const workspaceAccess = await validateWorkspaceAccessById(data.workspaceId, userId);
  if (!workspaceAccess.hasAccess) {
    throw new Error("Access denied");
  }

  if (!data.title || !data.title.trim()) {
    throw new Error("Title is required");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  validateEnum(data.status, FeatureStatus, "status");
  validateEnum(data.priority, FeaturePriority, "priority");

  if (data.assigneeId) {
    const assignee = await db.user.findFirst({
      where: {
        id: data.assigneeId,
        deleted: false,
      },
    });

    if (!assignee) {
      throw new Error("Assignee not found");
    }
  }

  const feature = await db.feature.create({
    data: {
      title: data.title.trim(),
      brief: data.brief?.trim() || null,
      requirements: data.requirements?.trim() || null,
      architecture: data.architecture?.trim() || null,
      personas: data.personas || [],
      workspaceId: data.workspaceId,
      status: data.status || FeatureStatus.BACKLOG,
      priority: data.priority || FeaturePriority.NONE,
      assigneeId: data.assigneeId || null,
      createdById: userId,
      updatedById: userId,
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
    const assignee = await db.user.findFirst({
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

  const updatedFeature = await db.feature.update({
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
    },
  });

  return updatedFeature;
}

/**
 * Soft deletes a feature
 */
export async function deleteFeature(
  featureId: string,
  userId: string
): Promise<void> {
  await validateFeatureAccess(featureId, userId);

  await db.feature.update({
    where: { id: featureId },
    data: {
      deleted: true,
      deletedAt: new Date(),
    },
  });
}

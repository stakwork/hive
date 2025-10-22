import { db } from "@/lib/db";

/**
 * Validates that a user has access to a feature through workspace membership
 * Throws specific errors for not found vs access denied scenarios
 */
export async function validateFeatureAccess(featureId: string, userId: string) {
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      id: true,
      workspaceId: true,
      deleted: true,
      workspace: {
        select: {
          id: true,
          ownerId: true,
          deleted: true,
          members: {
            where: { userId: userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!feature || feature.deleted || feature.workspace.deleted) {
    throw new Error("Feature not found or access denied");
  }

  const isOwner = feature.workspace.ownerId === userId;
  const isMember = feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  return feature;
}

/**
 * Validates that a user has access to a phase through its feature's workspace
 * Throws specific errors for not found vs access denied scenarios
 */
export async function validatePhaseAccess(phaseId: string, userId: string) {
  const phase = await db.phase.findUnique({
    where: { id: phaseId },
    select: {
      id: true,
      featureId: true,
      feature: {
        select: {
          id: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: userId },
                select: { role: true },
              },
            },
          },
        },
      },
    },
  });

  if (!phase || phase.feature.workspace.deleted) {
    throw new Error("Phase not found");
  }

  const isOwner = phase.feature.workspace.ownerId === userId;
  const isMember = phase.feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  return phase;
}

/**
 * Validates that a user has access to a roadmap task through its feature's workspace
 * Throws specific errors for not found vs access denied scenarios
 */
export async function validateRoadmapTaskAccess(taskId: string, userId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId, deleted: false },
    select: {
      id: true,
      featureId: true,
      feature: {
        select: {
          id: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: userId },
                select: { role: true },
              },
            },
          },
        },
      },
    },
  });

  if (!task || !task.feature || task.feature.workspace.deleted) {
    throw new Error("Task not found");
  }

  const isOwner = task.feature.workspace.ownerId === userId;
  const isMember = task.feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  return task;
}

// Backwards compatibility alias
export const validateTicketAccess = validateRoadmapTaskAccess;

/**
 * Validates that a user has access to a user story through its feature's workspace
 * Throws specific errors for not found vs access denied scenarios
 */
export async function validateUserStoryAccess(storyId: string, userId: string) {
  const story = await db.userStory.findUnique({
    where: { id: storyId },
    select: {
      id: true,
      featureId: true,
      feature: {
        select: {
          id: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: userId },
                select: { role: true },
              },
            },
          },
        },
      },
    },
  });

  if (!story || story.feature.workspace.deleted) {
    throw new Error("User story not found");
  }

  const isOwner = story.feature.workspace.ownerId === userId;
  const isMember = story.feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  return story;
}

/**
 * Calculates the next order value for an ordered entity
 *
 * Finds the maximum order value in the collection and returns the next order.
 * Returns 0 if no items exist in the collection.
 * Automatically filters out soft-deleted items for models that support soft deletion (Phase, Feature).
 * For models without soft deletion (Task, UserStory), uses the where clause as-is.
 *
 * @param model - Prisma model delegate (e.g., db.phase, db.task, db.userStory)
 * @param where - Filter conditions for the query
 * @param includeDeletedFilter - Whether to include deleted=false filter (default: false)
 * @returns The next order value to use
 *
 * @example
 * const nextOrder = await calculateNextOrder(db.phase, { featureId }, true);
 * const nextOrder = await calculateNextOrder(db.task, { featureId, phaseId });
 * const nextOrder = await calculateNextOrder(db.userStory, { featureId });
 */
export async function calculateNextOrder(
  model: any,
  where: Record<string, any>,
  includeDeletedFilter: boolean = false
): Promise<number> {
  const whereClause = includeDeletedFilter 
    ? { ...where, deleted: false } 
    : where;

  const maxOrderItem = await model.findFirst({
    where: whereClause,
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return (maxOrderItem?.order ?? -1) + 1;
}

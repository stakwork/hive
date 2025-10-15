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

  if (!feature || feature.workspace.deleted) {
    throw new Error("Feature not found");
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
 * Validates that a user has access to a ticket through its feature's workspace
 * Throws specific errors for not found vs access denied scenarios
 */
export async function validateTicketAccess(ticketId: string, userId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId, deleted: false },
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

  if (!ticket || ticket.feature.workspace.deleted) {
    throw new Error("Ticket not found");
  }

  const isOwner = ticket.feature.workspace.ownerId === userId;
  const isMember = ticket.feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  return ticket;
}

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
 *
 * @param model - Prisma model delegate (e.g., db.phase, db.ticket)
 * @param where - Filter conditions for the query
 * @returns The next order value to use
 *
 * @example
 * const nextOrder = await calculateNextOrder(db.phase, { featureId });
 * const nextOrder = await calculateNextOrder(db.ticket, { featureId, phaseId });
 */
export async function calculateNextOrder(
  model: any,
  where: Record<string, any>
): Promise<number> {
  const maxOrderItem = await model.findFirst({
    where,
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return (maxOrderItem?.order ?? -1) + 1;
}

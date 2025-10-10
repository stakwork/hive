import { db } from "@/lib/db";

/**
 * Validates that a user has access to a feature through workspace membership
 * Returns feature with workspace access info or null if no access
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

  if (!feature) {
    return null;
  }

  if (feature.workspace.deleted) {
    return null;
  }

  const isOwner = feature.workspace.ownerId === userId;
  const isMember = feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    return null;
  }

  return feature;
}

/**
 * Validates that a user has access to a phase through its feature's workspace
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

  if (!phase) {
    return null;
  }

  if (phase.feature.workspace.deleted) {
    return null;
  }

  const isOwner = phase.feature.workspace.ownerId === userId;
  const isMember = phase.feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    return null;
  }

  return phase;
}

/**
 * Validates that a user has access to a ticket through its feature's workspace
 */
export async function validateTicketAccess(ticketId: string, userId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
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

  if (!ticket) {
    return null;
  }

  if (ticket.feature.workspace.deleted) {
    return null;
  }

  const isOwner = ticket.feature.workspace.ownerId === userId;
  const isMember = ticket.feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    return null;
  }

  return ticket;
}

/**
 * Validates that a user has access to a user story through its feature's workspace
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

  if (!story) {
    return null;
  }

  if (story.feature.workspace.deleted) {
    return null;
  }

  const isOwner = story.feature.workspace.ownerId === userId;
  const isMember = story.feature.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    return null;
  }

  return story;
}

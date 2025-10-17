import { db } from "@/lib/db";

/**
 * Validates that a user has access to a swarm through workspace membership
 * Throws specific errors for not found vs access denied scenarios
 */
export async function validateSwarmAccess(swarmId: string, userId: string) {
  const swarm = await db.swarm.findUnique({
    where: { id: swarmId },
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

  if (!swarm || swarm.workspace.deleted) {
    throw new Error("Swarm not found");
  }

  const isOwner = swarm.workspace.ownerId === userId;
  const isMember = swarm.workspace.members.length > 0;

  if (!isOwner && !isMember) {
    throw new Error("Access denied");
  }

  return swarm;
}

/**
 * Validates that a user has access to a workspace
 * Throws specific errors for not found vs access denied scenarios
 */
export async function validateWorkspaceAccess(workspaceId: string, userId: string) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      ownerId: true,
      deleted: true,
      members: {
        where: { userId: userId },
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

  return workspace;
}

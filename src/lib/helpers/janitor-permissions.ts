import { db } from "@/lib/db";
import { JANITOR_PERMISSION_LEVELS, JANITOR_ERRORS } from "@/lib/constants/janitor";
import { WorkspaceRole } from "@prisma/client";

/**
 * Permission checking functions for janitor operations
 */

export async function getUserWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
    },
    select: {
      role: true,
    }
  });

  return member?.role || null;
}

export async function canViewJanitorConfig(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const role = await getUserWorkspaceRole(workspaceId, userId);
  return role ? JANITOR_PERMISSION_LEVELS.VIEW.includes(role) : false;
}

export async function canConfigureJanitor(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const role = await getUserWorkspaceRole(workspaceId, userId);
  return role ? JANITOR_PERMISSION_LEVELS.CONFIGURE.includes(role) : false;
}

export async function canExecuteJanitor(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const role = await getUserWorkspaceRole(workspaceId, userId);
  return role ? JANITOR_PERMISSION_LEVELS.EXECUTE.includes(role) : false;
}

export async function validateWorkspaceAccess(
  workspaceSlug: string,
  userId: string,
  requiredPermission: keyof typeof JANITOR_PERMISSION_LEVELS = "VIEW"
): Promise<{
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
  userRole: WorkspaceRole;
}> {
  // First check if workspace exists and user is a member
  const workspace = await db.workspace.findFirst({
    where: {
      slug: workspaceSlug,
      members: {
        some: { userId }
      }
    },
    select: {
      id: true,
      slug: true,
      name: true,
      members: {
        where: { userId },
        select: { role: true }
      }
    }
  });

  if (!workspace || workspace.members.length === 0) {
    throw new Error(JANITOR_ERRORS.WORKSPACE_NOT_FOUND);
  }

  // Then check if user has required permission level
  const userRole = workspace.members[0].role;
  if (!JANITOR_PERMISSION_LEVELS[requiredPermission].includes(userRole)) {
    throw new Error(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  return {
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
    },
    userRole,
  };
}

export async function validateWorkspaceMemberExists(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId
    }
  });

  return !!member;
}

export async function validateWorkspaceRepositoryExists(
  workspaceId: string,
  repositoryId: string
): Promise<boolean> {
  const repository = await db.repository.findFirst({
    where: {
      id: repositoryId,
      workspaceId
    }
  });

  return !!repository;
}
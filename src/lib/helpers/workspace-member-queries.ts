import { db } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_MEMBER_INCLUDE, type PrismaWorkspaceMemberWithUser } from "@/lib/mappers/workspace-member";

/**
 * Finds a user by GitHub username with their user profile
 */
export async function findUserByGitHubUsername(githubUsername: string) {
  return await db.gitHubAuth.findFirst({
    where: { githubUsername },
    include: { user: true },
  });
}

/**
 * Finds an active workspace member
 */
export async function findActiveMember(workspaceId: string, userId: string) {
  return await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
      leftAt: null,
    },
  });
}

/**
 * Finds the most recent previous membership (soft deleted)
 */
export async function findPreviousMember(workspaceId: string, userId: string) {
  return await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
      leftAt: { not: null },
    },
    orderBy: { leftAt: "desc" }, // Get the most recent membership
  });
}

/**
 * Checks if a user is the workspace owner
 */
export async function isWorkspaceOwner(workspaceId: string, userId: string): Promise<boolean> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  return workspace?.ownerId === userId;
}

/**
 * Creates a new workspace member
 */
export async function createWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<PrismaWorkspaceMemberWithUser> {
  return await db.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      role,
    },
    include: WORKSPACE_MEMBER_INCLUDE,
  });
}

/**
 * Reactivates a previously removed member with a new role
 */
export async function reactivateWorkspaceMember(
  memberId: string,
  role: WorkspaceRole
): Promise<PrismaWorkspaceMemberWithUser> {
  return await db.workspaceMember.update({
    where: { id: memberId },
    data: {
      role,
      leftAt: null, // Reactivate by clearing leftAt
      joinedAt: new Date(), // Update join date to current time
    },
    include: WORKSPACE_MEMBER_INCLUDE,
  });
}

/**
 * Gets all active workspace members
 */
export async function getActiveWorkspaceMembers(workspaceId: string): Promise<PrismaWorkspaceMemberWithUser[]> {
  return await db.workspaceMember.findMany({
    where: {
      workspaceId,
      leftAt: null,
    },
    include: WORKSPACE_MEMBER_INCLUDE,
    orderBy: { joinedAt: "asc" },
  });
}

/**
 * Updates a workspace member's role
 */
export async function updateMemberRole(
  memberId: string,
  role: WorkspaceRole
): Promise<PrismaWorkspaceMemberWithUser> {
  return await db.workspaceMember.update({
    where: { id: memberId },
    data: { role },
    include: WORKSPACE_MEMBER_INCLUDE,
  });
}

/**
 * Soft deletes a workspace member by setting leftAt timestamp
 */
export async function softDeleteMember(memberId: string): Promise<void> {
  await db.workspaceMember.update({
    where: { id: memberId },
    data: { leftAt: new Date() },
  });
}